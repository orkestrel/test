import type {
	EventSourceInterface,
	RecorderInterface,
	SignalInterface,
	StateScenario,
	invokeUnchecked,
} from '@src/core'
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
	'Drive an interface the way a person does': 'tests/src/browser/journeys/helpers.test.ts',
	'Drive a field the component listens to': 'tests/src/browser/journeys/helpers.test.ts',
	'Hold a control and read the pressed paint': 'tests/src/browser/journeys/helpers.test.ts',
	"Read a pseudo-element's paint": 'tests/src/browser/helpers.test.ts',
	'Emulate reduced motion and print': 'tests/src/browser/captures/helpers.test.ts',
	'Measure what a reader sees': 'tests/src/browser/colors/helpers.test.ts',
	'Read the tokens and colors a theme declares': 'tests/src/browser/sheets/helpers.test.ts',
	'Find a rule in the cascade': 'tests/src/browser/sheets/helpers.test.ts',
	'Read the classes and styles the markup carries': 'tests/src/browser/sheets/helpers.test.ts',
	'Remove an IndexedDB database': 'tests/src/browser/journeys/helpers.test.ts',
	"Measure a document's content edge": 'tests/src/browser/captures/helpers.test.ts',
	'Read a written frame back': 'tests/src/browser/captures/helpers.test.ts',
	'Record a browser journal': 'tests/src/browser/journeys/factories.test.ts',
	'Place a capture portfolio': 'tests/src/browser/captures/factories.test.ts',
	'Send a key to what holds focus': 'tests/src/browser/journeys/helpers.test.ts',
	'Wait for what a control announces': 'tests/src/browser/journeys/helpers.test.ts',
	'Wait for the paint to stop moving': 'tests/src/browser/journeys/helpers.test.ts',
	'Read the refusal instead of catching it': 'tests/src/browser/journeys/helpers.test.ts',
	'Take an authored-class census': 'tests/src/browser/sheets/helpers.test.ts',
	'Control a reading before you trust it': 'tests/src/browser/colors/helpers.test.ts',
	'Withhold a store the way a host does': 'tests/src/browser/journeys/factories.test.ts',
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
export interface DistributionResolution {
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
export const RESOLUTIONS: readonly DistributionResolution[] = Object.freeze([
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
export const INTERNAL: readonly string[] = Object.freeze([
	'class Production',
	'class Teardown',
	'class Loopback',
	'class Journal',
	'class WebStorage',
])

/** Counts callback invocations within one test fixture. */
export class TestCounter {
	#count = 0

	get count(): number {
		return this.#count
	}

	increment(): number {
		return ++this.#count
	}
}

/** Holds the value a test fixture changes between asynchronous observations. */
export class TestValue<T> {
	#value: T

	constructor(value: T) {
		this.#value = value
	}

	get value(): T {
		return this.#value
	}

	set value(value: T) {
		this.#value = value
	}
}

/**
 * Carries the refusal a scenario phase throws by identity, so a case over a non-error throw asserts on
 * the value that came back rather than on a rendering of it. A frozen record is not an `Error`, which
 * is the whole of what such a case turns on.
 */
export const REFUSAL = Object.freeze({ reason: 'refused' })

// The emitter fence drives `createRecorders` from a loader that emits `read` for every file it read
// and `fail` for every file it could not. That loader is the consumer's own code, so what stands here
// is the smallest real event source in its place: it registers the handlers it is given and delivers
// real tuples to them. Nothing this package owns is stood in for.
export type LoaderEvents = {
	readonly read: readonly [path: string]
	readonly fail: readonly [reason: string, retryable: boolean]
}

export type InvokeFunction = typeof invokeUnchecked

export class ScriptedLoader implements EventSourceInterface<LoaderEvents> {
	readonly #listeners: RecorderInterface<readonly [event: keyof LoaderEvents, handler: unknown]>
	readonly #invoke: InvokeFunction

	constructor(
		listeners: RecorderInterface<readonly [event: keyof LoaderEvents, handler: unknown]>,
		invoke: InvokeFunction,
	) {
		this.#listeners = listeners
		this.#invoke = invoke
	}

	on<K extends keyof LoaderEvents>(event: K, handler: (...args: LoaderEvents[K]) => void): void {
		this.#listeners.handler(event, handler)
	}

	emit(event: keyof LoaderEvents, args: readonly unknown[]): void {
		for (const [name, handler] of this.#listeners.calls) {
			if (name === event) this.#invoke<void>(this, handler, args)
		}
	}
}

// A fence opens on a run of three or more backticks indented no more than three spaces, and closes
// on a run at least as long carrying nothing after it. That pair is CommonMark's, and the indented
// form is the one a bare `startsWith` on the delimiter walks straight past. An opening run's info
// string carries no backtick, which is what keeps prose about a delimiter out of the walk.
export const FENCE_OPEN = /^ {0,3}(`{3,})[^`]*$/
export const FENCE_CLOSE = /^ {0,3}(`{3,})[ \t]*$/

export const HEADING = /^(#{1,6}) (.+)$/

// A carrier opens with this line, and the totality guard builds it from the guide's own headings.
// Reading the marker back out of a file is what makes a transcription and a routed carrier the same
// kind of evidence, so neither can go missing without the guard naming the heading it belonged to.
export function buildMarker(section: string, heading: string): string {
	return `// guides/test.md → ${section} → "${heading}"`
}

// A marker opens its own line, so a file carries one only when some line begins with it after its
// indentation. Reading the whole file for the substring accepts the same text quoted inside a
// sentence, and prose about a fence is not the comment that carries it.
export function carriesMarker(text: string, marker: string): boolean {
	return text.split(/\r\n|\n/).some((line) => line.trim().startsWith(marker))
}

// A README example states a long result across several comment lines, and where the wrap falls is
// the formatter's decision rather than the claim. Dropping the comment markers and every space
// compares what the example says a call returns against what it returns, and leaves a key that was
// added, removed, or renamed still moving the compared text.
export function normalizeComments(text: string): string {
	return text
		.split(/\r\n|\n/)
		.map((line) => (line.startsWith('//') ? line.slice(2) : line))
		.join('\n')
		.replaceAll(/\s+/gu, '')
}

// The shape a README example prints a key list in.
export function renderKeys(keys: readonly string[]): string {
	return `[${keys.map((key) => `'${key}'`).join(', ')}]`
}

// Models the interface-typed value in the "Copy a JSON value" guide fence.
export interface JSONCopyFixture {
	readonly name: string
	readonly tags: readonly string[]
}

// The "Prove a wire fixpoint" fence takes `schema`, `parseSchema`, and `serializeSchema` from the
// consumer, because the comparison is the consumer's own. This is that consumer's part: a fixture
// schema, a serializer that puts the wire in canonical order, and a parser that refuses anything
// else. The serializer sorts, so a fixpoint that held only by echoing bytes back would not hold.
export interface Schema {
	readonly name: string
	readonly fields: readonly string[]
}

export function serializeSchema(schema: Schema): Readonly<Record<string, unknown>> {
	return { name: schema.name, fields: [...schema.fields].sort() }
}

export function parseSchema(
	value: unknown,
	guard: (candidate: unknown) => candidate is Readonly<Record<string, unknown>>,
): Schema | undefined {
	if (!guard(value)) return undefined
	const name = value.name
	const fields: unknown = value.fields
	if (typeof name !== 'string' || !Array.isArray(fields)) return undefined
	const members: readonly unknown[] = fields
	if (!members.every((field): field is string => typeof field === 'string')) return undefined
	return { name, fields: members }
}

export interface GuideScan {
	readonly section: string
	readonly heading: string | undefined
	readonly open: string | undefined
	readonly markers: ReadonlyArray<readonly [string, string]>
}

export function advanceGuideScan(previous: GuideScan, line: string): GuideScan {
	if (previous.open !== undefined) {
		const close = FENCE_CLOSE.exec(line)
		return close !== null && (close[1]?.length ?? 0) >= previous.open.length
			? { ...previous, open: undefined }
			: previous
	}
	const fence = FENCE_OPEN.exec(line)
	if (fence !== null) {
		const heading = previous.heading
		return {
			...previous,
			open: fence[1],
			markers:
				heading === undefined
					? previous.markers
					: [...previous.markers, [heading, buildMarker(previous.section, heading)]],
		}
	}
	const head = HEADING.exec(line)
	if (head === null) return previous
	const depth = head[1]
	const title = head[2]
	if (depth === undefined || title === undefined) throw new Error('Heading pattern omitted a group')
	if (depth === '###') return { ...previous, heading: title }
	if (depth.length > 3) return previous
	return { ...previous, section: depth === '##' ? title : previous.section, heading: undefined }
}

export function createSignalListener(
	heard: RecorderInterface<readonly [receiver: unknown, count: number, scopes: number]>,
	instrument: SignalInterface,
	lifetime: SignalInterface,
): EventListenerObject {
	return {
		handleEvent() {
			heard.handler(this, instrument.count, lifetime.count)
		},
	}
}

export type ScriptedEventMap = {
	readonly progress: readonly [step: number]
	readonly ready: readonly [name: string, step: number]
}

export class ScriptedEventSource implements EventSourceInterface<ScriptedEventMap> {
	readonly #subscriptions: RecorderInterface<
		readonly [event: keyof ScriptedEventMap, handler: unknown]
	>
	readonly #invoke: InvokeFunction

	constructor(
		subscriptions: RecorderInterface<readonly [event: keyof ScriptedEventMap, handler: unknown]>,
		invoke: InvokeFunction,
	) {
		this.#subscriptions = subscriptions
		this.#invoke = invoke
	}

	get count(): number {
		return this.#subscriptions.count
	}

	on<K extends keyof ScriptedEventMap>(
		event: K,
		handler: (...args: ScriptedEventMap[K]) => void,
	): void {
		this.#subscriptions.handler(event, handler)
	}

	emit(event: keyof ScriptedEventMap, args: readonly unknown[]): void {
		for (const [name, handler] of this.#subscriptions.calls) {
			if (name === event) this.#invoke<void>(this, handler, args)
		}
	}
}

export type DisclosureState = 'closed' | 'open'

export type DisclosureEvent = 'show' | 'hide'

export interface DisclosureContext {
	readonly delay: () => Promise<void>
	readonly verify: (actual: DisclosureState, expected: DisclosureState) => void
	readonly disclosure: Disclosure
	readonly trail: RecorderInterface<readonly [phase: string, subject: string]>
}

export class Disclosure {
	#state: DisclosureState = 'closed'

	get state(): DisclosureState {
		return this.#state
	}

	show(): void {
		this.#state = 'open'
	}

	hide(): void {
		this.#state = 'closed'
	}
}

export function arrangeDisclosure(context: DisclosureContext, state: DisclosureState): void {
	context.trail.handler('arrange', state)
	if (state === 'open') context.disclosure.show()
}

// Asynchronous on purpose: an unawaited act would leave the entity in its arranged state, so the
// happy path fails rather than passes if `executeScenario` stops awaiting a phase.
export async function actOnDisclosure(
	context: DisclosureContext,
	event: DisclosureEvent,
): Promise<void> {
	context.trail.handler('act', event)
	await context.delay()
	if (event === 'show') context.disclosure.show()
	else context.disclosure.hide()
}

export function assertDisclosure(context: DisclosureContext, state: DisclosureState): void {
	context.trail.handler('assert', state)
	context.verify(context.disclosure.state, state)
}

export function buildDisclosure(
	trail: RecorderInterface<readonly [phase: string, subject: string]>,
	delay: () => Promise<void>,
	verify: (actual: DisclosureState, expected: DisclosureState) => void,
): DisclosureContext {
	return { disclosure: new Disclosure(), trail, delay, verify }
}

export const DISCLOSURE_SCENARIOS: ReadonlyArray<
	StateScenario<DisclosureState, DisclosureEvent, DisclosureContext>
> = [
	{
		transition: { name: 'closed opens on show', from: 'closed', event: 'show', to: 'open' },
		arrange: arrangeDisclosure,
		act: actOnDisclosure,
		assert: assertDisclosure,
	},
	{
		transition: { name: 'open closes on hide', from: 'open', event: 'hide', to: 'closed' },
		arrange: arrangeDisclosure,
		act: actOnDisclosure,
		assert: assertDisclosure,
	},
]

// The control, drawn from outside the preceding population: the same entity and the same three phases,
// with a `to` state the event cannot reach. Nothing about the row is malformed, so the assertion is
// the only thing that can catch it.
export const MISMATCHED_SCENARIOS: ReadonlyArray<
	StateScenario<DisclosureState, DisclosureEvent, DisclosureContext>
> = [
	{
		transition: { name: 'show leaves it closed', from: 'closed', event: 'show', to: 'closed' },
		arrange: arrangeDisclosure,
		act: actOnDisclosure,
		assert: assertDisclosure,
	},
]

export const REFUSED_SCENARIO: StateScenario<DisclosureState, DisclosureEvent, DisclosureContext> =
	{
		transition: { name: 'arrange refuses', from: 'closed', event: 'show', to: 'open' },
		arrange() {
			throw REFUSAL
		},
		act: actOnDisclosure,
		assert: assertDisclosure,
	}

export function readFixtureValue(): string {
	return 'value'
}

export function ignoreEvent(): void {
	return undefined
}

export function createEventListener(): EventListenerObject {
	return { handleEvent: ignoreEvent }
}
