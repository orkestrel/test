import type { InventoryOptions } from './types.js'
import { lstatSync, readdirSync, readFileSync, realpathSync } from 'node:fs'
import { isAbsolute, relative, resolve, sep } from 'node:path'
import { fileURLToPath } from 'node:url'

/**
 * Resolves a relative target that stays below a root directory.
 *
 * @param root - The absolute root directory.
 * @param target - The relative target to resolve.
 * @returns The absolute target, or `undefined` when the target escapes the root.
 */
export function resolveContained(root: string, target: string): string | undefined {
	const candidate = resolve(root, target)
	const contained = relative(root, candidate)
	if (
		isAbsolute(target) ||
		contained === '..' ||
		contained.startsWith(`..${sep}`) ||
		isAbsolute(contained)
	) {
		return undefined
	}
	return candidate
}

/**
 * Reports whether an existing segment from a root through a target is a symbolic link.
 *
 * @param root - The absolute root directory.
 * @param target - The absolute target below the root.
 * @returns True when an existing path segment is a symbolic link.
 */
export function hasSymbolicLink(root: string, target: string): boolean {
	let current = root
	const rootStatus = lstatSync(current, { throwIfNoEntry: false })
	if (rootStatus?.isSymbolicLink() === true) return true
	if (rootStatus === undefined) return false

	for (const segment of relative(root, target).split(sep)) {
		if (segment.length === 0) continue
		current = resolve(current, segment)
		const status = lstatSync(current, { throwIfNoEntry: false })
		if (status === undefined) return false
		if (status.isSymbolicLink()) return true
	}
	return false
}

/**
 * Reads files from selected directories below a root directory.
 *
 * @param root - The root directory as a path or file URL.
 * @param directories - The directories to visit below the root.
 * @param options - Optional file extension and exact-path exclusions.
 * @returns File contents keyed by sorted root-relative paths.
 * @remarks An absent extension filter includes every file. Exclusions match full root-relative keys.
 */
export function readInventory(
	root: URL | string,
	directories: readonly string[],
	options?: InventoryOptions,
): Readonly<Record<string, string>> {
	const supplied = resolve(typeof root === 'string' ? root : fileURLToPath(root))
	const rootStatus = lstatSync(supplied)
	if (rootStatus.isSymbolicLink()) throw new Error('Root is a symbolic link')
	if (!rootStatus.isDirectory()) throw new Error('Root is not a directory')

	const base = realpathSync.native(supplied)
	if (directories.length === 0) return Object.fromEntries([])

	const excluded = new Set(options?.exclude)
	const pending: string[] = []
	const queued = new Set<string>()
	const contents = new Map<string, string>()

	for (const directory of directories) {
		const candidate = resolveContained(base, directory)
		if (candidate === undefined) {
			throw new Error(`Directory outside root: ${directory}`)
		}

		const status = lstatSync(candidate)
		if (status.isSymbolicLink()) throw new Error(`Directory is a symbolic link: ${directory}`)
		if (!status.isDirectory()) throw new Error(`Not a directory: ${directory}`)

		const physical = realpathSync.native(candidate)
		const resolved = resolveContained(base, relative(base, physical))
		if (resolved === undefined) {
			throw new Error(`Directory outside root: ${directory}`)
		}

		const key = relative(base, resolved).split(sep).join('/')
		if (excluded.has(key) || queued.has(physical)) continue
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
			if (excluded.has(key)) continue

			if (status.isDirectory()) {
				const physical = realpathSync.native(path)
				const resolved = resolveContained(base, relative(base, physical))
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
