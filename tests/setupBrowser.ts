import { render } from '@src/browser'

// Every fixture a test builds is recorded here so one call takes them all back out of the document.
// A browser test file shares one page, so a container left behind is a resolver ambiguity in the
// next test rather than a leak nobody notices.
const fixtures: Element[] = []

/**
 * Renders fixture markup into a recorded container attached to the document.
 *
 * @param markup - The fixture markup to render.
 * @returns The attached container.
 * @example
 * ```ts
 * const container = buildFixture('<button type="button">Save</button>')
 * ```
 */
export function buildFixture(markup: string): HTMLDivElement {
	const container = render(markup)
	fixtures.push(container)
	return container
}

/**
 * Adds a recorded stylesheet to the document head.
 *
 * @param css - The stylesheet text.
 * @returns The attached style element.
 * @example
 * ```ts
 * buildStylesheet('.card { color: red }')
 * ```
 */
export function buildStylesheet(css: string): HTMLStyleElement {
	const sheet = document.createElement('style')
	sheet.textContent = css
	document.head.append(sheet)
	fixtures.push(sheet)
	return sheet
}

/**
 * Removes every fixture built since the last reset.
 *
 * @example
 * ```ts
 * afterEach(resetFixtures)
 * ```
 */
export function resetFixtures(): void {
	for (const fixture of fixtures.splice(0)) fixture.remove()
}
