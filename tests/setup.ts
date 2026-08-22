/**
 * Creates an async generator that yields each of the given values in order.
 *
 * @param values - The values to yield.
 * @returns An async generator over `values`.
 * @example
 * ```ts
 * for await (const value of createAsyncSource([1, 2, 3])) {
 * 	console.log(value)
 * }
 * ```
 */
export async function* createAsyncSource<T>(values: readonly T[]): AsyncGenerator<T> {
	for (const value of values) yield value
}

/**
 * Creates a readable stream that enqueues each of the given values in order, then closes.
 *
 * @param values - The values to enqueue.
 * @returns A readable stream over `values`.
 * @example
 * ```ts
 * const stream = createStreamSource([1, 2, 3])
 * ```
 */
export function createStreamSource<T>(values: readonly T[]): ReadableStream<T> {
	return new ReadableStream<T>({
		start(controller) {
			for (const value of values) controller.enqueue(value)
			controller.close()
		},
	})
}

/**
 * Rewrites every backslash in a path to a forward slash.
 *
 * @param path - The path to rewrite.
 * @returns The path written with forward slashes alone.
 * @remarks A provider returns a path in the separator its host writes, while a tool reporting its
 * own root normalizes that root to forward slashes on every host. Rewrite each side before
 * comparing them, so the comparison reads the file the path names rather than the host's
 * separator. Rewrites separators only for a recognized Windows path form — a drive-letter or UNC
 * head — because a backslash is a legal character in a POSIX path and an unconditional rewrite
 * maps distinct POSIX paths onto one spelling.
 * @example
 * ```ts
 * expect(normalizePath(written)).toBe(normalizePath(expected))
 * ```
 */
export function normalizePath(path: string): string {
	// Rewrites separators only for a recognized Windows path form — a drive-letter
	// or UNC head — because a backslash is a legal character in a POSIX path and an
	// unconditional rewrite maps distinct POSIX paths onto one spelling.
	return /^(?:[A-Za-z]:[\\/]|\\\\)/.test(path) ? path.replaceAll('\\', '/') : path
}

/**
 * Checks whether a value is a plain record that JSON can serialize.
 *
 * @param value - The value to check.
 * @returns Whether `value` is a serializable record with the default object prototype.
 */
export function isSerializableRecord(value: unknown): value is Readonly<Record<string, unknown>> {
	if (typeof value !== 'object' || value === null) return false

	try {
		if (Object.getPrototypeOf(value) !== Object.prototype) return false
		return JSON.stringify(value) !== undefined
	} catch {
		return false
	}
}
