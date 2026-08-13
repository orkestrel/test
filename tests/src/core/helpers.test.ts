import {
	captureError,
	collect,
	collectStream,
	requireValue,
	resolveRoot,
	roundTripJSON,
	waitForDelay,
} from '@src/core'
import { describe, expect, it } from 'vitest'
import { createAsyncSource, createStreamSource } from '../../setup.js'

describe('waitForDelay', () => {
	it('uses a real timer for the default delay', async () => {
		let resolved = false
		const pending = waitForDelay().then(() => {
			resolved = true
		})
		await Promise.resolve()
		expect(resolved).toBe(false)
		await expect(pending).resolves.toBeUndefined()
		expect(resolved).toBe(true)
	})

	it('waits for the requested delay', async () => {
		const delay = 20
		const clockSlop = 2
		const floor = delay - clockSlop
		const start = performance.now()
		await waitForDelay(delay)
		const elapsed = performance.now() - start
		expect(elapsed).toBeGreaterThanOrEqual(floor)
	})
})

describe('captureError', () => {
	it('returns undefined when the thunk does not throw', () => {
		expect(captureError(() => 'completed')).toBeUndefined()
	})

	it('returns the exact thrown value', () => {
		const thrown = { code: 'control' }
		expect(
			captureError(() => {
				throw thrown
			}),
		).toBe(thrown)
	})
})

describe('requireValue', () => {
	it('returns zero when it is present', () => {
		expect(requireValue(0)).toBe(0)
	})

	it('returns an empty string when it is present', () => {
		expect(requireValue('')).toBe('')
	})

	it('returns false when it is present', () => {
		expect(requireValue(false)).toBe(false)
	})

	it('throws for null with the requested message', () => {
		expect(() => requireValue(null, 'null control')).toThrow('null control')
	})

	it('throws for undefined with the requested message', () => {
		expect(() => requireValue(undefined, 'undefined control')).toThrow('undefined control')
	})

	it('uses the default message when none is requested', () => {
		expect(() => requireValue(undefined)).toThrow('Value is required')
	})
})

describe('collect', () => {
	it('returns an empty array for an empty async iterable', async () => {
		await expect(collect(createAsyncSource([]))).resolves.toStrictEqual([])
	})

	it('preserves iteration order', async () => {
		await expect(collect(createAsyncSource([3, 1, 2]))).resolves.toStrictEqual([3, 1, 2])
	})
})

describe('collectStream', () => {
	it('returns an empty array for an empty stream', async () => {
		await expect(collectStream(createStreamSource([]))).resolves.toStrictEqual([])
	})

	it('preserves stream order', async () => {
		await expect(
			collectStream(createStreamSource(['third', 'first', 'second'])),
		).resolves.toStrictEqual(['third', 'first', 'second'])
	})

	it('releases the reader lock after collection', async () => {
		const stream = createStreamSource(['value'])
		await collectStream(stream)

		expect(stream.locked).toBe(false)
	})
})

describe('roundTripJSON', () => {
	it('rejects a raw JSON non-finite number and an ordinary nested non-finite number', () => {
		const rawJSON: unknown = Reflect.get(JSON, 'rawJSON')
		if (typeof rawJSON !== 'function') throw new Error('JSON.rawJSON is required')
		const raw: unknown = rawJSON('1e400')

		expect(() => Reflect.apply(roundTripJSON, undefined, [raw])).toThrow(
			'JSON values must contain finite numbers',
		)
		expect(() => roundTripJSON({ nested: Number.POSITIVE_INFINITY })).toThrow(
			'JSON values must contain finite numbers',
		)
	})

	it('returns an equal value with fresh object and array references', () => {
		const value = { enabled: false, nested: ['value', 0, null] }
		const copy = roundTripJSON(value)

		expect(copy).toStrictEqual({ enabled: false, nested: ['value', 0, null] })
		expect(copy).not.toBe(value)
		expect(copy.nested).not.toBe(value.nested)
	})

	it('normalizes negative zero to zero', () => {
		const copy = roundTripJSON(-0)

		expect(copy).toBe(0)
		expect(Object.is(copy, -0)).toBe(false)
	})

	it('copies large arrays and objects without exceeding the argument limit', () => {
		const values = Array.from({ length: 300_000 }, () => 0)
		const object = Object.fromEntries(values.map((_value, index) => [String(index), 0]))

		expect(roundTripJSON(values)).toHaveLength(values.length)
		expect(Object.keys(roundTripJSON(object))).toHaveLength(values.length)
	})

	it('rejects non-finite numbers at every depth', () => {
		expect(() => roundTripJSON(Number.NaN)).toThrow('JSON values must contain finite numbers')
		expect(() => roundTripJSON(Number.POSITIVE_INFINITY)).toThrow(
			'JSON values must contain finite numbers',
		)
		expect(() => roundTripJSON(Number.NEGATIVE_INFINITY)).toThrow(
			'JSON values must contain finite numbers',
		)
		expect(() => roundTripJSON([0, Number.NaN])).toThrow('JSON values must contain finite numbers')
		expect(() => roundTripJSON({ nested: Number.POSITIVE_INFINITY })).toThrow(
			'JSON values must contain finite numbers',
		)
		expect(roundTripJSON({ nested: [0, 1.5, -2] })).toStrictEqual({ nested: [0, 1.5, -2] })
	})
})

describe('resolveRoot', () => {
	it('returns a URL one directory above the calling file', () => {
		const root = resolveRoot(import.meta)

		expect(root).toBeInstanceOf(URL)
		expect(root.pathname.endsWith('/tests/src/')).toBe(true)
		expect(root.pathname.includes('/tests/src/core/')).toBe(false)
	})
})
