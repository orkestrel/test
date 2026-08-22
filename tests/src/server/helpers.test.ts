import type { Duplex } from 'node:stream'
import { spawn } from 'node:child_process'
import { once } from 'node:events'
import {
	chmodSync,
	existsSync,
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
import { createServer as createHTTPServer } from 'node:http'
import { connect, createServer as createNetServer } from 'node:net'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { captureError, createRecorder, requireValue, waitForCondition } from '@src/core'
import {
	createLink,
	createLoopback,
	createScratch,
	destroyScratch,
	isExcluded,
	isRunning,
	matchesIdentity,
	readInventory,
	removeTree,
	requestUpgrade,
	resolveContained,
	supportsBytes,
	supportsCase,
	supportsDirectoryLinks,
	supportsFileLinks,
	supportsMode,
	waitForSocketClose,
} from '@src/server'
import { describe, expect, it } from 'vitest'
import { DIRECTORY_LINKS, FILE_LINKS } from '../../setupServer.js'

// The child announces itself on stdout and then parks on a timer that never fires within a test, so
// it holds its working directory until the parent kills it. A child that self-exits on a fixed delay
// raced the assertions that read the hold — whether it was still alive when the un-retried baseline
// ran was a coin toss — so every hold below is bounded by the parent rather than by a clock.
const HOLD_CWD = "process.stdout.write('ready\\n'); setTimeout(() => {}, 1e9)"

/**
 * Attempt the permission hold `destroyScratch`'s POSIX case is built on, and report whether the host
 * really refused the removal.
 *
 * @returns True if removing a directory entry under a parent stripped of write permission was
 * refused; false if the host removed it anyway.
 */
function probePermissionHold(): boolean {
	const parent = mkdtempSync(join(tmpdir(), 'orkestrel-test-hold-probe-'))
	const held = join(parent, 'held')
	mkdirSync(held)
	chmodSync(parent, 0o500)
	let refused = false
	try {
		rmSync(held, { force: true, recursive: true })
	} catch {
		refused = true
	} finally {
		chmodSync(parent, 0o700)
		rmSync(parent, { force: true, recursive: true })
	}
	return refused
}

// Removing a directory entry needs write permission on its parent, and two different hosts decline
// to enforce that: Windows ignores the bit, and a POSIX uid of 0 bypasses the check the bit
// describes. `supportsMode` cannot answer this, because it reads whether a bit is stored rather than
// whether it is enforced, and a root POSIX host stores it faithfully and enforces nothing. So the
// mechanism itself is attempted here — strip the parent, try the removal, read the host's answer —
// and the case below is keyed to that refusal rather than to a platform or a user name.
const PERMISSION_HOLD_REFUSES_REMOVAL = probePermissionHold()

/**
 * Count the socket handles holding this process's event loop open.
 *
 * @returns The number of live TCP socket resources, server listeners excluded.
 */
function countSocketHandles(): number {
	return process.getActiveResourcesInfo().filter((name) => name === 'TCPSocketWrap').length
}

/**
 * Every host-capability probe, paired with the name its failures are reported under. The pairs are
 * a case matrix rather than test registration, so the residue and boolean proofs below run once per
 * probe instead of being written out per probe.
 */
const HOST_PROBES: ReadonlyArray<readonly [name: string, probe: () => boolean]> = Object.freeze([
	['supportsDirectoryLinks', supportsDirectoryLinks],
	['supportsFileLinks', supportsFileLinks],
	['supportsMode', supportsMode],
	['supportsCase', supportsCase],
	['supportsBytes', supportsBytes],
])

/**
 * Every environment variable a host's `os.tmpdir()` reads. Each platform reads its own name first —
 * win32 takes `TEMP`, then `TMP`; POSIX takes `TMPDIR`, then `TMP`, then `TEMP` — so an override
 * that sets one name steers one platform, and an override that sets the whole set steers either.
 */
const TEMPORARY_VARIABLES: readonly string[] = Object.freeze(['TMPDIR', 'TEMP', 'TMP'])

/**
 * Points every temporary-directory environment variable at one directory.
 *
 * @param path - The directory `os.tmpdir()` reports while the override holds.
 * @returns A function restoring each variable to the value it held before the call.
 */
function overrideTemporaryDirectory(path: string): () => void {
	const saved = new Map<string, string | undefined>()
	for (const name of TEMPORARY_VARIABLES) {
		saved.set(name, process.env[name])
		process.env[name] = path
	}
	// Assigning `undefined` writes the string `'undefined'`, so a variable that was unset before the
	// override is restored by deleting it rather than by assigning its saved value back.
	return () => {
		for (const [name, value] of saved) {
			if (value === undefined) delete process.env[name]
			else process.env[name] = value
		}
	}
}

describe('resolveContained', () => {
	it('resolves relative and absolute contained targets and rejects escapes', () => {
		const root = mkdtempSync(join(tmpdir(), 'orkestrel-test-contained-'))
		try {
			expect(resolveContained(root, 'nested/file.txt')).toBe(join(root, 'nested', 'file.txt'))
			expect(resolveContained(root, join(root, 'nested'))).toBe(join(root, 'nested'))
			expect(resolveContained(root, '../outside')).toBeUndefined()
			expect(resolveContained(root, join(root, '..', 'outside'))).toBeUndefined()
		} finally {
			rmSync(root, { force: true, recursive: true })
		}
	})
})

describe('matchesIdentity', () => {
	// Plain triples rather than a real allocation: every replacement state a filesystem test can
	// reach on one host keeps the same device, so only a pure call can drive that field.
	it('accepts a triple matching in every field', () => {
		expect(
			matchesIdentity({ birth: 3, device: 1, inode: 2 }, { birth: 3, device: 1, inode: 2 }),
		).toBe(true)
	})

	it('refuses a triple whose device differs', () => {
		expect(
			matchesIdentity({ birth: 3, device: 9, inode: 2 }, { birth: 3, device: 1, inode: 2 }),
		).toBe(false)
	})

	it('refuses a triple whose index node differs', () => {
		expect(
			matchesIdentity({ birth: 3, device: 1, inode: 9 }, { birth: 3, device: 1, inode: 2 }),
		).toBe(false)
	})

	it('refuses a triple whose creation time differs', () => {
		expect(
			matchesIdentity({ birth: 9, device: 1, inode: 2 }, { birth: 3, device: 1, inode: 2 }),
		).toBe(false)
	})
})

describe('removeTree', () => {
	// A live process's current working directory blocks its ancestors' removal on Windows only;
	// POSIX permits removing a directory that is a process's cwd, so the two hosts need separate
	// cases rather than a runtime branch around one shared `expect`.
	it.runIf(process.platform === 'win32')(
		'retries past a live process holding the tree as its working directory, where the un-retried baseline fails',
		async () => {
			const root = mkdtempSync(join(tmpdir(), 'orkestrel-test-remove-tree-'))
			const held = join(root, 'held')
			mkdirSync(held)
			const child = spawn(process.execPath, ['-e', HOLD_CWD], {
				cwd: held,
				stdio: ['ignore', 'pipe', 'ignore'],
			})
			try {
				// The child is provably alive and holding the directory once it has spoken, so the
				// un-retried baseline throws deterministically rather than by luck of timing.
				await once(child.stdout, 'data')

				expect(() => rmSync(root, { force: true, recursive: true })).toThrow(
					/EPERM|EBUSY|ENOTEMPTY/,
				)

				// Kill releases the handle, but Windows frees it a beat later — exactly the lag
				// `removeTree`'s bounded retry is built to outlast.
				child.kill()
				removeTree(root)
				expect(existsSync(root)).toBe(false)
			} finally {
				if (child.exitCode === null && child.signalCode === null) child.kill()
				await once(child, 'exit').catch(() => {})
				if (existsSync(root)) rmSync(root, { force: true, recursive: true })
			}
		},
	)

	it.runIf(process.platform !== 'win32')(
		'removes the tree while a live process holds it as its working directory',
		async () => {
			const root = mkdtempSync(join(tmpdir(), 'orkestrel-test-remove-tree-'))
			const held = join(root, 'held')
			mkdirSync(held)
			const child = spawn(process.execPath, ['-e', HOLD_CWD], {
				cwd: held,
				stdio: ['ignore', 'pipe', 'ignore'],
			})
			try {
				await once(child.stdout, 'data')

				removeTree(root)
				expect(existsSync(root)).toBe(false)
			} finally {
				if (child.exitCode === null && child.signalCode === null) child.kill()
				await once(child, 'exit').catch(() => {})
				if (existsSync(root)) rmSync(root, { force: true, recursive: true })
			}
		},
	)
})

describe('isExcluded', () => {
	it('matches the key itself, an ancestor, and the root, and rejects a sibling', () => {
		expect(isExcluded('src/index.ts', ['src/index.ts'])).toBe(true)
		expect(isExcluded('src/index.ts', ['src'])).toBe(true)
		expect(isExcluded('src/index.ts', [''])).toBe(true)
		expect(isExcluded('src-other/index.ts', ['src'])).toBe(false)
		expect(isExcluded('src/index.ts', [])).toBe(false)
	})
})

describe('createLink', () => {
	// `createLink` links a directory, so a host whose volume creates neither a symbolic link nor the
	// junction it falls back to has no link for this case to follow. `supportsDirectoryLinks` reads
	// that capability, which is what `DIRECTORY_LINKS` carries.
	it.runIf(DIRECTORY_LINKS)('links a directory named by an absolute source', () => {
		const root = mkdtempSync(join(tmpdir(), 'orkestrel-test-link-absolute-'))
		const source = join(root, 'source')
		const path = join(root, 'linked')
		try {
			mkdirSync(source)
			writeFileSync(join(source, 'file.txt'), 'linked')

			createLink(path, source)

			expect(lstatSync(path).isSymbolicLink()).toBe(true)
			expect(readFileSync(join(path, 'file.txt'), 'utf8')).toBe('linked')
		} finally {
			rmSync(root, { force: true, recursive: true })
		}
	})

	// The link this case resolves is a directory link too, so it takes the same capability gate as
	// the preceding case.
	it.runIf(DIRECTORY_LINKS)("resolves a relative source against the link's own directory", () => {
		const root = mkdtempSync(join(tmpdir(), 'orkestrel-test-link-relative-'))
		const nested = join(root, 'nested')
		try {
			mkdirSync(join(nested, 'source'), { recursive: true })
			writeFileSync(join(nested, 'source', 'file.txt'), 'nested')

			// The decoy carries the same name one level up, so a source resolved against the working
			// directory or against the root reaches it and reads back the other text.
			mkdirSync(join(root, 'source'))
			writeFileSync(join(root, 'source', 'file.txt'), 'decoy')

			createLink(join(nested, 'linked'), 'source')

			expect(readFileSync(join(nested, 'linked', 'file.txt'), 'utf8')).toBe('nested')
		} finally {
			rmSync(root, { force: true, recursive: true })
		}
	})

	it.runIf(DIRECTORY_LINKS)('creates a dangling link for a source that does not exist', () => {
		const root = mkdtempSync(join(tmpdir(), 'orkestrel-test-link-dangling-'))
		const path = join(root, 'dangling')
		try {
			createLink(path, join(root, 'missing'))

			expect(lstatSync(path).isSymbolicLink()).toBe(true)
			expect(existsSync(path)).toBe(false)
			expect(() => readFileSync(path, 'utf8')).toThrow('ENOENT')
		} finally {
			rmSync(root, { force: true, recursive: true })
		}
	})

	it.runIf(DIRECTORY_LINKS)('surfaces the host EEXIST when the link path is occupied', () => {
		const root = mkdtempSync(join(tmpdir(), 'orkestrel-test-link-occupied-'))
		const source = join(root, 'source')
		const occupied = join(root, 'occupied')
		try {
			mkdirSync(source)
			mkdirSync(occupied)
			writeFileSync(join(occupied, 'kept.txt'), 'kept')

			expect(() => createLink(occupied, source)).toThrow('EEXIST')

			expect(lstatSync(occupied).isSymbolicLink()).toBe(false)
			expect(readFileSync(join(occupied, 'kept.txt'), 'utf8')).toBe('kept')
		} finally {
			rmSync(root, { force: true, recursive: true })
		}
	})

	it.runIf(!FILE_LINKS && DIRECTORY_LINKS)(
		'refuses a source that exists as a file and leaves the link path empty',
		() => {
			// A directory link accepts a file source and produces a link no reader can follow, so the
			// fallback refuses it and rethrows the refusal the symbolic-link attempt reported.
			const root = mkdtempSync(join(tmpdir(), 'orkestrel-test-link-file-source-'))
			const source = join(root, 'source.txt')
			const path = join(root, 'linked.txt')
			try {
				writeFileSync(source, 'source')

				// The host-populated fields are what pin the rethrow. Object identity is unreachable
				// without an injection seam admitting a known refusal, and this fallback rethrows an
				// error the host constructed, so `syscall` and `errno` are the discriminator: a fresh
				// error written here carries neither, and `code` alone is a field anyone can copy.
				// `syscall` names the call the fallback rethrows from and `errno` is host-varying, so
				// its value is read as the number the host reported rather than pinned to one.
				const refusal = captureError(() => createLink(path, source))
				expect(refusal).toBeInstanceOf(Error)
				expect(refusal).toHaveProperty('code', 'EPERM')
				expect(refusal).toHaveProperty('syscall', 'symlink')
				expect(refusal).toHaveProperty('errno', expect.any(Number))

				expect(lstatSync(path, { throwIfNoEntry: false })).toBeUndefined()
				expect(readdirSync(root)).toStrictEqual(['source.txt'])
			} finally {
				rmSync(root, { force: true, recursive: true })
			}
		},
	)
})

describe('readInventory', () => {
	it.runIf(DIRECTORY_LINKS)(
		'refuses a named target whose intermediate link leaves the root',
		() => {
			const parent = mkdtempSync(join(tmpdir(), 'orkestrel-test-inventory-linked-escape-'))
			const root = join(parent, 'root')
			const outside = join(parent, 'outside')
			try {
				mkdirSync(root)
				mkdirSync(outside)
				writeFileSync(join(outside, 'file.txt'), 'outside')
				symlinkSync(outside, join(root, 'link'), 'junction')

				expect(() => readInventory(root, ['link/file.txt'])).toThrow(
					'Target outside root: link/file.txt',
				)
			} finally {
				rmSync(parent, { force: true, recursive: true })
			}
		},
	)

	it.runIf(DIRECTORY_LINKS)(
		'keys a named target through an intermediate link by its real path',
		() => {
			const root = mkdtempSync(join(tmpdir(), 'orkestrel-test-inventory-linked-contained-'))
			try {
				mkdirSync(join(root, 'real'))
				writeFileSync(join(root, 'real', 'file.txt'), 'inside')
				symlinkSync(join(root, 'real'), join(root, 'link'), 'junction')

				expect(readInventory(root, ['link/file.txt'])).toStrictEqual({
					'real/file.txt': 'inside',
				})
			} finally {
				rmSync(root, { force: true, recursive: true })
			}
		},
	)

	it('accepts relative and absolute contained directories and refuses an absolute escape', () => {
		const parent = mkdtempSync(join(tmpdir(), 'orkestrel-test-inventory-targets-'))
		const root = join(parent, 'root')
		const source = join(root, 'src')
		const outside = join(parent, 'outside')
		try {
			mkdirSync(source, { recursive: true })
			mkdirSync(outside)
			writeFileSync(join(source, 'file.txt'), 'source')

			expect(readInventory(root, ['src'])).toStrictEqual({ 'src/file.txt': 'source' })
			expect(readInventory(root, [source])).toStrictEqual({ 'src/file.txt': 'source' })
			expect(() => readInventory(root, [outside])).toThrow(`Target outside root: ${outside}`)
		} finally {
			rmSync(parent, { force: true, recursive: true })
		}
	})

	it.runIf(DIRECTORY_LINKS)('validates the root when no directories are requested', () => {
		const parent = mkdtempSync(join(tmpdir(), 'orkestrel-test-inventory-empty-'))
		const root = join(parent, 'root')
		const linked = join(parent, 'linked')
		try {
			mkdirSync(root)
			symlinkSync(root, linked, 'junction')

			expect(readInventory(root, [])).toStrictEqual({})
			expect(() => readInventory(linked, [])).toThrow('Root is a symbolic link')
		} finally {
			rmSync(parent, { force: true, recursive: true })
		}
	})

	it('keeps a root-level __proto__ file as an own property', () => {
		const root = mkdtempSync(join(tmpdir(), 'orkestrel-test-inventory-prototype-'))
		try {
			writeFileSync(join(root, '__proto__'), 'prototype')
			writeFileSync(join(root, 'control.txt'), 'control')

			const files = readInventory(root, ['.'])
			expect(Object.keys(files)).toStrictEqual(['__proto__', 'control.txt'])
			expect(Object.hasOwn(files, '__proto__')).toBe(true)
			expect(files['__proto__']).toBe('prototype')
			expect(files['control.txt']).toBe('control')
		} finally {
			rmSync(root, { force: true, recursive: true })
		}
	})

	it.runIf(DIRECTORY_LINKS)('refuses a symlinked root while accepting the real directory', () => {
		const parent = mkdtempSync(join(tmpdir(), 'orkestrel-test-inventory-root-'))
		const root = join(parent, 'root')
		const linked = join(parent, 'linked')
		try {
			mkdirSync(root)
			writeFileSync(join(root, 'file.txt'), 'real')
			symlinkSync(root, linked, 'junction')

			expect(readInventory(pathToFileURL(root), ['.'])).toStrictEqual({ 'file.txt': 'real' })
			expect(() => readInventory(linked, ['.'])).toThrow('Root is a symbolic link')
		} finally {
			rmSync(parent, { force: true, recursive: true })
		}
	})

	it.runIf(DIRECTORY_LINKS)(
		'refuses a symlinked root supplied as a URL with a trailing slash',
		() => {
			const parent = mkdtempSync(join(tmpdir(), 'orkestrel-test-inventory-url-root-'))
			const root = join(parent, 'root')
			const linked = join(parent, 'linked')
			try {
				mkdirSync(root)
				writeFileSync(join(root, 'file.txt'), 'real')
				symlinkSync(root, linked, 'junction')

				const linkedUrl = pathToFileURL(`${linked}/`)
				expect(() => readInventory(linkedUrl, ['.'])).toThrow('Root is a symbolic link')
				expect(() => readInventory(linkedUrl, [])).toThrow('Root is a symbolic link')

				const rootUrl = pathToFileURL(`${root}/`)
				expect(readInventory(rootUrl, ['.'])).toStrictEqual({ 'file.txt': 'real' })
			} finally {
				rmSync(parent, { force: true, recursive: true })
			}
		},
	)

	it.runIf(FILE_LINKS)(
		'skips a symlinked file and includes the same path when it is a regular file',
		() => {
			const parent = mkdtempSync(join(tmpdir(), 'orkestrel-test-inventory-file-'))
			const root = join(parent, 'root')
			const target = join(parent, 'target.txt')
			const linked = join(root, 'linked.txt')
			try {
				mkdirSync(root)
				writeFileSync(join(root, 'file.txt'), 'inside')
				writeFileSync(target, 'outside')
				symlinkSync(target, linked, 'file')

				expect(Object.keys(readInventory(root, ['.']))).toStrictEqual(['file.txt'])
				rmSync(linked)
				writeFileSync(linked, 'regular')
				expect(Object.keys(readInventory(root, ['.']))).toStrictEqual(['file.txt', 'linked.txt'])
			} finally {
				rmSync(parent, { force: true, recursive: true })
			}
		},
	)

	it('sorts keys, filters extensions, and excludes exact paths', () => {
		const root = mkdtempSync(join(tmpdir(), 'orkestrel-test-inventory-options-'))
		try {
			mkdirSync(join(root, 'alpha'))
			mkdirSync(join(root, 'zeta'))
			writeFileSync(join(root, 'alpha', 'z.ts'), 'z')
			writeFileSync(join(root, 'alpha', 'a.ts'), 'a')
			writeFileSync(join(root, 'alpha', 'skip.ts'), 'skip')
			writeFileSync(join(root, 'zeta', 'b.txt'), 'b')
			writeFileSync(join(root, 'zeta', 'c.ts'), 'c')

			const files = readInventory(root, ['.'], {
				exclude: ['alpha/skip.ts'],
				extensions: ['.ts'],
			})
			expect(Object.keys(files)).toStrictEqual(['alpha/a.ts', 'alpha/z.ts', 'zeta/c.ts'])
			expect(files).toStrictEqual({
				'alpha/a.ts': 'a',
				'alpha/z.ts': 'z',
				'zeta/c.ts': 'c',
			})
			expect(readInventory(root, ['.'], { extensions: [] })).toStrictEqual({})
		} finally {
			rmSync(root, { force: true, recursive: true })
		}
	})

	it('excludes a directory and every file below it at both doors, on whole segments', () => {
		const root = mkdtempSync(join(tmpdir(), 'orkestrel-test-inventory-excluded-directory-'))
		try {
			mkdirSync(join(root, 'included'))
			mkdirSync(join(root, 'excluded'))
			mkdirSync(join(root, 'excluded-other'))
			writeFileSync(join(root, 'included', 'file.ts'), 'included')
			writeFileSync(join(root, 'excluded', 'file.ts'), 'excluded')
			writeFileSync(join(root, 'excluded-other', 'file.ts'), 'sibling')

			// The walked door.
			expect(readInventory(root, ['.'], { exclude: ['excluded'] })).toStrictEqual({
				'excluded-other/file.ts': 'sibling',
				'included/file.ts': 'included',
			})

			// The named door: a target below an excluded key is excluded there too.
			expect(readInventory(root, ['excluded/file.ts'], { exclude: ['excluded'] })).toStrictEqual({})
			expect(readInventory(root, ['excluded'], { exclude: ['excluded'] })).toStrictEqual({})

			// The segment boundary. A raw string prefix would drop the sibling at both doors.
			expect(
				readInventory(root, ['excluded-other/file.ts'], { exclude: ['excluded'] }),
			).toStrictEqual({ 'excluded-other/file.ts': 'sibling' })
			expect(readInventory(root, ['excluded-other'], { exclude: ['excluded'] })).toStrictEqual({
				'excluded-other/file.ts': 'sibling',
			})
		} finally {
			rmSync(root, { force: true, recursive: true })
		}
	})

	it('reads every exclusion spelling as one rule at both doors', () => {
		const root = mkdtempSync(join(tmpdir(), 'orkestrel-test-inventory-exclusion-spelling-'))
		try {
			mkdirSync(join(root, 'src'))
			mkdirSync(join(root, 'src-other'))
			writeFileSync(join(root, 'src', 'file.ts'), 'source')
			writeFileSync(join(root, 'src-other', 'file.ts'), 'sibling')

			// The control: with no exclusion the whole population is read, so an empty result below
			// reports the rule rather than an empty fixture.
			expect(readInventory(root, ['.'])).toStrictEqual({
				'src-other/file.ts': 'sibling',
				'src/file.ts': 'source',
			})

			// A directory rule keeps its sibling, and its four spellings normalize to one rule at
			// the walked door and the named one alike.
			const kept = { 'src-other/file.ts': 'sibling' }
			expect(readInventory(root, ['.'], { exclude: ['src'] })).toStrictEqual(kept)
			expect(readInventory(root, ['.'], { exclude: ['src/'] })).toStrictEqual(kept)
			expect(readInventory(root, ['.'], { exclude: ['src//'] })).toStrictEqual(kept)
			expect(readInventory(root, ['.'], { exclude: ['./src'] })).toStrictEqual(kept)
			expect(readInventory(root, ['src/file.ts'], { exclude: ['src'] })).toStrictEqual({})
			expect(readInventory(root, ['src/file.ts'], { exclude: ['src/'] })).toStrictEqual({})
			expect(readInventory(root, ['src/file.ts'], { exclude: ['src//'] })).toStrictEqual({})
			expect(readInventory(root, ['src/file.ts'], { exclude: ['./src'] })).toStrictEqual({})

			// The two root spellings are the rule that drops everything, and they agree at both
			// doors, which is where they disagreed.
			expect(readInventory(root, ['.'], { exclude: [''] })).toStrictEqual({})
			expect(readInventory(root, ['.'], { exclude: ['.'] })).toStrictEqual({})
			expect(readInventory(root, ['src/file.ts'], { exclude: [''] })).toStrictEqual({})
			expect(readInventory(root, ['src/file.ts'], { exclude: ['.'] })).toStrictEqual({})
			expect(readInventory(root, ['src'], { exclude: [''] })).toStrictEqual({})
			expect(readInventory(root, ['src'], { exclude: ['.'] })).toStrictEqual({})
		} finally {
			rmSync(root, { force: true, recursive: true })
		}
	})

	it('refuses a target outside the root', () => {
		const parent = mkdtempSync(join(tmpdir(), 'orkestrel-test-inventory-escape-'))
		const root = join(parent, 'root')
		try {
			mkdirSync(root)
			expect(() => readInventory(root, ['..'])).toThrow('Target outside root: ..')
		} finally {
			rmSync(parent, { force: true, recursive: true })
		}
	})

	it.runIf(DIRECTORY_LINKS)(
		'refuses a linked directory target while accepting a real file beside it',
		() => {
			const parent = mkdtempSync(join(tmpdir(), 'orkestrel-test-inventory-directory-'))
			const root = join(parent, 'root')
			try {
				mkdirSync(root)
				mkdirSync(join(root, 'real'))
				writeFileSync(join(root, 'file.txt'), 'file')
				symlinkSync(join(root, 'real'), join(root, 'linked'), 'junction')

				expect(() => readInventory(root, ['linked'])).toThrow('Target is a symbolic link: linked')
				expect(readInventory(root, ['file.txt'])).toStrictEqual({ 'file.txt': 'file' })
			} finally {
				rmSync(parent, { force: true, recursive: true })
			}
		},
	)

	it.runIf(FILE_LINKS)('refuses a linked file target while accepting its destination', () => {
		const parent = mkdtempSync(join(tmpdir(), 'orkestrel-test-inventory-file-target-link-'))
		const root = join(parent, 'root')
		try {
			mkdirSync(root)
			writeFileSync(join(root, 'file.txt'), 'file')
			symlinkSync(join(root, 'file.txt'), join(root, 'linked.txt'), 'file')

			expect(() => readInventory(root, ['linked.txt'])).toThrow(
				'Target is a symbolic link: linked.txt',
			)
			expect(readInventory(root, ['file.txt'])).toStrictEqual({ 'file.txt': 'file' })
		} finally {
			rmSync(parent, { force: true, recursive: true })
		}
	})

	it('includes a named file target regardless of the extension filter', () => {
		const root = mkdtempSync(join(tmpdir(), 'orkestrel-test-inventory-file-target-'))
		try {
			mkdirSync(join(root, 'src'))
			writeFileSync(join(root, 'notes.md'), 'notes')
			writeFileSync(join(root, 'src', 'index.ts'), 'index')

			expect(readInventory(root, ['notes.md', 'src'], { extensions: ['.ts'] })).toStrictEqual({
				'notes.md': 'notes',
				'src/index.ts': 'index',
			})
			expect(Object.keys(readInventory(root, ['.'], { extensions: ['.ts'] }))).toStrictEqual([
				'src/index.ts',
			])
		} finally {
			rmSync(root, { force: true, recursive: true })
		}
	})

	it('walks a named directory target under the extension filter', () => {
		const root = mkdtempSync(join(tmpdir(), 'orkestrel-test-inventory-directory-target-'))
		try {
			mkdirSync(join(root, 'src', 'nested'), { recursive: true })
			writeFileSync(join(root, 'outside.ts'), 'outside')
			writeFileSync(join(root, 'src', 'index.ts'), 'index')
			writeFileSync(join(root, 'src', 'data.json'), 'data')
			writeFileSync(join(root, 'src', 'nested', 'deep.ts'), 'deep')

			expect(readInventory(root, ['src'], { extensions: ['.ts'] })).toStrictEqual({
				'src/index.ts': 'index',
				'src/nested/deep.ts': 'deep',
			})
		} finally {
			rmSync(root, { force: true, recursive: true })
		}
	})

	it('refuses a root that is not a directory', () => {
		const parent = mkdtempSync(join(tmpdir(), 'orkestrel-test-inventory-root-file-'))
		const root = join(parent, 'file.txt')
		try {
			writeFileSync(root, 'file')
			expect(() => readInventory(root, ['.'])).toThrow('Root is not a directory')
		} finally {
			rmSync(parent, { force: true, recursive: true })
		}
	})

	it('uses the host filesystem case behavior without assuming it', () => {
		const root = mkdtempSync(join(tmpdir(), 'orkestrel-test-inventory-case-'))
		try {
			mkdirSync(join(root, 'mixed'))
			writeFileSync(join(root, 'mixed', 'file.txt'), 'case')
			const directory = existsSync(join(root, 'MIXED')) ? 'MIXED' : 'mixed'

			expect(readInventory(root, [directory])).toStrictEqual({ 'mixed/file.txt': 'case' })
		} finally {
			rmSync(root, { force: true, recursive: true })
		}
	})
})

describe('isRunning', () => {
	it('reports the process making the call', () => {
		expect(isRunning(process.pid)).toBe(true)
	})

	it('reports a child that has exited', async () => {
		const child = spawn(process.execPath, ['-e', ''], { stdio: 'ignore' })
		const pid = requireValue(child.pid, 'the spawned child reported no process id')
		await once(child, 'exit')

		// The exited pid is read immediately, so the host has had no opportunity to hand it to
		// another process; a true answer here would mean the reader never consulted the host.
		expect(isRunning(pid)).toBe(false)
	})

	it('reports a pid the host refuses to accept, without throwing', () => {
		// `2 ** 31` is outside the signed 32-bit range Node accepts, so `process.kill` refuses it with
		// `ERR_INVALID_ARG_TYPE` rather than reporting on a process. The refusal is Node's own, so it
		// is the same on every host, and a total reader answers false instead of raising it.
		expect(isRunning(2 ** 31)).toBe(false)
	})
})

describe('waitForSocketClose', () => {
	it('resolves for a socket that has already closed', async () => {
		const loopback = await createLoopback(createHTTPServer())
		const client = connect(loopback.port, '127.0.0.1')
		client.on('error', () => {})
		try {
			await once(client, 'connect')
			client.destroy()
			await once(client, 'close')
			expect(client.closed).toBe(true)

			// The budget is the control: a wait that listened for a `close` already emitted would
			// reject 25ms later instead of resolving.
			await expect(waitForSocketClose(client, { budget: 25 })).resolves.toBeUndefined()
		} finally {
			client.destroy()
			await loopback.destroy()
		}
	})

	it('resolves when the peer ends the connection', async () => {
		const loopback = await createLoopback(createNetServer((socket) => socket.end()))
		const client = connect(loopback.port, '127.0.0.1')
		const closes = createRecorder<[hadError: boolean]>()
		client.on('close', closes.handler)
		try {
			await waitForSocketClose(client, { budget: 1000 })

			expect(client.destroyed).toBe(true)
			expect(closes.calls).toStrictEqual([[false]])
		} finally {
			client.destroy()
			await loopback.destroy()
		}
	})

	it('waits past a peer reset and resolves on the close that follows it', async () => {
		const loopback = await createLoopback(createNetServer((socket) => socket.resetAndDestroy()))
		const client = connect(loopback.port, '127.0.0.1')
		const errors = createRecorder<[error: Error]>()
		const closes = createRecorder<[hadError: boolean]>()
		client.on('error', errors.handler)
		client.on('close', closes.handler)
		try {
			await waitForSocketClose(client, { budget: 1000 })

			// The reset really happened, so the resolution above came from waiting past it rather
			// than from a connection that ended cleanly.
			expect(errors.count).toBe(1)
			expect(errors.calls[0]?.[0]).toHaveProperty('code', 'ECONNRESET')
			expect(closes.calls).toStrictEqual([[true]])
		} finally {
			client.destroy()
			await loopback.destroy()
		}
	})

	it('rejects a socket error that is not a reset', async () => {
		const loopback = await createLoopback(createHTTPServer())
		const client = connect(loopback.port, '127.0.0.1')
		const refusal = new Error('the host refused the stream')
		try {
			const wait = waitForSocketClose(client, { budget: 1000 })
			client.destroy(refusal)

			await expect(wait).rejects.toBe(refusal)
		} finally {
			client.destroy()
			await loopback.destroy()
		}
	})

	it('rejects when the socket stays open past the budget', async () => {
		const loopback = await createLoopback(createHTTPServer())
		const client = connect(loopback.port, '127.0.0.1')
		client.on('error', () => {})
		try {
			await once(client, 'connect')

			await expect(waitForSocketClose(client, { budget: 25 })).rejects.toThrow(
				'Socket did not close within 25ms',
			)
			expect(client.closed).toBe(false)
		} finally {
			client.destroy()
			await loopback.destroy()
		}
	})

	it('removes both listeners after it rejects and after it resolves', async () => {
		const loopback = await createLoopback(createHTTPServer())
		const client = connect(loopback.port, '127.0.0.1')
		client.on('error', () => {})
		try {
			await once(client, 'connect')
			const closes = client.listenerCount('close')
			const errors = client.listenerCount('error')

			await expect(waitForSocketClose(client, { budget: 25 })).rejects.toThrow(
				'Socket did not close within 25ms',
			)
			expect(client.listenerCount('close')).toBe(closes)
			expect(client.listenerCount('error')).toBe(errors)

			const wait = waitForSocketClose(client, { budget: 1000 })
			client.destroy()
			await wait

			expect(client.listenerCount('close')).toBe(closes)
			expect(client.listenerCount('error')).toBe(errors)
		} finally {
			client.destroy()
			await loopback.destroy()
		}
	})

	it('rejects with the abort reason, before and during the wait', async () => {
		const loopback = await createLoopback(createHTTPServer())
		const client = connect(loopback.port, '127.0.0.1')
		const reason = new Error('the caller stopped waiting')
		client.on('error', () => {})
		try {
			await once(client, 'connect')
			const controller = new AbortController()
			const wait = waitForSocketClose(client, { budget: 1000, signal: controller.signal })
			controller.abort(reason)
			await expect(wait).rejects.toBe(reason)

			// A signal already aborted refuses before either listener is attached, so the counts
			// below are what they were before the call.
			const closes = client.listenerCount('close')
			await expect(waitForSocketClose(client, { signal: AbortSignal.abort(reason) })).rejects.toBe(
				reason,
			)
			expect(client.listenerCount('close')).toBe(closes)
		} finally {
			client.destroy()
			await loopback.destroy()
		}
	})

	it('refuses a budget and an interval that are not finite and non-negative', async () => {
		const loopback = await createLoopback(createHTTPServer())
		const client = connect(loopback.port, '127.0.0.1')
		client.on('error', () => {})
		try {
			await expect(waitForSocketClose(client, { budget: Number.NaN })).rejects.toThrow(
				'Socket budget must be finite and non-negative',
			)
			await expect(waitForSocketClose(client, { budget: -1 })).rejects.toThrow(
				'Socket budget must be finite and non-negative',
			)
			await expect(
				waitForSocketClose(client, { interval: Number.POSITIVE_INFINITY }),
			).rejects.toThrow('Socket interval must be finite and non-negative')
			await expect(waitForSocketClose(client, { interval: -1 })).rejects.toThrow(
				'Socket interval must be finite and non-negative',
			)
		} finally {
			client.destroy()
			await loopback.destroy()
		}
	})
})

describe('destroyScratch', () => {
	it('destroys the allocation on its first attempt, taking no retry delay', async () => {
		const scratch = createScratch({ files: { 'nested/file.txt': 'file' } })
		const start = performance.now()

		await destroyScratch(scratch, { budget: 5000, interval: 1000 })

		// One retry costs the whole interval, so an elapsed reading below it is what proves
		// `destroy()` was called once and the loop was left immediately.
		expect(performance.now() - start).toBeLessThan(1000)
		expect(existsSync(scratch.path)).toBe(false)
	})

	// The hold below is a permission hold, so it forms only where the host enforces the permission.
	// `PERMISSION_HOLD_REFUSES_REMOVAL` records whether it did, attempted for real at load. The
	// Windows case beneath it holds the allocation the one way that host refuses a removal for.
	it.runIf(PERMISSION_HOLD_REFUSES_REMOVAL)(
		'rejects when a permission hold outlasts the budget, and destroys the allocation once it lifts',
		async () => {
			const parent = mkdtempSync(join(tmpdir(), 'orkestrel-test-destroy-held-'))
			const scratch = createScratch({ parent, prefix: 'held-' })
			try {
				chmodSync(parent, 0o500)

				const rejection: unknown = await destroyScratch(scratch, {
					budget: 60,
					interval: 20,
				}).catch((error: unknown) => error)

				expect(rejection).toBeInstanceOf(Error)
				expect(rejection).toHaveProperty(
					'message',
					'Scratch directory was not destroyed within 60ms',
				)
				// A `code` is the host's own signature; nothing this package throws carries one.
				expect(rejection).toHaveProperty('cause', expect.any(Error))
				expect(rejection).toHaveProperty(['cause', 'code'], expect.any(String))
				expect(existsSync(scratch.path)).toBe(true)

				const release = setTimeout(() => chmodSync(parent, 0o700), 60)
				try {
					await destroyScratch(scratch, { budget: 5000, interval: 20 })
				} finally {
					clearTimeout(release)
				}

				expect(existsSync(scratch.path)).toBe(false)
			} finally {
				chmodSync(parent, 0o700)
				rmSync(parent, { force: true, recursive: true })
			}
		},
	)

	it.runIf(process.platform === 'win32')(
		'rejects when a live process holds the allocation past the budget, and destroys it once the process exits',
		async () => {
			const scratch = createScratch({ prefix: 'orkestrel-test-destroy-held-' })
			const child = spawn(process.execPath, ['-e', HOLD_CWD], {
				cwd: scratch.path,
				stdio: ['ignore', 'pipe', 'ignore'],
			})
			try {
				// The child is provably alive and holding the directory once it has spoken, so the
				// rejection below is the hold rather than luck of timing.
				await once(child.stdout, 'data')

				const rejection: unknown = await destroyScratch(scratch, {
					budget: 60,
					interval: 20,
				}).catch((error: unknown) => error)

				expect(rejection).toBeInstanceOf(Error)
				expect(rejection).toHaveProperty(
					'message',
					'Scratch directory was not destroyed within 60ms',
				)
				// A `code` is the host's own signature; nothing this package throws carries one.
				expect(rejection).toHaveProperty('cause', expect.any(Error))
				expect(rejection).toHaveProperty(['cause', 'code'], expect.any(String))
				expect(existsSync(scratch.path)).toBe(true)

				// `removeTree` already outlasts about a second of this refusal inside one attempt, so
				// the release lands past that second and the retry here is what covers the rest.
				const release = setTimeout(() => child.kill(), 1200)
				try {
					await destroyScratch(scratch, { budget: 20_000, interval: 25 })
				} finally {
					clearTimeout(release)
				}

				expect(existsSync(scratch.path)).toBe(false)
			} finally {
				// The release above usually kills the child, and `exit` has then already been
				// emitted; awaiting it again would wait for an event that never comes twice.
				if (child.exitCode === null && child.signalCode === null) {
					child.kill()
					await once(child, 'exit').catch(() => {})
				}
				if (existsSync(scratch.path)) rmSync(scratch.path, { force: true, recursive: true })
			}
		},
		// Each refused attempt costs `removeTree`'s own second of retries, and this case needs three
		// of them, so the budget is sized from that rather than from an ordinary test's cost.
		30_000,
	)

	it('refuses a signal that is already aborted, before it attempts anything', async () => {
		const scratch = createScratch()
		const reason = new Error('the caller stopped waiting')
		try {
			await expect(destroyScratch(scratch, { signal: AbortSignal.abort(reason) })).rejects.toBe(
				reason,
			)

			expect(existsSync(scratch.path)).toBe(true)
		} finally {
			scratch.destroy()
		}
	})

	it('refuses a budget and an interval that are not finite and non-negative', async () => {
		const scratch = createScratch()
		try {
			await expect(destroyScratch(scratch, { budget: Number.NaN })).rejects.toThrow(
				'Scratch budget must be finite and non-negative',
			)
			await expect(destroyScratch(scratch, { budget: -1 })).rejects.toThrow(
				'Scratch budget must be finite and non-negative',
			)
			await expect(destroyScratch(scratch, { interval: Number.POSITIVE_INFINITY })).rejects.toThrow(
				'Scratch interval must be finite and non-negative',
			)
			await expect(destroyScratch(scratch, { interval: -1 })).rejects.toThrow(
				'Scratch interval must be finite and non-negative',
			)

			// Every refusal answers before the first attempt, so the allocation is still standing.
			expect(existsSync(scratch.path)).toBe(true)
		} finally {
			scratch.destroy()
		}
	})
})

describe('requestUpgrade', () => {
	// A server that upgrades keeps the socket it took: the connection is detached from the HTTP
	// server, so `LoopbackInterface.destroy`'s `closeAllConnections` never reaches it and
	// `server.close` waits on it forever. Every fixture below therefore records what its upgrade
	// handler took and destroys it itself.
	it('reports the protocol a server selects when it claims the upgrade', async () => {
		const detached: Duplex[] = []
		const server = createHTTPServer((_request, response) => {
			response.statusCode = 500
			response.end('the plain handler must not answer an upgrade request')
		})
		server.on('upgrade', (_request, socket) => {
			detached.push(socket)
			socket.write(
				'HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Protocol: chat\r\n\r\n',
			)
		})
		const loopback = await createLoopback(server)
		try {
			// The offered list carries two tokens and the server selects one, so the reported
			// protocol is the server's choice rather than an echo of what was asked for.
			await expect(
				requestUpgrade(loopback.port, { path: '/socket', protocols: ['chat', 'echo'] }),
			).resolves.toStrictEqual({ claimed: true, protocol: 'chat' })

			// The upgrade handler answered, so the plain handler above did not.
			expect(detached.length).toBe(1)
		} finally {
			for (const socket of detached) socket.destroy()
			await loopback.destroy()
		}
	})

	it('claims the upgrade with no protocol when the server selects none', async () => {
		const detached: Duplex[] = []
		const server = createHTTPServer((_request, response) => response.end('unused'))
		server.on('upgrade', (_request, socket) => {
			detached.push(socket)
			socket.write(
				'HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\n\r\n',
			)
		})
		const loopback = await createLoopback(server)
		try {
			// A claimed upgrade that selected nothing is the case that keeps `claimed` from being
			// read off the protocol: absence here means "selected none", not "did not upgrade".
			await expect(requestUpgrade(loopback.port)).resolves.toStrictEqual({
				claimed: true,
				protocol: undefined,
			})
		} finally {
			for (const socket of detached) socket.destroy()
			await loopback.destroy()
		}
	})

	it('reports the status a server answers when it refuses the upgrade', async () => {
		const paths = createRecorder<[path: string | undefined]>()
		const server = createHTTPServer((request, response) => {
			paths.handler(request.url)
			response.statusCode = 426
			response.end('this server upgrades nothing')
		})
		const loopback = await createLoopback(server)
		try {
			await expect(requestUpgrade(loopback.port, { path: '/refused' })).resolves.toStrictEqual({
				claimed: false,
				status: 426,
			})

			// The plain handler really answered, and it answered the path the options named.
			expect(paths.calls).toStrictEqual([['/refused']])
		} finally {
			await loopback.destroy()
		}
	})

	it('rejects with a message naming the port and path when the server never answers', async () => {
		// The server takes the upgrade and writes nothing back, which is the case the budget exists
		// for: the request was delivered, so no transport error arrives, and the `upgrade`,
		// `response`, and `error` events all stay silent for as long as the caller waits.
		const detached: Duplex[] = []
		const server = createHTTPServer((_request, response) => response.end('unused'))
		server.on('upgrade', (_request, socket) => {
			detached.push(socket)
		})
		const silent = await createLoopback(server)
		try {
			const rejection: unknown = await requestUpgrade(silent.port, {
				budget: 50,
				path: '/socket',
			}).catch((error: unknown) => error)

			expect(rejection).toBeInstanceOf(Error)
			// The port and the path are what tell a caller which wait ended, so both are read out of
			// the message rather than matched as one fixed sentence.
			expect(rejection).toHaveProperty('message', expect.stringContaining(String(silent.port)))
			expect(rejection).toHaveProperty('message', expect.stringContaining('/socket'))

			// The server really took the request, so the wait ended on the budget rather than on a
			// connection that was never made.
			expect(detached.length).toBe(1)

			// The budget is a settlement path like the others, so it releases the client socket
			// like the others. The fixture still holds the socket its upgrade handler took, so the
			// reading clears only when the client end is gone and that server end is what remains.
			await waitForCondition(
				'only the socket the fixture still holds is left open',
				() => countSocketHandles() === detached.length,
				{ budget: 1000 },
			)
		} finally {
			for (const socket of detached) socket.destroy()
			await silent.destroy()
		}
	})

	it('rejects with the abort reason, before and during the wait', async () => {
		const detached: Duplex[] = []
		const server = createHTTPServer((_request, response) => response.end('unused'))
		server.on('upgrade', (_request, socket) => {
			detached.push(socket)
		})
		const silent = await createLoopback(server)
		const reason = new Error('the caller stopped waiting')
		try {
			const controller = new AbortController()
			const pending = requestUpgrade(silent.port, { budget: 1000, signal: controller.signal })
			controller.abort(reason)
			await expect(pending).rejects.toBe(reason)

			// An already-aborted signal refuses before the request is made, so the rejection is the
			// caller's reason rather than anything the transport produced.
			await expect(requestUpgrade(silent.port, { signal: AbortSignal.abort(reason) })).rejects.toBe(
				reason,
			)
		} finally {
			for (const socket of detached) socket.destroy()
			await silent.destroy()
		}
	})

	it('refuses a budget and an interval that are not finite and non-negative', async () => {
		const loopback = await createLoopback(createHTTPServer())
		try {
			// A bound is read before anything is sent, so these refusals need no answering server.
			await expect(requestUpgrade(loopback.port, { budget: Number.NaN })).rejects.toThrow(
				'Upgrade budget must be finite and non-negative',
			)
			await expect(requestUpgrade(loopback.port, { budget: -1 })).rejects.toThrow(
				'Upgrade budget must be finite and non-negative',
			)
			await expect(requestUpgrade(loopback.port, { interval: Number.NaN })).rejects.toThrow(
				'Upgrade interval must be finite and non-negative',
			)
			await expect(requestUpgrade(loopback.port, { interval: -1 })).rejects.toThrow(
				'Upgrade interval must be finite and non-negative',
			)
		} finally {
			await loopback.destroy()
		}
	})

	it('rejects with the transport error when nothing listens on the port', async () => {
		const loopback = await createLoopback(createHTTPServer())
		const port = loopback.port
		await loopback.destroy()

		const rejection: unknown = await requestUpgrade(port).catch((error: unknown) => error)

		expect(rejection).toBeInstanceOf(Error)
		// A `code` is the host's own signature; nothing this package throws carries one.
		expect(rejection).toHaveProperty('code', 'ECONNREFUSED')
	})

	it('releases the client socket on the claimed, refused, and rejected paths', async () => {
		const detached: Duplex[] = []
		const ends = createRecorder<[]>()
		const server = createHTTPServer((_request, response) => response.end('unused'))
		server.on('upgrade', (_request, socket) => {
			detached.push(socket)
			socket.on('end', ends.handler)
			socket.write(
				'HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\n\r\n',
			)
		})
		const upgrading = await createLoopback(server)
		// No `upgrade` listener, so Node routes the same request to the plain handler and this
		// server drives the refused path while the one above drives the claimed path.
		const refusing = await createLoopback(
			createHTTPServer((_request, response) => {
				response.statusCode = 426
				response.end('this server upgrades nothing')
			}),
		)
		const released = await createLoopback(createHTTPServer())
		const port = released.port
		await released.destroy()
		try {
			// The cases before this one leave sockets draining, so the floor is established by
			// waiting for them to finish rather than by reading a number that is still falling.
			await waitForCondition(
				'every socket the earlier cases opened has drained',
				() => countSocketHandles() === 0,
				{ budget: 1000 },
			)

			const claimed = await requestUpgrade(upgrading.port, { path: '/socket' })
			const refused = await requestUpgrade(refusing.port)
			const rejection: unknown = await requestUpgrade(port).catch((error: unknown) => error)

			// All three paths were really driven, so the release below covers each of them rather
			// than one path taken three times.
			expect([claimed.claimed, refused.claimed]).toStrictEqual([true, false])
			expect(rejection).toBeInstanceOf(Error)

			// The peer's own reading of the claimed path: an upgraded socket is detached from the
			// request and outlives it, so the server end sees `end` only where the helper destroyed
			// the client end itself.
			await waitForCondition(
				'the upgraded server end saw the client end close',
				() => ends.count === 1,
				{ budget: 1000 },
			)

			// The fixture deliberately still holds the socket its upgrade handler took, so this
			// reading clears only when every client socket the three calls opened is gone and that
			// one server socket is what remains. A pooled or undestroyed client socket keeps a
			// runner's event loop from draining after the suite finishes, and shows up here.
			expect(detached.length).toBe(1)
			await waitForCondition(
				'only the socket the fixture still holds is left open',
				() => countSocketHandles() === detached.length,
				{ budget: 1000 },
			)
		} finally {
			for (const socket of detached) socket.destroy()
			await upgrading.destroy()
			await refusing.destroy()
		}
	})
})

describe('host capability probes', () => {
	for (const [name, probe] of HOST_PROBES) {
		it(`${name} answers this host with a boolean`, () => {
			expect(typeof probe()).toBe('boolean')
		})

		it(`${name} allocates below the host temporary directory and leaves nothing there`, () => {
			const owned = createScratch({ prefix: 'orkestrel-test-residue-' })
			// `os.tmpdir()` resolves against whichever temporary-directory variable its platform reads
			// first, so pointing the whole set at an owned empty directory is what makes the residue
			// reading exact rather than a guess about which entry under the real temporary directory
			// belonged to this call. A scratch path carries no trailing separator and `os.tmpdir()`
			// strips one, so the equality holds on either platform.
			const restore = overrideTemporaryDirectory(owned.path)
			try {
				expect(tmpdir()).toBe(owned.path)

				probe()

				expect(owned.names()).toStrictEqual([])
			} finally {
				restore()
				owned.destroy()
			}
		})

		it(`${name} raises a failure to allocate rather than reading it as a refusal`, () => {
			const owned = createScratch({ prefix: 'orkestrel-test-missing-tmpdir-' })
			const missing = join(owned.path, 'absent')
			// This is the control for the preceding residue case: with every temporary-directory
			// variable pointed at a path that does not exist, allocation beneath a missing parent
			// throws `ENOENT` on win32 and POSIX alike. A probe that ignored `os.tmpdir()` would
			// answer `false` here, and the residue case would then be reading an empty directory
			// nothing had ever allocated in.
			const restore = overrideTemporaryDirectory(missing)
			try {
				const failure = captureError(probe)

				expect(failure).toBeInstanceOf(Error)
				expect(failure).toHaveProperty('code', 'ENOENT')
			} finally {
				restore()
				owned.destroy()
			}
		})
	}

	it('supportsCase reads case folding, on a pair of names differing only by case', () => {
		const upper = 'Cased'
		const lower = 'cased'
		const owned = createScratch({ prefix: 'orkestrel-test-case-control-' })
		try {
			// The subject has to differ by case and by nothing else, or the reading below is true on
			// every host and answers nothing about folding.
			expect(upper).not.toBe(lower)
			expect(upper.toLowerCase()).toBe(lower)

			owned.write(upper, 'written')

			// A second mechanism that can disagree with the probe's: the probe compares contents
			// after two writes, while this asks the host to resolve a name that was never created.
			expect(supportsCase()).toBe(!owned.has(lower))

			// The control for that lookup: it finds the name that was written and refuses one that
			// was not, so a `false` from it is an answer rather than a lookup that never works.
			expect(owned.has(upper)).toBe(true)
			expect(owned.has(`${upper}Extra`)).toBe(false)
		} finally {
			owned.destroy()
		}
	})

	it('supportsMode reads whether a bit is stored, not whether it is enforced', () => {
		const parent = mkdtempSync(join(tmpdir(), 'orkestrel-test-mode-control-'))
		try {
			mkdirSync(join(parent, 'held'))
			chmodSync(parent, 0o500)
			const stored = (statSync(parent).mode & 0o777) === 0o500

			// The two readings come apart on a root POSIX host, which stores every bit faithfully
			// and bypasses the check the bits describe. That is why the permission-hold case earlier
			// probes the refusal instead of reading `supportsMode`.
			expect(supportsMode()).toBe(stored)

			// The prediction the distinction earns: a host that stores the bit refuses the removal
			// for every user except uid 0, and a host that stores nothing refuses nothing. The
			// stored reading and the user id are read outside the hold probe, so this assertion
			// fails wherever the probe's answer and that prediction come apart.
			expect(PERMISSION_HOLD_REFUSES_REMOVAL).toBe(stored && process.getuid?.() !== 0)
		} finally {
			chmodSync(parent, 0o700)
			rmSync(parent, { force: true, recursive: true })
		}
	})
})
