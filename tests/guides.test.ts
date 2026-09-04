import type { Duplex } from 'node:stream'
import type { EventSourceInterface, StateScenario } from '@src/core'
import { afterEach, describe, expect, it } from 'vitest'
import {
	createGuide,
	createSource,
	extractFenceImports,
	findMissing,
	findMissingSymbols,
	isExternalLink,
	parseManifest,
	resolveLink,
} from '@orkestrel/guide'
import { EventEmitter } from 'node:events'
import { existsSync } from 'node:fs'
import { createServer } from 'node:http'
import { join } from 'node:path'
import {
	captureError,
	collect,
	collectStream,
	createHostileValues,
	createRecorder,
	createRecorders,
	createResourceFactory,
	createSignal,
	createTeardown,
	executeScenarios,
	flattenHeaders,
	invokeUnchecked,
	readProperty,
	requireValue,
	resolveRoot,
	retryUntil,
	roundTripJSON,
	STATECHART_ATTRIBUTES,
	STATECHART_STATUSES,
	waitForAbort,
	waitForCondition,
	waitForEvent,
} from '@src/core'
import {
	createCookieJar,
	createLoopback,
	createScratch,
	destroyScratch,
	readInventory,
	requestUpgrade,
	resolveContained,
	supportsDirectoryLinks,
	supportsFileLinks,
} from '@src/server'
import {
	createAsyncSource,
	createStreamSource,
	isSerializableRecord,
	ROUTED_FENCES,
} from './setup.js'

// The inventory comes from this package's own walker rather than a local one: `readInventory` is
// proved against raw `node:fs` fixtures in tests/src/server/helpers.test.ts, so here it is a
// consumer. A broken walk fails parity loudly with missing symbols instead of passing on an empty
// map, and the fleet's headline capability is exercised by the suite that depends on it.
const files = readInventory(resolveRoot(import.meta), ['README.md', 'src', 'tests', 'guides'], {
	extensions: ['.ts', '.md'],
})

const manifest = parseManifest(requireValue(files['guides/README.md']), 'guides')

// The emitter fence drives `createRecorders` from a loader that emits `read` for every file it read
// and `fail` for every file it could not. That loader is the consumer's own code, so what stands here
// is the smallest real event source in its place: it registers the handlers it is given and delivers
// real tuples to them. Nothing this package owns is stood in for.
type LoaderEvents = {
	readonly read: readonly [path: string]
	readonly fail: readonly [reason: string, retryable: boolean]
}

class ScriptedLoader implements EventSourceInterface<LoaderEvents> {
	readonly #listeners = createRecorder<readonly [event: keyof LoaderEvents, handler: unknown]>()

	on<K extends keyof LoaderEvents>(event: K, handler: (...args: LoaderEvents[K]) => void): void {
		this.#listeners.handler(event, handler)
	}

	emit(event: keyof LoaderEvents, args: readonly unknown[]): void {
		for (const [name, handler] of this.#listeners.calls) {
			if (name === event) invokeUnchecked<void>(this, handler, args)
		}
	}
}

// A guide fence imports through the published specifier, so only this package's own specifiers name
// symbols the reflected source can confirm. Everything else in a fence belongs to another package.
const specifier = '@orkestrel/test'

// A fence opens on a run of three or more backticks indented no more than three spaces, and closes
// on a run at least as long carrying nothing after it. That pair is CommonMark's, and the indented
// form is the one a bare `startsWith` on the delimiter walks straight past. An opening run's info
// string carries no backtick, which is what keeps prose about a delimiter out of the walk.
const FENCE_OPEN = /^ {0,3}(`{3,})[^`]*$/
const FENCE_CLOSE = /^ {0,3}(`{3,})[ \t]*$/

const HEADING = /^(#{1,6}) (.+)$/

// A carrier opens with this line, and the totality guard builds it from the guide's own headings.
// Reading the marker back out of a file is what makes a transcription and a routed carrier the same
// kind of evidence, so neither can go missing without the guard naming the heading it belonged to.
function buildMarker(section: string, heading: string): string {
	return `// guides/test.md → ${section} → "${heading}"`
}

// A marker opens its own line, so a file carries one only when some line begins with it after its
// indentation. Reading the whole file for the substring accepts the same text quoted inside a
// sentence, and prose about a fence is not the comment that carries it.
function carriesMarker(text: string, marker: string): boolean {
	return text.split('\n').some((line) => line.trim().startsWith(marker))
}

// A README example states a long result across several comment lines, and where the wrap falls is
// the formatter's decision rather than the claim. Dropping the comment markers and every space
// compares what the example says a call returns against what it returns, and leaves a key that was
// added, removed, or renamed still moving the compared text.
function normalizeComments(text: string): string {
	return text
		.split('\n')
		.map((line) => (line.startsWith('//') ? line.slice(2) : line))
		.join('\n')
		.replaceAll(/\s+/gu, '')
}

// The shape a README example prints a key list in.
function renderKeys(keys: readonly string[]): string {
	return `[${keys.map((key) => `'${key}'`).join(', ')}]`
}

