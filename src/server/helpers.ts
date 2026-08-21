import type { Socket } from 'node:net'
import type { WaitOptions } from '@src/core'
import type { InventoryOptions, ScratchIdentity, ScratchInterface } from './types.js'
import {
	lstatSync,
	readdirSync,
	readFileSync,
	realpathSync,
	rmSync,
	statSync,
	symlinkSync,
} from 'node:fs'
import { dirname, isAbsolute, relative, resolve, sep } from 'node:path'
import { fileURLToPath } from 'node:url'
import { waitForDelay } from '@src/core'
import {
	REMOVE_TREE_MAX_ATTEMPTS,
	REMOVE_TREE_RETRY_DELAY_MS,
	REMOVE_TREE_RETRYABLE_CODES,
} from './constants.js'

/**
 * Resolves a target that stays below a root directory.
 *
 * @param root - The absolute root directory.
 * @param target - The relative or absolute target to resolve.
 * @returns The absolute target, or `undefined` when the target escapes the root.
 */
export function resolveContained(root: string, target: string): string | undefined {
	const candidate = resolve(root, target)
	const contained = relative(root, candidate)
	// Cross-drive containment is unproven because POSIX `relative` never returns an absolute path;
	// a Windows gate would drive this branch.
	if (contained === '..' || contained.startsWith(`..${sep}`) || isAbsolute(contained)) {
		return undefined
	}
	return candidate
}

/**
 * Reports whether two directory identities name the same allocation.
 *
 * @param current - The identity read from the path now.
 * @param allocation - The identity recorded when the directory was allocated.
 * @returns Whether the device, the index node, and the creation time all match.
 * @remarks All three fields are compared because none of them alone identifies an allocation. A
 * device is shared by every directory on one filesystem, an index node is reused once its directory
 * is removed, and a creation time repeats within the host's timestamp resolution.
 */
export function matchesIdentity(current: ScratchIdentity, allocation: ScratchIdentity): boolean {
	return (
		current.device === allocation.device &&
		current.inode === allocation.inode &&
		current.birth === allocation.birth
	)
}

/**
 * Reports whether a root-relative key matches an exclusion.
 *
 * @param key - The root-relative key to test.
 * @param exclusions - The normalized root-relative exclusion keys.
 * @returns Whether an exclusion names the key or one of its ancestors.
 */
export function isExcluded(key: string, exclusions: readonly string[]): boolean {
	return exclusions.some((rule) => rule === '' || key === rule || key.startsWith(`${rule}/`))
}

/**
 * Creates a symbolic link with a directory-junction fallback for hosts that refuse symbolic links.
 *
 * @param path - The path where the link is created.
 * @param source - The destination path the link points at.
 * @throws The original link error when its code is not `EPERM`, or when the source names an
 * existing non-directory; otherwise, any error from inspecting the source or creating the junction.
 * @remarks Only `EPERM` from the first symbolic-link attempt triggers the fallback. The fallback
 * resolves the source against the link's directory. An existing non-directory rethrows the original
 * `EPERM`, while a directory or missing source is passed to a junction attempt. A missing source is
 * accepted to create a dangling junction. Where the host creates a junction, its stored value is the
 * resolved absolute path.
 */
export function createLink(path: string, source: string): void {
	try {
		symlinkSync(source, path)
	} catch (error) {
		const code =
			typeof error === 'object' &&
			error !== null &&
			'code' in error &&
			typeof error.code === 'string'
				? error.code
				: undefined
		if (code !== 'EPERM') throw error

		const resolved = resolve(dirname(path), source)
		const status = statSync(resolved, { throwIfNoEntry: false })
		if (status !== undefined && !status.isDirectory()) throw error
		symlinkSync(resolved, path, 'junction')
	}
}

/**
 * Removes a directory tree, retrying past a transient Windows handle-release race.
 *
 * @param path - The absolute directory to remove.
 * @throws The last removal error once {@link REMOVE_TREE_MAX_ATTEMPTS} attempts are exhausted,
 * or immediately for any error whose code is not in {@link REMOVE_TREE_RETRYABLE_CODES}.
 * @remarks On Windows, a directory that a just-exited process still holds as its current
 * working directory throws `EPERM` for a short interval after that process exits. Node's own
 * `rmSync` `maxRetries`/`retryDelay` options do not cover this error class on that host: probed
 * against a real held directory, they neither delay nor retry before rethrowing, so the retry
 * is implemented here with a synchronous sleep instead. Ten attempts 100ms apart bound the wait
 * at roughly one second. A hold that outlasts that second is {@link destroyScratch}'s case, which
 * retries every refusal inside a caller's budget rather than the codes named here.
 */
export function removeTree(path: string): void {
	for (let attempt = 1; ; attempt++) {
		try {
			rmSync(path, { force: true, recursive: true })
			return
		} catch (error) {
			const code =
				typeof error === 'object' &&
				error !== null &&
				'code' in error &&
				typeof error.code === 'string'
					? error.code
					: undefined
			if (
				code === undefined ||
				!REMOVE_TREE_RETRYABLE_CODES.includes(code) ||
				attempt >= REMOVE_TREE_MAX_ATTEMPTS
			) {
				throw error
			}
			Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, REMOVE_TREE_RETRY_DELAY_MS)
		}
	}
}

