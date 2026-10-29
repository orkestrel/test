import type { CaptureVariant } from '@src/browser'
import type { StateScenario } from '@src/core'
import { requireValue } from '@src/core'
import { TestValue } from './setup.js'
import { clickAccessible, clickDisclosure, readStates, render } from '@src/browser'

/** Lists native file-input arrangements that a journey must refuse before activation. */
export const FILE_REFUSALS = Object.freeze([
	{
		name: 'hidden',
		markup: '<label hidden>Attachments<input type="file"></label>',
		message: 'Native file target "Attachments" is not visible and focus-reachable',
	},
	{
		name: 'disabled',
		markup: '<label>Attachments<input type="file" disabled></label>',
		message: 'Native file target "Attachments" is not visible and focus-reachable',
	},
	{
		name: 'duplicate',
		markup:
			'<label>Attachments<input type="file"></label><label>Attachments<input type="file"></label>',
		message: 'Native file target "Attachments" is ambiguous across 2 elements',
	},
	{
		name: 'inactive modal',
		markup:
			'<label>Attachments<input type="file"></label><section role="dialog" aria-modal="true"><button>Close</button></section>',
		message: 'Native file target "Attachments" is not visible and focus-reachable',
	},
	{
		name: 'not focusable',
		markup: '<label>Attachments<input type="file" tabindex="-1"></label>',
		message: 'Native file target "Attachments" is not visible and focus-reachable',
	},
	{
		name: 'wrong control',
		markup: '<label>Attachments<input type="text"></label>',
		message: 'No native file input has the accessible name "Attachments"',
	},
])

/** Builds labeled native file inputs for chooser proofs and records their cleanup. */
export function buildFileFixture(): {
	readonly input: HTMLInputElement
	readonly other: HTMLInputElement
} {
	const container = buildFixture(
		'<label>Attachments<input type="file" multiple></label><label>Other files<input type="file"></label>',
	)
	const [input, other] = container.querySelectorAll('input')
	if (input === undefined || other === undefined) throw new Error('Missing file fixture inputs')
	return { input, other }
}

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
 * Lists the inline styles a clip-edge reader measures over a frame with the
 * `height: 400px; padding-bottom: 20px; border-bottom: 3px solid` style, and the row each clip edge
 * sits on counted from the frame's top: a hidden or scrolling overflow stops at the padding box
 * whatever its clip margin, a `clip` overflow and a paint containment over a `visible` overflow
 * expand the box their clip margin selects (the padding box by default), and a frame that clips
 * nothing has no edge.
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

/** Lists the window size each capture variant renders at, keyed by its own descriptive name. */
export const VARIANTS: readonly CaptureVariant[] = Object.freeze([
	Object.freeze({ name: 'light-1440', width: 1440, height: 1000 }),
	Object.freeze({ name: 'dark-390', width: 390, height: 844 }),
])

/** Lists the states a store fixture builds against, in the order a portfolio walks them. */
export const STATES: readonly string[] = Object.freeze(['start-empty', 'answer-ideal'])

/**
 * Lists every tag whose implicit role a name computation reads from the markup rather than from an
 * explicit `role` attribute, and the markup and role each row proves.
 *
 * The expectations here are written out rather than read back from the constants, so a case that
 * disagrees with the map reddens instead of re-deriving the map's own answer. The membership
 * assertions beside them are what make the tables and the maps fail together.
 */
