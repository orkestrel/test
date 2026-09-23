import { isObject } from '@orkestrel/contract'

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
 * Rewrites a Windows absolute path to forward slashes.
 *
 * @param path - The path to rewrite.
 * @returns The path written with forward slashes when it is a Windows absolute path; otherwise `path` unchanged.
 * @remarks A provider returns a path in the separator its host writes, while a tool reporting its
 * own root normalizes that root to forward slashes on every host. Rewrite each side before
 * comparing them, so the comparison reads the file the path names rather than the host's
 * separator. Rewrites separators only for a recognized Windows path form — a drive-letter or UNC
 * head — because a backslash is a legal character in a POSIX path and an unconditional rewrite
 * maps distinct POSIX paths onto one spelling.
 * @example
 * ```ts
 * expect(rewriteWindowsAbsolutePath(written)).toBe(rewriteWindowsAbsolutePath(expected))
 * ```
 */
export function rewriteWindowsAbsolutePath(path: string): string {
	// Rewrites separators only for a recognized Windows path form — a drive-letter
	// or UNC head — because a backslash is a legal character in a POSIX path and an
	// unconditional rewrite maps distinct POSIX paths onto one spelling.
	return /^(?:[A-Za-z]:[\\/]|\\\\)/.test(path) ? path.replaceAll('\\', '/') : path
}

/**
 * Names the `guides/test.md` fences carried outside `tests/guides.test.ts`, keyed by the `###`
 * heading that owns the fence and valued by the test file that runs it.
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
	'Hold a control and read the pressed paint': 'tests/src/browser/helpers.test.ts',
	"Read a pseudo-element's paint": 'tests/src/browser/helpers.test.ts',
	'Emulate reduced motion and print': 'tests/src/browser/helpers.test.ts',
	'Measure what a reader sees': 'tests/src/browser/helpers.test.ts',
	'Read the tokens and colors a theme declares': 'tests/src/browser/helpers.test.ts',
	'Find a rule in the cascade': 'tests/src/browser/helpers.test.ts',
	'Read the classes and styles the markup carries': 'tests/src/browser/helpers.test.ts',
	'Remove an IndexedDB database': 'tests/src/browser/helpers.test.ts',
	"Measure a document's content edge": 'tests/src/browser/helpers.test.ts',
	'Read a written frame back': 'tests/src/browser/helpers.test.ts',
	'Record a browser journal': 'tests/src/browser/factories.test.ts',
	'Place a capture portfolio': 'tests/src/browser/factories.test.ts',
	'Send a key to what holds focus': 'tests/src/browser/helpers.test.ts',
	'Wait for what a control announces': 'tests/src/browser/helpers.test.ts',
	'Wait for the paint to stop moving': 'tests/src/browser/helpers.test.ts',
	'Read the refusal instead of catching it': 'tests/src/browser/helpers.test.ts',
	'Take an authored-class census': 'tests/src/browser/helpers.test.ts',
	'Control a reading before you trust it': 'tests/src/browser/helpers.test.ts',
	'Withhold a store the way a host does': 'tests/src/browser/factories.test.ts',
})

/**
 * Checks whether a value is a plain record that JSON can serialize.
 *
 * @param value - The value to check.
 * @returns Whether `value` is a serializable record with the default object prototype.
 */
export function isSerializableRecord(value: unknown): value is Readonly<Record<string, unknown>> {
	if (!isObject(value)) return false

	try {
		if (Object.getPrototypeOf(value) !== Object.prototype) return false
		return JSON.stringify(value) !== undefined
	} catch {
		return false
	}
}

/** Lists the `npm` arguments the `tests/distribution.test.ts` suite checks the registry's availability with. */
export const PING = Object.freeze([
	'ping',
	'--fetch-retries=0',
	'--fetch-timeout=5000',
	'--loglevel=silent',
])

/**
 * Lists the extensions a JavaScript handler loads as modules. Node loads a native addon through its
 * addon handler instead, so that extension is named separately.
 */
export const MODULE_EXTENSIONS = Object.freeze(['.js', '.mjs', '.cjs'])

/**
 * Lists the extensions a declaration file carries. A `require` condition declares `.d.cts` and an
 * ESM-only one `.d.mts`, so the `.d.ts` spelling alone does not name them.
 */
