import type { Duplex } from 'node:stream'
import type { EventSourceInterface } from '@src/core'
import { describe, expect, it } from 'vitest'
import {
	createGuide,
	createSource,
	fenceImports,
	findMissing,
	isExternalLink,
	missingSymbols,
	parseManifest,
	resolveLink,
} from '@orkestrel/guide'
import { createServer } from 'node:http'
import {
	createRecorder,
	createRecorders,
	createResourceFactory,
	createSignal,
	flattenHeaders,
	invokeUnchecked,
	readProperty,
	requireValue,
	resolveRoot,
	retryUntil,
	waitForAbort,
	waitForCondition,
} from '@src/core'
import { createCookieJar, createLoopback, readInventory, requestUpgrade } from '@src/server'

// The inventory comes from this package's own walker rather than a local one: `readInventory` is
// proved against raw `node:fs` fixtures in tests/src/server/helpers.test.ts, so here it is a
// consumer. A broken walk fails parity loudly with missing symbols instead of passing on an empty
// map, and the fleet's headline capability is exercised by the suite that depends on it.
const files = readInventory(resolveRoot(import.meta), ['src', 'tests', 'guides'], {
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
				.filter((symbol) => symbol.kind === 'interface' && source.methods(symbol.name).length > 0)
				.map((symbol) => symbol.name)

			it('documents every source export', () => {
				expect(missingSymbols(source.exports(), guide.surface())).toEqual([])
			})

			it('documents only real exports', () => {
				expect(missingSymbols(guide.surface(), source.exports())).toEqual([])
			})

			it('exposes every source export through its barrel', () => {
				expect(missingSymbols(source.exports(), source.surface())).toEqual([])
			})

			it('declares every barrel symbol directly', () => {
				expect(missingSymbols(source.surface(), source.exports())).toEqual([])
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
					.flatMap((fence) => fenceImports(fence.code))
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
// case below runs one guide fence and asserts the values that fence's own comments claim, so a
// fence that goes stale reddens here instead of shipping. A fence naming a browser, a spawned
// process, or a real registry is not transcribed: this project runs in Node with the browser
// disabled, and a proof that spawns belongs in a project of its own.
describe('guide fences', () => {
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
})
