import type { CaptureVariant } from '@src/browser'
import type { StateScenario } from '@src/core'
import { createRecorder, requireValue, waitForCondition } from '@src/core'
import { TestValue } from './setup.js'
import {
	clickAccessible,
	clickDisclosure,
	collectClippingAncestors,
	readClipEdge,
	readAccessibilityNode,
	readName,
	readPixels,
	readStates,
	readStyle,
	render,
	sendProtocol,
	settleCapture,
	waitForFrame,
	waitForStability,
} from '@src/browser'
import { page } from 'vitest/browser'

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

/**
 * Holds the stylesheet of a viewport-height shell: a 60-row red header over a main column that
 * takes the rest of the viewport and scrolls its 100-row blue rows, on a green root.
 */
export const SHELL_SHEET =
	'html { background: rgb(0, 128, 0) } body { margin: 0 }' +
	' .shell { display: flex; flex-direction: column; height: 100vh }' +
	' .header { flex: none; height: 60px; background: rgb(255, 0, 0) }' +
	' .main { flex: 1; min-height: 0; overflow: auto }' +
	' .row { height: 100px; background: rgb(0, 0, 255) }'

/**
 * Holds the stylesheet of a viewport-height shell with panes side by side: a 60-row red header over
 * a 100-column sidebar and a main pane that takes the rest, each scrolling its own rows, with blue
 * `.fill` rows on a green root.
 */
export const PANES_SHEET =
	'html { background: rgb(0, 128, 0) } body { margin: 0 }' +
	' .shell { display: flex; flex-direction: column; height: 100vh }' +
	' .header { flex: none; height: 60px; background: rgb(255, 0, 0) }' +
	' .panes { display: flex; flex: 1; min-height: 0 }' +
	' .side { width: 100px; overflow: auto } .main { flex: 1; min-height: 0; overflow: auto }' +
	' .fill { background: rgb(0, 0, 255) }'

/**
 * Lists the shadow-hosted main panes a side-by-side shell is built with: a host whose own overflow
 * scrolls the rows its shadow root holds, and a host whose shadow scroller wraps a slot that the
 * host's light rows are assigned to. Each pane lays out 1600 blue rows.
 */
export const SHADOW_PANES: ReadonlyArray<{
	readonly name: string
	readonly host: string
	readonly shadow: string
}> = Object.freeze([
	Object.freeze({
		name: 'rows in its shadow root',
		host: '<main class="main" id="host"></main>',
		shadow: '<div style="height: 1600px; background: rgb(0, 0, 255)"></div>',
	}),
	Object.freeze({
		name: 'slotted rows under a shadow scroller',
		host: '<div id="host" style="flex: 1; min-height: 0"><div style="height: 1600px; background: rgb(0, 0, 255)"></div></div>',
		shadow: '<div style="height: 100%; overflow: auto"><slot></slot></div>',
	}),
])

/**
 * Lists the inline styles a fixed-containment reader judges, and whether each makes the element
 * the containing block of the fixed-position boxes inside it.
 */
export const FIXED_CASES: ReadonlyArray<{ readonly style: string; readonly contains: boolean }> =
	Object.freeze([
		Object.freeze({ style: 'transform: translateZ(0)', contains: true }),
		Object.freeze({ style: 'perspective: 100px', contains: true }),
		Object.freeze({ style: 'filter: blur(1px)', contains: true }),
		Object.freeze({ style: 'contain: paint', contains: true }),
		Object.freeze({ style: 'contain: layout', contains: true }),
		Object.freeze({ style: 'will-change: transform', contains: true }),
		Object.freeze({ style: 'will-change: perspective', contains: true }),
		Object.freeze({ style: 'will-change: filter', contains: true }),
		Object.freeze({ style: 'translate: 1px', contains: true }),
		Object.freeze({ style: 'rotate: 1deg', contains: true }),
		Object.freeze({ style: 'scale: 2', contains: true }),
		Object.freeze({ style: 'container-type: size', contains: true }),
		Object.freeze({ style: 'container-type: inline-size', contains: true }),
		Object.freeze({ style: 'content-visibility: auto', contains: true }),
		Object.freeze({ style: 'transform-style: preserve-3d', contains: true }),
		Object.freeze({ style: 'backdrop-filter: blur(1px)', contains: true }),
		Object.freeze({ style: 'contain: strict', contains: true }),
		Object.freeze({ style: 'contain: content', contains: true }),
		Object.freeze({ style: 'position: relative', contains: false }),
		Object.freeze({ style: 'will-change: opacity', contains: false }),
		Object.freeze({ style: '', contains: false }),
	])

