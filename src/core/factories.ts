import type { RecorderInterface, TeardownHandler, TeardownInterface } from './types.js'

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
 * Creates a teardown list that runs registered handlers newest-first.
 *
 * @returns A teardown list that awaits every handler and collects failures.
 */
export function createTeardown(): TeardownInterface {
	let handlers: TeardownHandler[] = []
	return {
		get count() {
			return handlers.length
		},
		add(handler) {
			handlers.push(handler)
		},
		async destroy() {
			const snapshot = handlers
			handlers = []
			const failures: unknown[] = []
			for (const handler of snapshot.reverse()) {
				try {
					await handler()
				} catch (error) {
					failures.push(error)
				}
			}
			if (failures.length === 1) throw failures[0]
			if (failures.length > 1) throw new AggregateError(failures)
		},
	}
}
