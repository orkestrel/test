import { Journal } from '../../../../src/browser/journeys/Journal.js'
import { describe, expect, it } from 'vitest'

describe('Journal', () => {
	it('records only while started and restores the console by identity', () => {
		const original = console.log
		const journal = new Journal()
		journal.record('click', 'Before', 'ignored')
		expect(journal.steps).toEqual([])
		try {
			journal.start()
			journal.record('click', 'Apply', 'accepted')
			const steps = journal.steps
			journal.start()
			expect(journal.steps).toEqual([])
			expect(steps).toEqual([{ action: 'click', trigger: 'Apply', result: 'accepted' }])
		} finally {
			journal.stop()
		}
		expect(console.log).toBe(original)
		journal.record('click', 'After', 'ignored')
		expect(journal.steps).toEqual([])
	})
})