/** Holds the markup of a viewport-height shell whose main column lays out twenty rows. */
export const SHELL_MARKUP = `<div class="shell"><header class="header">Header</header><main class="main">${'<div class="row"></div>'.repeat(20)}</main></div>`

/** Holds the sheet the banded document needs: no body margin, and bands 400 rows tall. */
export const BANDS_SHEET = 'body { margin: 0 } .band { height: 400px }'

/**
 * Holds a document of five 400-row bands, red, green, blue, yellow, and purple from the top, so the
 * colors a frame's first and last rows paint name the scroll the frame was shot at.
 */
export const BANDS_MARKUP = [
	'<div class="band" style="background: rgb(255, 0, 0)"></div>',
	'<div class="band" style="background: rgb(0, 128, 0)"></div>',
	'<div class="band" style="background: rgb(0, 0, 255)"></div>',
	'<div class="band" style="background: rgb(255, 255, 0)"></div>',
	'<div class="band" style="background: rgb(128, 0, 128)"></div>',
].join('')

/**
 * Holds the sheet of the settle fixtures: a stage, a spinner that turns forever, a control whose
 * hover fill transitions, and a box whose opacity transitions from full to half.
 */
export const SETTLE_SHEET =
	'.settle-stage { width: 160px; height: 100px; padding: 10px; background: rgb(250, 250, 250) }' +
	'@keyframes settle-spin { to { transform: rotate(360deg) } }' +
	'.settle-spin { width: 40px; height: 40px; background: linear-gradient(90deg, rgb(255, 0, 0), rgb(0, 0, 255)); animation: settle-spin 900ms linear infinite }' +
	'.settle-hover { width: 120px; height: 30px; border: 0; background-color: rgb(255, 255, 255); transition: background-color 150ms linear }' +
	'.settle-hover:hover { background-color: rgb(200, 0, 0) }' +
	'.settle-end { width: 60px; height: 20px; opacity: 1; background-color: rgb(0, 0, 255); transition: opacity 120ms linear }'

/**
 * Holds the markup of each settle fixture, a stage around one subject, keyed by what the settle
 * meets: an endless animation to hold, a hover to clear, and a transition whose end a listener can
 * finalize.
 */
export const SETTLE_MARKUP = Object.freeze({
	held: '<div class="settle-stage"><div class="settle-spin"></div></div>',
	hover:
		'<div class="settle-stage"><button class="settle-hover" type="button">Hover target</button></div>',
	end: '<div class="settle-stage"><div class="settle-end"></div></div>',
})

/**
 * Starts the end fixture's opacity transition from rest.
 *
 * @param element - The rendered `.settle-end` box of `SETTLE_MARKUP.end`.
 * @param final - If `true`, a `transitionend` listener grows the box to 60 pixels tall and paints
 * it green when the transition ends; if `false`, nothing listens.
 * @throws Thrown when the box is not at full opacity, because the change would start no transition.
 *
 * @example
 * ```ts
 * startTransition(requireValue(stage.querySelector<HTMLElement>('.settle-end')), true)
 * ```
 */
export function startTransition(element: HTMLElement, final: boolean): void {
	if (readStyle(element, 'opacity') !== '1') throw new Error('Settle box must rest at full opacity')
	if (final) {
		element.addEventListener(
			'transitionend',
			() => {
				element.style.height = '60px'
				element.style.backgroundColor = 'rgb(0, 128, 0)'
			},
			{ once: true },
		)
	}
	element.style.opacity = '0.5'
}

