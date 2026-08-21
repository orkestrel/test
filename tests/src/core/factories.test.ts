import type { EventSourceInterface } from '@src/core'
import {
	createHostileValues,
	createRecorder,
	createRecorders,
	createResourceFactory,
	createSignal,
	createTeardown,
	invokeUnchecked,
	requireValue,
} from '@src/core'
import { describe, expect, it } from 'vitest'
import { isSerializableRecord } from '../../setup.js'

type ScriptedEventMap = {
	readonly progress: readonly [step: number]
	readonly ready: readonly [name: string, step: number]
}

class ScriptedEventSource implements EventSourceInterface<ScriptedEventMap> {
	readonly #subscriptions =
		createRecorder<readonly [event: keyof ScriptedEventMap, handler: unknown]>()

	get count(): number {
		return this.#subscriptions.count
	}

	on<K extends keyof ScriptedEventMap>(
		event: K,
		handler: (...args: ScriptedEventMap[K]) => void,
	): void {
		this.#subscriptions.handler(event, handler)
	}

	emit(event: keyof ScriptedEventMap, args: readonly unknown[]): void {
		for (const [name, handler] of this.#subscriptions.calls) {
			if (name === event) invokeUnchecked<void>(this, handler, args)
		}
	}
}

describe('createHostileValues', () => {
	it('provides a negative control for every hostile member', () => {
		const values = createHostileValues()

		expect(() => JSON.stringify(values[0])).toThrow(/circular|cyclic/i)
		expect(() => Reflect.ownKeys(Object(values[1]))).toThrow(/revoked/i)
		expect(() => Reflect.get(Object(values[2]), 'value')).toThrow('Hostile property read')
		expect(() => Reflect.ownKeys(Object(values[3]))).toThrow('Hostile key enumeration')
		expect(() => Object.getPrototypeOf(values[4])).toThrow('Hostile prototype read')
		expect(() => Object(values[5]).hasOwnProperty('value')).toThrow(/hasOwnProperty/)
		expect(Array.isArray(values[6])).toBe(true)
		expect(() => Reflect.get(Object(values[6]), 0)).toThrow('Hostile array index read')
		expect(() => JSON.stringify(values[7])).toThrow(/circular|cyclic/i)
		expect(Object.keys(Object(values[8])).length).toBeLessThan(
			Reflect.get(Object(values[8]), 'length'),
		)
		expect(Object.keys(Object(values[9])).length).toBeLessThan(
			Reflect.ownKeys(Object(values[9])).length,
		)
		expect(() => Reflect.get(Object(values[10]), 'danger')).toThrow('Hostile named getter read')
	})

	it('returns a frozen array of fresh values', () => {
		const first = createHostileValues()
		const second = createHostileValues()

		expect(Object.isFrozen(first)).toBe(true)
		expect(Object.isFrozen(second)).toBe(true)
		for (const value of first) {
			expect(second.some((candidate) => Object.is(candidate, value))).toBe(false)
		}
	})

	it('supports a totality loop with index attribution', () => {
		expect(isSerializableRecord({ a: 1 })).toBe(true)

		for (const [index, value] of createHostileValues().entries()) {
			let accepted: boolean | undefined
			expect(() => {
				accepted = isSerializableRecord(value)
			}, `hostile value ${index}`).not.toThrow()
			expect(accepted, `hostile value ${index}`).toBe(false)
		}
	})
})

describe('createRecorder', () => {
	it('defaults to unknown argument tuples', () => {
		const recorder = createRecorder()
		recorder.handler('value', 1)

		expect(recorder.calls).toStrictEqual([['value', 1]])
	})

	it('records typed argument tuples in call order', () => {
		const recorder = createRecorder<readonly [string, number]>()
		expect(recorder.calls).toStrictEqual([])
		expect(recorder.count).toBe(0)

		recorder.handler('first', 1)
		recorder.handler('second', 2)

		expect(recorder.calls).toStrictEqual([
			['first', 1],
			['second', 2],
		])
		expect(recorder.count).toBe(2)
	})

	it('truncates the captured calls array and remains usable', () => {
		const recorder = createRecorder<readonly [string]>()
		const calls = recorder.calls
		recorder.handler('before')

		recorder.clear()

		expect(calls).toStrictEqual([])
		expect(recorder.calls).toBe(calls)
		expect(recorder.count).toBe(0)

		recorder.handler('after')
		expect(calls).toStrictEqual([['after']])
		expect(recorder.count).toBe(1)
	})
})

