import { createHostileValues, createRecorder } from '@src/core'
import { describe, expect, it } from 'vitest'

function isSerializableRecord(value: unknown): value is Readonly<Record<string, unknown>> {
	if (typeof value !== 'object' || value === null) return false

	try {
		if (Object.getPrototypeOf(value) !== Object.prototype) return false
		return JSON.stringify(value) !== undefined
	} catch {
		return false
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
