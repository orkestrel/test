import type { RecorderInterface } from './types.js'

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
