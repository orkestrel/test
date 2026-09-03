import type { Server } from 'node:net'
import type {
	CookieJarInterface,
	LoopbackInterface,
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
	statSync,
	writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, resolve, sep } from 'node:path'
import {
	createLink,
	matchesIdentity,
	readIdentity,
	removeTree,
	requireContained,
} from './helpers.js'

/**
 * Allocates an owned temporary directory with contained file operations.
 *
 * @param options - Optional parent directory, name prefix, and initial files.
 * @returns The scratch directory and its file operations.
 * @throws When the parent is missing, a symbolic link, or not a directory; when the prefix contains
 * `/` or `\`; or when allocation or seeding fails.
 * @remarks Default parent: the host temporary directory. Default prefix: `orkestrel-test-`. Seed
 * keys use root-relative paths.
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
	const allocation = readIdentity(statSync(path))
	const unremovable = 'Scratch directory is not a removable target'
	try {
		for (const [target, text] of Object.entries(options?.files ?? {})) {
			const candidate = requireContained(path, target)
			mkdirSync(dirname(candidate), { recursive: true })
			writeFileSync(candidate, text)
		}
	} catch (error) {
		removeTree(path)
		throw error
	}

	const scratch: ScratchInterface = {
		path,
		write(target, text) {
			const candidate = requireContained(path, target)
			if (!scratch.has('.')) throw new Error('Scratch directory does not exist')

			mkdirSync(dirname(candidate), { recursive: true })
			writeFileSync(candidate, text)
			return candidate
		},
		read(target) {
			const candidate = requireContained(path, target)
			if (!scratch.has(target)) return undefined
			const status = statSync(candidate, { throwIfNoEntry: false })
			if (status === undefined) return undefined
			if (status.isDirectory()) {
				throw new Error(`Scratch path is a directory: ${target}`)
			}
			return readFileSync(candidate, 'utf8')
		},
		has(target) {
			const candidate = requireContained(path, target)
			const rootStatus = lstatSync(path, { throwIfNoEntry: false })
			if (rootStatus === undefined) return false
			if (rootStatus.isSymbolicLink()) throw new Error('Scratch directory is a symbolic link')
			if (!rootStatus.isDirectory()) throw new Error('Scratch path is not a directory')

			return lstatSync(candidate, { throwIfNoEntry: false }) !== undefined
		},
		names(target = '.') {
			const candidate = requireContained(path, target)
			if (!scratch.has('.')) throw new Error('Scratch directory does not exist')

			const status = statSync(candidate, { throwIfNoEntry: false })
			if (status === undefined) throw new Error(`Scratch path does not exist: ${target}`)
			if (!status.isDirectory()) throw new Error(`Scratch path is not a directory: ${target}`)
			return readdirSync(candidate).sort()
		},
		ensure(target) {
			const candidate = requireContained(path, target)
			if (!scratch.has('.')) throw new Error('Scratch directory does not exist')

			const status = statSync(candidate, { throwIfNoEntry: false })
			if (status !== undefined && !status.isDirectory()) {
				throw new Error(`Scratch path is not a directory: ${target}`)
			}
			if (status === undefined) mkdirSync(candidate, { recursive: true })
			return candidate
		},
		link(target, source) {
			const candidate = requireContained(path, target)
			if (!scratch.has('.')) throw new Error('Scratch directory does not exist')

			mkdirSync(dirname(candidate), { recursive: true })
			createLink(candidate, source)
			return candidate
		},
		remove(target) {
			const candidate = requireContained(path, target)
			if (candidate === path) throw new Error(`${unremovable}: ${target}`)
			if (!scratch.has('.')) throw new Error('Scratch directory does not exist')

			const status = lstatSync(candidate, { throwIfNoEntry: false })
			if (status !== undefined && matchesIdentity(readIdentity(status), allocation)) {
				throw new Error(`${unremovable}: ${target}`)
			}
			removeTree(candidate)
		},
		destroy() {
			const status = lstatSync(path, { throwIfNoEntry: false })
			if (status === undefined) return
			if (!matchesIdentity(readIdentity(status), allocation)) return
			removeTree(path)
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
		destroy() {
			if (destruction === undefined) {
				destruction = new Promise<void>((resolveClose, rejectClose) => {
					if ('closeAllConnections' in server && typeof server.closeAllConnections === 'function') {
						server.closeAllConnections()
					}
					server.close((error) => {
						if (
							error === undefined ||
							('code' in error && error.code === 'ERR_SERVER_NOT_RUNNING')
						) {
							resolveClose()
						} else {
							rejectClose(error)
						}
					})
				})
			}
			return destruction
		},
	}
}

/**
 * Creates a cookie jar that records a real response's cookies and replays them as one header.
 *
 * @returns The rendered request header, and the members that read and capture cookies.
 * @remarks Selection is by name alone: no `Domain` or `Path` matching, no `Expires` or `Secure`
 * handling, and no persistence beyond the jar. That is what a test driving one origin over one path
 * needs, and a fixture needing a browser's cookie store needs a browser rather than this.
 */
export function createCookieJar(): CookieJarInterface {
	const cookies = new Map<string, string>()
	return {
		get header() {
			const pairs = [...cookies].map(([name, value]) => `${name}=${value}`)
			return pairs.length === 0 ? undefined : pairs.join('; ')
		},
		read(name) {
			return cookies.get(name)
		},
		capture(response) {
			const fields = response.headers.getSetCookie()
			for (const field of fields) {
				const boundary = field.indexOf(';')
				const pair = boundary < 0 ? field : field.slice(0, boundary)
				const separator = pair.indexOf('=')
				if (separator < 1) continue

				const name = pair.slice(0, separator)
				// An origin spells a deletion `Max-Age=0` in whatever case and spacing it likes, so the
				// attribute is matched rather than compared.
				if (/;\s*max-age\s*=\s*0\s*(?:;|$)/iu.test(field)) cookies.delete(name)
				else cookies.set(name, pair.slice(separator + 1))
			}
			return fields
		},
	}
}