export const IMPLICIT_ROLE_CASES: ReadonlyArray<{
	readonly tag: string
	readonly markup: string
	readonly role: string
}> = Object.freeze([
	Object.freeze({
		tag: 'ARTICLE',
		markup: '<article id="subject">Body</article>',
		role: 'article',
	}),
	Object.freeze({
		tag: 'ASIDE',
		markup: '<aside id="subject">Body</aside>',
		role: 'complementary',
	}),
	Object.freeze({
		tag: 'BUTTON',
		markup: '<button id="subject" type="button">Save</button>',
		role: 'button',
	}),
	Object.freeze({
		tag: 'DIALOG',
		markup: '<dialog id="subject" open>Body</dialog>',
		role: 'dialog',
	}),
	Object.freeze({
		tag: 'FIELDSET',
		markup: '<fieldset id="subject"><legend>Range</legend></fieldset>',
		role: 'group',
	}),
	Object.freeze({
		tag: 'FOOTER',
		markup: '<footer id="subject">Body</footer>',
		role: 'contentinfo',
	}),
	Object.freeze({ tag: 'FORM', markup: '<form id="subject"></form>', role: 'form' }),
	Object.freeze({ tag: 'H1', markup: '<h1 id="subject">Totals</h1>', role: 'heading' }),
	Object.freeze({ tag: 'H2', markup: '<h2 id="subject">Totals</h2>', role: 'heading' }),
	Object.freeze({ tag: 'H3', markup: '<h3 id="subject">Totals</h3>', role: 'heading' }),
	Object.freeze({ tag: 'H4', markup: '<h4 id="subject">Totals</h4>', role: 'heading' }),
	Object.freeze({ tag: 'H5', markup: '<h5 id="subject">Totals</h5>', role: 'heading' }),
	Object.freeze({ tag: 'H6', markup: '<h6 id="subject">Totals</h6>', role: 'heading' }),
	Object.freeze({ tag: 'HEADER', markup: '<header id="subject">Body</header>', role: 'banner' }),
	Object.freeze({ tag: 'HR', markup: '<hr id="subject">', role: 'separator' }),
	Object.freeze({ tag: 'IMG', markup: '<img id="subject" alt="Chart">', role: 'img' }),
	Object.freeze({ tag: 'LI', markup: '<ul><li id="subject">One</li></ul>', role: 'listitem' }),
	Object.freeze({ tag: 'MAIN', markup: '<main id="subject">Body</main>', role: 'main' }),
	Object.freeze({ tag: 'NAV', markup: '<nav id="subject">Body</nav>', role: 'navigation' }),
	Object.freeze({ tag: 'OL', markup: '<ol id="subject"><li>One</li></ol>', role: 'list' }),
	Object.freeze({
		tag: 'OPTION',
		markup: '<select><option id="subject">One</option></select>',
		role: 'option',
	}),
	Object.freeze({ tag: 'OUTPUT', markup: '<output id="subject">7</output>', role: 'status' }),
	Object.freeze({
		tag: 'PROGRESS',
		markup: '<progress id="subject" value="1" max="2"></progress>',
		role: 'progressbar',
	}),
	Object.freeze({ tag: 'SEARCH', markup: '<search id="subject"></search>', role: 'search' }),
	Object.freeze({
		tag: 'SECTION',
		markup: '<section id="subject" aria-label="Ledger"></section>',
		role: 'region',
	}),
	Object.freeze({
		tag: 'SUMMARY',
		markup: '<details><summary id="subject">Advanced</summary></details>',
		role: 'button',
	}),
	Object.freeze({ tag: 'TABLE', markup: '<table id="subject"></table>', role: 'table' }),
	Object.freeze({
		tag: 'TBODY',
		markup: '<table><tbody id="subject"><tr><td>A</td></tr></tbody></table>',
		role: 'rowgroup',
	}),
	Object.freeze({
		tag: 'TD',
		markup: '<table><tbody><tr><td id="subject">A</td></tr></tbody></table>',
		role: 'cell',
	}),
	Object.freeze({ tag: 'TEXTAREA', markup: '<textarea id="subject"></textarea>', role: 'textbox' }),
	Object.freeze({
		tag: 'TH',
		markup: '<table><thead><tr><th id="subject">A</th></tr></thead></table>',
		role: 'columnheader',
	}),
	Object.freeze({
		tag: 'THEAD',
		markup: '<table><thead id="subject"><tr><th>A</th></tr></thead></table>',
		role: 'rowgroup',
	}),
	Object.freeze({
		tag: 'TR',
		markup: '<table><tbody><tr id="subject"><td>A</td></tr></tbody></table>',
		role: 'row',
	}),
	Object.freeze({ tag: 'UL', markup: '<ul id="subject"><li>One</li></ul>', role: 'list' }),
])