/**
 * Removes every recorded fixture, then builds the end fixture with its sheet and starts its
 * transition with the final listener attached.
 *
 * @remarks
 * It returns nothing, so a bench passes it as a `beforeEach` hook; read the stage and the box from
 * the document by their `.settle-stage` and `.settle-end` classes.
 *
 * @example
 * ```ts
 * bench('settle', { beforeEach: restartTransition }, () => settleCapture())
 * ```
 */
export function restartTransition(): void {
	resetFixtures()
	buildStylesheet(SETTLE_SHEET)
	startTransition(
		requireValue(buildFixture(SETTLE_MARKUP.end).querySelector<HTMLElement>('.settle-end')),
		true,
	)
}

/**
 * Holds the sheet of the motion fixtures: a stage, a panel that slides in over 300 milliseconds, a
 * scroll region that lands on its target smoothly, a badge, a card whose entrance animation runs
 * one time, and a hero painted by the state its stage fixed at mount. Under reduced motion the slide,
 * the smooth landing, and the entrance are removed, and the badge paints grey at rest.
 */
export const MOTION_SHEET =
	'.motion-stage { position: relative; width: 200px; height: 140px; overflow: hidden; background-color: rgb(250, 250, 250) }' +
	'.motion-panel { position: absolute; top: 0; bottom: 0; left: 0; width: 120px; background-color: rgb(0, 96, 160); transform: translateX(-100%); transition: transform 300ms ease-out }' +
	'.motion-panel.motion-open { transform: none }' +
	'.motion-region { position: relative; height: 140px; overflow: auto; scroll-behavior: smooth }' +
	'.motion-row { height: 60px; border-bottom: 1px solid rgb(200, 200, 200) }' +
	'.motion-target { background-color: rgb(255, 200, 0) }' +
	'.motion-badge { width: 80px; height: 30px; background-color: rgb(0, 0, 255) }' +
	'@keyframes motion-enter { from { opacity: 0; transform: translateY(12px) } }' +
	'.motion-card { width: 120px; height: 60px; background-color: rgb(0, 128, 0); animation: motion-enter 400ms ease-out }' +
	'.motion-hero { width: 120px; height: 60px; background-color: rgb(255, 160, 0) }' +
	".motion-stage[data-motion='reduce'] .motion-hero { background-color: rgb(128, 128, 128) }" +
	'@media (prefers-reduced-motion: reduce) {' +
	' .motion-panel { transition: none }' +
	' .motion-region { scroll-behavior: auto }' +
	' .motion-card { animation: none }' +
	' .motion-badge { background-color: rgb(128, 128, 128) }' +
	' }'

/**
 * Holds the markup of each motion fixture, a stage around one subject, keyed by what reduced motion
 * changes: the panel's slide, the region's landing, the badge's paint at rest, the card's entrance,
 * and the hero's state, which the stage's empty `data-motion` attribute asks to be fixed at mount.
 */
export const MOTION_MARKUP = Object.freeze({
	panel: '<div class="motion-stage"><div class="motion-panel"></div></div>',
	landing: `<div class="motion-stage"><div class="motion-region">${'<div class="motion-row"></div>'.repeat(8)}<div class="motion-row motion-target"></div>${'<div class="motion-row"></div>'.repeat(3)}</div></div>`,
	rule: '<div class="motion-stage"><div class="motion-badge"></div></div>',
	entrance: '<div class="motion-stage"><div class="motion-card"></div></div>',
	mount: '<div class="motion-stage" data-motion><div class="motion-hero"></div></div>',
})

/**
 * Lists the fixtures whose frame a run under reduced motion matches after it restores motion,
 * each with the subject's resolved property under default motion and under reduced motion.
 */
