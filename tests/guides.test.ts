import { describe, expect, it } from 'vitest'
import {
	createGuide,
	createSource,
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

describe('guides parity', () => {
	it('parses a non-empty manifest', () => {
		expect(manifest.length).toBeGreaterThan(0)
	})

	for (const entry of manifest) {
		describe(`${entry.concept}`, () => {
			const guide = createGuide(requireValue(files[entry.spec], `Missing guide: ${entry.spec}`))
			const source = createSource({ files, module: entry.source })

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

			it('extracts non-vacuous surface and methods', () => {
				expect(guide.surface().length).toBeGreaterThan(0)
				for (const group of guide.methods()) {
					expect(group.methods.length).toBeGreaterThan(0)
				}
			})
		})
	}
})
