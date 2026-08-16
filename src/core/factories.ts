import type { RecorderInterface } from './types.js'

/**
 * Creates values that make common object readers throw or violate their assumptions.
 *
 * @returns A frozen array whose six values are fresh on every call.
 * @remarks Membership may grow in a release. The stable consumer contract is that a total guard
 * refuses every member without throwing. Test the whole returned set in a loop, and include the
 * loop index in each failure so a newly added member identifies itself.
 * @example
 * ```ts
 * for (const [index, value] of createHostileValues().entries()) {
 * 	try {
 * 		if (isRecord(value)) throw new Error(`Guard accepted hostile value ${index}`)
 * 	} catch (error) {
 * 		throw new Error(`Guard failed at hostile value ${index}`, { cause: error })
 * 	}
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