export const DECLARATION_EXTENSIONS = Object.freeze(['.d.ts', '.d.cts', '.d.mts'])

/** Names whether a consumer module resolves through an ECMAScript module or a CommonJS one. */
export type Format = 'module' | 'commonjs'

/**
 * Describes a compile-and-resolve drive `tests/distribution.test.ts` runs against the installed
 * consumer: the compiler options its scratch project sets, and the conditions TypeScript applies
 * for that resolution and importing format.
 */
export interface Resolution {
	readonly label: string
	readonly resolution: string
	readonly module: string
	readonly conditions: Readonly<Record<Format, readonly string[]>>
}

/**
 * Lists the Node import target's resolution conditions. The CommonJS compile probe is selected from
 * its declaration's format, and its runtime drive loads the same subpath through Node's require
 * resolver. Vite's production client build enables its module and browser conditions.
 */
export const RUNTIME_CONDITIONS = Object.freeze({
	module: Object.freeze(['node-addons', 'node', 'import', 'module-sync']),
	commonjs: Object.freeze(['node-addons', 'node', 'require', 'module-sync']),
	browser: Object.freeze(['module', 'browser', 'production', 'import']),
})

/**
 * Lists TypeScript's bundler resolution's declaration conditions. Its Node resolutions add `node`
 * to the format condition; its bundler resolution does not, so a browser drive compares against the
 * declaration a bundler consumer reads rather than borrowing the Node declaration.
 */
export const BUNDLER_CONDITIONS = Object.freeze({
	module: Object.freeze(['types', 'import']),
	commonjs: Object.freeze(['types', 'require']),
})

/** Lists TypeScript's Node resolutions' declaration conditions. */
export const DECLARATION_CONDITIONS = Object.freeze({
	module: Object.freeze(['types', 'node', 'import']),
	commonjs: Object.freeze(['types', 'node', 'require']),
	browser: BUNDLER_CONDITIONS.module,
})

/**
 * Lists every compile-and-resolve drive `tests/distribution.test.ts` runs against the installed
 * consumer. The option values are the spellings the project file takes, so nothing here needs the
 * compiler's own API to name them.
 */
export const RESOLUTIONS: readonly Resolution[] = Object.freeze([
	Object.freeze({
		label: 'node16',
		resolution: 'node16',
		module: 'node16',
		conditions: DECLARATION_CONDITIONS,
	}),
	Object.freeze({
		label: 'nodenext',
		resolution: 'nodenext',
		module: 'nodenext',
		conditions: DECLARATION_CONDITIONS,
	}),
	Object.freeze({
		label: 'bundler',
		resolution: 'bundler',
		module: 'esnext',
		conditions: BUNDLER_CONDITIONS,
	}),
])

/** Pairs the declaration extension and format each source extension resolves through. */
export const FORMATS: ReadonlyArray<readonly [extension: string, format: Format]> = Object.freeze([
	Object.freeze<readonly [extension: string, format: Format]>(['ts', 'module']),
	Object.freeze<readonly [extension: string, format: Format]>(['cts', 'commonjs']),
])

/** Lists every fence language this package's guides are allowed to use. */
export const FENCE_LANGUAGES = Object.freeze(['bash', 'ts'])

/** Maps each import specifier this package's own guides may resolve against. */
export const MODULES: Readonly<Record<string, string>> = Object.freeze({
	'@orkestrel/test': 'src/core',
	'@orkestrel/test/server': 'src/server',
	'@orkestrel/test/browser': 'src/browser',
})

/**
 * Lists the declarations deliberately kept out of the barrel, as `computeSymbolKey` strings.
 *
 * A class that one-class-per-file evicted from its owning consumer cannot become a local, so it
 * stays exported without being public. Naming it here is what makes that intentional rather than
 * forgotten — and the assertion in `tests/guides.test.ts` that reads this table fails when a name
 * here stops being stranded, so the list cannot rot.
 */
export const INTERNAL: readonly string[] = Object.freeze([])

/**
 * Carries the refusal a scenario phase throws by identity, so a case over a non-error throw asserts on
 * the value that came back rather than on a rendering of it. A frozen record is not an `Error`, which
 * is the whole of what such a case turns on.
 */
export const REFUSAL = Object.freeze({ reason: 'refused' })
