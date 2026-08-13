import {
	existsSync,
	mkdirSync,
	mkdtempSync,
	readFileSync,
	readdirSync,
	rmSync,
	symlinkSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { basename, isAbsolute, join, relative } from 'node:path'
import { createScratch } from '@src/server'
import { describe, expect, it } from 'vitest'

describe('createScratch', () => {
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

	it('refuses paths through symlinks while allowing regular directories', () => {
		const outside = mkdtempSync(join(tmpdir(), 'orkestrel-test-scratch-outside-'))
		const scratch = createScratch()
		try {
			mkdirSync(join(scratch.path, 'regular'))
			scratch.write('regular/file.txt', 'regular')
			expect(scratch.read('regular/file.txt')).toBe('regular')

			symlinkSync(outside, join(scratch.path, 'linked'), 'dir')
			expect(() => scratch.write('linked/file.txt', 'outside')).toThrow(
				'Path is a symbolic link: linked/file.txt',
			)
			expect(() => scratch.read('linked/file.txt')).toThrow(
				'Path is a symbolic link: linked/file.txt',
			)
			expect(() => scratch.exists('linked/file.txt')).toThrow(
				'Path is a symbolic link: linked/file.txt',
			)
			expect(existsSync(join(outside, 'file.txt'))).toBe(false)
		} finally {
			scratch.destroy()
			rmSync(outside, { force: true, recursive: true })
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
