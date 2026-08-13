import type { JSONValue } from './types.js'

/**
 * Waits for a host timer to elapse.
 *
 * @param ms - The delay in milliseconds.
 * @returns A promise that resolves after the timer fires.
 */
export function waitForDelay(ms = 0): Promise<void> {
	return new Promise((resolve) => setTimeout(resolve, ms))
}

/**
 * Captures the value thrown by a thunk.
 *
 * @param thunk - The work whose thrown value to capture.
 * @returns The thrown value, or `undefined` when the thunk completes.
 */
export function captureError(thunk: () => unknown): unknown {
	try {
		thunk()
	} catch (error) {
		return error
	}
	return undefined
}

/**
 * Requires a value to be present.
 *
 * @typeParam T - The required value type.
 * @param value - The value to check.
 * @param message - The error message used when the value is absent.
 * @returns The present value.
 */
export function requireValue<T>(value: T | null | undefined, message = 'Value is required'): T {
	if (value === null || value === undefined) throw new Error(message)
	return value
}

/**
 * Collects every value from an async iterable.
 *
 * @typeParam T - The yielded value type.
 * @param source - The async iterable to drain.
 * @returns The yielded values in iteration order.
 */
export async function collect<T>(source: AsyncIterable<T>): Promise<readonly T[]> {
	const values: T[] = []
	for await (const value of source) values.push(value)
	return values
}

/**
 * Collects every value from a readable stream.
 *
 * @typeParam T - The streamed value type.
 * @param stream - The readable stream to drain.
 * @returns The streamed values in read order.
 */
export async function collectStream<T>(stream: ReadableStream<T>): Promise<readonly T[]> {
	const reader = stream.getReader()
	const values: T[] = []
	try {
		while (true) {
			const result = await reader.read()
			if (result.done) return values
			values.push(result.value)
		}
	} finally {
		reader.releaseLock()
	}
}

/**
 * Copies a JSON value through serialization and parsing.
 *
 * @typeParam T - The JSON value type.
 * @param value - The value to copy.
 * @returns The parsed JSON copy.
 */
export function roundTripJSON<T extends JSONValue>(value: T): T {
	return JSON.parse(JSON.stringify(value))
}

/**
 * Resolves the workspace root above a calling module.
 *
 * @param meta - The calling module metadata.
 * @returns The root URL one directory above the calling file.
 */
export function resolveRoot(meta: ImportMeta): URL {
	return new URL('../', meta.url)
}
