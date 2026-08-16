import { createRecorder, createTeardown } from '@src/core'
import { describe, expect, it } from 'vitest'

describe('createRecorder', () => {
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
