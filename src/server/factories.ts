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
 *
 * @example Own a temporary directory
 * ```ts
 * import { createScratch } from '@orkestrel/test/server'
 *
 * const scratch = createScratch({ prefix: 'guide-', files: { 'src/index.ts': 'export {}\n' } })
 *
 * scratch.read('src/index.ts') // 'export {}\n'
 * scratch.has('src') // true
 * scratch.read('src') // throws Error: Scratch path is a directory: src
 * scratch.read('missing.ts') // undefined
 * scratch.write('../escape.ts', '') // throws Error: Path outside scratch directory: ../escape.ts
 *
 * // `write` answers the contained path it wrote, the way `ensure` and `link` answer theirs, so the
 * // path goes straight to the code under test without joining it again.
 * scratch.write('src/notes.ts', 'export {}\n') // `${scratch.path}/src/notes.ts`
 *
 * // `ensure` is how you get an empty directory, because every `write` creates a file.
 * scratch.ensure('empty')
 * scratch.names() // ['empty', 'src']
 * scratch.names('empty') // []
 *
 * // `parent` puts the allocation somewhere other than the host temporary directory.
 * const child = createScratch({ parent: scratch.path, prefix: 'child-' })
 * scratch.names().length // 3 — 'empty', 'src', and the child allocation
 * child.destroy()
 * scratch.names().length // 2 — the child removed itself and nothing else
 *
 * // `link` creates the symbolic link the threat model names, and `read` follows it. A directory
 * // source runs on a host that creates no symbolic link too; see "Hosts that create no symbolic
 * // link" for what such a host does with a file source.
 * const outside = createScratch({ prefix: 'outside-', files: { 'read.ts': 'export {}\n' } })
 * scratch.link('gate', outside.path) // `${scratch.path}/gate` — the link's own path, not its destination
 * scratch.read('gate/read.ts') // 'export {}\n' — read through the link, at its destination
 *
 * // A link pointing out of the allocation is resolved through, so a contained path acts outside it.
 * scratch.ensure('gate/made') // `${scratch.path}/gate/made` — the lexical path, not the destination
 * outside.names() // ['made', 'read.ts'] — the directory was made under `outside.path`
 * scratch.names('gate') // ['made', 'read.ts'] — the same entries, listed through the link
 *
 * // `link` acts at the final segment rather than through it, so `gate` is occupied.
 * scratch.link('gate', outside.path) // throws Error: EEXIST: file already exists
 *
 * // `has` reads the final segment without following it, and `read` follows it.
 * scratch.link('dangling', 'missing.ts')
 * scratch.has('dangling') // true — the link is there
 * scratch.read('dangling') // undefined — what it points at is not
 *
 * // `remove` takes one contained entry and acts at the final segment, so a link goes and whatever it
 * // pointed at stays. A missing target is a no-op.
 * scratch.remove('dangling')
 * scratch.has('dangling') // false
 * scratch.remove('missing.ts') // no throw — there was nothing there
 * scratch.remove('src') // the directory and everything under it
 * scratch.names() // ['empty', 'gate']
 *
 * scratch.destroy()
 * scratch.destroy() // no-op — destroy is idempotent
 * outside.has('made') // true — destroy unlinks `gate` and leaves what it pointed at
 * outside.destroy()
 * ```
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
