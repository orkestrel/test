import type { RecorderMap } from '@src/core'
import { createRecorder, isRecorderMapComplete } from '@src/core'
import { describe, expect, it } from 'vitest'

type ScriptedEventMap = {
	readonly ready: readonly [name: string, step: number]
}

describe('isRecorderMapComplete', () => {
	it('narrows a structurally complete recorder map', () => {
		const value: unknown = {
			ready: createRecorder<readonly [name: string, step: number]>(),
		}

		if (!isRecorderMapComplete<ScriptedEventMap, 'ready'>(value, ['ready'])) {
			throw new Error('Expected a complete recorder map')
		}
		const complete: RecorderMap<ScriptedEventMap, 'ready'> = value
		complete.ready.handler('value', 1)
		expect(complete.ready.calls).toStrictEqual([['value', 1]])
	})

	it('refuses missing and malformed recorder members', () => {
		const recorder = createRecorder<readonly [name: string, step: number]>()
		const inherited: unknown = Object.create({ ready: recorder })

		expect(isRecorderMapComplete<ScriptedEventMap, 'ready'>({}, ['ready'])).toBe(false)
		expect(isRecorderMapComplete<ScriptedEventMap, 'ready'>(inherited, ['ready'])).toBe(false)
		expect(isRecorderMapComplete<ScriptedEventMap, 'ready'>({ ready: 1 }, ['ready'])).toBe(false)
		expect(
			isRecorderMapComplete<ScriptedEventMap, 'ready'>({ ready: { calls: [] } }, ['ready']),
		).toBe(false)
		expect(
			isRecorderMapComplete<ScriptedEventMap, 'ready'>(
				{ ready: { calls: 'invalid', handler: recorder.handler } },
				['ready'],
			),
		).toBe(false)
	})

	it('refuses hostile and primitive values without throwing', () => {
		const hostile = new Proxy(
			{},
			{
				getOwnPropertyDescriptor() {
					throw new Error('Hostile recorder descriptor read')
				},
			},
		)

		expect(() => isRecorderMapComplete<ScriptedEventMap, 'ready'>(hostile, ['ready'])).not.toThrow()
		expect(isRecorderMapComplete<ScriptedEventMap, 'ready'>(hostile, ['ready'])).toBe(false)
		expect(isRecorderMapComplete<ScriptedEventMap, 'ready'>(null, ['ready'])).toBe(false)
		expect(isRecorderMapComplete<ScriptedEventMap, 'ready'>(1, ['ready'])).toBe(false)
	})
})
