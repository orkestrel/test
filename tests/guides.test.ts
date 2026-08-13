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
import { requireValue, resolveRoot } from '@src/core'
import { readInventory } from '@src/server'

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
					.patterns()
					.flatMap((fence) => fenceImports(fence))
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
