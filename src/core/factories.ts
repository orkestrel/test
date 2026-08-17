import type { RecorderInterface, TeardownHandler, TeardownInterface } from './types.js'

/**
 * Creates values that make common object readers throw or violate their assumptions.
 *
 * @returns A frozen array whose six values are fresh on every call.
 * @remarks Every member makes a naive reader throw. A total guard survives every member without
 * throwing. Whether it accepts or refuses one is that guard's own contract. Membership may grow in
 * a release, so test the whole returned set in a loop and include the index in each failure.
 * @example
 * ```ts
 * import { expect } from 'vitest'
 * import { createHostileValues } from '@orkestrel/test'
 *
 * function isWireRecord(value: unknown): value is Readonly<Record<string, string>> {
 * 	if (typeof value !== 'object' || value === null) return false
 * 	try {
 * 		if (Object.getPrototypeOf(value) !== Object.prototype) return false
 * 		Reflect.get(value, 'value')
 * 		if (Reflect.ownKeys(value).length === 0) return false
 * 		return Object.values(value).every((member) => typeof member === 'string')
 * 	} catch {
 * 		return false
 * 	}
 * }
 *
 * for (const [index, value] of createHostileValues().entries()) {
 * 	let accepted: boolean | undefined
 * 	expect(() => {
 * 		accepted = isWireRecord(value)
 * 	}, `hostile value ${index}`).not.toThrow()
 * 	expect(accepted, `hostile value ${index}`).toBe(false)
 * }
 * ```
 */
export function createHostileValues(): readonly unknown[] {
	const cyclic: Record<string, unknown> = {}
	cyclic.self = cyclic
	const revoked = Proxy.revocable({}, {})
	revoked.revoke()

	return Object.freeze([
		cyclic,
		revoked.proxy,
		new Proxy(
			{},
			{
				get() {
					throw new Error('Hostile property read')
				},
			},
		),
		new Proxy(
			{},
			{
				ownKeys() {
					throw new Error('Hostile key enumeration')
				},
			},
		),
		new Proxy(
			{},
			{
				getPrototypeOf() {
					throw new Error('Hostile prototype read')
				},
			},
		),
		Object.create(null),
	])
}

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
