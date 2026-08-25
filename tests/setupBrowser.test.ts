import { describe, expect, it } from 'vitest'
import { buildFixture, resetFixtures } from './setupBrowser.js'

// This proof runs in the `setup` project, which is Node with the browser disabled. `buildFixture`
// rendering markup through `render`, and `buildStylesheet` touching `document.head`, both need a
// real DOM, so their DOM-driving behavior is proven where a DOM exists: the browser suites that
// consume them, chiefly tests/src/browser/helpers.test.ts and every fixture built through them
// across tests/src/browser/**. What this module carries that needs no host at all: `resetFixtures`
// walking an empty record without touching the DOM, and `buildFixture` refusing to run at all
// where no DOM host resolved `render` — both proven below.
describe('resetFixtures', () => {
	it('returns without touching the DOM when no fixture was built', () => {
		expect(() => resetFixtures()).not.toThrow()
	})

	it('is idempotent on an already-empty record', () => {
		resetFixtures()
		expect(() => resetFixtures()).not.toThrow()
	})
})

describe('buildFixture', () => {
	it('refuses to run outside a DOM host', () => {
		expect(() => buildFixture('<p>Ready</p>')).toThrow('buildFixture requires a DOM host')
	})
})
