import type { JSONSafe } from '@src/core'
import {
	captureError,
	collect,
	collectStream,
	createHostileValues,
	decodeJSONLines,
	flattenHeaders,
	invokeUnchecked,
	readProperty,
	requireValue,
	resolveRoot,
	retryUntil,
	roundTripJSON,
	waitForAbort,
	waitForCondition,
	waitForDelay,
	waitForEvent,
} from '@src/core'
import { describe, expect, expectTypeOf, it } from 'vitest'
import { createAsyncSource, createStreamSource } from '../../setup.js'

// Interfaces rather than type aliases: TypeScript grants an implicit index signature to an alias
// and never to an interface, so only an interface exercises what the `JSONValue` bound rejected.
interface Snapshot {
	readonly id: string
	readonly turns: number
}

interface Session {
	readonly snapshot: Snapshot
	readonly tags: readonly string[]
}

interface Envelope {
	readonly value: object
}

declare const tag: unique symbol

interface Tagged {
	readonly [tag]: string
	readonly id: string
}

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

describe('waitForAbort', () => {
	it('resolves immediately for an already-aborted signal', async () => {
		const controller = new AbortController()
		controller.abort()

		await expect(waitForAbort(controller.signal)).resolves.toBeUndefined()
	})

	it('parks until the signal aborts', async () => {
		const controller = new AbortController()
		let resolved = false
		const pending = waitForAbort(controller.signal).then(() => {
			resolved = true
		})
		await Promise.resolve()
		expect(resolved).toBe(false)

		controller.abort()

		await expect(pending).resolves.toBeUndefined()
		expect(resolved).toBe(true)
	})
})

describe('waitForCondition', () => {
	it('returns after one immediate read with a zero budget', async () => {
		let reads = 0

		await waitForCondition(
			'ready immediately',
			() => {
				reads += 1
				return true
			},
			{ budget: 0, interval: 50 },
		)

		expect(reads).toBe(1)
	})

	it('returns when a later read holds', async () => {
		let reads = 0

		await waitForCondition(
			'ready later',
			() => {
				reads += 1
				return reads === 3
			},
			{ interval: 0 },
		)

		expect(reads).toBe(3)
	})

	it('awaits an asynchronous condition', async () => {
		await expect(
			waitForCondition('async ready', async () => {
				await Promise.resolve()
				return true
			}),
		).resolves.toBeUndefined()
	})

	it('names the condition and budget when it never holds', async () => {
		await expect(
			waitForCondition('database visible', () => false, { budget: 5, interval: 10 }),
		).rejects.toThrow('Condition "database visible" did not hold within 5ms')
	})

	it('propagates a condition throw unchanged', async () => {
		const thrown = new Error('condition failed')
		let caught: unknown
		try {
			await waitForCondition('throwing condition', () => {
				throw thrown
			})
		} catch (error) {
			caught = error
		}

		expect(caught).toBe(thrown)
	})

	it('rejects an aborted wait with the signal reason and stops reading', async () => {
		const controller = new AbortController()
		const reason = new Error('wait aborted')
		let reads = 0
		setTimeout(() => controller.abort(reason), 0)

		let caught: unknown
		try {
			await waitForCondition(
				'aborted condition',
				() => {
					reads += 1
					return false
				},
				{ budget: 100, interval: 20, signal: controller.signal },
			)
		} catch (error) {
			caught = error
		}

		expect(caught).toBe(reason)
		expect(reads).toBe(1)
	})

	it('accepts a true reading taken after the final interval', async () => {
		let reads = 0

		await waitForCondition(
			'final reading',
			() => {
				reads += 1
				return reads === 2
			},
			{ budget: 10, interval: 20 },
		)

		expect(reads).toBe(2)
	})

	it('refuses invalid budgets and intervals', async () => {
		await expect(
			waitForCondition('invalid budget', () => true, { budget: Number.NaN }),
		).rejects.toThrow('Wait budget')
		await expect(
			waitForCondition('invalid interval', () => true, { interval: -1 }),
		).rejects.toThrow('Wait interval')
	})
})

