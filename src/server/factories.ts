import type { ScratchInterface, ScratchOptions } from './types.js'
import { lstatSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, isAbsolute, relative, resolve, sep } from 'node:path'

/**
 * Allocates an owned temporary directory with contained file operations.
 *
 * @param options - Optional directory prefix and initial files.
 * @returns The scratch directory and its file operations.
 * @remarks The prefix defaults to `orkestrel-test-`. Seed keys use root-relative paths.
 */
export function createScratch(options?: ScratchOptions): ScratchInterface {
	const temporary = resolve(tmpdir())
	const prefix = resolve(temporary, options?.prefix ?? 'orkestrel-test-')
	if (dirname(prefix) !== temporary)
		throw new Error('Scratch prefix must stay within the temporary directory')

	const path = mkdtempSync(prefix)
	try {
		for (const [target, text] of Object.entries(options?.files ?? {})) {
			const candidate = resolve(path, target)
			const contained = relative(path, candidate)
			if (
				isAbsolute(target) ||
				contained === '..' ||
				contained.startsWith(`..${sep}`) ||
				isAbsolute(contained)
			) {
				throw new Error(`Path outside scratch directory: ${target}`)
			}

			let current = path
			for (const segment of contained.split(sep)) {
				current = resolve(current, segment)
				const status = lstatSync(current, { throwIfNoEntry: false })
				if (status === undefined) break
				if (status.isSymbolicLink()) throw new Error(`Path is a symbolic link: ${target}`)
			}

			mkdirSync(dirname(candidate), { recursive: true })
			writeFileSync(candidate, text)
		}
	} catch (error) {
		rmSync(path, { force: true, recursive: true })
		throw error
	}

	return {
		path,
		write(target, text) {
			const candidate = resolve(path, target)
			const contained = relative(path, candidate)
			if (
				isAbsolute(target) ||
				contained === '..' ||
				contained.startsWith(`..${sep}`) ||
				isAbsolute(contained)
			) {
				throw new Error(`Path outside scratch directory: ${target}`)
			}

			const rootStatus = lstatSync(path, { throwIfNoEntry: false })
			if (rootStatus === undefined) throw new Error('Scratch directory does not exist')
			if (rootStatus.isSymbolicLink()) throw new Error('Scratch directory is a symbolic link')
			if (!rootStatus.isDirectory()) throw new Error('Scratch path is not a directory')

			let current = path
			for (const segment of contained.split(sep)) {
				current = resolve(current, segment)
				const status = lstatSync(current, { throwIfNoEntry: false })
				if (status === undefined) break
				if (status.isSymbolicLink()) throw new Error(`Path is a symbolic link: ${target}`)
			}

			mkdirSync(dirname(candidate), { recursive: true })
			writeFileSync(candidate, text)
		},
		read(target) {
			const candidate = resolve(path, target)
			const contained = relative(path, candidate)
			if (
				isAbsolute(target) ||
				contained === '..' ||
				contained.startsWith(`..${sep}`) ||
				isAbsolute(contained)
			) {
				throw new Error(`Path outside scratch directory: ${target}`)
			}

			const rootStatus = lstatSync(path, { throwIfNoEntry: false })
			if (rootStatus === undefined) return undefined
			if (rootStatus.isSymbolicLink()) throw new Error('Scratch directory is a symbolic link')
			if (!rootStatus.isDirectory()) throw new Error('Scratch path is not a directory')

			let current = path
			for (const segment of contained.split(sep)) {
				current = resolve(current, segment)
				const status = lstatSync(current, { throwIfNoEntry: false })
				if (status === undefined) return undefined
				if (status.isSymbolicLink()) throw new Error(`Path is a symbolic link: ${target}`)
			}
			return readFileSync(candidate, 'utf8')
		},
		exists(target) {
			const candidate = resolve(path, target)
			const contained = relative(path, candidate)
			if (
				isAbsolute(target) ||
				contained === '..' ||
				contained.startsWith(`..${sep}`) ||
				isAbsolute(contained)
			) {
				throw new Error(`Path outside scratch directory: ${target}`)
			}

			const rootStatus = lstatSync(path, { throwIfNoEntry: false })
			if (rootStatus === undefined) return false
			if (rootStatus.isSymbolicLink()) throw new Error('Scratch directory is a symbolic link')
			if (!rootStatus.isDirectory()) throw new Error('Scratch path is not a directory')

			let current = path
			for (const segment of contained.split(sep)) {
				current = resolve(current, segment)
				const status = lstatSync(current, { throwIfNoEntry: false })
				if (status === undefined) return false
				if (status.isSymbolicLink()) throw new Error(`Path is a symbolic link: ${target}`)
			}
			return true
		},
		destroy() {
			rmSync(path, { force: true, recursive: true })
		},
	}
}
