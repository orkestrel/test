import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import {
	createAsyncSource,
	createStreamSource,
	isSerializableRecord,
	normalizePath,
	ROUTED_FENCES,
} from './setup.js'

describe('createAsyncSource', () => {
	it('yields each given value in order, then completes', async () => {
		const collected: number[] = []
		for await (const value of createAsyncSource([1, 2, 3])) collected.push(value)
		expect(collected).toStrictEqual([1, 2, 3])
	})

	it('yields nothing for an empty source', async () => {
		const collected: number[] = []
		for await (const value of createAsyncSource([])) collected.push(value)
		expect(collected).toStrictEqual([])
	})
})

describe('createStreamSource', () => {
	it('enqueues each given value in order, then closes', async () => {
		const reader = createStreamSource(['a', 'b', 'c']).getReader()
		const collected: string[] = []
		for (;;) {
			const { done, value } = await reader.read()
			if (done) break
			collected.push(value)
		}
		expect(collected).toStrictEqual(['a', 'b', 'c'])

		// The control: a stream that never closes never reports `done`, so the loop above would
		// hang rather than pass silently. Read once more to confirm the close persists.
		const settled = await reader.read()
		expect(settled.done).toBe(true)
	})
})

describe('normalizePath', () => {
	it('rewrites a drive-letter path to forward slashes', () => {
		expect(normalizePath('C:\\Users\\dev\\project')).toBe('C:/Users/dev/project')
	})

	it('rewrites a UNC path to forward slashes', () => {
		expect(normalizePath('\\\\server\\share\\file.txt')).toBe('//server/share/file.txt')
	})

	it('leaves a POSIX path carrying a literal backslash unchanged', () => {
		// A backslash is a legal character in a POSIX filename, so a path that merely contains
		// one — and carries neither a drive-letter nor a UNC head — must not be rewritten.
		expect(normalizePath('/home/dev/weird\\name')).toBe('/home/dev/weird\\name')
	})

	it('leaves an already-forward-slashed path unchanged', () => {
		expect(normalizePath('/home/dev/project')).toBe('/home/dev/project')
	})
})

describe('isSerializableRecord', () => {
	it('accepts a plain object JSON can serialize', () => {
		expect(isSerializableRecord({ a: 1, b: 'two' })).toBe(true)
	})

	it('refuses an array', () => {
		expect(isSerializableRecord([1, 2, 3])).toBe(false)
	})

	it('refuses null', () => {
		expect(isSerializableRecord(null)).toBe(false)
	})

	it('refuses a primitive', () => {
		expect(isSerializableRecord('text')).toBe(false)
	})

	it('refuses an instance carrying a non-default prototype', () => {
		expect(isSerializableRecord(new Date())).toBe(false)
	})

	it('refuses a record JSON.stringify cannot serialize', () => {
		const cyclic: Record<string, unknown> = {}
		cyclic.self = cyclic
		expect(isSerializableRecord(cyclic)).toBe(false)
	})
})

describe('ROUTED_FENCES', () => {
	it('is frozen and non-empty', () => {
		expect(Object.isFrozen(ROUTED_FENCES)).toBe(true)
		expect(Object.keys(ROUTED_FENCES).length).toBeGreaterThan(0)
	})

	it('keys every heading with a non-empty string and no duplicate value key', () => {
		for (const heading of Object.keys(ROUTED_FENCES)) {
			expect(heading.length).toBeGreaterThan(0)
		}
		// Object keys are unique by construction; the check that matters is that no heading
		// resolves to an empty or whitespace-only carrier path.
		for (const path of Object.values(ROUTED_FENCES)) {
			expect(path.trim().length).toBeGreaterThan(0)
		}
	})

	it('routes every heading to a test file the totality guard in tests/guides.test.ts can load', () => {
		// The guard reads each routed value as a key into its own collected-files map and fails
		// loudly when that key is missing, so membership here is real filesystem existence rather
		// than a shape the guard never checks. This proof stops short of the guard's own
		// guide-consistency assertions — that every routed heading actually carries the marker
		// line, and that discovered headings equal transcribed-plus-routed — which
		// tests/guides.test.ts already proves.
		for (const path of Object.values(ROUTED_FENCES)) {
			expect(path.startsWith('tests/')).toBe(true)
			expect(path.endsWith('.test.ts')).toBe(true)
			expect(existsSync(join(process.cwd(), path))).toBe(true)
		}
	})
})
