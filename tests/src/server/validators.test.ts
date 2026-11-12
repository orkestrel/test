import { describe, expect, it } from 'vitest'
import { isProgressError, isProgressEvent } from '@src/server'
import { PROGRESS_BAIL_EVENTS, PROGRESS_LIVE_EVENTS } from '../../setupServer.js'

describe('isProgressError', () => {
	it('accepts a message with or without a location', () => {
		expect(isProgressError({ message: 'Error: refused' })).toBe(true)
		expect(isProgressError({ message: 'Error: refused', location: 'a.test.ts:1:2' })).toBe(true)
	})

	it('refuses a missing message, a non-string location, and a non-record', () => {
		expect(isProgressError({ location: 'a.test.ts:1:2' })).toBe(false)
		expect(isProgressError({ message: 'Error: refused', location: 4 })).toBe(false)
		expect(isProgressError('Error: refused')).toBe(false)
		expect(isProgressError(undefined)).toBe(false)
	})
})

describe('isProgressEvent', () => {
	it('accepts every event the fixtures carry', () => {
		const events = [...PROGRESS_BAIL_EVENTS, ...PROGRESS_LIVE_EVENTS]
		expect(new Set(events.map((event) => event.event))).toEqual(
			new Set(['init', 'start', 'collected', 'ready', 'case', 'cancel', 'module', 'end']),
		)
		expect(events.every((event) => isProgressEvent(JSON.parse(JSON.stringify(event))))).toBe(true)
	})

	it('refuses an unknown event, a missing stamp, and an off-domain state', () => {
		expect(isProgressEvent({ event: 'retry', time: 1, pid: 2 })).toBe(false)
		expect(isProgressEvent({ event: 'cancel', reason: 'test-failure', wall: 1, time: 2 })).toBe(
			false,
		)
		expect(
			isProgressEvent({
				event: 'case',
				project: 'unit',
				module: 'a.test.ts',
				id: 'a0',
				name: 'adds',
				state: 'flaky',
				time: 1,
				pid: 2,
			}),
		).toBe(false)
		expect(
			isProgressEvent({
				event: 'end',
				reason: 'cancelled',
				overhead: 1,
				unhandled: [],
				time: 1,
				pid: 2,
			}),
		).toBe(false)
		expect(isProgressEvent(null)).toBe(false)
		expect(isProgressEvent([])).toBe(false)
	})

	it('accepts a case line without its optional duration, start, and errors', () => {
		expect(
			isProgressEvent({
				event: 'case',
				project: 'unit',
				module: 'a.test.ts',
				id: 'a0',
				name: 'adds',
				state: 'skipped',
				time: 1,
				pid: 2,
			}),
		).toBe(true)
	})
})
