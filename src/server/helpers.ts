import type { Socket } from 'node:net'
import type { WaitOptions } from '@src/core'
import type {
	InventoryOptions,
	ScratchIdentity,
	ScratchInterface,
	UpgradeOptions,
	UpgradeResult,
} from './types.js'
import { Buffer } from 'node:buffer'
import {
	lstatSync,
	mkdirSync,
	mkdtempSync,
	readdirSync,
	readFileSync,
	realpathSync,
	rmSync,
	statSync,
	symlinkSync,
	writeFileSync,
} from 'node:fs'
import { request as requestHTTP } from 'node:http'
import { tmpdir } from 'node:os'
import { dirname, isAbsolute, join, relative, resolve, sep } from 'node:path'
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

/**
 * Drives a real client upgrade request against a loopback port and reports what the server did.
 *
 * @param port - The port the server listens on at `127.0.0.1`.
 * @param options - Optional request path and offered subprotocols.
 * @returns A promise resolving to the server's answer: a claimed upgrade with the protocol it
 * selected, or a refusal with the status it answered.
 * @throws The client's own transport error, such as the `ECONNREFUSED` a closed port answers.
 * @remarks The request carries `Connection: Upgrade` and `Upgrade: websocket`, which is what makes a
 * server's `upgrade` handler the one that answers it. The `upgrade`, `response`, and `error` events
 * are mutually exclusive in practice and the promise settles on whichever arrives first, so a second
 * event changes nothing. The client socket is destroyed before every settlement, on the claimed path
 * because an upgraded socket is detached from the request and outlives it otherwise. The request is
 * made with no agent, so no pooled connection survives the call to keep a suite's event loop alive.
 *
 * A `101` is the claimed path's status on the wire and is deliberately not reported: `status` is the
 * plain answer's status, and a claimed upgrade produced no plain answer.
 * @example
 * ```ts
 * const answer = await requestUpgrade(loopback.port, { path: '/socket', protocols: ['chat'] })
 * // { claimed: true, status: undefined, protocol: 'chat' }
 * ```
 */
export async function requestUpgrade(
	port: number,
	options?: UpgradeOptions,
): Promise<UpgradeResult> {
	const headers: Record<string, string> = { connection: 'Upgrade', upgrade: 'websocket' }
	const protocols = options?.protocols ?? []
	if (protocols.length > 0) headers['sec-websocket-protocol'] = protocols.join(', ')

	const request = requestHTTP({
		agent: false,
		headers,
		host: '127.0.0.1',
		path: options?.path ?? '/',
		port,
	})
	const settled = Promise.withResolvers<UpgradeResult>()
	request.on('upgrade', (response, socket) => {
		const protocol = response.headers['sec-websocket-protocol']
		socket.destroy()
		settled.resolve({ claimed: true, protocol, status: undefined })
	})
	request.on('response', (response) => {
		const status = response.statusCode
		response.destroy()
		request.destroy()
		settled.resolve({ claimed: false, protocol: undefined, status })
	})
	request.on('error', (error) => {
		request.destroy()
		settled.reject(error)
	})
	request.end()

	try {
		return await settled.promise
	} finally {
		request.destroy()
	}
}

/**
 * Checks whether this host links a directory, by creating one link and reading through it.
 *
 * @returns True if the created link reports as a symbolic link, resolves to a directory, and reaches
 * the destination's contents; false otherwise, including every host refusal.
 * @throws Nothing the attempt itself raises. Failing to allocate the probe directory, and failing to
 * remove it afterwards, both propagate.
 * @remarks `symlinkSync(source, target, 'junction')` creates a directory junction on Windows, which
 * needs no privilege, and Node ignores the type argument off Windows, so one call covers both hosts.
 * The answer is false on a filesystem carrying neither reparse points nor symbolic links. Every call
 * probes and cleans up after itself, so a host whose answer changes is read again rather than
 * remembered.
 */
export function supportsDirectoryLinks(): boolean {
	const directory = mkdtempSync(join(tmpdir(), 'orkestrel-test-directory-links-'))
	try {
		const source = join(directory, 'source')
		const link = join(directory, 'link')
		mkdirSync(source)
		writeFileSync(join(source, 'marker.txt'), 'marked')
		symlinkSync(source, link, 'junction')
		return (
			lstatSync(link).isSymbolicLink() &&
			statSync(link).isDirectory() &&
			readFileSync(join(link, 'marker.txt'), 'utf8') === 'marked'
		)
	} catch {
		return false
	} finally {
		removeTree(directory)
	}
}