describe('retryUntil', () => {
	it('returns after the first satisfying attempt', async () => {
		let calls = 0

		const value = await retryUntil(
			'first value',
			() => {
				calls += 1
				return 'ready'
			},
			(candidate) => candidate === 'ready',
		)

		expect(value).toBe('ready')
		expect(calls).toBe(1)
	})

	it('returns a value from a later attempt', async () => {
		let calls = 0

		const value = await retryUntil(
			'later value',
			() => {
				calls += 1
				return calls
			},
			(candidate) => candidate === 3,
			{ interval: 0 },
		)

		expect(value).toBe(3)
		expect(calls).toBe(3)
	})

	it('rejects when the attempt bound is exhausted', async () => {
		await expect(
			retryUntil('attempt limit', () => false, Boolean, {
				attempts: 2,
				budget: 100,
				interval: 0,
			}),
		).rejects.toThrow('Retry "attempt limit" did not succeed within 2 attempts')
	})

	it('rejects when the time budget is exhausted', async () => {
		let calls = 0
		await expect(
			retryUntil(
				'time limit',
				() => {
					calls += 1
					return false
				},
				Boolean,
				{ attempts: 1, budget: 0, interval: 10 },
			),
		).rejects.toThrow('Retry "time limit" did not succeed within 0ms')
		expect(calls).toBe(1)
	})

	it('names the last produced value when exhausted', async () => {
		let value = 'earlier'
		await expect(
			retryUntil(
				'last value',
				() => {
					const current = value
					value = 'latest'
					return current
				},
				() => false,
				{ attempts: 2, budget: 100, interval: 0 },
			),
		).rejects.toThrow('last value: "latest"')
	})

	it('bounds the rendered last value in the exhaustion message', async () => {
		let caught: unknown
		try {
			await retryUntil(
				'bounded value',
				() => 'x'.repeat(400),
				() => false,
				{
					attempts: 1,
					budget: 100,
				},
			)
		} catch (error) {
			caught = error
		}

		expect(caught).toBeInstanceOf(Error)
		if (!(caught instanceof Error)) throw new Error('Expected a retry error')
		expect(caught.message).toContain('...')
		expect(caught.message.length).toBeLessThan(300)
	})

	it('returns the exact satisfying value', async () => {
		const expected = { status: 'ready' }
		const value = await retryUntil(
			'object value',
			() => expected,
			() => true,
		)

		expect(value).toBe(expected)
	})

	it('counts producer throws and uses the last error as the exhaustion cause', async () => {
		const first = new Error('first failure')
		const last = new Error('last failure')
		let calls = 0
		let caught: unknown
		try {
			await retryUntil(
				'throwing producer',
				() => {
					calls += 1
					throw calls === 1 ? first : last
				},
				() => true,
				{ attempts: 2, budget: 100, interval: 0 },
			)
		} catch (error) {
			caught = error
		}

		expect(calls).toBe(2)
		expect(caught).toBeInstanceOf(Error)
		if (!(caught instanceof Error)) throw new Error('Expected a retry error')
		expect(caught.cause).toBe(last)
	})

	it('propagates a predicate throw unchanged', async () => {
		const thrown = new Error('predicate failed')
		let caught: unknown
		try {
			await retryUntil(
				'throwing predicate',
				() => 'value',
				() => {
					throw thrown
				},
			)
		} catch (error) {
			caught = error
		}

		expect(caught).toBe(thrown)
	})

	it('rejects an aborted retry with the signal reason', async () => {
		const controller = new AbortController()
		const reason = new Error('retry aborted')
		let calls = 0
		setTimeout(() => controller.abort(reason), 0)

		let caught: unknown
		try {
			await retryUntil(
				'aborted retry',
				() => {
					calls += 1
					return false
				},
				Boolean,
				{ budget: 100, interval: 20, signal: controller.signal },
			)
		} catch (error) {
			caught = error
		}

		expect(caught).toBe(reason)
		expect(calls).toBe(1)
	})
})

