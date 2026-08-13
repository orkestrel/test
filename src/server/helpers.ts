import type { InventoryOptions } from './types.js'
import { lstatSync, readdirSync, readFileSync, realpathSync } from 'node:fs'
import { isAbsolute, relative, resolve, sep } from 'node:path'
import { fileURLToPath } from 'node:url'

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
	if (directories.length === 0) return {}

	const supplied = typeof root === 'string' ? root : fileURLToPath(root)
	const rootStatus = lstatSync(supplied)
	if (rootStatus.isSymbolicLink()) throw new Error('Root is a symbolic link')
	if (!rootStatus.isDirectory()) throw new Error('Root is not a directory')

	const base = realpathSync.native(supplied)
	const excluded = new Set(options?.exclude)
	const pending: string[] = []
	const queued = new Set<string>()
	const contents = new Map<string, string>()

	for (const directory of directories) {
		const candidate = directory === '.' ? base : resolve(base, directory)
		const requested = relative(base, candidate)
		if (requested === '..' || requested.startsWith(`..${sep}`) || isAbsolute(requested)) {
			throw new Error(`Directory outside root: ${directory}`)
		}

		const status = lstatSync(candidate)
		if (status.isSymbolicLink()) throw new Error(`Directory is a symbolic link: ${directory}`)
		if (!status.isDirectory()) throw new Error(`Not a directory: ${directory}`)

		const physical = realpathSync.native(candidate)
		const resolved = relative(base, physical)
		if (resolved === '..' || resolved.startsWith(`..${sep}`) || isAbsolute(resolved)) {
			throw new Error(`Directory outside root: ${directory}`)
		}

		const key = resolved.split(sep).join('/')
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
				const resolved = relative(base, physical)
				if (
					resolved === '..' ||
					resolved.startsWith(`..${sep}`) ||
					isAbsolute(resolved) ||
					queued.has(physical)
				) {
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

	const files: Record<string, string> = {}
	for (const key of Array.from(contents.keys()).sort()) {
		const value = contents.get(key)
		if (value !== undefined) files[key] = value
	}
	return files
}
