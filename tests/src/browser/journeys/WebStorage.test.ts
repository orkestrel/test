import { WebStorage } from '../../../../src/browser/journeys/WebStorage.js'
import { describe, expect, it } from 'vitest'

describe('WebStorage', () => {
	it('grants permissions without replenishing the write quota', () => {
		const storage = new WebStorage({ reads: false, writes: false, values: { seed: 'kept' } }, 1)
		expect(() => storage.getItem('seed')).toThrow('getItem')
		storage.permit()
		expect(storage.getItem('seed')).toBe('kept')
		storage.setItem('next', 'accepted')
		storage.permit()
		expect(() => storage.setItem('last', 'refused')).toThrow('No room is left for last')
		expect(storage.length).toBe(2)
		expect(storage.key(0)).toBe('seed')
		storage.removeItem('seed')
		expect(storage.getItem('seed')).toBeNull()
		storage.clear()
		expect(storage.length).toBe(0)
	})
})
