import {
	lstatSync,
	mkdirSync,
	mkdtempSync,
	readFileSync,
	rmSync,
	statSync,
	symlinkSync,
	writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { join, sep } from 'node:path'
import { describe, expect, it } from 'vitest'
import {
	CASE_SENSITIVE_FS,
	DIRECTORY_LINKS,
	FILE_LINKS,
	POSIX_MODE,
	RAW_BYTE_NAMES,
} from './setupServer.js'

// Each constant here is computed once, at import time, by calling the matching `supports*` probe
// from `@src/server` — proved against real fixtures in tests/src/server/helpers.test.ts. This
// proof does not call those probes again: it derives the same host capability through its own
// raw `node:fs` attempt on a scratch directory this file owns, so a constant that drifted from the
// probe it wraps fails here even though both sides would agree if the drift were in the probe
// itself.

describe('FILE_LINKS', () => {
	it('matches whether this host reads a file through a symbolic link', () => {
		const directory = mkdtempSync(join(tmpdir(), 'orkestrel-test-setup-file-links-'))
		try {
			const source = join(directory, 'source.txt')
			const link = join(directory, 'link.txt')
			writeFileSync(source, 'linked')
			let readable = false
			try {
				symlinkSync(source, link, 'file')
				readable = readFileSync(link, 'utf8') === 'linked'
			} catch {
				readable = false
			}
			expect(FILE_LINKS).toBe(readable)
		} finally {
			rmSync(directory, { force: true, recursive: true })
		}
	})
})

describe('DIRECTORY_LINKS', () => {
	it('matches whether this host reads a directory through a symbolic link', () => {
		const directory = mkdtempSync(join(tmpdir(), 'orkestrel-test-setup-directory-links-'))
		try {
			const source = join(directory, 'source')
			const link = join(directory, 'link')
			let readable = false
			try {
				mkdirSync(source)
				writeFileSync(join(source, 'marker.txt'), 'marked')
				symlinkSync(source, link, 'junction')
				readable =
					lstatSync(link).isSymbolicLink() &&
					statSync(link).isDirectory() &&
					readFileSync(join(link, 'marker.txt'), 'utf8') === 'marked'
			} catch {
				readable = false
			}
			expect(DIRECTORY_LINKS).toBe(readable)
		} finally {
			rmSync(directory, { force: true, recursive: true })
		}
	})
})

describe('POSIX_MODE', () => {
	it('matches whether this host round-trips a permission bit through chmod and stat', () => {
		const directory = mkdtempSync(join(tmpdir(), 'orkestrel-test-setup-mode-'))
		try {
			const path = join(directory, 'moded')
			mkdirSync(path, { mode: 0o700 })
			const stored = (statSync(path).mode & 0o777) === 0o700
			expect(POSIX_MODE).toBe(stored)
		} finally {
			rmSync(directory, { force: true, recursive: true })
		}
	})
})

describe('CASE_SENSITIVE_FS', () => {
	it('matches whether this host treats two names differing only by case as distinct', () => {
		const directory = mkdtempSync(join(tmpdir(), 'orkestrel-test-setup-case-'))
		try {
			const upper = join(directory, 'A')
			const lower = join(directory, 'a')
			writeFileSync(upper, 'upper')
			writeFileSync(lower, 'lower')
			const distinct =
				readFileSync(upper, 'utf8') === 'upper' && readFileSync(lower, 'utf8') === 'lower'
			expect(CASE_SENSITIVE_FS).toBe(distinct)
		} finally {
			rmSync(directory, { force: true, recursive: true })
		}
	})
})

describe('RAW_BYTE_NAMES', () => {
	it('matches whether this host accepts a filename carrying an undecodable byte', () => {
		const directory = mkdtempSync(join(tmpdir(), 'orkestrel-test-setup-bytes-'))
		try {
			const name = Buffer.concat([Buffer.from(`${directory}${sep}`), Buffer.from([0x80])])
			let accepted = false
			try {
				writeFileSync(name, 'raw')
				accepted = readFileSync(name, 'utf8') === 'raw'
			} catch {
				accepted = false
			}
			expect(RAW_BYTE_NAMES).toBe(accepted)
		} finally {
			rmSync(directory, { force: true, recursive: true })
		}
	})
})
