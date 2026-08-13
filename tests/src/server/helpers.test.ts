import { existsSync, mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { readInventory, resolveContained } from '@src/server'
import { describe, expect, it } from 'vitest'

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

describe('readInventory', () => {
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

	it('validates the root when no directories are requested', () => {
		const parent = mkdtempSync(join(tmpdir(), 'orkestrel-test-inventory-empty-'))
		const root = join(parent, 'root')
		const linked = join(parent, 'linked')
		try {
			mkdirSync(root)
			symlinkSync(root, linked, 'dir')

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

	it('refuses a symlinked root while accepting the real directory', () => {
		const parent = mkdtempSync(join(tmpdir(), 'orkestrel-test-inventory-root-'))
		const root = join(parent, 'root')
		const linked = join(parent, 'linked')
		try {
			mkdirSync(root)
			writeFileSync(join(root, 'file.txt'), 'real')
			symlinkSync(root, linked, 'dir')

			expect(readInventory(pathToFileURL(root), ['.'])).toStrictEqual({ 'file.txt': 'real' })
			expect(() => readInventory(linked, ['.'])).toThrow('Root is a symbolic link')
		} finally {
			rmSync(parent, { force: true, recursive: true })
		}
	})

	it('refuses a symlinked root supplied as a URL with a trailing slash', () => {
		const parent = mkdtempSync(join(tmpdir(), 'orkestrel-test-inventory-url-root-'))
		const root = join(parent, 'root')
		const linked = join(parent, 'linked')
		try {
			mkdirSync(root)
			writeFileSync(join(root, 'file.txt'), 'real')
			symlinkSync(root, linked, 'dir')

			const linkedUrl = pathToFileURL(`${linked}/`)
			expect(() => readInventory(linkedUrl, ['.'])).toThrow('Root is a symbolic link')
			expect(() => readInventory(linkedUrl, [])).toThrow('Root is a symbolic link')

			const rootUrl = pathToFileURL(`${root}/`)
			expect(readInventory(rootUrl, ['.'])).toStrictEqual({ 'file.txt': 'real' })
		} finally {
			rmSync(parent, { force: true, recursive: true })
		}
	})

	it('skips a symlinked file and includes the same path when it is a regular file', () => {
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
	})

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

	it('refuses a symlinked directory target and a symlinked file target', () => {
		const parent = mkdtempSync(join(tmpdir(), 'orkestrel-test-inventory-directory-'))
		const root = join(parent, 'root')
		try {
			mkdirSync(root)
			mkdirSync(join(root, 'real'))
			writeFileSync(join(root, 'file.txt'), 'file')
			symlinkSync(join(root, 'real'), join(root, 'linked'), 'dir')
			symlinkSync(join(root, 'file.txt'), join(root, 'linked.txt'), 'file')

			expect(() => readInventory(root, ['linked'])).toThrow('Target is a symbolic link: linked')
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