/** Lists every form-field `type` a name computation maps to an implicit role, and the role it maps to. */
export const FIELD_ROLE_CASES: ReadonlyArray<{ readonly type: string; readonly role: string }> =
	Object.freeze([
		Object.freeze({ type: 'button', role: 'button' }),
		Object.freeze({ type: 'checkbox', role: 'checkbox' }),
		Object.freeze({ type: 'email', role: 'textbox' }),
		Object.freeze({ type: 'number', role: 'spinbutton' }),
		Object.freeze({ type: 'password', role: 'textbox' }),
		Object.freeze({ type: 'radio', role: 'radio' }),
		Object.freeze({ type: 'range', role: 'slider' }),
		Object.freeze({ type: 'reset', role: 'button' }),
		Object.freeze({ type: 'search', role: 'searchbox' }),
		Object.freeze({ type: 'submit', role: 'button' }),
		Object.freeze({ type: 'tel', role: 'textbox' }),
		Object.freeze({ type: 'text', role: 'textbox' }),
		Object.freeze({ type: 'url', role: 'textbox' }),
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
 * Dispatches one event from a button inside an open shadow root and reports what a document
 * listener heard.
 *
 * @param event - The event to dispatch.
 * @returns The type of each event the `document` listener heard, in order.
 *
 * @remarks
 * A listener on the document hears the event only when it is composed, because the shadow boundary
 * stops every other event at the root. The host is a recorded fixture, and the listener is removed
 * before this returns, even when the dispatch throws.
 *
 * @example
 * ```ts
 * dispatchFromShadow(createPointerEvent('pointerdown')) // ['pointerdown']
 * ```
 */
export function dispatchFromShadow(event: Event): readonly string[] {
	const host = buildFixture('').appendChild(document.createElement('div'))
	const button = host.attachShadow({ mode: 'open' }).appendChild(document.createElement('button'))
	const heard: string[] = []
	const controller = new AbortController()
	document.addEventListener(
		event.type,
		(reached) => {
			heard.push(reached.type)
		},
		{ signal: controller.signal },
	)
	try {
		button.dispatchEvent(event)
	} finally {
		controller.abort()
	}
	return heard
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

// The worked statechart table `guides/test.md` § Patterns → "Drive a statechart table" carries. The
// entity is a native disclosure with a second door: the summary toggles it, and a Dismiss button
// closes it and does nothing when it is already closed. That second door is what gives the table a
// row whose event leaves the state unchanged, which a lone `<details>` cannot have.
export type DisclosureState = 'closed' | 'open'

export type DisclosureEvent = 'toggle' | 'dismiss'

export interface DisclosureContext {
	readonly verify: (actual: DisclosureState, expected: DisclosureState) => void
	readonly summary: HTMLElement
}

// The fixture the row before this one left on the page. A journey verb resolves its own target by
// accessible name, so two mounted disclosures called "Advanced" are an ambiguity rather than a
// second fixture: each build takes the previous one back out before rendering its own.
export const mounted = new TestValue<HTMLElement | undefined>(undefined)

export function buildDisclosure(
	verify: (actual: DisclosureState, expected: DisclosureState) => void,
): DisclosureContext {
	mounted.value?.remove()
	const container = buildFixture(
		'<details><summary>Advanced</summary><p>Every setting.</p></details><button type="button">Dismiss</button>',
	)
	const details = requireValue(container.querySelector('details'))
	requireValue(container.querySelector('button')).addEventListener('click', () => {
		details.open = false
	})
	mounted.value = container
	return { summary: requireValue(container.querySelector('summary')), verify }
}

export function readDisclosure(context: DisclosureContext): DisclosureState {
	return readStates(context.summary).includes('expanded') ? 'open' : 'closed'
}

export async function arrangeDisclosure(
	context: DisclosureContext,
	state: DisclosureState,
): Promise<void> {
	if (readDisclosure(context) !== state) await clickDisclosure('Advanced')
}

// The context is unused because a journey verb resolves its own target: the summary and the button
// are found by what a person reads, not by a node this row was handed.
export async function actOnDisclosure(
	_context: DisclosureContext,
	event: DisclosureEvent,
): Promise<void> {
	if (event === 'toggle') await clickDisclosure('Advanced')
	else await clickAccessible('Dismiss')
}

export function assertDisclosure(context: DisclosureContext, state: DisclosureState): void {
	context.verify(readDisclosure(context), state)
}

export const DISCLOSURE_SCENARIOS: ReadonlyArray<
	StateScenario<DisclosureState, DisclosureEvent, DisclosureContext>
> = [
	{
		transition: {
			name: 'closed opens through the summary',
			from: 'closed',
			event: 'toggle',
			to: 'open',
		},
		arrange: arrangeDisclosure,
		act: actOnDisclosure,
		assert: assertDisclosure,
	},
	{
		transition: {
			name: 'open closes through the summary',
			from: 'open',
			event: 'toggle',
			to: 'closed',
		},
		arrange: arrangeDisclosure,
		act: actOnDisclosure,
		assert: assertDisclosure,
	},
	{
		transition: {
			name: 'open closes through the button',
			from: 'open',
			event: 'dismiss',
			to: 'closed',
		},
		arrange: arrangeDisclosure,
		act: actOnDisclosure,
		assert: assertDisclosure,
	},
	{
		transition: {
			name: 'closed stays closed through the button',
			from: 'closed',
			event: 'dismiss',
			to: 'closed',
		},
		arrange: arrangeDisclosure,
		act: actOnDisclosure,
		assert: assertDisclosure,
	},
]

// One row whose `to` state the event cannot reach. Nothing about the row is malformed: the summary
// really does open the disclosure, so only `assert` can catch it.
export const MISMATCHED_SCENARIOS: ReadonlyArray<
	StateScenario<DisclosureState, DisclosureEvent, DisclosureContext>
> = [
	{
		transition: {
			name: 'the summary leaves it closed',
			from: 'closed',
			event: 'toggle',
			to: 'closed',
		},
		arrange: arrangeDisclosure,
		act: actOnDisclosure,
		assert: assertDisclosure,
	},
]

// The same table with the mismatched row second, so the rows after a failing row are observable.
export const MIXED_SCENARIOS: ReadonlyArray<
	StateScenario<DisclosureState, DisclosureEvent, DisclosureContext>
> = [
	requireValue(DISCLOSURE_SCENARIOS[0]),
	requireValue(MISMATCHED_SCENARIOS[0]),
	requireValue(DISCLOSURE_SCENARIOS[2]),
	requireValue(DISCLOSURE_SCENARIOS[3]),
]

export function applyDarkTheme(): void {
	document.documentElement.setAttribute('data-theme', 'dark')
}
