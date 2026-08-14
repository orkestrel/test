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
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from 'node:path'
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

	it('refuses every member that reaches the root when it is a symbolic link', () => {
		const scratch = createScratch()
		const moved = `${scratch.path}-moved`
		renameSync(scratch.path, moved)
		symlinkSync(moved, scratch.path, 'dir')
		try {
			const message = 'Scratch directory is a symbolic link'
			expect(() => scratch.has('file.txt')).toThrow(message)
			expect(() => scratch.write('file.txt', 'file')).toThrow(message)
			expect(() => scratch.read('file.txt')).toThrow(message)
			expect(() => scratch.names()).toThrow(message)
			expect(() => scratch.ensure('made')).toThrow(message)
			expect(() => scratch.link('linked', 'source')).toThrow(message)
			expect(() => scratch.remove('file.txt')).toThrow(message)

			expect(readdirSync(moved)).toStrictEqual([])
		} finally {
			rmSync(scratch.path, { force: true })
			rmSync(moved, { force: true, recursive: true })
		}
	})

	it('refuses every member that reaches the root when it is a file', () => {
		const scratch = createScratch()
		scratch.destroy()
		writeFileSync(scratch.path, 'file')
		try {
			const message = 'Scratch path is not a directory'
			expect(() => scratch.has('file.txt')).toThrow(message)
			expect(() => scratch.write('file.txt', 'file')).toThrow(message)
			expect(() => scratch.read('file.txt')).toThrow(message)
			expect(() => scratch.names()).toThrow(message)
			expect(() => scratch.ensure('made')).toThrow(message)
			expect(() => scratch.link('linked', 'source')).toThrow(message)
			expect(() => scratch.remove('file.txt')).toThrow(message)

			expect(readFileSync(scratch.path, 'utf8')).toBe('file')
		} finally {
			rmSync(scratch.path, { force: true })
		}
	})

	it('resolves an empty target to the allocation root', () => {
		const scratch = createScratch()
		try {
			scratch.write('file.txt', 'file')

			expect(scratch.ensure('')).toBe(scratch.path)
			expect(scratch.has('')).toBe(true)
			expect(scratch.names('')).toStrictEqual(['file.txt'])
			expect(() => scratch.read('')).toThrow('Scratch path is a directory: ')

			// An empty target names a directory that already exists, so both writing members surface
			// the host's own refusal rather than a message from this package. The two codes are POSIX,
			// which is the host this suite runs on.
			expect(() => scratch.write('', 'root')).toThrow('EISDIR')
			expect(() => scratch.link('', 'source')).toThrow('EEXIST')
			expect(scratch.names()).toStrictEqual(['file.txt'])
		} finally {
			scratch.destroy()
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

	describe('destruction', () => {
		it('refuses writes after destruction', () => {
			const scratch = createScratch()
			scratch.destroy()

			expect(() => scratch.write('file.txt', 'file')).toThrow('Scratch directory does not exist')
			expect(existsSync(scratch.path)).toBe(false)
		})

		it('returns undefined from a read after destruction', () => {
			const scratch = createScratch({ files: { 'file.txt': 'file' } })
			scratch.destroy()

			expect(scratch.read('file.txt')).toBeUndefined()
			expect(existsSync(scratch.path)).toBe(false)
		})

		it('reports has as false after destruction', () => {
			const scratch = createScratch({ files: { 'file.txt': 'file' } })
			scratch.destroy()

			expect(scratch.has('file.txt')).toBe(false)
			expect(scratch.has('.')).toBe(false)
		})

		it('refuses names after destruction', () => {
			const scratch = createScratch({ files: { 'file.txt': 'file' } })
			scratch.destroy()

			expect(() => scratch.names()).toThrow('Scratch directory does not exist')
			expect(() => scratch.names('.')).toThrow('Scratch directory does not exist')
		})

		it('refuses ensure after destruction and does not recreate the allocation', () => {
			const scratch = createScratch()
			scratch.destroy()

			expect(() => scratch.ensure('made')).toThrow('Scratch directory does not exist')
			expect(existsSync(scratch.path)).toBe(false)
			expect(existsSync(join(scratch.path, 'made'))).toBe(false)
		})

		it('refuses link after destruction and does not recreate the allocation', () => {
			const scratch = createScratch()
			scratch.destroy()

			expect(() => scratch.link('linked', 'source')).toThrow('Scratch directory does not exist')
			expect(existsSync(scratch.path)).toBe(false)
			expect(existsSync(join(scratch.path, 'linked'))).toBe(false)
		})

		it('refuses remove after destruction and does not recreate the allocation', () => {
			const scratch = createScratch()
			scratch.destroy()

			expect(() => scratch.remove('file.txt')).toThrow('Scratch directory does not exist')
			expect(existsSync(scratch.path)).toBe(false)
		})
	})

	describe('names', () => {
		it('lists one level of the scratch root in code-unit order', () => {
			const scratch = createScratch()
			try {
				// Entries are created in descending order, and the population mixes case with
				// digit-leading names so the expectation pins `.sort()`'s code-unit order rather
				// than a locale-aware or numeric order. The test below it is what discriminates a
				// dropped sort.
				scratch.write('zeta.txt', 'zeta')
				scratch.write('nested/deep.txt', 'deep')
				scratch.write('mid.txt', 'mid')
				scratch.write('alpha.txt', 'alpha')
				scratch.write('Zeta.txt', 'upper zeta')
				scratch.write('Alpha.txt', 'upper alpha')
				scratch.write('2.txt', 'two')
				scratch.write('10.txt', 'ten')

				expect(scratch.names()).toStrictEqual([
					'10.txt',
					'2.txt',
					'Alpha.txt',
					'Zeta.txt',
					'alpha.txt',
					'mid.txt',
					'nested',
					'zeta.txt',
				])
			} finally {
				scratch.destroy()
			}
		})

		it('sorts a population the host enumerates in the opposite order', () => {
			const scratch = createScratch()
			try {
				// The names are written from raw bytes because no JS string expresses a byte the
				// host refuses to decode. `0x80` is an invalid UTF-8 lead byte, so the name reaches
				// JS as U+FFFD, which sorts after `é` (U+00E9); on disk `0x80` sorts before `é`'s
				// leading `0xc3`, so the host enumerates the two in the reverse of sorted order.
				const base = Buffer.from(`${scratch.path}${sep}`)
				writeFileSync(Buffer.concat([base, Buffer.from([0x80, 0x61])]), 'invalid')
				writeFileSync(Buffer.concat([base, Buffer.from([0xc3, 0xa9])]), 'accented')

				// Escapes rather than the characters themselves: the exact code points are the
				// subject here, and rewriting the line must not fold one into a look-alike.
				const native = readdirSync(scratch.path)
				expect(native).toStrictEqual(['\uFFFDa', '\u00E9'])
				expect(scratch.names()).toStrictEqual(['\u00E9', '\uFFFDa'])

				// The control. The two assertions above pin a dropped `.sort()` only while this
				// population still discriminates, so this fails the moment it stops.
				expect(scratch.names()).not.toStrictEqual(native)
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

		it('surfaces the host EEXIST when something already occupies the target', () => {
			const scratch = createScratch()
			try {
				scratch.write('taken.txt', 'taken')
				scratch.ensure('taken')

				expect(() => scratch.link('taken.txt', 'source')).toThrow('EEXIST')
				expect(() => scratch.link('taken', 'source')).toThrow('EEXIST')

				expect(scratch.read('taken.txt')).toBe('taken')
				expect(lstatSync(join(scratch.path, 'taken')).isDirectory()).toBe(true)
			} finally {
				scratch.destroy()
			}
		})

		it('lets every member act at a planted link destination while refusing a lexical escape', () => {
			// The package's contract is lexical containment, not a sandbox: a link inside the
			// allocation is resolved through, so a member can act outside the allocation. That is
			// what `link` exists for, so this pins it rather than guarding against it.
			const destination = createScratch({ prefix: 'orkestrel-test-link-destination-' })
			const scratch = createScratch()
			try {
				destination.write('planted.txt', 'planted')
				scratch.link('gate', destination.path)

				expect(scratch.ensure('gate/made')).toBe(join(scratch.path, 'gate', 'made'))
				expect(destination.has('made')).toBe(true)
				expect(scratch.names('gate')).toStrictEqual(['made', 'planted.txt'])
				expect(scratch.has('gate/planted.txt')).toBe(true)
				expect(scratch.read('gate/planted.txt')).toBe('planted')

				scratch.write('gate/written.txt', 'written')
				expect(destination.read('written.txt')).toBe('written')

				// The other half of the contract: an escape spelled lexically is still refused.
				expect(() => scratch.ensure(`../${basename(destination.path)}`)).toThrow(
					`Path outside scratch directory: ../${basename(destination.path)}`,
				)
				expect(() => scratch.names('..')).toThrow('Path outside scratch directory: ..')
			} finally {
				scratch.destroy()
				destination.destroy()
			}
		})

		it('reports a final-segment link rather than its destination', () => {
			// The traversal test above drives `has` through an intermediate link. `has` uses
			// `lstatSync`, so a link as the final segment reports on the link itself, which is the
			// case that behaves differently.
			const destination = createScratch({ prefix: 'orkestrel-test-link-final-' })
			const scratch = createScratch()
			try {
				destination.write('planted.txt', 'planted')
				scratch.link('gate', destination.path)

				expect(scratch.has('gate')).toBe(true)
				expect(lstatSync(join(scratch.path, 'gate')).isSymbolicLink()).toBe(true)

				destination.destroy()

				// The destination is gone and the link is not, so `has` still reports it while a
				// read through it follows the link and finds nothing.
				expect(existsSync(destination.path)).toBe(false)
				expect(scratch.has('gate')).toBe(true)
				expect(scratch.read('gate')).toBeUndefined()
			} finally {
				scratch.destroy()
				destination.destroy()
			}
		})

		it('refuses a final segment already occupied by a link', () => {
			const destination = createScratch({ prefix: 'orkestrel-test-link-occupied-' })
			const scratch = createScratch()
			try {
				scratch.link('gate', destination.path)

				// `link` acts on the final segment, so an occupied one is the host's `EEXIST` rather
				// than a link created inside the destination.
				expect(() => scratch.link('gate', destination.path)).toThrow('EEXIST')
				expect(destination.names()).toStrictEqual([])
				expect(scratch.names('gate')).toStrictEqual([])

				// The contrast: the same link as an intermediate segment is traversed.
				scratch.link('gate/inner', destination.path)
				expect(destination.names()).toStrictEqual(['inner'])
			} finally {
				scratch.destroy()
				destination.destroy()
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

	describe('remove', () => {
		it('removes a file and leaves its siblings', () => {
			const scratch = createScratch({
				files: { 'kept.txt': 'kept', 'removed.txt': 'removed' },
			})
			try {
				scratch.remove('removed.txt')

				expect(scratch.has('removed.txt')).toBe(false)
				expect(scratch.names()).toStrictEqual(['kept.txt'])
			} finally {
				scratch.destroy()
			}
		})

		it('removes an empty directory', () => {
			const scratch = createScratch()
			try {
				scratch.ensure('empty')

				scratch.remove('empty')

				expect(scratch.has('empty')).toBe(false)
			} finally {
				scratch.destroy()
			}
		})

		it('removes a directory and all of its descendants', () => {
			const scratch = createScratch({
				files: { 'tree/branch/leaf.txt': 'leaf', 'tree/root.txt': 'root' },
			})
			try {
				scratch.remove('tree')

				expect(scratch.has('tree')).toBe(false)
				expect(scratch.has('tree/branch/leaf.txt')).toBe(false)
				expect(scratch.names()).toStrictEqual([])
			} finally {
				scratch.destroy()
			}
		})

		it('does nothing when the target does not exist', () => {
			const scratch = createScratch({ files: { 'kept.txt': 'kept' } })
			try {
				expect(() => scratch.remove('missing')).not.toThrow()
				expect(scratch.names()).toStrictEqual(['kept.txt'])
			} finally {
				scratch.destroy()
			}
		})

		it('removes a final symbolic link without removing its destination', () => {
			const destination = createScratch({
				files: { 'kept.txt': 'kept' },
				prefix: 'orkestrel-test-remove-destination-',
			})
			const scratch = createScratch()
			try {
				scratch.link('gate', destination.path)

				scratch.remove('gate')

				expect(scratch.has('gate')).toBe(false)
				expect(destination.read('kept.txt')).toBe('kept')
				expect(destination.names()).toStrictEqual(['kept.txt'])
			} finally {
				scratch.destroy()
				destination.destroy()
			}
		})

		it('refuses an escaping target', () => {
			const scratch = createScratch()
			const outside = join(dirname(scratch.path), `${basename(scratch.path)}-outside`)
			writeFileSync(outside, 'outside')
			try {
				expect(() => scratch.remove(`../${basename(outside)}`)).toThrow(
					`Path outside scratch directory: ../${basename(outside)}`,
				)
				expect(readFileSync(outside, 'utf8')).toBe('outside')
			} finally {
				scratch.destroy()
				rmSync(outside, { force: true })
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

		it('refuses a prefix containing either path separator', () => {
			const parent = createScratch({ prefix: 'orkestrel-test-prefix-separator-' })
			try {
				parent.ensure('nested')

				expect(() => createScratch({ parent: parent.path, prefix: 'nested/child-' })).toThrow(
					'Scratch prefix must be a name fragment',
				)
				expect(() => createScratch({ parent: parent.path, prefix: 'nested\\child-' })).toThrow(
					'Scratch prefix must be a name fragment',
				)
				// `\` is a name character on this host, so a dropped backslash branch allocates a
				// directory literally named `nested\child-…` directly beneath the parent.
				expect(parent.names()).toStrictEqual(['nested'])
				expect(parent.names('nested')).toStrictEqual([])
			} finally {
				parent.destroy()
			}
		})

		it('accepts a fragment carrying dots', () => {
			const parent = createScratch({ prefix: 'orkestrel-test-prefix-dotted-' })
			try {
				const scratch = createScratch({ parent: parent.path, prefix: 'release-0..2-' })

				expect(dirname(scratch.path)).toBe(resolve(parent.path))
				expect(basename(scratch.path).startsWith('release-0..2-')).toBe(true)
				expect(parent.names()).toStrictEqual([basename(scratch.path)])

				scratch.destroy()
				expect(parent.names()).toStrictEqual([])
			} finally {
				parent.destroy()
			}
		})

		// A dotted fragment allocates; what is refused here is the separator that would let the
		// fragment walk out of its parent, which is why the sibling control counts entries there.
		it('refuses a prefix that walks out of its parent', () => {
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