export const MOTION_CASES: ReadonlyArray<{
	readonly fixture: 'panel' | 'landing' | 'rule' | 'entrance'
	readonly subject: string
	readonly property: string
	readonly full: string
	readonly reduced: string
}> = Object.freeze([
	Object.freeze({
		fixture: 'panel',
		subject: '.motion-panel',
		property: 'transition-duration',
		full: '0.3s',
		reduced: '0s',
	}),
	Object.freeze({
		fixture: 'landing',
		subject: '.motion-region',
		property: 'scroll-behavior',
		full: 'smooth',
		reduced: 'auto',
	}),
	Object.freeze({
		fixture: 'rule',
		subject: '.motion-badge',
		property: 'background-color',
		full: 'rgb(0, 0, 255)',
		reduced: 'rgb(128, 128, 128)',
	}),
	Object.freeze({
		fixture: 'entrance',
		subject: '.motion-card',
		property: 'animation-name',
		full: 'motion-enter',
		reduced: 'none',
	}),
])

/**
 * Removes every recorded fixture, then mounts one motion fixture with its sheet and navigates it the
 * way a journey reaches its state.
 *
 * @param markup - One of the `MOTION_MARKUP` fixtures.
 * @returns The rendered `.motion-stage` element.
 * @throws Thrown when the markup holds no `.motion-stage`, when a region holds no `.motion-target`,
 * and when a region does not hold its target's offset within 2000 milliseconds.
 *
 * @remarks
 * A stage carrying `data-motion` records the reduced-motion query at mount, as `reduce` or `full`,
 * and keeps it. After one frame every panel opens, and every region scrolls to its target and is
 * waited on until it holds the target's offset, because the settle waits out animations and no
 * scroll. Every motion the act starts under default motion is left running for the settle.
 *
 * @example
 * ```ts
 * const stage = await navigateMotion(MOTION_MARKUP.panel)
 * ```
 */
export async function navigateMotion(markup: string): Promise<HTMLElement> {
	resetFixtures()
	buildStylesheet(MOTION_SHEET)
	const stage = requireValue(
		buildFixture(markup).querySelector<HTMLElement>('.motion-stage'),
		'Motion fixture holds no .motion-stage',
	)
	if (stage.hasAttribute('data-motion')) {
		stage.dataset.motion = matchMedia('(prefers-reduced-motion: reduce)').matches
			? 'reduce'
			: 'full'
	}
	await waitForFrame()
	for (const panel of stage.querySelectorAll('.motion-panel')) panel.classList.add('motion-open')
	for (const region of stage.querySelectorAll<HTMLElement>('.motion-region')) {
		const top = requireValue(
			region.querySelector<HTMLElement>('.motion-target'),
			'Motion region holds no .motion-target',
		).offsetTop
		region.scrollTop = top
		await waitForCondition('the motion region holds its landing', () => region.scrollTop === top, {
			budget: 2000,
		})
	}
	return stage
}

/**
 * Settles the page and shoots one element, resuming the held animations on every path.
 *
 * @param element - The rendered element to shoot.
 * @returns The provider's screenshot of the element as base64 PNG bytes, unsaved.
 * @throws Thrown when the settle refuses, as `settleCapture` raises it with a 2000 millisecond
 * budget, and when the provider cannot shoot the element.
 *
 * @example
 * ```ts
 * const frame = await shootSettled(await navigateMotion(MOTION_MARKUP.rule))
 * ```
 */
export async function shootSettled(element: Element): Promise<string> {
	const resume = await settleCapture({ budget: 2000 })
	try {
		return await page.screenshot({ element, save: false })
	} finally {
		resume()
	}
}

/** Lists the window size each capture variant renders at, keyed by its own descriptive name. */
export const VARIANTS: readonly CaptureVariant[] = Object.freeze([
	Object.freeze({ name: 'light-1440', width: 1440, height: 1000 }),
	Object.freeze({ name: 'dark-390', width: 390, height: 844 }),
])

/** Lists the states a store fixture builds against, in the order a portfolio walks them. */
export const STATES: readonly string[] = Object.freeze(['start-empty', 'answer-ideal'])

