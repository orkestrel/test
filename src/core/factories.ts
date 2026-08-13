import type { ClockInterface, RecorderInterface } from './types.js'

/**
 * Creates a recorder for callback arguments.
 *
 * @typeParam TArgs - The argument tuple to record.
 * @returns A recorder whose handler appends calls in order.
 */
export function createRecorder<TArgs extends readonly unknown[]>(): RecorderInterface<TArgs> {
	const calls: TArgs[] = []
	return {
		calls,
		get count() {
			return calls.length
		},
		handler(...args) {
			calls.push(args)
		},
		clear() {
			calls.length = 0
		},
	}
}

/**
 * Creates a clock controlled by the caller.
 *
 * @param start - The initial time in milliseconds.
 * @returns A clock that can advance or replace its current time.
 */
export function createClock(start = 0): ClockInterface {
	let current = start
	return {
		now: () => current,
		advance(ms) {
			current += ms
		},
		set(value) {
			current = value
		},
	}
}