describe('createRecorders', () => {
	it('records each event argument tuple in delivery order', () => {
		const source = new ScriptedEventSource()
		const recorders = createRecorders<ScriptedEventMap, 'ready' | 'progress'>(source, [
			'ready',
			'progress',
		])

		source.emit('ready', ['alpha', 1])
		source.emit('progress', [2])
		source.emit('ready', ['omega', 3])

		expect(recorders.ready.calls).toStrictEqual([
			['alpha', 1],
			['omega', 3],
		])
		expect(recorders.progress.calls).toStrictEqual([[2]])
		const ready: readonly [name: string, step: number] = requireValue(recorders.ready.calls[0])
		const reversed: readonly [step: number, name: string] = [ready[1], ready[0]]
		// The exact binding proves the tuple type; the reversed value proves the assertion detects a swap.
		expect(ready).toStrictEqual(['alpha', 1])
		expect(ready).not.toStrictEqual(reversed)
	})

	it('installs duplicate event names and retains the last recorder', () => {
		const source = new ScriptedEventSource()
		const recorders = createRecorders<ScriptedEventMap, 'ready'>(source, ['ready', 'ready'])

		source.emit('ready', ['value', 1])

		expect(source.count).toBe(2)
		expect(recorders.ready.calls).toStrictEqual([['value', 1]])
	})

	it('infers exact tuples through an event-source interface', () => {
		const scripted = new ScriptedEventSource()
		const source: EventSourceInterface<ScriptedEventMap> = scripted
		const recorders = createRecorders(source, ['ready', 'progress'])

		scripted.emit('ready', ['value', 1])
		scripted.emit('progress', [2])

		const ready: readonly [name: string, step: number] = requireValue(recorders.ready.calls[0])
		const progress: readonly [step: number] = requireValue(recorders.progress.calls[0])
		expect(ready).toStrictEqual(['value', 1])
		expect(progress).toStrictEqual([2])
	})
})

describe('createSignal', () => {
	it('tracks listener addition and removal by original callback', () => {
		const fixture = createSignal()
		const recorder = createRecorder<readonly [event: Event]>()

		fixture.signal.addEventListener('abort', recorder.handler)
		expect(fixture.count).toBe(1)
		fixture.signal.removeEventListener('abort', recorder.handler)
		expect(fixture.count).toBe(0)

		fixture.controller.abort()
		expect(fixture.signal.aborted).toBe(true)
		expect(recorder.count).toBe(0)
	})

	it('removes a one-shot listener from the tally when it fires', () => {
		const fixture = createSignal()
		const recorder = createRecorder<readonly [event: Event]>()
		fixture.signal.addEventListener('abort', recorder.handler, {
			once: true,
		})

		fixture.controller.abort()

		expect(fixture.signal.aborted).toBe(true)
		expect(fixture.count).toBe(0)
		expect(recorder.count).toBe(1)
		fixture.signal.removeEventListener('abort', recorder.handler)
		expect(fixture.count).toBe(0)
	})

	it('removes a listener from the tally when its scoping signal aborts', () => {
		const instrument = createSignal()
		const lifetime = new AbortController()
		const recorder = createRecorder<readonly [event: Event]>()
		instrument.signal.addEventListener('abort', recorder.handler, {
			signal: lifetime.signal,
		})

		expect(instrument.count).toBe(1)
		lifetime.abort()
		expect(instrument.count).toBe(0)
		instrument.controller.abort()
		expect(recorder.count).toBe(0)
	})

	it('does not tally a listener whose scoping signal is already aborted', () => {
		const instrument = createSignal()
		const lifetime = new AbortController()
		const recorder = createRecorder<readonly [event: Event]>()
		lifetime.abort()

		instrument.signal.addEventListener('abort', recorder.handler, {
			signal: lifetime.signal,
		})
		instrument.controller.abort()

		expect(instrument.count).toBe(0)
		expect(recorder.count).toBe(0)
	})

	it('detaches the scoping listener after removal by the original callback', () => {
		const instrument = createSignal()
		const lifetime = createSignal()
		const recorder = createRecorder<readonly [event: Event]>()

		instrument.signal.addEventListener('abort', recorder.handler, {
			signal: lifetime.signal,
		})
		expect(lifetime.count).toBe(1)

		instrument.signal.removeEventListener('abort', recorder.handler)

		expect(lifetime.count).toBe(0)
		lifetime.controller.abort()
		instrument.controller.abort()
		expect(recorder.count).toBe(0)
	})

	it('detaches the scoping listener after a one-shot delivery', () => {
		const instrument = createSignal()
		const lifetime = createSignal()
		const recorder = createRecorder<readonly [event: Event]>()

		instrument.signal.addEventListener('abort', recorder.handler, {
			once: true,
			signal: lifetime.signal,
		})
		expect(lifetime.count).toBe(1)

		instrument.controller.abort()

		expect(lifetime.count).toBe(0)
		expect(recorder.count).toBe(1)
		lifetime.controller.abort()
		expect(lifetime.count).toBe(0)
	})
})

