import type { InventoryOptions, ScratchIdentity } from './types.js'
import { lstatSync, readdirSync, readFileSync, realpathSync, rmSync } from 'node:fs'
import { isAbsolute, relative, resolve, sep } from 'node:path'
import { fileURLToPath } from 'node:url'
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
 * at roughly one second.
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