/**
 * Computes the document's content edge by climbing each element's clipping ancestors on its own,
 * with no bound shared between elements.
 *
 * @returns The largest bottom edge, in document coordinates, plus its own bottom margin, of every
 * element in the body, each capped at the clip edge `readClipEdge` measures on every clipping
 * ancestor below the body, plus the body's and the root's bottom padding and margin, rounded up.
 * @remarks This is the reading `measureContent` took before its clip bounds shared one memo, kept as
 * the second mechanism its proofs and its bench compare the shipped reading with.
 * @example
 * ```ts
 * expect(measureContent()).toBe(climbContentEdge())
 * ```
 */
export function climbContentEdge(): number {
	const edge = Array.from(document.body.querySelectorAll('*')).reduce((greatest, element) => {
		const bottom = Math.min(
			element.getBoundingClientRect().bottom +
				window.scrollY +
				readPixels(element, 'margin-bottom'),
			...collectClippingAncestors(element)
				.filter((frame) => frame !== document.body && frame !== document.documentElement)
				.flatMap((frame) => {
					const limit = readClipEdge(frame)
					return limit === undefined ? [] : [limit]
				}),
		)
		return bottom > greatest ? bottom : greatest
	}, 0)
	return Math.ceil(
		edge +
			readPixels(document.body, 'padding-bottom') +
			readPixels(document.body, 'margin-bottom') +
			readPixels(document.documentElement, 'padding-bottom') +
			readPixels(document.documentElement, 'margin-bottom'),
	)
}

/**
 * Records the element of every computed-style read the page makes while a reading runs.
 *
 * @param read - The reading to run.
 * @returns The element each `getComputedStyle` call named, in call order.
 * @throws Thrown when the window refuses the recording function in place of its own, and whatever
 * `read` throws.
 * @remarks The window's own `getComputedStyle` answers every call: the recording function notes
 * the element and forwards the call. The window's own function is put back on every path.
 * @example
 * ```ts
 * const reads = recordStyleReads(() => measureContent())
 * reads.filter((element) => element === frame).length // the reads of one frame
 * ```
 */
export function recordStyleReads(read: () => unknown): readonly Element[] {
	const original = window.getComputedStyle
	const reads = createRecorder<[element: Element]>()
	const installed = Reflect.set(
		window,
		'getComputedStyle',
		(element: Element, pseudo?: string | null) => {
			reads.handler(element)
			return original.call(window, element, pseudo)
		},
	)
	if (!installed) throw new Error('The window refused a recorder in place of getComputedStyle')
	try {
		read()
	} finally {
		Reflect.set(window, 'getComputedStyle', original)
	}
	return reads.calls.map(([element]) => element)
}

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
 * Lists the frames the name sweep reads a name through, each naming the element `#sweep-target`
 * from the word `Go` and what the frame holds.
 *
 * Every frame named the target from all of its text in 0.0.42, whichever path it takes: content (a
 * button, a link, a heading, a list item, a table cell), a label, and an `aria-labelledby` target,
 * shown or hidden.
 */
export const NAME_SWEEP_FRAMES: ReadonlyArray<{ readonly open: string; readonly close: string }> =
	Object.freeze([
		Object.freeze({ open: '<button type="button" id="sweep-target">Go ', close: '</button>' }),
		Object.freeze({ open: '<a href="#sweep" id="sweep-target">Go ', close: '</a>' }),
		Object.freeze({ open: '<h2 id="sweep-target">Go ', close: '</h2>' }),
		Object.freeze({
			open: '<label for="sweep-target">Go ',
			close: '</label><input id="sweep-target">',
		}),
		Object.freeze({
			open: '<div id="sweep-caption">Go ',
			close:
				'</div><button type="button" id="sweep-target" aria-labelledby="sweep-caption">x</button>',
		}),
		Object.freeze({
			open: '<div id="sweep-caption" hidden>Go ',
			close:
				'</div><button type="button" id="sweep-target" aria-labelledby="sweep-caption">x</button>',
		}),
		Object.freeze({ open: '<ul><li id="sweep-target">Go ', close: '</li></ul>' }),
		Object.freeze({
			open: '<table><tbody><tr><td id="sweep-target">Go ',
			close: '</td></tr></tbody></table>',
		}),
	])