/**
 * Reads files from selected targets below a root directory.
 *
 * @param root - The root directory as a path or file URL.
 * @param targets - The files to read directly and directories to visit below the root.
 * @param options - Optional file extension and path exclusions.
 * @returns File contents keyed by sorted root-relative paths.
 * @throws When the root or a named target is a symbolic link, is not a supported entry, or resolves
 * outside the root.
 * @remarks A named file is included regardless of the extension filter. An absent extension filter
 * includes every walked file. An exclusion matches whole root-relative key segments and covers every
 * key below it, and it applies to a named target and a walked entry alike.
 */
export function readInventory(
	root: URL | string,
	targets: readonly string[],
	options?: InventoryOptions,
): Readonly<Record<string, string>> {
	const supplied = resolve(typeof root === 'string' ? root : fileURLToPath(root))
	const rootStatus = lstatSync(supplied)
	if (rootStatus.isSymbolicLink()) throw new Error('Root is a symbolic link')
	if (!rootStatus.isDirectory()) throw new Error('Root is not a directory')

	const base = realpathSync.native(supplied)
	if (targets.length === 0) return Object.fromEntries([])

	const exclusions = (options?.exclude ?? []).map((rule) => {
		const unprefixed = rule.startsWith('./') ? rule.slice(2) : rule
		const collapsed = unprefixed.replace(/\/+/g, '/')
		const untrailed = collapsed.endsWith('/') ? collapsed.slice(0, -1) : collapsed
		return untrailed === '.' ? '' : untrailed
	})
	const pending: string[] = []
	const queued = new Set<string>()
	const contents = new Map<string, string>()

	for (const target of targets) {
		const candidate = resolveContained(base, target)
		if (candidate === undefined) {
			throw new Error(`Target outside root: ${target}`)
		}

		const status = lstatSync(candidate)
		if (status.isSymbolicLink()) throw new Error(`Target is a symbolic link: ${target}`)
		if (!status.isDirectory() && !status.isFile()) {
			throw new Error(`Target is not a file or directory: ${target}`)
		}

		const physical = realpathSync.native(candidate)
		const resolved = resolveContained(base, relative(base, physical))
		if (resolved === undefined) {
			throw new Error(`Target outside root: ${target}`)
		}

		const key = relative(base, resolved).split(sep).join('/')
		if (isExcluded(key, exclusions)) continue
		if (status.isFile()) {
			contents.set(key, readFileSync(physical, 'utf8'))
			continue
		}
		if (queued.has(physical)) continue
		queued.add(physical)
		pending.push(physical)
	}

	while (pending.length > 0) {
		const directory = pending.pop()
		if (directory === undefined) continue

		for (const entry of readdirSync(directory, { withFileTypes: true })) {
			const path = resolve(directory, entry.name)
			const status = lstatSync(path)
			if (status.isSymbolicLink()) continue

			const key = relative(base, path).split(sep).join('/')
			if (isExcluded(key, exclusions)) continue

			if (status.isDirectory()) {
				const physical = realpathSync.native(path)
				const resolved = resolveContained(base, relative(base, physical))
				// Walk containment is unproven because POSIX CI skips links before `realpath`;
				// a host that resolves a walked directory outside `base` would drive this branch.
				if (resolved === undefined || queued.has(physical)) {
					continue
				}
				queued.add(physical)
				pending.push(physical)
				continue
			}

			if (
				!status.isFile() ||
				(options?.extensions !== undefined &&
					!options.extensions.some((extension) => entry.name.endsWith(extension)))
			) {
				continue
			}
			contents.set(key, readFileSync(path, 'utf8'))
		}
	}

	return Object.fromEntries(
		Array.from(contents).sort(([left], [right]) => (left < right ? -1 : left > right ? 1 : 0)),
	)
}

/**
 * Reports whether a process id names a live process.
 *
 * @param pid - The process id to read.
 * @returns True if a process holds that id at the moment of the call; false otherwise, including a
 * pid the host refuses.
 * @throws Nothing. Every host refusal reads as false.
 * @remarks This is an instantaneous observation rather than a claim of ownership. A host reuses a
 * process id after the process holding it exits, so a true answer says some process holds that id now
 * and never says it is the process the caller started. Two host answers are worth knowing. A POSIX
 * host refuses signal `0` to a process another user owns with `EPERM`, and that refusal reads as
 * false here. A pid of `0` names the caller's own process group on POSIX and the system idle process
 * on Windows, so it reads as true on both without naming a process anyone started.
 *
 * A Linux zombie — a process that has exited and whose parent has not reaped it — still accepts
 * signal `0`, so its `/proc` status is read and a `Z` state reads as false.
 */
export function isRunning(pid: number): boolean {
	try {
		process.kill(pid, 0)
	} catch {
		return false
	}
	if (process.platform !== 'linux') return true

	// The zombie refinement is unproven on a host that carries no `/proc`; a Linux gate drives it.
	try {
		const status = readFileSync(`/proc/${String(pid)}/stat`, 'utf8')
		const boundary = status.lastIndexOf(') ')
		return boundary < 0 || status.slice(boundary + 2, boundary + 3) !== 'Z'
	} catch {
		return false
	}
}