/**
 * Checks whether this host links a file, by creating one link and reading the file through it.
 *
 * @returns True if the file's contents are readable through the link; false otherwise, including
 * every host refusal.
 * @throws Nothing the attempt itself raises. Failing to allocate the probe directory, and failing to
 * remove it afterwards, both propagate.
 * @remarks `symlinkSync(source, target, 'file')` needs the symbolic-link privilege, which Windows
 * grants under Developer Mode or administrator rights and refuses with `EPERM` otherwise, so the
 * answer is true on POSIX and on a privileged Windows host. Where it is false, no mechanism reaches a
 * file through a link and a proof that reads one back cannot run. This is a separate question from
 * {@link supportsDirectoryLinks}, which an unprivileged Windows host answers true through a junction
 * while answering this one false.
 */
export function supportsFileLinks(): boolean {
	const directory = mkdtempSync(join(tmpdir(), 'orkestrel-test-file-links-'))
	try {
		const source = join(directory, 'source.txt')
		const link = join(directory, 'link.txt')
		writeFileSync(source, 'linked')
		symlinkSync(source, link, 'file')
		return readFileSync(link, 'utf8') === 'linked'
	} catch {
		return false
	} finally {
		removeTree(directory)
	}
}

/**
 * Checks whether POSIX permission bits round-trip through this host's `chmod` and `stat`.
 *
 * @returns True if a directory created with mode `0o700` reports that mode back; false otherwise,
 * including every host refusal.
 * @throws Nothing the attempt itself raises. Failing to allocate the probe directory, and failing to
 * remove it afterwards, both propagate.
 * @remarks POSIX reports `mode & 0o777 === 0o700` and Windows reports `0o666` regardless, so the
 * answer is true on POSIX and false on Windows. Storing a bit is a narrower question than enforcing
 * it: a POSIX host running as uid `0` stores every bit faithfully and bypasses the access check the
 * bits describe, so a caller that needs a permission to be enforced probes the refusal it needs
 * rather than reading this.
 */
export function supportsMode(): boolean {
	const directory = mkdtempSync(join(tmpdir(), 'orkestrel-test-mode-'))
	try {
		const path = join(directory, 'moded')
		mkdirSync(path, { mode: 0o700 })
		return (statSync(path).mode & 0o777) === 0o700
	} catch {
		return false
	} finally {
		removeTree(directory)
	}
}

/**
 * Checks whether this host treats two names differing only by case as distinct files.
 *
 * @returns True if `A` and `a` hold the contents each was written with; false otherwise, including
 * every host refusal.
 * @throws Nothing the attempt itself raises. Failing to allocate the probe directory, and failing to
 * remove it afterwards, both propagate.
 * @remarks The names `A` and `a` differ by case and by nothing else, which is what makes the reading
 * an answer about case folding rather than an answer about two unrelated files. A case-folding volume
 * routes the second write onto the first entry, so reading the first back returns the second's
 * contents and the answer is false. The answer is true on a typical POSIX host and false on a
 * case-folding Windows or macOS volume.
 */
export function supportsCase(): boolean {
	const directory = mkdtempSync(join(tmpdir(), 'orkestrel-test-case-'))
	try {
		const upper = join(directory, 'A')
		const lower = join(directory, 'a')
		writeFileSync(upper, 'upper')
		writeFileSync(lower, 'lower')
		return readFileSync(upper, 'utf8') === 'upper' && readFileSync(lower, 'utf8') === 'lower'
	} catch {
		return false
	} finally {
		removeTree(directory)
	}
}

/**
 * Checks whether this host accepts a filename carrying a raw byte no UTF-8 decoder resolves.
 *
 * @returns True if a name ending in byte `0x80` is written and read back; false otherwise, including
 * every host refusal.
 * @throws Nothing the attempt itself raises. Failing to allocate the probe directory, and failing to
 * remove it afterwards, both propagate.
 * @remarks Byte `0x80` is an invalid UTF-8 lead byte. POSIX stores the name verbatim and Windows
 * rejects it with `ENOENT`, so the answer is true on POSIX and false on Windows. The path is passed
 * as a `Buffer` because the byte survives no string round trip.
 */
export function supportsBytes(): boolean {
	const directory = mkdtempSync(join(tmpdir(), 'orkestrel-test-bytes-'))
	try {
		const name = Buffer.concat([Buffer.from(`${directory}${sep}`), Buffer.from([0x80])])
		writeFileSync(name, 'raw')
		return readFileSync(name, 'utf8') === 'raw'
	} catch {
		return false
	} finally {
		removeTree(directory)
	}
}
