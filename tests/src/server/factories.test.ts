import {
	existsSync,
	lstatSync,
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
			expect(scratch.has('nested/file.txt')).toBe(true)
			expect(scratch.read('missing.txt')).toBeUndefined()
			expect(scratch.has('missing.txt')).toBe(false)

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
		expect(existsSync(scratch.path)).toBe(false)
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
			expect(scratch.has('inside.txt')).toBe(true)

			expect(() => scratch.write('../outside.txt', 'outside')).toThrow(
				'Path outside scratch directory: ../outside.txt',
			)
			expect(() => scratch.read('../outside.txt')).toThrow(
				'Path outside scratch directory: ../outside.txt',
			)
			expect(() => scratch.has('../outside.txt')).toThrow(
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
			expect(scratch.has('linked/file.txt')).toBe(true)
			expect(readFileSync(join(outside, 'file.txt'), 'utf8')).toBe('linked')
		} finally {
			scratch.destroy()
			rmSync(outside, { force: true, recursive: true })
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
			expect(() => scratch.has('file.txt')).toThrow('Scratch directory is a symbolic link')
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
			expect(() => scratch.has('file.txt')).toThrow('Scratch path is not a directory')
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

	describe('names', () => {
		it('lists one level of the scratch root in sorted order', () => {
			const scratch = createScratch()
			try {
				// Entries are created in descending order. Directory order is a host property, and
				// this host returns it already sorted, so the expected order below fails for a
				// dropped sort only on a host whose directories are hash-ordered.
				scratch.write('zeta.txt', 'zeta')
				scratch.write('mid.txt', 'mid')
				scratch.write('alpha.txt', 'alpha')
				scratch.ensure('nested')
				scratch.write('nested/deep.txt', 'deep')

				expect(scratch.names()).toStrictEqual(['alpha.txt', 'mid.txt', 'nested', 'zeta.txt'])
			} finally {
				scratch.destroy()
			}
		})

		it('lists a contained subdirectory by name rather than by path', () => {
			const scratch = createScratch()
			try {
				scratch.write('nested/zeta.txt', 'zeta')
				scratch.write('nested/alpha.txt', 'alpha')
				scratch.ensure('nested/inner')

				expect(scratch.names('nested')).toStrictEqual(['alpha.txt', 'inner', 'zeta.txt'])
				expect(scratch.names(join(scratch.path, 'nested'))).toStrictEqual([
					'alpha.txt',
					'inner',
					'zeta.txt',
				])
			} finally {
				scratch.destroy()
			}
		})

		it('refuses an escape, a missing target, and a file target', () => {
			const scratch = createScratch()
			try {
				scratch.write('nested/file.txt', 'file')
				expect(scratch.names('nested')).toStrictEqual(['file.txt'])

				expect(() => scratch.names('..')).toThrow('Path outside scratch directory: ..')
				expect(() => scratch.names('missing')).toThrow('Scratch path does not exist: missing')
				expect(() => scratch.names('nested/file.txt')).toThrow(
					'Scratch path is not a directory: nested/file.txt',
				)
			} finally {
				scratch.destroy()
			}
		})
	})

	describe('ensure', () => {
		it('creates a directory that did not exist', () => {
			const scratch = createScratch()
			try {
				expect(scratch.has('made')).toBe(false)

				const made = scratch.ensure('made')

				expect(scratch.has('made')).toBe(true)
				expect(statSync(made).isDirectory()).toBe(true)
			} finally {
				scratch.destroy()
			}
		})

		it('creates every missing parent of a nested target', () => {
			const scratch = createScratch()
			try {
				scratch.ensure('outer/middle/inner')

				expect(scratch.has('outer/middle/inner')).toBe(true)
				expect(scratch.names('outer')).toStrictEqual(['middle'])
				expect(scratch.names('outer/middle')).toStrictEqual(['inner'])
			} finally {
				scratch.destroy()
			}
		})

		it('creates a genuinely empty directory', () => {
			const scratch = createScratch()
			try {
				const made = scratch.ensure('empty')

				expect(statSync(made).isDirectory()).toBe(true)
				expect(scratch.names('empty')).toStrictEqual([])
			} finally {
				scratch.destroy()
			}
		})

		it('is idempotent and returns the joined absolute path', () => {
			const scratch = createScratch()
			try {
				const first = scratch.ensure('twice')
				scratch.write('twice/kept.txt', 'kept')
				const second = scratch.ensure('twice')

				expect(isAbsolute(first)).toBe(true)
				expect(first).toBe(join(scratch.path, 'twice'))
				expect(second).toBe(first)
				expect(scratch.read('twice/kept.txt')).toBe('kept')
			} finally {
				scratch.destroy()
			}
		})

		it('refuses a target that exists as a file and a target that escapes', () => {
			const scratch = createScratch()
			const outside = join(dirname(scratch.path), `${basename(scratch.path)}-escape`)
			try {
				scratch.write('file.txt', 'file')

				expect(() => scratch.ensure('file.txt')).toThrow(
					'Scratch path is not a directory: file.txt',
				)
				expect(() => scratch.ensure(`../${basename(outside)}`)).toThrow(
					`Path outside scratch directory: ../${basename(outside)}`,
				)
				expect(existsSync(outside)).toBe(false)
			} finally {
				scratch.destroy()
			}
		})
	})

	describe('link', () => {
		it('creates a link at a contained target and creates its missing parents', () => {
			const scratch = createScratch()
			try {
				scratch.write('source.txt', 'source')
				scratch.link('nested/deep/linked.txt', join(scratch.path, 'source.txt'))

				expect(scratch.has('nested/deep/linked.txt')).toBe(true)
				expect(lstatSync(join(scratch.path, 'nested', 'deep', 'linked.txt')).isSymbolicLink()).toBe(
					true,
				)
				expect(scratch.read('nested/deep/linked.txt')).toBe('source')
				expect(scratch.names('nested')).toStrictEqual(['deep'])
			} finally {
				scratch.destroy()
			}
		})

		it('points a contained link at a source outside the allocation', () => {
			const source = createScratch({ prefix: 'orkestrel-test-link-source-' })
			const scratch = createScratch()
			try {
				source.write('file.txt', 'outside')
				expect(relative(scratch.path, source.path).startsWith('..')).toBe(true)

				scratch.link('outside.txt', join(source.path, 'file.txt'))

				expect(scratch.has('outside.txt')).toBe(true)
				expect(lstatSync(join(scratch.path, 'outside.txt')).isSymbolicLink()).toBe(true)
				expect(scratch.read('outside.txt')).toBe('outside')
			} finally {
				scratch.destroy()
				source.destroy()
			}
		})

		it('reports a dangling link as existing but unreadable', () => {
			const scratch = createScratch()
			try {
				scratch.link('dangling', 'missing.txt')

				expect(scratch.has('dangling')).toBe(true)
				expect(scratch.read('dangling')).toBeUndefined()
			} finally {
				scratch.destroy()
			}
		})

		it('refuses an escaping target while accepting an escaping source', () => {
			const source = createScratch({ prefix: 'orkestrel-test-link-refusal-' })
			const scratch = createScratch()
			const outside = join(dirname(scratch.path), `${basename(scratch.path)}-escape`)
			try {
				expect(() => scratch.link(`../${basename(outside)}`, source.path)).toThrow(
					`Path outside scratch directory: ../${basename(outside)}`,
				)
				expect(existsSync(outside)).toBe(false)

				scratch.link('contained', source.path)
				expect(scratch.has('contained')).toBe(true)
			} finally {
				scratch.destroy()
				source.destroy()
			}
		})
	})

	describe('parent', () => {
		it('allocates directly beneath a caller-supplied parent and destroys there', () => {
			const parent = createScratch({ prefix: 'orkestrel-test-parent-' })
			try {
				const scratch = createScratch({ parent: parent.path, prefix: 'child-' })

				expect(dirname(scratch.path)).toBe(resolve(parent.path))
				expect(basename(scratch.path).startsWith('child-')).toBe(true)
				expect(parent.names()).toStrictEqual([basename(scratch.path)])

				scratch.destroy()

				expect(existsSync(scratch.path)).toBe(false)
				expect(parent.names()).toStrictEqual([])
			} finally {
				parent.destroy()
			}
		})

		it('leaves a foreign directory standing beneath a caller-supplied parent', () => {
			const parent = createScratch({ prefix: 'orkestrel-test-parent-swap-' })
			try {
				const scratch = createScratch({ parent: parent.path, prefix: 'child-' })
				rmSync(scratch.path, { force: true, recursive: true })
				mkdirSync(scratch.path)
				writeFileSync(join(scratch.path, 'not-mine.txt'), 'foreign')

				scratch.destroy()

				expect(existsSync(scratch.path)).toBe(true)
				expect(readFileSync(join(scratch.path, 'not-mine.txt'), 'utf8')).toBe('foreign')
			} finally {
				parent.destroy()
			}
		})

		it('refuses a missing parent and a parent that is a file', () => {
			const parent = createScratch({ prefix: 'orkestrel-test-parent-refusal-' })
			try {
				parent.write('file.txt', 'file')

				expect(() => createScratch({ parent: join(parent.path, 'missing') })).toThrow(
					'Scratch parent does not exist',
				)
				expect(() => createScratch({ parent: join(parent.path, 'file.txt') })).toThrow(
					'Scratch parent is not a directory',
				)
				expect(parent.names()).toStrictEqual(['file.txt'])
			} finally {
				parent.destroy()
			}
		})

		it('refuses a parent whose final segment is a symbolic link', () => {
			const parent = createScratch({ prefix: 'orkestrel-test-parent-linked-' })
			try {
				const real = parent.ensure('real')
				parent.link('linked', real)

				expect(() => createScratch({ parent: join(parent.path, 'linked') })).toThrow(
					'Scratch parent is a symbolic link',
				)

				const scratch = createScratch({ parent: real, prefix: 'child-' })
				expect(dirname(scratch.path)).toBe(real)
				scratch.destroy()
			} finally {
				parent.destroy()
			}
		})
	})

	describe('prefix', () => {
		it('accepts a plain name fragment', () => {
			const scratch = createScratch({ prefix: 'orkestrel-test-fragment-' })
			try {
				expect(basename(scratch.path).startsWith('orkestrel-test-fragment-')).toBe(true)
				expect(dirname(scratch.path)).toBe(resolve(tmpdir()))
			} finally {
				scratch.destroy()
			}
		})

		it('refuses a prefix containing a path separator', () => {
			const parent = createScratch({ prefix: 'orkestrel-test-prefix-separator-' })
			try {
				parent.ensure('nested')

				expect(() => createScratch({ parent: parent.path, prefix: 'nested/child-' })).toThrow(
					'Scratch prefix must be a name fragment',
				)
				expect(parent.names('nested')).toStrictEqual([])
			} finally {
				parent.destroy()
			}
		})

		it('refuses a prefix containing ..', () => {
			const parent = createScratch({ prefix: 'orkestrel-test-prefix-escape-' })
			const sibling = `${basename(parent.path)}-evil-`
			const before = readdirSync(dirname(parent.path))
				.filter((name) => name.startsWith(sibling))
				.sort()
			try {
				expect(() => createScratch({ parent: parent.path, prefix: `../${sibling}` })).toThrow(
					'Scratch prefix must be a name fragment',
				)

				const after = readdirSync(dirname(parent.path))
					.filter((name) => name.startsWith(sibling))
					.sort()
				expect(after).toStrictEqual(before)
				expect(parent.names()).toStrictEqual([])
			} finally {
				parent.destroy()
			}
		})
	})
})