// The "Copy a JSON value" fence copies an interface-typed value, so its `Snapshot` stands here.
interface Snapshot {
	readonly name: string
	readonly tags: readonly string[]
}

// The "Prove a wire fixpoint" fence takes `schema`, `parseSchema`, and `serializeSchema` from the
// consumer, because the comparison is the consumer's own. This is that consumer's part: a fixture
// schema, a serializer that puts the wire in canonical order, and a parser that refuses anything
// else. The serializer sorts, so a fixpoint that held only by echoing bytes back would not hold.
interface Schema {
	readonly name: string
	readonly fields: readonly string[]
}

function serializeSchema(schema: Schema): Readonly<Record<string, unknown>> {
	return { name: schema.name, fields: [...schema.fields].sort() }
}

function parseSchema(value: unknown): Schema | undefined {
	if (!isSerializableRecord(value)) return undefined
	const name = value.name
	const fields: unknown = value.fields
	if (typeof name !== 'string' || !Array.isArray(fields)) return undefined
	const members: readonly unknown[] = fields
	if (!members.every((field): field is string => typeof field === 'string')) return undefined
	return { name, fields: members }
}

// The "Drive a statechart table" fence drives a disclosure that is closed until something shows it.
// This is that entity, in the fence's own shape.
type DisclosureState = 'closed' | 'open'

type DisclosureEvent = 'show' | 'hide'

