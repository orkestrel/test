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
 * The `guides/test.md` fences carried outside `tests/guides.test.ts`, keyed by the `###` heading
 * that owns the fence and valued by the test file that runs it.
 *
 * @remarks A browser fence needs a document, and the guides project runs in Node with the browser
 * disabled, so each one is carried in the browser suite that owns its subject. The totality guard in
 * `tests/guides.test.ts` reads this table: it fails on a fence-bearing heading that appears neither
 * in a transcription there nor here, on an entry naming a heading the guide does not carry a fence
 * under, and on a carrier file missing its `guides/test.md → <section> → "<heading>"` marker line.
 */
export const ROUTED_FENCES: Readonly<Record<string, string>> = Object.freeze({
	'Build and mount a fixture': 'tests/src/browser/helpers.test.ts',
	'Drive an interface the way a person does': 'tests/src/browser/helpers.test.ts',
	'Drive a field the component listens to': 'tests/src/browser/helpers.test.ts',
	'Measure what a reader sees': 'tests/src/browser/helpers.test.ts',
	'Read the tokens and colors a theme declares': 'tests/src/browser/helpers.test.ts',
	'Find a rule in the cascade': 'tests/src/browser/helpers.test.ts',
	'Read the classes and styles the markup carries': 'tests/src/browser/helpers.test.ts',
	'Remove an IndexedDB database': 'tests/src/browser/helpers.test.ts',
	'Read a written frame back': 'tests/src/browser/helpers.test.ts',
	'Record a browser journal': 'tests/src/browser/factories.test.ts',
	'Place a capture portfolio': 'tests/src/browser/factories.test.ts',
})

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
