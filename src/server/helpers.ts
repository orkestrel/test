import type { InventoryOptions } from './types.js'
import { lstatSync, readdirSync, readFileSync, realpathSync } from 'node:fs'
import { isAbsolute, relative, resolve, sep } from 'node:path'
import { fileURLToPath } from 'node:url'

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
	if (contained === '..' || contained.startsWith(`..${sep}`) || isAbsolute(contained)) {
		return undefined
	}
	return candidate
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

	const exclusions = options?.exclude ?? []
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
		if (exclusions.some((rule) => key === rule || key.startsWith(`${rule}/`))) continue
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
			if (exclusions.some((rule) => key === rule || key.startsWith(`${rule}/`))) continue

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
