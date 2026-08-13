import {
	existsSync,
	mkdirSync,
	mkdtempSync,
	readFileSync,
	readdirSync,
	renameSync,
	rmSync,
	statSync,
	symlinkSync,
	writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { basename, dirname, isAbsolute, join, relative, resolve } from 'node:path'
import { createScratch } from '@src/server'
import { describe, expect, it } from 'vitest'

describe('createScratch', () => {
	it('allocates its directory with mode 0700', () => {
		const scratch = createScratch()
		try {
			expect(statSync(scratch.path).mode & 0o777).toBe(0o700)
		} finally {
			scratch.destroy()
		}
	})

	it('allocates below the temporary directory and seeds nested files', () => {
		const scratch = createScratch({
			files: { 'nested/file.txt': 'seeded' },
			prefix: 'orkestrel-test-seeded-',
		})
		try {
			const location = relative(tmpdir(), scratch.path)
			expect(isAbsolute(location)).toBe(false)
			expect(location.startsWith('..')).toBe(false)
			expect(scratch.read('nested/file.txt')).toBe('seeded')
			expect(scratch.exists('nested/file.txt')).toBe(true)
			expect(scratch.read('missing.txt')).toBeUndefined()
			expect(scratch.exists('missing.txt')).toBe(false)

			scratch.write('created/after.txt', 'written')
			expect(readFileSync(join(scratch.path, 'created', 'after.txt'), 'utf8')).toBe('written')
		} finally {
			scratch.destroy()
		}
	})

	it('destroys its directory idempotently', () => {
		const scratch = createScratch()
		expect(existsSync(scratch.path)).toBe(true)
		expect(basename(scratch.path).startsWith('orkestrel-test-')).toBe(true)

		scratch.destroy()
		expect(existsSync(scratch.path)).toBe(false)
		expect(() => scratch.destroy()).not.toThrow()
	})

	it('leaves a replacement directory at the allocated path', () => {
		const scratch = createScratch()
		rmSync(scratch.path, { recursive: true })
		mkdirSync(scratch.path)
		writeFileSync(join(scratch.path, 'replacement.txt'), 'replacement')
		try {
			scratch.destroy()

			expect(existsSync(scratch.path)).toBe(true)
			expect(readFileSync(join(scratch.path, 'replacement.txt'), 'utf8')).toBe('replacement')
		} finally {
			rmSync(scratch.path, { force: true, recursive: true })
		}
	})

	it('leaves a moved allocation and does not throw during destruction', () => {
		const scratch = createScratch()
		const moved = `${scratch.path}-moved`
		renameSync(scratch.path, moved)
		try {
			expect(() => scratch.destroy()).not.toThrow()
			expect(existsSync(moved)).toBe(true)
		} finally {
			rmSync(moved, { force: true, recursive: true })
		}
	})

	it('refuses escaping paths while allowing contained paths', () => {
		const parent = mkdtempSync(join(tmpdir(), 'orkestrel-test-scratch-control-'))
		const scratch = createScratch()
		const outside = join(parent, 'outside.txt')
		try {
			scratch.write('inside.txt', 'inside')
			expect(scratch.read('inside.txt')).toBe('inside')
			expect(scratch.exists('inside.txt')).toBe(true)

			expect(() => scratch.write('../outside.txt', 'outside')).toThrow(
				'Path outside scratch directory: ../outside.txt',
			)
			expect(() => scratch.read('../outside.txt')).toThrow(
				'Path outside scratch directory: ../outside.txt',
			)
			expect(() => scratch.exists('../outside.txt')).toThrow(
				'Path outside scratch directory: ../outside.txt',
			)
			expect(existsSync(outside)).toBe(false)
		} finally {
			scratch.destroy()
			rmSync(parent, { force: true, recursive: true })
		}
	})

	it('uses lexical containment without walking symbolic-link segments', () => {
		const outside = mkdtempSync(join(tmpdir(), 'orkestrel-test-scratch-outside-'))
		const scratch = createScratch()
		try {
			symlinkSync(outside, join(scratch.path, 'linked'), 'dir')
			scratch.write('linked/file.txt', 'linked')

			expect(scratch.read('linked/file.txt')).toBe('linked')
			expect(scratch.exists('linked/file.txt')).toBe(true)
			expect(readFileSync(join(outside, 'file.txt'), 'utf8')).toBe('linked')
		} finally {
			scratch.destroy()
			rmSync(outside, { force: true, recursive: true })
		}
	})

	it('reports a dangling link as existing but unreadable', () => {
		const scratch = createScratch()
		try {
			symlinkSync('missing.txt', join(scratch.path, 'dangling'), 'file')

			expect(scratch.exists('dangling')).toBe(true)
			expect(scratch.read('dangling')).toBeUndefined()
		} finally {
			scratch.destroy()
		}
	})

	it('rejects reading a directory with a package-authored error', () => {
		const scratch = createScratch()
		try {
			mkdirSync(join(scratch.path, 'nested'))

			expect(() => scratch.read('nested')).toThrow('Scratch path is a directory: nested')
		} finally {
			scratch.destroy()
		}
	})

	it('refuses a prefix that would allocate outside the temporary directory', () => {
		const prefix = '../evil-'
		const outside = resolve(tmpdir(), prefix)
		const before = readdirSync(dirname(outside))
			.filter((name) => name.startsWith(basename(outside)))
			.sort()

		expect(() => createScratch({ prefix })).toThrow(
			'Scratch prefix must stay within the temporary directory',
		)

		const after = readdirSync(dirname(outside))
			.filter((name) => name.startsWith(basename(outside)))
			.sort()
		expect(after).toStrictEqual(before)
	})

	it('refuses writes after destruction', () => {
		const scratch = createScratch()
		scratch.destroy()

		expect(() => scratch.write('file.txt', 'file')).toThrow('Scratch directory does not exist')
	})

	it('refuses existence checks when the scratch root is a symbolic link', () => {
		const scratch = createScratch()
		const moved = `${scratch.path}-moved`
		renameSync(scratch.path, moved)
		symlinkSync(moved, scratch.path, 'dir')
		try {
			expect(() => scratch.exists('file.txt')).toThrow('Scratch directory is a symbolic link')
		} finally {
			rmSync(scratch.path, { force: true })
			rmSync(moved, { force: true, recursive: true })
		}
	})

	it('refuses existence checks when the scratch root is a file', () => {
		const scratch = createScratch()
		scratch.destroy()
		writeFileSync(scratch.path, 'file')
		try {
			expect(() => scratch.exists('file.txt')).toThrow('Scratch path is not a directory')
		} finally {
			rmSync(scratch.path, { force: true })
		}
	})

	it('cleans up when seeded files escape containment', () => {
		const prefix = 'orkestrel-test-invalid-seed-'
		const before = readdirSync(tmpdir())
			.filter((name) => name.startsWith(prefix))
			.sort()
		expect(() => createScratch({ files: { '../outside.txt': 'outside' }, prefix })).toThrow(
			'Path outside scratch directory: ../outside.txt',
		)
		const after = readdirSync(tmpdir())
			.filter((name) => name.startsWith(prefix))
			.sort()
		expect(after).toStrictEqual(before)
	})
})
