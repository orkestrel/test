import { createRecorder } from '@src/core'
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
