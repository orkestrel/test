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
import { requireValue, resolveRoot, retryUntil, waitForCondition } from '@src/core'
import { createCookieJar, createLoopback, readInventory } from '@src/server'

// The inventory comes from this package's own walker rather than a local one: `readInventory` is
// proved against raw `node:fs` fixtures in tests/src/server/helpers.test.ts, so here it is a
// consumer. A broken walk fails parity loudly with missing symbols instead of passing on an empty
// map, and the fleet's headline capability is exercised by the suite that depends on it.
const files = readInventory(resolveRoot(import.meta), ['src', 'tests', 'guides'], {
	extensions: ['.ts', '.md'],
})

const manifest = parseManifest(requireValue(files['guides/README.md']), 'guides')

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
