import type { Server } from 'node:net'
import type {
	LoopbackInterface,
	ScratchIdentity,
	ScratchInterface,
	ScratchOptions,
} from './types.js'
import { once } from 'node:events'
import {
	lstatSync,
	mkdirSync,
	mkdtempSync,
	readFileSync,
	readdirSync,
	rmSync,
	statSync,
	symlinkSync,
	writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, resolve, sep } from 'node:path'
import { matchesIdentity, resolveContained } from './helpers.js'

/**
 * Allocates an owned temporary directory with contained file operations.
 *
 * @param options - Optional parent directory, name prefix, and initial files.
 * @returns The scratch directory and its file operations.
 * @throws When the parent is missing, a symbolic link, or not a directory; when the prefix contains
 * `/` or `\`; or when allocation or seeding fails.
 * @remarks The parent defaults to the host temporary directory. The prefix defaults to
 * `orkestrel-test-`. Seed keys use root-relative paths.
 */
export function createScratch(options?: ScratchOptions): ScratchInterface {
	const parent = resolve(options?.parent ?? tmpdir())
	const parentStatus = lstatSync(parent, { throwIfNoEntry: false })
	if (parentStatus === undefined) throw new Error('Scratch parent does not exist')
	if (parentStatus.isSymbolicLink()) throw new Error('Scratch parent is a symbolic link')
	if (!parentStatus.isDirectory()) throw new Error('Scratch parent is not a directory')

	const prefix = options?.prefix ?? 'orkestrel-test-'
	if (prefix.includes('/') || prefix.includes('\\')) {
		throw new Error('Scratch prefix must be a name fragment')
	}

	const path = mkdtempSync(`${parent}${sep}${prefix}`)
	const allocated = statSync(path)
	const allocation: ScratchIdentity = {
		birth: allocated.birthtimeMs,
		device: allocated.dev,
		inode: allocated.ino,
	}
	const outside = 'Path outside scratch directory'
	const unremovable = 'Scratch directory is not a removable target'
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

			if (!scratch.has('.')) throw new Error('Scratch directory does not exist')

			mkdirSync(dirname(candidate), { recursive: true })
			writeFileSync(candidate, text)
		},
		read(target) {
			const candidate = resolveContained(path, target)
			if (candidate === undefined) throw new Error(`${outside}: ${target}`)
			if (!scratch.has(target)) return undefined
			const status = statSync(candidate, { throwIfNoEntry: false })
			if (status === undefined) return undefined
			if (status.isDirectory()) {
				throw new Error(`Scratch path is a directory: ${target}`)
			}
			return readFileSync(candidate, 'utf8')
		},
		has(target) {
			const candidate = resolveContained(path, target)
			if (candidate === undefined) throw new Error(`${outside}: ${target}`)

			const rootStatus = lstatSync(path, { throwIfNoEntry: false })
			if (rootStatus === undefined) return false
			if (rootStatus.isSymbolicLink()) throw new Error('Scratch directory is a symbolic link')
			if (!rootStatus.isDirectory()) throw new Error('Scratch path is not a directory')

			return lstatSync(candidate, { throwIfNoEntry: false }) !== undefined
		},
		names(target = '.') {
			const candidate = resolveContained(path, target)
			if (candidate === undefined) throw new Error(`${outside}: ${target}`)
			if (!scratch.has('.')) throw new Error('Scratch directory does not exist')

			const status = statSync(candidate, { throwIfNoEntry: false })
			if (status === undefined) throw new Error(`Scratch path does not exist: ${target}`)
			if (!status.isDirectory()) throw new Error(`Scratch path is not a directory: ${target}`)
			return readdirSync(candidate).sort()
		},
		ensure(target) {
			const candidate = resolveContained(path, target)
			if (candidate === undefined) throw new Error(`${outside}: ${target}`)
			if (!scratch.has('.')) throw new Error('Scratch directory does not exist')

			const status = statSync(candidate, { throwIfNoEntry: false })
			if (status !== undefined && !status.isDirectory()) {
				throw new Error(`Scratch path is not a directory: ${target}`)
			}
			if (status === undefined) mkdirSync(candidate, { recursive: true })
			return candidate
		},
		link(target, source) {
			const candidate = resolveContained(path, target)
			if (candidate === undefined) throw new Error(`${outside}: ${target}`)
			if (!scratch.has('.')) throw new Error('Scratch directory does not exist')

			mkdirSync(dirname(candidate), { recursive: true })
			symlinkSync(source, candidate)
		},
		remove(target) {
			const candidate = resolveContained(path, target)
			if (candidate === undefined) throw new Error(`${outside}: ${target}`)
			if (candidate === path) throw new Error(`${unremovable}: ${target}`)
			if (!scratch.has('.')) throw new Error('Scratch directory does not exist')

			const status = lstatSync(candidate, { throwIfNoEntry: false })
			if (status !== undefined) {
				const identity: ScratchIdentity = {
					birth: status.birthtimeMs,
					device: status.dev,
					inode: status.ino,
				}
				if (matchesIdentity(identity, allocation)) {
					throw new Error(`${unremovable}: ${target}`)
				}
			}
			rmSync(candidate, { force: true, recursive: true })
		},
		destroy() {
			const status = lstatSync(path, { throwIfNoEntry: false })
			if (status === undefined) return
			const identity: ScratchIdentity = {
				birth: status.birthtimeMs,
				device: status.dev,
				inode: status.ino,
			}
			if (!matchesIdentity(identity, allocation)) return
			rmSync(path, { force: true, recursive: true })
		},
	}
	return scratch
}

/**
 * Starts a server on an ephemeral IPv4 loopback port.
 *
 * @param server - The unstarted server to bind.
 * @returns The bound origin, assigned port, and asynchronous teardown.
 * @throws When the server cannot bind or reports an address without a numeric port.
 */
export async function createLoopback(server: Server): Promise<LoopbackInterface> {
	server.listen(0, '127.0.0.1')
	await once(server, 'listening')

	const address = server.address()
	if (
		typeof address !== 'object' ||
		address === null ||
		!('port' in address) ||
		typeof address.port !== 'number'
	) {
		throw new Error(`Loopback address must have a numeric port; found ${String(address)}`)
	}

	const port = address.port
	let destruction: Promise<void> | undefined
	return {
		url: `http://127.0.0.1:${port}`,
		port,
		async destroy() {
			if (destruction !== undefined) return destruction
			if ('closeAllConnections' in server && typeof server.closeAllConnections === 'function') {
				server.closeAllConnections()
			}
			destruction = new Promise<void>((resolveClose, rejectClose) => {
				server.close((error) => {
					if (error === undefined || ('code' in error && error.code === 'ERR_SERVER_NOT_RUNNING')) {
						resolveClose()
					} else {
						rejectClose(error)
					}
				})
			})
			return destruction
		},
	}
}
