import type { RecorderMap } from './types.js'

/**
 * Checks whether a value contains a recorder for every listed event.
 *
 * @typeParam TMap - The source's event names and delivered argument tuples.
 * @typeParam TName - The event names represented in the map.
 * @param value - The value to inspect.
 * @param events - The events the completed map must contain.
 * @returns True if every listed event has a structurally valid recorder; false otherwise.
 * @remarks Per-key tuple precision is the predicate's claim. The factory proves that claim by
 * wiring each recorder to exactly the event where it stores that recorder. A direct caller must
 * establish the same pairing before it relies on the narrowing. This guard takes the listed events
 * through a reference parameter rather than using the canonical single-value guard form.
 */
export function isRecorderMapComplete<
	TMap extends Record<string, readonly unknown[]>,
	TName extends keyof TMap,
>(value: unknown, events: readonly TName[]): value is RecorderMap<TMap, TName> {
	try {
		if (typeof value !== 'object' || value === null) return false
		return events.every((event) => {
			if (!Object.hasOwn(value, event)) return false
			const recorder = Reflect.get(value, event)
			if (typeof recorder !== 'object' || recorder === null) return false
			return (
				typeof Reflect.get(recorder, 'handler') === 'function' &&
				Array.isArray(Reflect.get(recorder, 'calls'))
			)
		})
	} catch {
		return false
	}
}
