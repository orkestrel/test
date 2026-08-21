import type { RecorderMap } from './types.js'

/**
 * Checks whether a partial recorder map contains a recorder for every listed event.
 *
 * @typeParam TMap - The source's event names and delivered argument tuples.
 * @typeParam TName - The event names represented in the map.
 * @param recorders - The partial recorder map to inspect.
 * @param events - The events the completed map must contain.
 * @returns True if every listed event has a recorder; false otherwise.
 * @remarks Use this narrowing companion when building a recorder map incrementally.
 */
export function isRecorderMapComplete<
	TMap extends Record<string, readonly unknown[]>,
	TName extends keyof TMap,
>(
	recorders: Partial<RecorderMap<TMap, TName>>,
	events: readonly TName[],
): recorders is RecorderMap<TMap, TName> {
	try {
		return events.every((event) => recorders[event] !== undefined)
	} catch {
		return false
	}
}