/**
 * Lists the wrappers the name sweep nests a leaf in, the empty wrapper first, with what 0.0.42 read
 * from each: `words` the wrapper itself adds before its content, and `muted` where 0.0.42 dropped the
 * wrapper's whole content, which it did for `aria-hidden` alone.
 */
export const NAME_SWEEP_WRAPPERS: ReadonlyArray<{
	readonly open: string
	readonly close: string
	readonly words: string
	readonly muted: boolean
}> = Object.freeze([
	Object.freeze({ open: '', close: '', words: '', muted: false }),
	Object.freeze({ open: '<span>', close: '</span>', words: '', muted: false }),
	Object.freeze({
		open: '<span style="display: none">',
		close: '</span>',
		words: '',
		muted: false,
	}),
	Object.freeze({
		open: '<span style="display: contents">',
		close: '</span>',
		words: '',
		muted: false,
	}),
	Object.freeze({
		open: '<span style="display: block">',
		close: '</span>',
		words: '',
		muted: false,
	}),
	Object.freeze({
		open: '<span style="display: inline-block">',
		close: '</span>',
		words: '',
		muted: false,
	}),
	Object.freeze({
		open: '<span style="visibility: hidden">',
		close: '</span>',
		words: '',
		muted: false,
	}),
	Object.freeze({
		open: '<span style="visibility: collapse">',
		close: '</span>',
		words: '',
		muted: false,
	}),
	Object.freeze({ open: '<span hidden>', close: '</span>', words: '', muted: false }),
	Object.freeze({
		open: '<span hidden style="display: inline">',
		close: '</span>',
		words: '',
		muted: false,
	}),
	Object.freeze({
		open: '<details open><summary>More</summary>',
		close: '</details>',
		words: 'More',
		muted: false,
	}),
	Object.freeze({
		open: '<details><summary>More</summary>',
		close: '</details>',
		words: 'More',
		muted: false,
	}),
	Object.freeze({ open: '<slot>', close: '</slot>', words: '', muted: false }),
	Object.freeze({
		open: '<span style="content-visibility: hidden">',
		close: '</span>',
		words: '',
		muted: false,
	}),
	Object.freeze({ open: '<span aria-hidden="true">', close: '</span>', words: '', muted: true }),
])

/**
 * Lists the leaves the name sweep names, each with the words 0.0.42 read from it: text, hidden text,
 * the svg naming elements in every placement of a hidden group or a hidden svg, svg text, an image's
 * alternative text, a select, and an input's value.
 */
