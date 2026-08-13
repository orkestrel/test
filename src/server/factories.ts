import type { ScratchInterface, ScratchOptions } from './types.js'
import {
	lstatSync,
	mkdirSync,
	mkdtempSync,
	readFileSync,
	rmSync,
	statSync,
	writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, resolve } from 'node:path'
import { resolveContained } from './helpers.js'

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
	const allocation = statSync(path)
	const outside = 'Path outside scratch directory'
	try {
		for (const [target, text] of Object.entries(options?.files ?? {})) {
			const candidate = resolveContained(path, target)
			if (candidate === undefined) throw new Error(`${outside}: ${target}`)

			mkdirSync(dirname(candidate), { recursive: true })
			writeFileSync(candidate, text)
		}
	} catch (error) {
		rmSync(path, { force: true, recursive: true })
		throw error
	}

	const scratch: ScratchInterface = {
		path,
		write(target, text) {
			const candidate = resolveContained(path, target)
			if (candidate === undefined) throw new Error(`${outside}: ${target}`)

			const rootStatus = lstatSync(path, { throwIfNoEntry: false })
			if (rootStatus === undefined) throw new Error('Scratch directory does not exist')
			if (rootStatus.isSymbolicLink()) throw new Error('Scratch directory is a symbolic link')
			if (!rootStatus.isDirectory()) throw new Error('Scratch path is not a directory')

			mkdirSync(dirname(candidate), { recursive: true })
			writeFileSync(candidate, text)
		},
		read(target) {
			const candidate = resolveContained(path, target)
			if (candidate === undefined) throw new Error(`${outside}: ${target}`)
			if (!scratch.exists(target)) return undefined
			const status = statSync(candidate, { throwIfNoEntry: false })
			if (status === undefined) return undefined
			if (status.isDirectory()) {
				throw new Error(`Scratch path is a directory: ${target}`)
			}
			return readFileSync(candidate, 'utf8')
		},
		exists(target) {
			const candidate = resolveContained(path, target)
			if (candidate === undefined) throw new Error(`${outside}: ${target}`)

			const rootStatus = lstatSync(path, { throwIfNoEntry: false })
			if (rootStatus === undefined) return false
			if (rootStatus.isSymbolicLink()) throw new Error('Scratch directory is a symbolic link')
			if (!rootStatus.isDirectory()) throw new Error('Scratch path is not a directory')

			return lstatSync(candidate, { throwIfNoEntry: false }) !== undefined
		},
		destroy() {
			const status = lstatSync(path, { throwIfNoEntry: false })
			if (
				status === undefined ||
				status.dev !== allocation.dev ||
				status.ino !== allocation.ino ||
				status.birthtimeMs !== allocation.birthtimeMs
			)
				return
			rmSync(path, { force: true, recursive: true })
		},
	}
	return scratch
}