describe('waitForEvent', () => {
	it('resolves with the exact delivered tuple', async () => {
		let deliver: ((name: string, count: number) => void) | undefined
		const pending = waitForEvent<[name: string, count: number]>((listener) => {
			deliver = listener
		}, 'job completed')
		if (deliver === undefined) throw new Error('Expected an event listener')

		deliver('ready', 2)

		await expect(pending).resolves.toStrictEqual(['ready', 2])
	})

	it('names the event and budget on timeout and invokes cleanup', async () => {
		let cleanups = 0
		const pending = waitForEvent(
			() => () => {
				cleanups += 1
			},
			'worker exit',
			{ budget: 5 },
		)

		await expect(pending).rejects.toThrow('Event "worker exit" was not delivered within 5ms')
		expect(cleanups).toBe(1)
	})

	it('rejects with the abort reason and invokes cleanup', async () => {
		const controller = new AbortController()
		const reason = new Error('event aborted')
		let cleanups = 0
		const pending = waitForEvent(
			() => () => {
				cleanups += 1
			},
			'aborted event',
			{ budget: 100, signal: controller.signal },
		)

		controller.abort(reason)

		let caught: unknown
		try {
			await pending
		} catch (error) {
			caught = error
		}
		expect(caught).toBe(reason)
		expect(cleanups).toBe(1)
	})

	it('ignores a second delivery after settlement', async () => {
		const pending = waitForEvent<[value: string]>((listener) => {
			listener('first')
			listener('second')
		}, 'first delivery')

		await expect(pending).resolves.toStrictEqual(['first'])
	})
})

describe('decodeJSONLines', () => {
	it('returns an empty array for empty input', () => {
		expect(decodeJSONLines('')).toStrictEqual([])
	})

	it('ignores a trailing newline', () => {
		expect(decodeJSONLines('{"ready":true}\n')).toStrictEqual([{ ready: true }])
	})

	it('accepts CRLF input', () => {
		expect(decodeJSONLines('1\r\n2\r\n')).toStrictEqual([1, 2])
	})

	it('preserves line order', () => {
		expect(decodeJSONLines('{"position":3}\n{"position":1}\n{"position":2}')).toStrictEqual([
			{ position: 3 },
			{ position: 1 },
			{ position: 2 },
		])
	})

	it('decodes primitive lines', () => {
		expect(decodeJSONLines('"entry"\n7\ntrue\nnull')).toStrictEqual(['entry', 7, true, null])
	})

	it('names a malformed physical line and keeps the native syntax error as cause', () => {
		let caught: unknown
		try {
			decodeJSONLines('{}\n\n{')
		} catch (error) {
			caught = error
		}

		expect(caught).toBeInstanceOf(Error)
		if (!(caught instanceof Error)) throw new Error('Expected a JSON Lines error')
		expect(caught.message).toBe('Invalid JSON on line 3')
		expect(caught.cause).toBeInstanceOf(SyntaxError)
	})
})