class Disclosure {
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

interface DisclosureContext {
	readonly disclosure: Disclosure
}

function arrangeDisclosure(context: DisclosureContext, state: DisclosureState): void {
	if (state === 'open') context.disclosure.show()
}

function actOnDisclosure(context: DisclosureContext, event: DisclosureEvent): void {
	if (event === 'show') context.disclosure.show()
	else context.disclosure.hide()
}

function assertDisclosure(context: DisclosureContext, state: DisclosureState): void {
	expect(context.disclosure.state).toBe(state)
}

const DISCLOSURE_SCENARIOS: ReadonlyArray<
	StateScenario<DisclosureState, DisclosureEvent, DisclosureContext>
> = [
	{
		transition: { name: 'closed opens on show', from: 'closed', event: 'show', to: 'open' },
		arrange: arrangeDisclosure,
		act: actOnDisclosure,
		assert: assertDisclosure,
	},
]

// The failing-row fence's table: nothing about the row is malformed, and the `to` state the event
// leaves the entity in is not the one the row names, so only `assert` can catch it.
const MISMATCHED_SCENARIOS: ReadonlyArray<
	StateScenario<DisclosureState, DisclosureEvent, DisclosureContext>
> = [
	{
		transition: { name: 'show leaves it closed', from: 'closed', event: 'show', to: 'closed' },
		arrange: arrangeDisclosure,
		act: actOnDisclosure,
		assert: assertDisclosure,
	},
]

describe('guides parity', () => {
	it('parses a non-empty manifest', () => {
		expect(manifest.length).toBeGreaterThan(0)
	})

	for (const entry of manifest) {
		describe(`${entry.concept}`, () => {
			const guide = createGuide(requireValue(files[entry.spec], `Missing guide: ${entry.spec}`))
			const source = createSource({ files, module: entry.source })
			// Derived from source, not from the guide: deleting the guide's `## Methods` section
			// empties `guide.methods()`, and a check anchored only to the guide then passes with
			// nothing left to compare.
			const behavioral = source
				.exports()
				.filter(
					(symbol) => symbol.keyword === 'interface' && source.methods(symbol.name).length > 0,
				)
				.map((symbol) => symbol.name)

			it('documents every source export', () => {
				expect(findMissingSymbols(source.exports(), guide.surface())).toEqual([])
			})

			it('documents only real exports', () => {
				expect(findMissingSymbols(guide.surface(), source.exports())).toEqual([])
			})

			it('exposes every source export through its barrel', () => {
				expect(findMissingSymbols(source.exports(), source.surface())).toEqual([])
			})

			it('declares every barrel symbol directly', () => {
				expect(findMissingSymbols(source.surface(), source.exports())).toEqual([])
			})

			it('documents every behavioral interface', () => {
				const documented = guide.methods().map((group) => group.interface)
				expect(findMissing(behavioral, documented)).toEqual([])
				expect(findMissing(documented, behavioral)).toEqual([])
			})

			it('documents every public method on implementing interfaces', () => {
				for (const group of guide.methods()) {
					const documented = [...group.methods]
					const actual = [...source.methods(group.interface)]
					expect(findMissing(documented, actual)).toEqual([])
					expect(findMissing(actual, documented)).toEqual([])
				}
			})

			it('resolves internal links', () => {
				for (const href of guide.links()) {
					if (isExternalLink(href)) continue
					const resolved = resolveLink(entry.spec, href)
					expect(source.exists(resolved)).toBe(true)
				}
			})

			it('resolves tests links', () => {
				for (const href of guide.tests()) {
					const resolved = resolveLink(entry.spec, href)
					expect(source.exists(resolved)).toBe(true)
				}
			})

			it('imports only real exports in its examples', () => {
				const exported = source.exports().map((symbol) => symbol.name)
				const imported = guide
					.fences()
					.filter((fence) => fence.language === 'ts')
					.flatMap((fence) => extractFenceImports(fence.code))
					.filter((row) => row.specifier === specifier || row.specifier.startsWith(`${specifier}/`))
					.flatMap((row) => [...row.names])
				expect(imported.length).toBeGreaterThan(0)
				expect(findMissing(imported, exported)).toEqual([])
			})

			it('extracts non-vacuous surface and methods', () => {
				expect(guide.surface().length).toBeGreaterThan(0)
				expect(behavioral.length).toBeGreaterThan(0)
				for (const group of guide.methods()) {
					expect(group.methods.length).toBeGreaterThan(0)
				}
			})
		})
	}
})

// Parity proves a documented name exists; it never proves a sentence about behaviour is true. Each
// case that follows runs one guide fence and asserts the values that fence's own comments claim, so
// a fence that goes stale reddens here instead of shipping.
//
// Placement rule: a fence's carrier lives in the project that can run it. A browser carrier lives
// in `tests/src/browser/`, and each one there names the project it was routed out of. A
// real-registry carrier lives in the project that owns that subject. Every other carrier lives
// here, where the guides project runs in Node with the browser disabled. A carrier opens with its
// `guides/test.md → <section> → "<heading>"` line, and the first case that follows reads that line
// in this file and in each routed-away carrier so no fence can be added or moved unnoticed.
describe('guide fences', () => {
	// A presence check over a named few passes while the guide grows past them, so the population is
	// discovered from the guide instead: every `###` heading with a fence under it. That population
	// must equal the headings transcribed here plus the headings routed away in `ROUTED_FENCES`, and
	// no heading may be in both. A fence-bearing heading nobody carries fails by name, an entry
	// naming a heading the guide does not carry a fence under fails by name, and a carrier that lost
	// its marker line fails on that file.
	it('carries every fence-bearing guide heading in exactly one place', () => {
		const text = requireValue(files['guides/test.md'], 'Missing guide: guides/test.md')
		const markers = new Map<string, string>()
		let section = ''
		let heading: string | undefined
		let open: string | undefined

		for (const line of text.split('\n')) {
			if (open !== undefined) {
				const close = FENCE_CLOSE.exec(line)
				if (close !== null && requireValue(close[1]).length >= open.length) open = undefined
				continue
			}

			const fence = FENCE_OPEN.exec(line)
			if (fence !== null) {
				open = requireValue(fence[1])
				if (heading !== undefined) markers.set(heading, buildMarker(section, heading))
				continue
			}

			const head = HEADING.exec(line)
			if (head === null) continue
			const depth = requireValue(head[1])
			const title = requireValue(head[2])
			if (depth === '###') {
				heading = title
				continue
			}
			// A deeper heading is part of what the `###` above it owns, so it leaves that heading
			// standing and a fence under it still belongs to the carrier that names it. A `##` opens a
			// section that owns no `###` yet.
			if (depth.length > 3) continue
			if (depth === '##') section = title
			heading = undefined
		}

		const discovered = [...markers.keys()]
		const routed = Object.keys(ROUTED_FENCES)
		const own = requireValue(files['tests/guides.test.ts'], 'Missing carrier: tests/guides.test.ts')
		const transcribed = discovered.filter((name) =>
			carriesMarker(own, requireValue(markers.get(name))),
		)

		expect(discovered.length).toBeGreaterThan(0)
		expect(findMissing(routed, discovered)).toEqual([])
		expect(transcribed.filter((name) => routed.includes(name))).toEqual([])
		expect(findMissing(discovered, [...transcribed, ...routed])).toEqual([])
		expect(findMissing([...transcribed, ...routed], discovered)).toEqual([])

		const unmarked = Object.entries(ROUTED_FENCES).filter(
			([name, path]) =>
				!carriesMarker(
					requireValue(files[path], `Missing routed carrier: ${path}`),
					requireValue(markers.get(name)),
				),
		)
		expect(unmarked).toEqual([])
	})

	// guides/test.md → Patterns → "Record calls without a spy".
	it('truncates a captured calls array in place and stays usable', () => {
		const recorder = createRecorder<[id: string, size: number]>()
		recorder.handler('a', 1)
		recorder.handler('b', 2)
		expect(recorder.count).toBe(2)
		expect(recorder.calls).toStrictEqual([
			['a', 1],
			['b', 2],
		])

		const captured = recorder.calls
		recorder.clear()
		expect(recorder.count).toBe(0)
		expect(captured.length).toBe(0)
		recorder.handler('c', 3)
		expect(recorder.count).toBe(1)
	})

	// guides/test.md → Patterns → "Record an emitter's events".
	it('keys one recorder per named event and records each delivery in order', () => {
		const loader = new ScriptedLoader()
		const recorders = createRecorders<LoaderEvents, 'read' | 'fail'>(loader, ['read', 'fail'])

		loader.emit('read', ['src/index.ts'])
		loader.emit('read', ['src/types.ts'])
		loader.emit('fail', ['locked', true])

		expect(recorders.read.count).toBe(2)
		expect(recorders.read.calls).toStrictEqual([['src/index.ts'], ['src/types.ts']])
		expect(recorders.fail.calls).toStrictEqual([['locked', true]])
	})

	// guides/test.md → Patterns → "Count the listeners on a signal".
	it('counts the live abort registrations and drops each one at its own exit', async () => {
		const instrument = createSignal()
		expect(instrument.count).toBe(0)

		const heard = createRecorder<[event: Event]>()
		instrument.signal.addEventListener('abort', heard.handler)
		expect(instrument.count).toBe(1)
		instrument.signal.addEventListener('abort', heard.handler)
		expect(instrument.count).toBe(1)

		const parked = waitForAbort(instrument.signal)
		expect(instrument.count).toBe(2)

		const scoped = createRecorder<[event: Event]>()
		const lifetime = new AbortController()
		instrument.signal.addEventListener('abort', scoped.handler, { signal: lifetime.signal })
		expect(instrument.count).toBe(3)

		lifetime.abort()
		expect(instrument.count).toBe(2)

		instrument.controller.abort()
		await parked
		expect(instrument.count).toBe(1)
		expect(heard.count).toBe(1)
		expect(scoped.count).toBe(0)

		instrument.signal.removeEventListener('abort', heard.handler)
		expect(instrument.count).toBe(0)
	})

	// guides/test.md → Patterns → "Number the resources a fixture allocates".
	it('numbers each allocation and records the ids created and destroyed', () => {
		const resources = createResourceFactory()

		const first = resources.create()
		const second = resources.create()
		expect(first).toBe(1)
		expect(second).toBe(2)
		resources.destroy(first)

		expect(resources.created.calls).toStrictEqual([[1], [2]])
		expect(resources.destroyed.calls).toStrictEqual([[1]])
		expect(resources.created.count - resources.destroyed.count).toBe(1)
	})

	// guides/test.md → Patterns → "Capture a throw, then assert on it".
	it('captures a real throw and answers undefined for both a return and a thrown undefined', () => {
		const thrown = captureError(() => JSON.parse('{'))
		expect(thrown).toBeInstanceOf(SyntaxError)

		expect(captureError(() => 'fine')).toBeUndefined()
		expect(
			captureError(() => {
				throw undefined
			}),
		).toBeUndefined()
	})

	// guides/test.md → Patterns → "Narrow without `!` or `as`".
	it('passes a falsy value through and refuses absence with the message it was given', () => {
		expect(requireValue(0)).toBe(0)
		expect(requireValue('')).toBe('')
		expect(requireValue(false)).toBe(false)
		expect(() => requireValue(undefined)).toThrow(new Error('Value is required'))
		expect(() => requireValue(null, 'port is required')).toThrow(new Error('port is required'))
	})

	// guides/test.md → Patterns → "Cross an unchecked boundary".
	it('reads an absent key as undefined and refuses an uncallable method and a null target', () => {
		const closed = createRecorder<[]>()
		const handle: unknown = { label: 'ledger', close: closed.handler }

		const close: unknown = readProperty(handle, 'close')
		invokeUnchecked<void>(handle, close, [])
		expect(closed.count).toBe(1)

		const label = readProperty<unknown>(handle, 'label')
		expect(typeof label === 'string').toBe(true)

		expect(readProperty<string>(handle, 'absent')).toBeUndefined()
		expect(() => invokeUnchecked<void>(handle, 'close', [])).toThrow(
			new TypeError('Method must be callable'),
		)
		expect(() => readProperty<string>(null, 'label')).toThrow(
			new TypeError('Target must be an object or function'),
		)
	})

	// guides/test.md → Patterns → "Flatten headers into one record".
	it('lowercases a header name, combines a repeated one, and freezes the record', () => {
		expect(flattenHeaders({ 'Content-Type': 'application/json' })).toStrictEqual({
			'content-type': 'application/json',
		})
		expect(
			flattenHeaders([
				['x-run', '1'],
				['X-Run', '2'],
			]),
		).toStrictEqual({ 'x-run': '1, 2' })
		expect(Object.isFrozen(flattenHeaders(new Headers({ accept: 'text/plain' })))).toBe(true)
	})

	// guides/test.md → Patterns → "Drain an async source". The fence declares its generator and its
	// stream inline; `createAsyncSource` and `createStreamSource` are the same two sources, already
	// standing in tests/setup.ts because every project's suites drain them.
	it('drains an async iterable and a readable stream into arrays in yield order', async () => {
		expect(await collect(createAsyncSource(['a', 'b']))).toStrictEqual(['a', 'b'])
		expect(await collectStream(createStreamSource([1, 2]))).toStrictEqual([1, 2])
	})

	// guides/test.md → Patterns → "Wait for a named condition", the `waitForCondition` arm. The
	// fence's `isBuilt` reads for an artifact a build outside the test produces, so a real scratch
	// directory takes that place and a real file appears in it while the wait is reading.
	it('reads until the artifact is on disk, then resolves', async () => {
		const scratch = createScratch({ prefix: 'guide-build-' })
		try {
			const artifact = join(scratch.path, 'dist/index.js')
			const pending = setTimeout(() => {
				scratch.write('dist/index.js', 'export {}\n')
			}, 20)
			try {
				await waitForCondition('artifact is on disk', () => existsSync(artifact), {
					budget: 2000,
					interval: 25,
				})
			} finally {
				clearTimeout(pending)
			}
			expect(scratch.read('dist/index.js')).toBe('export {}\n')
		} finally {
			scratch.destroy()
		}
	})

	// guides/test.md → Patterns → "Wait for a named condition", the `retryUntil` arm. The fence's
	// `origin` is a server the test started, so a real one answers here: its health route reports
	// `starting` once and `ok` after that, which is the reading the predicate is there to reject.
	it('returns the first produced value the predicate accepts', async () => {
		let started = false
		const server = createServer((_request, response) => {
			if (started) {
				response.end('ok')
				return
			}
			started = true
			response.statusCode = 503
			response.end('starting')
		})
		const loopback = await createLoopback(server)
		try {
			const body = await retryUntil(
				'health endpoint answers',
				async () => (await fetch(`${loopback.url}/health`)).text(),
				(text) => text === 'ok',
				{ budget: 2000, attempts: 20 },
			)
			expect(body).toBe('ok')
		} finally {
			await loopback.destroy()
		}
	})

	// guides/test.md → Patterns → "Wait for a named condition", the `waitForEvent` arm. The fence's
	// `child` is scene, so a real `EventEmitter` stands in its place: it registers the listener the
	// subscriber hands it and delivers a real `exit` tuple to it. Its own live listener count is how
	// the cleanup is read — the count can only fall back to zero because `waitForEvent` ran the
	// cleanup the subscriber returned, and it ran it on delivery rather than on timeout or abort.
	it('resolves with the delivered tuple and runs the returned cleanup on delivery', async () => {
		const exits = new EventEmitter()

		const parked = waitForEvent<[code: number, signal: string | null]>((listener) => {
			exits.on('exit', listener)
			return () => {
				exits.off('exit', listener)
			}
		}, 'child exits')
		expect(exits.listenerCount('exit')).toBe(1)

		exits.emit('exit', 0, null)

		expect(await parked).toStrictEqual([0, null])
		expect(exits.listenerCount('exit')).toBe(0)
	})

	// guides/test.md → Patterns → "Wait for a named condition", the throw-asymmetry fence.
	it('propagates a condition throw and keeps a producer throw as the exhaustion cause', async () => {
		const unreachable = new Error('registry unreachable')

		const refused: unknown = await waitForCondition('never holds', () => {
			throw unreachable
		}).catch((reason: unknown) => reason)
		expect(refused === unreachable).toBe(true)

		const exhausted: unknown = await retryUntil(
			'registry answers',
			(): string => {
				throw unreachable
			},
			() => true,
			{ budget: 30, interval: 10 },
		).catch((reason: unknown) => reason)
		expect(exhausted).toBeInstanceOf(Error)
		const error = requireValue(exhausted instanceof Error ? exhausted : undefined)
		expect(error.message.startsWith('Retry "registry answers" did not succeed within 30ms')).toBe(
			true,
		)
		expect(error.cause === unreachable).toBe(true)
	})

	// guides/test.md → Patterns → "Copy a JSON value".
	it('copies an interface-typed value to fresh references and refuses a non-finite member', () => {
		const original: Snapshot = { name: 'a', tags: ['x'] }
		const copy: Snapshot = roundTripJSON(original)
		expect(copy).toStrictEqual({ name: 'a', tags: ['x'] })
		expect(copy.tags === original.tags).toBe(false)

		expect(roundTripJSON(-0)).toBe(0)
		const refusal = captureError(() => roundTripJSON({ a: [{ b: NaN }] }))
		expect(requireValue(refusal instanceof Error ? refusal : undefined).message).toBe(
			'JSON values must contain finite numbers',
		)
	})

	// guides/test.md → Patterns → "Prove a guard is total". The fence is a consumer's parameterized
	// body, so a real total guard fills `guard`: `isSerializableRecord`, which tests/setup.ts already
	// runs the workspace's serializable-record decisions through. Its contract refuses every member
	// of the corpus, and `expected` names the reading each refusal rests on rather than repeating a
	// literal the loop could have derived from the corpus itself.
	it('survives every hostile value and answers what the guard contract requires', () => {
		const guard = isSerializableRecord
		const expected: readonly boolean[] = [
			false, // the self-referential record — serialization throws on the cycle
			false, // the revoked proxy — the prototype read throws
			false, // the property proxy — serialization's property read throws
			false, // the key proxy — serialization's key enumeration throws
			false, // the prototype proxy — the prototype read throws
			false, // the null-prototype record — its prototype is not the default one
			false, // the array-target proxy — its prototype is Array's
			false, // the self-referential array — its prototype is Array's
			false, // the sparse array — its prototype is Array's
			false, // the hidden-key record — its enumerable self-reference cycles serialization
			false, // the named getter — serialization's property read throws
		]

		const values = createHostileValues()
		expect(expected.length).toBe(values.length)

		for (const [index, value] of values.entries()) {
			let accepted: boolean | undefined
			expect(() => {
				accepted = guard(value)
			}, `hostile value ${index}`).not.toThrow()
			expect(accepted, `hostile value ${index}`).toBe(expected[index])
		}
	})

	// guides/test.md → Patterns → "Prove a wire fixpoint".
	it('reproduces the canonical wire after a parse across an untrusted JSON boundary', () => {
		const schema: Schema = { name: 'ledger', fields: ['id', 'amount'] }

		const wire = JSON.stringify(serializeSchema(schema))
		const received = requireValue(parseSchema(JSON.parse(wire)))

		expect(JSON.stringify(serializeSchema(received))).toBe(wire)
	})

	// guides/test.md → Patterns → "Drive a statechart table".
	it('walks the table and opens a failing row message with that row name', async () => {
		await executeScenarios(DISCLOSURE_SCENARIOS, () => ({ disclosure: new Disclosure() }))

		const thrown = await executeScenarios(MISMATCHED_SCENARIOS, () => ({
			disclosure: new Disclosure(),
		})).catch((error: unknown) => error)

		const failure = requireValue(thrown instanceof Error ? thrown : undefined)
		expect(
			failure.message.startsWith("show leaves it closed: expected 'open' to be 'closed'"),
		).toBe(true)
		expect(failure.cause).toBeInstanceOf(Error)

		const refused = await executeScenarios(MISMATCHED_SCENARIOS, () => {
			throw new Error('no fixture')
		}).catch((error: unknown) => error)

		const refusal = requireValue(refused instanceof Error ? refused : undefined)
		expect(refusal.message).toBe('show leaves it closed: build refused')
		expect(refusal.cause).toBeInstanceOf(Error)

		expect(STATECHART_ATTRIBUTES.status).toBe('data-statechart-status')
		expect(STATECHART_ATTRIBUTES.scenario).toBe('data-statechart-scenario')
		expect(STATECHART_STATUSES[0]).toBe('pending')
		expect(STATECHART_STATUSES.includes('running')).toBe(true)
	})

	// guides/test.md → Patterns → "Read a source inventory". The root is this workspace, as the
	// fence's own comment says it is, so the keys are this package's real files.
	it('keys a walk root-relative, takes a named file whatever the filter says, and excludes below a directory', () => {
		const root = resolveRoot(import.meta)

		expect(Object.keys(readInventory(root, ['src/core'], { extensions: ['.ts'] }))).toStrictEqual([
			'src/core/constants.ts',
			'src/core/factories.ts',
			'src/core/helpers.ts',
			'src/core/index.ts',
			'src/core/types.ts',
			'src/core/validators.ts',
		])

		expect(
			Object.keys(readInventory(root, ['package.json', 'src/core'], { extensions: ['.ts'] })),
		).toStrictEqual([
			'package.json',
			'src/core/constants.ts',
			'src/core/factories.ts',
			'src/core/helpers.ts',
			'src/core/index.ts',
			'src/core/types.ts',
			'src/core/validators.ts',
		])

		expect(
			Object.keys(
				readInventory(root, ['src/core'], {
					extensions: ['.ts'],
					exclude: ['src/core/index.ts'],
				}),
			),
		).toStrictEqual([
			'src/core/constants.ts',
			'src/core/factories.ts',
			'src/core/helpers.ts',
			'src/core/types.ts',
			'src/core/validators.ts',
		])

		expect(
			Object.keys(readInventory(root, ['src'], { extensions: ['.ts'], exclude: ['src/server'] })),
		).toStrictEqual([
			'src/browser/constants.ts',
			'src/browser/factories.ts',
			'src/browser/helpers.ts',
			'src/browser/index.ts',
			'src/browser/types.ts',
			'src/core/constants.ts',
			'src/core/factories.ts',
			'src/core/helpers.ts',
			'src/core/index.ts',
			'src/core/types.ts',
			'src/core/validators.ts',
		])

		expect(
			readInventory(root, ['src/core/index.ts'], { extensions: ['.ts'], exclude: ['src/core'] }),
		).toStrictEqual({})
	})

	// guides/test.md → Patterns → "Own a temporary directory", the allocation half.
	it('reads back what it wrote, refuses an escape, and nests one allocation in another', () => {
		const scratch = createScratch({ prefix: 'guide-', files: { 'src/index.ts': 'export {}\n' } })
		try {
			expect(scratch.read('src/index.ts')).toBe('export {}\n')
			expect(scratch.has('src')).toBe(true)
			expect(() => scratch.read('src')).toThrow('Scratch path is a directory: src')
			expect(scratch.read('missing.ts')).toBeUndefined()
			expect(() => scratch.write('../escape.ts', '')).toThrow(
				'Path outside scratch directory: ../escape.ts',
			)

			expect(scratch.write('src/notes.ts', 'export {}\n')).toBe(join(scratch.path, 'src/notes.ts'))

			scratch.ensure('empty')
			expect(scratch.names()).toStrictEqual(['empty', 'src'])
			expect(scratch.names('empty')).toStrictEqual([])

			const child = createScratch({ parent: scratch.path, prefix: 'child-' })
			expect(scratch.names().length).toBe(3)
			child.destroy()
			expect(scratch.names().length).toBe(2)
		} finally {
			scratch.destroy()
		}
	})

	// guides/test.md → Patterns → "Own a temporary directory", the link half. The fence links a
	// directory, so it runs where the host makes one: `supportsDirectoryLinks` reads that host as it
	// stands rather than naming a platform.
	it.skipIf(!supportsDirectoryLinks())(
		'acts at a link rather than through it, and leaves what a removed link pointed at',
		() => {
			const scratch = createScratch({ prefix: 'guide-', files: { 'src/index.ts': 'export {}\n' } })
			const outside = createScratch({ prefix: 'outside-', files: { 'read.ts': 'export {}\n' } })
			try {
				scratch.ensure('empty')

				expect(scratch.link('gate', outside.path)).toBe(join(scratch.path, 'gate'))
				expect(scratch.read('gate/read.ts')).toBe('export {}\n')

				expect(scratch.ensure('gate/made')).toBe(join(scratch.path, 'gate/made'))
				expect(outside.names()).toStrictEqual(['made', 'read.ts'])
				expect(scratch.names('gate')).toStrictEqual(['made', 'read.ts'])

				expect(() => scratch.link('gate', outside.path)).toThrow('EEXIST')

				scratch.link('dangling', 'missing.ts')
				expect(scratch.has('dangling')).toBe(true)
				expect(scratch.read('dangling')).toBeUndefined()

				scratch.remove('dangling')
				expect(scratch.has('dangling')).toBe(false)
				expect(() => scratch.remove('missing.ts')).not.toThrow()
				scratch.remove('src')
				expect(scratch.names()).toStrictEqual(['empty', 'gate'])

				scratch.destroy()
				expect(() => scratch.destroy()).not.toThrow()
				expect(outside.has('made')).toBe(true)
			} finally {
				scratch.destroy()
				outside.destroy()
			}
		},
	)

	// guides/test.md → Patterns → "Own a temporary directory", the `destroyScratch` fence. Nothing
	// holds this allocation, so the retry resolves on its first attempt.
	it('awaits the removal of an allocation a holder may still be releasing', async () => {
		const workspace = createScratch({ prefix: 'build-' })

		await destroyScratch(workspace)

		expect(existsSync(workspace.path)).toBe(false)
	})

	// guides/test.md → Patterns → "Give everything back in one hook". The fence's consumer registers
	// the hook beside the list, so the transcription does too and the hook really runs.
	describe('one cleanup hook', () => {
		const teardown = createTeardown()

		// This package registers no hook of its own, so the consumer writes this line once.
		afterEach(() => teardown.destroy())

		it('runs its cleanup newest-first and empties the list', async () => {
			const order: string[] = []
			teardown.add(() => {
				order.push('opened first')
			})
			teardown.add(async () => {
				await Promise.resolve()
				order.push('opened second')
			})
			expect(teardown.count).toBe(2)

			await teardown.destroy()
			expect(order).toStrictEqual(['opened second', 'opened first'])
			expect(teardown.count).toBe(0)
		})
	})

	// guides/test.md → Patterns → "Answer a real request on a loopback port".
	it('answers on an IPv4 loopback port the host picked, then closes idempotently', async () => {
		const server = createServer((_request, response) => {
			response.end('ok')
		})

		const loopback = await createLoopback(server)

		expect(loopback.url).toBe(`http://127.0.0.1:${loopback.port}`)
		expect(loopback.port).toBeGreaterThan(0)

		const response = await fetch(loopback.url)
		expect(await response.text()).toBe('ok')

		await loopback.destroy()
		expect(await loopback.destroy()).toBeUndefined()
		expect(server.listening).toBe(false)
	})

	// guides/test.md → Patterns → "Request an HTTP upgrade". The server is a real one on a real
	// loopback port, so each arm is what a client read off the wire rather than a literal.
	it('reports the refused arm, the claimed arm, and the budget a silent server runs out', async () => {
		const detached: Duplex[] = []
		const server = createServer((_request, response) => {
			response.statusCode = 426
			response.end('upgrade required')
		})
		const loopback = await createLoopback(server)
		try {
			expect(await requestUpgrade(loopback.port, { path: '/socket' })).toStrictEqual({
				claimed: false,
				status: 426,
			})

			server.on('upgrade', (request, socket) => {
				detached.push(socket)
				if (request.url !== '/socket') return
				socket.write(
					'HTTP/1.1 101 Switching Protocols\r\nConnection: Upgrade\r\nUpgrade: websocket\r\nSec-WebSocket-Protocol: ledger.v2\r\n\r\n',
				)
			})

			const claimed = await requestUpgrade(loopback.port, {
				path: '/socket',
				protocols: ['ledger.v2', 'ledger.v1'],
			})
			expect(claimed).toStrictEqual({ claimed: true, protocol: 'ledger.v2' })
			expect(claimed.claimed ? claimed.protocol : undefined).toBe('ledger.v2')

			const expired: unknown = await requestUpgrade(loopback.port, {
				path: '/silent',
				budget: 50,
			}).catch((reason: unknown) => reason)
			const refusal = requireValue(expired instanceof Error ? expired : undefined)
			expect(refusal.message).toBe(
				`Upgrade request to 127.0.0.1:${loopback.port}/silent was not answered within 50ms`,
			)
		} finally {
			for (const socket of detached) socket.destroy()
			await loopback.destroy()
		}
	})

	// guides/test.md → Patterns → "Probe what the host supports". The fence is itself a gated case,
	// so it transcribes as one: the skip cites the mechanism the proof rests on rather than a host.
	it.skipIf(!supportsFileLinks())('reads a file through a link', () => {
		const scratch = createScratch({ files: { 'source.txt': 'linked' } })
		try {
			scratch.link('gate.txt', 'source.txt')
			expect(scratch.read('gate.txt')).toBe('linked')
		} finally {
			scratch.destroy()
		}
	})

	// guides/test.md → Patterns → "Replay response cookies". The origin is a real loopback server
	// spelling real `Set-Cookie` fields, so the jar reads what an origin sends rather than a literal.
	it('replays what a real origin set, and drops a cookie on Max-Age=0', async () => {
		const server = createServer((request, response) => {
			if (request.url === '/session' && request.method === 'POST') {
				response.setHeader('set-cookie', [
					'session=abc; Path=/; HttpOnly',
					'theme=dark; Max-Age=600',
				])
				response.end('signed in')
				return
			}
			if (request.url === '/session' && request.method === 'DELETE') {
				response.setHeader('set-cookie', ['session=; Path=/; Max-Age=0'])
				response.end('signed out')
				return
			}
			const carried = request.headers.cookie ?? ''
			response.end(carried.includes('session=abc') ? 'signed in' : 'signed out')
		})
		const loopback = await createLoopback(server)
		try {
			const jar = createCookieJar()

			const signIn = await fetch(`${loopback.url}/session`, { method: 'POST' })
			expect(jar.capture(signIn)).toStrictEqual([
				'session=abc; Path=/; HttpOnly',
				'theme=dark; Max-Age=600',
			])
			expect(jar.read('session')).toBe('abc')
			expect(jar.header).toBe('session=abc; theme=dark')

			const profile = await fetch(`${loopback.url}/profile`, {
				headers: { cookie: jar.header ?? '' },
			})
			expect(await profile.text()).toBe('signed in')

			jar.capture(await fetch(`${loopback.url}/session`, { method: 'DELETE' }))
			expect(jar.read('session')).toBeUndefined()
			expect(jar.header).toBe('theme=dark')
		} finally {
			await loopback.destroy()
		}
	})

	// guides/test.md → Patterns → "Refuse an escaping path in your own fixture".
	it('resolves a contained path and refuses a relative and an absolute escape', () => {
		const scratch = createScratch({ files: { 'src/index.ts': 'export {}\n' } })
		const root = scratch.path
		try {
			expect(resolveContained(root, 'src/index.ts')).toBe(join(root, 'src/index.ts'))
			expect(resolveContained(root, join(root, 'src/index.ts'))).toBe(join(root, 'src/index.ts'))
			expect(resolveContained(root, '../escape.ts')).toBeUndefined()
			expect(resolveContained(root, join(root, '../escape.ts'))).toBeUndefined()
			expect(resolveContained(root, '/etc/passwd')).toBeUndefined()
		} finally {
			scratch.destroy()
		}
	})
})

// The README carries its own `readInventory` example, and until this case the inventory walked
// `src`, `tests`, and `guides` alone, so the root README was read by nothing and the results it
// states were never re-derived. Each expectation here comes from the live walk rather than from a
// literal, so a file added under `src` reddens the README copy the way it already reddens the
// guide's.
describe('README examples', () => {
	const readme = requireValue(files['README.md'], 'Missing README: README.md')
	const root = resolveRoot(import.meta)

	it('states what each readInventory call it shows really returns', () => {
		const sources = readInventory(root, ['src/core', 'src/server'], { extensions: ['.ts'] })
		const text = normalizeComments(readme)

		expect(text).toContain(normalizeComments(renderKeys(Object.keys(sources))))

		expect(text).toContain(
			normalizeComments(JSON.stringify(requireValue(sources['src/core/index.ts']))),
		)

		expect(text).toContain(
			normalizeComments(
				renderKeys(
					Object.keys(readInventory(root, ['package.json', 'src/core'], { extensions: ['.ts'] })),
				),
			),
		)

		expect(text).toContain(
			normalizeComments(
				renderKeys(
					Object.keys(
						readInventory(root, ['src/core'], {
							extensions: ['.ts'],
							exclude: ['src/core/index.ts'],
						}),
					),
				),
			),
		)

		expect(text).toContain(
			normalizeComments(
				renderKeys(
					Object.keys(
						readInventory(root, ['src'], { extensions: ['.ts'], exclude: ['src/server'] }),
					),
				),
			),
		)
	})
})