/**
 * Waits for a socket to close, accepting a peer reset as a forced close.
 *
 * @param socket - The socket to wait on. One that has already closed resolves without listening.
 * @param options - The time bounds and abort signal.
 * @returns A promise that resolves when the socket emits `close`.
 * @throws The socket's own error when its code is not `ECONNRESET`, the abort reason, or an `Error`
 * when a bound is invalid or the socket does not close within the budget.
 * @remarks Default budget: `1000` milliseconds. A reset is the peer forcing the connection down, and
 * the socket still emits `close` afterwards, so `ECONNRESET` is waited past rather than raised while
 * every other error ends the wait. The interval is validated for consistency with the wait family but
 * is not used, because this helper parks on the socket's events. Both listeners are removed on every
 * settlement, so a caller may wait on one socket repeatedly.
 */
export async function waitForSocketClose(socket: Socket, options?: WaitOptions): Promise<void> {
	const budget = options?.budget ?? 1000
	const interval = options?.interval ?? 10
	if (!Number.isFinite(budget) || budget < 0) {
		throw new Error('Socket budget must be finite and non-negative')
	}
	if (!Number.isFinite(interval) || interval < 0) {
		throw new Error('Socket interval must be finite and non-negative')
	}

	const signal = options?.signal
	signal?.throwIfAborted()
	if (socket.closed) return

	// The resolvers are the listeners themselves, so the same references remove them afterwards.
	const closed = Promise.withResolvers<boolean>()
	const failed = Promise.withResolvers<NodeJS.ErrnoException>()
	const expiry = Promise.withResolvers<never>()
	const aborted = Promise.withResolvers<never>()
	const subscription = new AbortController()
	socket.on('close', closed.resolve)
	socket.on('error', failed.resolve)
	signal?.addEventListener('abort', () => aborted.reject(signal.reason), {
		once: true,
		signal: subscription.signal,
	})
	const timer = setTimeout(() => {
		expiry.reject(new Error(`Socket did not close within ${budget}ms`))
	}, budget)

	try {
		const error = await Promise.race([
			closed.promise.then(() => undefined),
			failed.promise,
			expiry.promise,
			aborted.promise,
		])
		if (error === undefined) return
		if (error.code !== 'ECONNRESET') throw error
		await Promise.race([closed.promise, expiry.promise, aborted.promise])
	} finally {
		clearTimeout(timer)
		subscription.abort()
		socket.off('close', closed.resolve)
		socket.off('error', failed.resolve)
	}
}

/**
 * Destroys a scratch directory, retrying until the host releases it.
 *
 * @param scratch - The scratch directory to destroy.
 * @param options - The time bounds and abort signal.
 * @returns A promise that resolves once `destroy()` returns without throwing.
 * @throws The abort reason, or an `Error` when a bound is invalid or the budget elapses. The
 * exhaustion error carries the last host refusal as its `cause`.
 * @remarks Default budget: `10000` milliseconds. Default interval: `25` milliseconds. A host holds a
 * directory for a short interval after the process that held it exits, and a just-stopped child's
 * working directory is the case this exists for, so removal is attempted until the host lets go
 * rather than exactly once. {@link ScratchInterface.destroy} stays synchronous and is unchanged; this
 * is the bounded retry around it. A directory nothing releases still fails, with the host's own
 * refusal as the `cause`.
 *
 * Every refusal is retried, deliberately, and that is wider than {@link removeTree}'s policy: that
 * one retries the codes {@link REMOVE_TREE_RETRYABLE_CODES} names and rethrows the rest at once.
 * The hold this waits out is not classifiable across hosts — Windows reports a working-directory
 * hold as `EPERM`, POSIX hosts and network filesystems report their own — so a code list here would
 * be a list of the hosts it had been run on. The residual is the cost of that: a fault no wait can
 * clear, such as a path removed from under the allocation or a permission the process never had,
 * spends the whole budget before it surfaces, and it surfaces wrapped in the exhaustion error with
 * the host's refusal as `cause` rather than by identity. Pass a shorter `budget` or a `signal`
 * wherever a caller must bound that cost.
 */
export async function destroyScratch(
	scratch: ScratchInterface,
	options?: WaitOptions,
): Promise<void> {
	const budget = options?.budget ?? 10_000
	const interval = options?.interval ?? 25
	if (!Number.isFinite(budget) || budget < 0) {
		throw new Error('Scratch budget must be finite and non-negative')
	}
	if (!Number.isFinite(interval) || interval < 0) {
		throw new Error('Scratch interval must be finite and non-negative')
	}

	const start = performance.now()
	let refusal: unknown
	while (true) {
		options?.signal?.throwIfAborted()
		try {
			scratch.destroy()
			return
		} catch (error) {
			refusal = error
		}

		if (performance.now() - start >= budget) {
			throw new Error(`Scratch directory was not destroyed within ${budget}ms`, {
				cause: refusal,
			})
		}
		await waitForDelay(interval)
	}
}
