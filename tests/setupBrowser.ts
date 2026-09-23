import { render } from '@src/browser'

// Every fixture a test builds is recorded here so one call takes them all back out of the document.
// A browser test file shares one page, so a container left behind is a resolver ambiguity in the
// next test rather than a leak nobody notices.
const fixtures: Element[] = []

/**
 * Lists the inline styles a clipping predicate reads and whether each clips a descendant's vertical
 * overflow: the overflow keywords on each axis and the containment values, the default first.
 */
export const CLIP_CASES: ReadonlyArray<{ readonly style: string; readonly clips: boolean }> =
	Object.freeze([
		Object.freeze({ style: '', clips: false }),
		Object.freeze({ style: 'overflow: visible', clips: false }),
		Object.freeze({ style: 'overflow: clip', clips: true }),
		Object.freeze({ style: 'overflow: hidden', clips: true }),
		Object.freeze({ style: 'overflow: auto', clips: true }),
		Object.freeze({ style: 'overflow: scroll', clips: true }),
		Object.freeze({ style: 'overflow-x: clip', clips: false }),
		Object.freeze({ style: 'overflow-y: clip', clips: true }),
		Object.freeze({ style: 'contain: layout', clips: false }),
		Object.freeze({ style: 'contain: paint', clips: true }),
		Object.freeze({ style: 'contain: content', clips: true }),
		Object.freeze({ style: 'contain: strict', clips: true }),
	])

/**
 * Lists the inline styles a clip-margin reader measures and the margin each yields: the `clip`
 * overflow and the paint containment carry their margin, a keyword beside the length included, and
 * the other overflows and a bare margin yield nothing.
 */
export const CLIP_MARGIN_CASES: ReadonlyArray<{ readonly style: string; readonly margin: number }> =
	Object.freeze([
		Object.freeze({ style: 'overflow: clip; overflow-clip-margin: 20px', margin: 20 }),
		Object.freeze({ style: 'contain: paint; overflow-clip-margin: 20px', margin: 20 }),
		Object.freeze({ style: 'overflow: clip; overflow-clip-margin: content-box 20px', margin: 20 }),
		Object.freeze({ style: 'overflow: clip', margin: 0 }),
		Object.freeze({ style: 'overflow: hidden; overflow-clip-margin: 20px', margin: 0 }),
		Object.freeze({ style: 'overflow: auto; overflow-clip-margin: 20px', margin: 0 }),
		Object.freeze({ style: 'overflow-clip-margin: 20px', margin: 0 }),
	])

/**
 * Lists the inline styles a clip-edge reader measures over a frame styled `height: 400px;
 * padding-bottom: 20px; border-bottom: 3px solid`, and the row each clip edge sits on counted from
 * the frame's top: a `hidden` or scrolling overflow stops at the padding box whatever its clip
 * margin, a `clip` overflow and a paint containment expand the box their clip margin selects (the
 * padding box by default), and a frame that clips nothing has no edge.
 */
export const CLIP_EDGE_CASES: ReadonlyArray<{
	readonly style: string
	readonly edge: number | undefined
}> = Object.freeze([
	Object.freeze({ style: 'overflow: hidden', edge: 420 }),
	Object.freeze({ style: 'overflow: auto; overflow-clip-margin: 100px', edge: 420 }),
	Object.freeze({ style: 'overflow: clip', edge: 420 }),
	Object.freeze({ style: 'overflow: clip; overflow-clip-margin: 100px', edge: 520 }),
	Object.freeze({ style: 'overflow: clip; overflow-clip-margin: content-box 100px', edge: 500 }),
	Object.freeze({ style: 'overflow: clip; overflow-clip-margin: border-box 100px', edge: 523 }),
	Object.freeze({ style: 'contain: paint; overflow-clip-margin: content-box 100px', edge: 500 }),
	Object.freeze({ style: '', edge: undefined }),
])

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