export const NAME_SWEEP_LEAVES: ReadonlyArray<{ readonly markup: string; readonly old: string }> =
	Object.freeze([
		Object.freeze({ markup: 'now', old: 'now' }),
		Object.freeze({ markup: '<span style="display: contents">now</span>', old: 'now' }),
		Object.freeze({ markup: 'later<span style="display: none"> gone</span>', old: 'later gone' }),
		Object.freeze({
			markup:
				'A <span style="visibility: hidden">B <span style="visibility: visible">C</span></span>',
			old: 'A B C',
		}),
		Object.freeze({
			markup:
				'<svg width="10" height="10"><title>Home</title><rect width="5" height="5"></rect></svg>',
			old: 'Home',
		}),
		Object.freeze({
			markup:
				'<svg width="10" height="10"><desc>Icon</desc><rect width="5" height="5"></rect></svg>',
			old: 'Icon',
		}),
		Object.freeze({
			markup:
				'<svg width="10" height="10"><title>Home</title><desc>Icon</desc>' +
				'<rect width="5" height="5"></rect></svg>',
			old: 'Home Icon',
		}),
		Object.freeze({
			markup:
				'<svg width="10" height="10"><g style="display: none"><title>Hidden</title></g>' +
				'<desc>Fallback</desc><rect width="5" height="5"></rect></svg>',
			old: 'Hidden Fallback',
		}),
		Object.freeze({
			markup:
				'<svg width="10" height="10"><title>Home</title><g style="display: none">' +
				'<desc>Icon</desc></g><rect width="5" height="5"></rect></svg>',
			old: 'Home Icon',
		}),
		Object.freeze({
			markup:
				'<svg width="10" height="10"><g style="display: none"><title>Home</title>' +
				'<desc>Icon</desc></g><rect width="5" height="5"></rect></svg>',
			old: 'Home Icon',
		}),
		Object.freeze({
			markup:
				'<svg width="10" height="10" style="display: none"><title>Home</title>' +
				'<desc>Icon</desc><rect width="5" height="5"></rect></svg>',
			old: 'Home Icon',
		}),
		Object.freeze({
			markup: '<svg width="40" height="12"><text x="0" y="10">Chart</text></svg>',
			old: 'Chart',
		}),
		Object.freeze({
			markup: '<img alt="Logo" src="data:image/gif;base64,R0lGODlhAQABAAAAACw=">',
			old: '',
		}),
		Object.freeze({
			markup: '<select><option>Small</option><option selected>Large</option></select>',
			old: 'Small Large',
		}),
		Object.freeze({ markup: '<input value="Typed">', old: '' }),
	])

/**
 * Lists every name sweep fixture, a frame around two wrappers around a leaf, with the name 0.0.42
 * read for it, composed from what the table declares 0.0.42 read from each part.
 */
export const NAME_SWEEP_CASES: ReadonlyArray<{ readonly markup: string; readonly old: string }> =
	Object.freeze(
		NAME_SWEEP_LEAVES.flatMap((leaf) =>
			NAME_SWEEP_WRAPPERS.flatMap((inner) =>
				NAME_SWEEP_WRAPPERS.flatMap((outer) =>
					NAME_SWEEP_FRAMES.map((frame) =>
						Object.freeze({
							markup: `${frame.open}${outer.open}${inner.open}${leaf.markup}${inner.close}${outer.close}${frame.close}`,
							old: [
								'Go',
								...(outer.muted
									? []
									: [outer.words, ...(inner.muted ? [] : [inner.words, leaf.old])]),
							]
								.join(' ')
								.replaceAll(/\s+/g, ' ')
								.trim(),
						}),
					),
				),
			),
		),
	)

/**
 * Fixes the slice of the name sweep the default suite reads: the `count` indexes from `seed` in
 * steps of `stride` through {@link NAME_SWEEP_CASES}. The stride shares no factor with the table's
 * length, so no index repeats, and the same fixtures run every time.
 */
export const NAME_SWEEP = Object.freeze({ seed: 17, stride: 2399, count: 160 })

/**
 * Reads each name sweep fixture through `readName` and through the browser's own computation, and
 * rules it against the name 0.0.42 read.
 *
 * @param cases - The fixtures to read, each naming `#sweep-target`, with the name 0.0.42 read.
 * @returns One reading per fixture, in order: `regressed` where 0.0.42 read the browser's name and
 * the reader now does not, `improved` where the reader now reads it and 0.0.42 did not, and
 * `unchanged` otherwise. The browser's name has its whitespace runs collapsed, as the reader's are.
 * @example
 * ```ts
 * const readings = await readSweepNames(NAME_SWEEP_CASES.slice(0, 8))
 * ```
 */
export async function readSweepNames(
	cases: ReadonlyArray<{ readonly markup: string; readonly old: string }>,
): Promise<
	ReadonlyArray<{
		readonly markup: string
		readonly old: string
		readonly reading: string
		readonly computed: string
		readonly verdict: 'regressed' | 'improved' | 'unchanged'
	}>