describe('createResourceFactory', () => {
	it('creates increasing ids and records creation and destruction', () => {
		const factory = createResourceFactory()

		const first = factory.create()
		const next = factory.create()
		factory.destroy(next)
		factory.destroy(first)

		expect(next).toBeGreaterThan(first)
		expect(factory.created.calls).toStrictEqual([[first], [next]])
		expect(factory.destroyed.calls).toStrictEqual([[next], [first]])
	})
})

describe('createTeardown', () => {
	it('runs every handler newest-first', async () => {
		const teardown = createTeardown()
		const order: string[] = []
		teardown.add(() => {
			order.push('first')
		})
		teardown.add(async () => {
			await Promise.resolve()
			order.push('second')
		})
		teardown.add(() => {
			order.push('third')
		})

		await teardown.destroy()

		expect(order).toStrictEqual(['third', 'second', 'first'])
	})

	it('continues after a synchronous throw and rethrows it by identity', async () => {
		const teardown = createTeardown()
		const sentinel = new Error('sentinel')
		const order: string[] = []
		teardown.add(() => {
			order.push('oldest')
		})
		teardown.add(() => {
			order.push('throw')
			throw sentinel
		})
		teardown.add(() => {
			order.push('newest')
		})

		let caught: unknown
		try {
			await teardown.destroy()
		} catch (error) {
			caught = error
		}

		expect(caught).toBe(sentinel)
		expect(order).toStrictEqual(['newest', 'throw', 'oldest'])
	})

	it('continues after an asynchronous rejection and rethrows it by identity', async () => {
		const teardown = createTeardown()
		const sentinel = new Error('sentinel')
		const order: string[] = []
		teardown.add(() => {
			order.push('oldest')
		})
		teardown.add(async () => {
			order.push('reject')
			await Promise.reject(sentinel)
		})
		teardown.add(() => {
			order.push('newest')
		})

		let caught: unknown
		try {
			await teardown.destroy()
		} catch (error) {
			caught = error
		}

		expect(caught).toBe(sentinel)
		expect(order).toStrictEqual(['newest', 'reject', 'oldest'])
	})

	it('aggregates synchronous and asynchronous failures in run order after every handler runs', async () => {
		const teardown = createTeardown()
		const synchronous = new Error('synchronous')
		const asynchronous = new Error('asynchronous')
		const order: string[] = []
		teardown.add(() => {
			order.push('oldest')
		})
		teardown.add(() => {
			order.push('synchronous')
			throw synchronous
		})
		teardown.add(async () => {
			order.push('asynchronous')
			await Promise.reject(asynchronous)
		})
		teardown.add(() => {
			order.push('newest')
		})

		let caught: unknown
		try {
			await teardown.destroy()
		} catch (error) {
			caught = error
		}

		expect(caught).toBeInstanceOf(AggregateError)
		if (!(caught instanceof AggregateError)) throw new Error('Expected an AggregateError')
		expect(caught.errors).toStrictEqual([asynchronous, synchronous])
		expect(order).toStrictEqual(['newest', 'asynchronous', 'synchronous', 'oldest'])
	})

	it('leaves handlers added during destruction for the next call', async () => {
		const teardown = createTeardown()
		const order: string[] = []
		teardown.add(() => {
			order.push('oldest')
		})
		teardown.add(() => {
			order.push('adding')
			teardown.add(() => {
				order.push('added')
			})
		})

		await teardown.destroy()
		expect(order).toStrictEqual(['adding', 'oldest'])
		expect(teardown.count).toBe(1)

		await teardown.destroy()
		expect(order).toStrictEqual(['adding', 'oldest', 'added'])
		expect(teardown.count).toBe(0)
	})

	it('tracks additions and resets the count before handlers run', async () => {
		const teardown = createTeardown()
		const counts: number[] = []
		expect(teardown.count).toBe(0)

		teardown.add(() => {
			counts.push(teardown.count)
		})
		expect(teardown.count).toBe(1)
		teardown.add(() => {
			counts.push(teardown.count)
		})
		expect(teardown.count).toBe(2)

		await teardown.destroy()

		expect(counts).toStrictEqual([0, 0])
		expect(teardown.count).toBe(0)
	})

	it('does nothing when destroyed empty or destroyed again', async () => {
		const teardown = createTeardown()
		await expect(teardown.destroy()).resolves.toBeUndefined()

		let count = 0
		teardown.add(() => {
			count += 1
		})
		await teardown.destroy()
		await expect(teardown.destroy()).resolves.toBeUndefined()

		expect(count).toBe(1)
		expect(teardown.count).toBe(0)
	})
})
