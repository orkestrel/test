import { describe, expect, it } from 'vitest'
import { buildFixture, buildStylesheet, resetFixtures } from './setupBrowser.js'

// This proof runs in the `setup:browser` project, a browser project where a real DOM exists, so
// every case here drives that DOM directly rather than proving a Node fallback.
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
	it('renders markup into an attached container reachable by querySelector', () => {
		const container = buildFixture('<p data-testid="ready">Ready</p>')
		expect(document.body.contains(container)).toBe(true)
		expect(document.querySelector('[data-testid="ready"]')?.textContent).toBe('Ready')
		resetFixtures()
	})

	it('records the container so resetFixtures removes it', () => {
		const container = buildFixture('<p data-testid="tracked">Tracked</p>')
		resetFixtures()
		expect(document.body.contains(container)).toBe(false)
		expect(document.querySelector('[data-testid="tracked"]')).toBeNull()
	})
})

describe('buildStylesheet', () => {
	it('attaches a style element to document.head', () => {
		const sheet = buildStylesheet('.card { color: red }')
		expect(document.head.contains(sheet)).toBe(true)
		expect(sheet.tagName).toBe('STYLE')
		expect(sheet.textContent).toBe('.card { color: red }')
		resetFixtures()
	})

	it('records the style element so resetFixtures removes it', () => {
		const sheet = buildStylesheet('.badge { color: blue }')
		resetFixtures()
		expect(document.head.contains(sheet)).toBe(false)
	})
})
