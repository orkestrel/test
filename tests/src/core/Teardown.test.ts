import { Teardown } from '../../../src/core/Teardown.js'
import { describe, expect, it } from 'vitest'

describe('Teardown', () => {
	it('retains additions made during an earlier destruction', async () => {
		const teardown = new Teardown()
		const calls: string[] = []
		teardown.add(() => {
			calls.push('original')
			teardown.add(() => {
				calls.push('later')
			})
		})
		await teardown.destroy()
		expect(calls).toEqual(['original'])
		expect(teardown.count).toBe(1)
		await teardown.destroy()
		expect(calls).toEqual(['original', 'later'])
		expect(teardown.count).toBe(0)
	})
})