describe('captureError', () => {
	it('invokes a completing thunk exactly once', () => {
		let count = 0
		captureError(() => {
			count += 1
		})

		expect(count).toBe(1)
	})

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

describe('invokeUnchecked', () => {
	it('invokes a callable and returns its result', () => {
		const result = invokeUnchecked<number>(undefined, Math.max, [3, 7, 2])

		expect(result).toBe(7)
	})

	it('throws TypeError for every hostile non-callable', () => {
		for (const [index, value] of createHostileValues().entries()) {
			expect(
				() => invokeUnchecked<unknown>(undefined, value, []),
				`hostile value ${index}`,
			).toThrow(TypeError)
		}
	})
})

describe('readProperty', () => {
	it('reads an object property under the caller-owned type', () => {
		const value = readProperty<string>({ name: 'fixture' }, 'name')

		expect(value).toBe('fixture')
	})

	it('throws TypeError for primitive targets', () => {
		for (const value of [undefined, null, true, 1, 'text', 1n, Symbol('value')]) {
			expect(() => readProperty<unknown>(value, 'name')).toThrow(TypeError)
		}
	})
})

describe('flattenHeaders', () => {
	it('normalizes every HeadersInit form to equal frozen records', () => {
		const record = flattenHeaders({ 'X-Test': 'value', Accept: 'text/plain' })
		const entries = flattenHeaders([
			['X-Test', 'value'],
			['Accept', 'text/plain'],
		])
		const headers = flattenHeaders(new Headers({ 'X-Test': 'value', Accept: 'text/plain' }))

		expect(record).toStrictEqual({ accept: 'text/plain', 'x-test': 'value' })
		expect(entries).toStrictEqual(record)
		expect(headers).toStrictEqual(record)
		expect(Object.isFrozen(record)).toBe(true)
		expect(Object.getPrototypeOf(record)).toBe(Object.prototype)
	})

	it('throws for an invalid header name', () => {
		expect(() => flattenHeaders({ 'bad header': 'value' })).toThrow(TypeError)
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
	it('refuses opaque object and symbol-keyed members in its type projection', () => {
		expectTypeOf<JSONSafe<Envelope>['value']>().toEqualTypeOf<never>()
		expectTypeOf<JSONSafe<Tagged>[typeof tag]>().toEqualTypeOf<never>()
	})

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

	it('copies an interface-typed value', () => {
		const snapshot: Snapshot = { id: 'a', turns: 2 }
		const copy: Snapshot = roundTripJSON(snapshot)

		expect(copy).toStrictEqual({ id: 'a', turns: 2 })
		expect(copy).not.toBe(snapshot)
	})

	it('copies a nested interface-typed value with fresh references', () => {
		const session: Session = { snapshot: { id: 'a', turns: 2 }, tags: ['x', 'y'] }
		const copy: Session = roundTripJSON(session)

		expect(copy).toStrictEqual({ snapshot: { id: 'a', turns: 2 }, tags: ['x', 'y'] })
		expect(copy.snapshot).not.toBe(session.snapshot)
		expect(copy.tags).not.toBe(session.tags)
	})

	it('rejects a non-finite number inside an interface-typed value', () => {
		const session: Session = { snapshot: { id: 'a', turns: Number.NaN }, tags: [] }

		expect(() => roundTripJSON(session)).toThrow('JSON values must contain finite numbers')
	})

	it('copies a record of unknown values and refuses a non-finite number inside one', () => {
		// `JSONSafe` passes `unknown` through, so `Record<string, unknown>` satisfies the bound and
		// its values are the runtime check's job. The compile-time half of that claim is not
		// assertable here: this suite has no type-level project.
		const record: Record<string, unknown> = { flag: true, nested: { count: 2 }, tags: ['x'] }
		const copy: Record<string, unknown> = roundTripJSON(record)

		expect(copy).toStrictEqual({ flag: true, nested: { count: 2 }, tags: ['x'] })
		expect(copy).not.toBe(record)
		expect(copy['nested']).not.toBe(record['nested'])

		const invalid: Record<string, unknown> = { nested: { deep: [Number.NaN] } }
		expect(() => roundTripJSON(invalid)).toThrow('JSON values must contain finite numbers')
	})

	it('refuses undefined, a function, and a symbol at depth under an unknown member', () => {
		const message = 'JSON values must not contain undefined, functions, or symbols'
		const absent: Record<string, unknown> = { nested: { deep: [undefined] } }
		const called: Record<string, unknown> = { nested: { deep: [() => 'value'] } }
		const keyed: Record<string, unknown> = { nested: { deep: [Symbol('control')] } }
		const omitted: Record<string, unknown> = { nested: { deep: undefined } }

		expect(() => roundTripJSON(absent)).toThrow(message)
		expect(() => roundTripJSON(called)).toThrow(message)
		expect(() => roundTripJSON(keyed)).toThrow(message)
		// An object member holding `undefined` is the case plain `JSON.stringify` drops silently.
		expect(() => roundTripJSON(omitted)).toThrow(message)

		// The control: the same shape carrying JSON values round-trips.
		expect(roundTripJSON({ nested: { deep: ['value'] } })).toStrictEqual({
			nested: { deep: ['value'] },
		})
	})

	it('copies a Date under an unknown member as its serialized string', () => {
		// `toJSON` runs before the replacer sees the value, so a Date arrives as a string and is
		// copied rather than refused. That is the ruling, not an oversight.
		const value: Record<string, unknown> = { at: new Date(0), nested: { at: new Date(86_400_000) } }
		const copy: Record<string, unknown> = roundTripJSON(value)

		expect(copy).toStrictEqual({
			at: '1970-01-01T00:00:00.000Z',
			nested: { at: '1970-01-02T00:00:00.000Z' },
		})
		expect(copy['at']).not.toBeInstanceOf(Date)
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
