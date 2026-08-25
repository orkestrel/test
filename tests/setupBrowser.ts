import type { render as RenderFunction } from '@src/browser'

// Every fixture a test builds is recorded here so one call takes them all back out of the document.
// A browser test file shares one page, so a container left behind is a resolver ambiguity in the
// next test rather than a leak nobody notices.
const fixtures: Element[] = []

// `@src/browser` re-exports `src/browser/helpers.ts`, which imports `vitest/browser` at module
// scope; that import throws unconditionally outside Browser Mode. The `setup` project runs this
// file in Node, where `document` is undefined, so the load below never runs there and this module
// never reaches `vitest/browser`. A browser project registers this file as a setup file, where
// Vitest awaits a setup file's top-level evaluation — including a top-level `await` — before
// running any test in that file, so `render` is resolved before `buildFixture` is ever called.
let render: typeof RenderFunction | undefined
if (typeof document !== 'undefined') {
	;({ render } = await import('@src/browser'))
}

/**
 * Renders fixture markup into a recorded container attached to the document.
 *
 * @param markup - The fixture markup to render.
 * @returns The attached container.
 * @throws When no DOM host provided `render`, which only a browser project's setup does.
 * @example
 * ```ts
 * const container = buildFixture('<button type="button">Save</button>')
 * ```
 */
export function buildFixture(markup: string): HTMLDivElement {
	if (!render) throw new Error('buildFixture requires a DOM host')
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