> {
	const readings: Array<{
		readonly markup: string
		readonly old: string
		readonly reading: string
		readonly computed: string
		readonly verdict: 'regressed' | 'improved' | 'unchanged'
	}> = []
	for (const entry of cases) {
		const container = buildFixture(entry.markup)
		const target = requireValue(container.querySelector('#sweep-target'))
		const reading = readName(target)
		const computed = ((await readAccessibilityNode(target)).name ?? '')
			.replaceAll(/\s+/g, ' ')
			.trim()
		container.remove()
		const verdict =
			entry.old === computed && reading !== computed
				? 'regressed'
				: reading === computed && entry.old !== computed
					? 'improved'
					: 'unchanged'
		readings.push(Object.freeze({ ...entry, reading, computed, verdict }))
	}
	return Object.freeze(readings)
}

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

/** Holds the reason a pointer-media proof is skipped on a browser that keeps no pointer after touch. */
export const POINTER_RESTORATION =
	'Emulation.setTouchEmulationEnabled with enabled false leaves (pointer: none) matching rather than (pointer: fine), so no fine pointer returns for this proof to assert'

/**
 * Infers whether the browser restored a fine pointer from the pointer value it reads after touch
 * emulation ends.
 *
 * @param pointer - The `pointer` media value that matches, or `undefined` where none matches.
 * @returns True for `fine`; false for `none`.
 * @throws Thrown for any other reading, because a browser that ends touch emulation reads either.
 * @example
 * ```ts
 * inferPointerRestoration('none') // false
 * ```
 */
export function inferPointerRestoration(pointer: string | undefined): boolean {
	if (pointer === 'fine') return true
	if (pointer === 'none') return false
	throw new Error(
		`Pointer media reads ${pointer ?? 'no pointer value'} after touch emulation ends, where fine or none was expected`,
	)
}

/**
 * Checks whether the browser restores a fine pointer after touch emulation ends, by turning touch
 * emulation on and off again.
 *
 * @returns True where `(pointer: fine)` matches again; false where `(pointer: none)` holds.
 * @throws Thrown when the provider exposes no DevTools session, when touch emulation never reads
 * coarse or never ends, and when the reading after it ends is neither fine nor none.
 * @remarks Leaves touch emulation off. The reading is taken after it holds across painted frames.
 * @example
 * ```ts
 * const restored = await supportsPointerRestoration()
 * ```
 */
export async function supportsPointerRestoration(): Promise<boolean> {
	await sendProtocol('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 1 })
	await waitForCondition(
		'touch emulation reads coarse',
		() => matchMedia('(pointer: coarse)').matches,
	)
	await sendProtocol('Emulation.setTouchEmulationEnabled', { enabled: false })
	await waitForCondition('touch emulation ends', () => !matchMedia('(pointer: coarse)').matches)
	await waitForStability('pointer media after touch emulation ends', () =>
		String(readPointerMedia()),
	)
	return inferPointerRestoration(readPointerMedia())
}

/**
 * Reads which `pointer` media value the tester matches.
 *
 * @returns `fine`, `coarse`, or `none`, or `undefined` where none of them matches.
 * @example
 * ```ts
 * readPointerMedia() // 'fine'
 * ```
 */
export function readPointerMedia(): 'fine' | 'coarse' | 'none' | undefined {
	return (['fine', 'coarse', 'none'] as const).find(
		(value) => matchMedia(`(pointer: ${value})`).matches,
	)
}

/**
 * Skips the calling case, naming {@link POINTER_RESTORATION}, where the browser keeps no pointer
 * after touch emulation ends, as {@link supportsPointerRestoration} reads it.
 *
 * @param context - The calling case's context, whose `skip` carries the reason.
 * @example
 * ```ts
 * it('restores a fine pointer', async (context) => {
 * 	await skipUnrestoredPointer(context)
 * })
 * ```
 */
export async function skipUnrestoredPointer(context: {
	readonly skip: (condition: boolean, note?: string) => void
}): Promise<void> {
	context.skip(!(await supportsPointerRestoration()), POINTER_RESTORATION)
}
