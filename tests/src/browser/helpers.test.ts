import type { CaptureVariant, Color } from '@src/browser'
import type { JourneyVariant } from '@src/core'
import {
	ACCESSIBLE_ROLES,
	blendColor,
	build,
	buildCensus,
	buildContrast,
	buildDenial,
	buildEscapes,
	CANVAS_COLOR,
	CAPTURE_PANE,
	captureFrame,
	clearStorage,
	clickAccessible,
	clickAccessibleWithin,
	clickDisclosure,
	commitInput,
	computeNamePattern,
	convertSRGB,
	convertLinearSRGB,
	convertXYZD65,
	convertXYZD50,
	convertOKLab,
	convertLab,
	convertDisplayP3,
	convertA98RGB,
	convertProPhotoRGB,
	convertRec2020,
	describeFocus,
	describeTree,
	expandCaptures,
	extractOrphans,
	extractStyles,
	FIELD_ROLES,
	fillAccessible,
	findKeyframes,
	findRule,
	holdAccessible,
	hoverAccessible,
	IMPLICIT_ROLES,
	isOutsideViewport,
	isReachable,
	isRendered,
	matchesColor,
	MEDIA_STAGE,
	measureContent,
	measureContrast,
	measureLuminance,
	mount,
	parseColor,
	parseCSSColor,
	POINTER_HOLD,
	pressKeys,
	readBackdrop,
	readCascade,
	readCensus,
	readClasses,
	readContrast,
	readFocus,
	readFrame,
	readHit,
	readLayers,
	readName,
	readPage,
	readPerception,
	readPixels,
	readRefusal,
	readRing,
	readRole,
	readRootToken,
	readRows,
	readRules,
	readStates,
	readStyle,
	readText,
	readToken,
	readValue,
	releaseMedia,
	releasePane,
	releasePointer,
	removeDatabase,
	render,
	resolveAccessible,
	resolveRendered,
	sendProtocol,
	stageMedia,
	stagePane,
	traverseAccessible,
	typeAccessible,
	typeInput,
	waitForAnimations,
	waitForFrame,
	waitForState,
} from '@src/browser'
import { createRecorder, createTeardown, requireValue, waitForCondition } from '@src/core'
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest'
import { commands, page, server, userEvent } from 'vitest/browser'
import { rewriteWindowsAbsolutePath } from '../../setup.js'
import { buildFixture, buildStylesheet, resetFixtures } from '../../setupBrowser.js'

const VARIANTS: readonly CaptureVariant[] = [
	{ name: 'light-1440', width: 1440, height: 1000 },
	{ name: 'dark-390', width: 390, height: 844 },
]

// The expectations below are written out rather than read back from the constants, so a case that
// disagrees with the map reddens instead of re-deriving the map's own answer. The membership
// assertions beside them are what make the tables and the maps fail together.
const IMPLICIT_ROLE_CASES: ReadonlyArray<{
	readonly tag: string
	readonly markup: string
	readonly role: string
}> = [
	{ tag: 'ARTICLE', markup: '<article id="subject">Body</article>', role: 'article' },
	{ tag: 'ASIDE', markup: '<aside id="subject">Body</aside>', role: 'complementary' },
	{ tag: 'BUTTON', markup: '<button id="subject" type="button">Save</button>', role: 'button' },
	{ tag: 'DIALOG', markup: '<dialog id="subject" open>Body</dialog>', role: 'dialog' },
	{
		tag: 'FIELDSET',
		markup: '<fieldset id="subject"><legend>Range</legend></fieldset>',
		role: 'group',
	},
	{ tag: 'FOOTER', markup: '<footer id="subject">Body</footer>', role: 'contentinfo' },
	{ tag: 'FORM', markup: '<form id="subject"></form>', role: 'form' },
	{ tag: 'H1', markup: '<h1 id="subject">Totals</h1>', role: 'heading' },
	{ tag: 'H2', markup: '<h2 id="subject">Totals</h2>', role: 'heading' },
	{ tag: 'H3', markup: '<h3 id="subject">Totals</h3>', role: 'heading' },
	{ tag: 'H4', markup: '<h4 id="subject">Totals</h4>', role: 'heading' },
	{ tag: 'H5', markup: '<h5 id="subject">Totals</h5>', role: 'heading' },
	{ tag: 'H6', markup: '<h6 id="subject">Totals</h6>', role: 'heading' },
	{ tag: 'HEADER', markup: '<header id="subject">Body</header>', role: 'banner' },
	{ tag: 'HR', markup: '<hr id="subject">', role: 'separator' },
	{ tag: 'IMG', markup: '<img id="subject" alt="Chart">', role: 'img' },
	{ tag: 'LI', markup: '<ul><li id="subject">One</li></ul>', role: 'listitem' },
	{ tag: 'MAIN', markup: '<main id="subject">Body</main>', role: 'main' },
	{ tag: 'NAV', markup: '<nav id="subject">Body</nav>', role: 'navigation' },
	{ tag: 'OL', markup: '<ol id="subject"><li>One</li></ol>', role: 'list' },
	{ tag: 'OPTION', markup: '<select><option id="subject">One</option></select>', role: 'option' },
	{ tag: 'OUTPUT', markup: '<output id="subject">7</output>', role: 'status' },
	{
		tag: 'PROGRESS',
		markup: '<progress id="subject" value="1" max="2"></progress>',
		role: 'progressbar',
	},
	{ tag: 'SEARCH', markup: '<search id="subject"></search>', role: 'search' },
	{
		tag: 'SECTION',
		markup: '<section id="subject" aria-label="Ledger"></section>',
		role: 'region',
	},
	{
		tag: 'SUMMARY',
		markup: '<details><summary id="subject">Advanced</summary></details>',
		role: 'button',
	},
	{ tag: 'TABLE', markup: '<table id="subject"></table>', role: 'table' },
	{
		tag: 'TBODY',
		markup: '<table><tbody id="subject"><tr><td>A</td></tr></tbody></table>',
		role: 'rowgroup',
	},
	{
		tag: 'TD',
		markup: '<table><tbody><tr><td id="subject">A</td></tr></tbody></table>',
		role: 'cell',
	},
	{ tag: 'TEXTAREA', markup: '<textarea id="subject"></textarea>', role: 'textbox' },
	{
		tag: 'TH',
		markup: '<table><thead><tr><th id="subject">A</th></tr></thead></table>',
		role: 'columnheader',
	},
	{
		tag: 'THEAD',
		markup: '<table><thead id="subject"><tr><th>A</th></tr></thead></table>',
		role: 'rowgroup',
	},
	{
		tag: 'TR',
		markup: '<table><tbody><tr id="subject"><td>A</td></tr></tbody></table>',
		role: 'row',
	},
	{ tag: 'UL', markup: '<ul id="subject"><li>One</li></ul>', role: 'list' },
]

const FIELD_ROLE_CASES: ReadonlyArray<{ readonly type: string; readonly role: string }> = [
	{ type: 'button', role: 'button' },
	{ type: 'checkbox', role: 'checkbox' },
	{ type: 'email', role: 'textbox' },
	{ type: 'number', role: 'spinbutton' },
	{ type: 'password', role: 'textbox' },
	{ type: 'radio', role: 'radio' },
	{ type: 'range', role: 'slider' },
	{ type: 'reset', role: 'button' },
	{ type: 'search', role: 'searchbox' },
	{ type: 'submit', role: 'button' },
	{ type: 'tel', role: 'textbox' },
	{ type: 'text', role: 'textbox' },
	{ type: 'url', role: 'textbox' },
]

// An icon font paints its glyph as `::before` content on an element marked `aria-hidden`, which is
// how Bootstrap Icons writes one. The character is a private-use codepoint, so only a name
// computation that reads hidden subtrees ever sees it. The stylesheet is what makes the glyph real:
// without it the element paints nothing and a case built on it proves nothing.
const GLYPH = '\uF4FE'
const GLYPH_STYLE = `.glyph::before { content: "${GLYPH}" }`
const GLYPH_ICON = '<i class="glyph" aria-hidden="true"></i>'

// Relative to this test file, which is where the provider resolves a screenshot path from. `tmp` is
// ignored by git, so a written frame never reaches a commit.
const FRAMES = '../../../tmp/capture/frame'

// The viewport the runner handed this file, restored after every test that stages a pane, so a
// resized tester never reaches the next test or the next file.
let width = 0
let height = 0

beforeAll(() => {
	width = window.innerWidth
	height = window.innerHeight
})

afterAll(async () => {
	await page.viewport(width, height)
})

afterEach(resetFixtures)
afterEach(releasePointer)
afterEach(releaseMedia)

describe('computeNamePattern', () => {
	it('admits a glyph run at either edge and nothing a reader would hear', () => {
		const pattern = computeNamePattern('Add building')
		expect(pattern.test('Add building')).toBe(true)
		expect(pattern.test(`${GLYPH} Add building`)).toBe(true)
		expect(pattern.test(`Add building ${GLYPH}`)).toBe(true)
		expect(pattern.test('Add')).toBe(false)
		expect(pattern.test('Add building now')).toBe(false)
		expect(pattern.test('Please Add building')).toBe(false)
	})

	// `Save draft` is the control: it is what the same source matches when the parentheses reach the
	// engine as a group rather than as the characters a person reads.
	it('reads a name with regular-expression punctuation as the literal text', () => {
		const pattern = computeNamePattern('Save (draft)')
		expect(pattern.test('Save (draft)')).toBe(true)
		expect(pattern.test('Save draft')).toBe(false)
	})

	it('collapses the requested name the way a role query collapses a computed one', () => {
		expect(computeNamePattern('  Save   changes ').test('Save changes')).toBe(true)
	})

	// The two edges of the approximation, recorded rather than worked around. Both cost a refusal
	// voice and neither can cost a wrong element, because the visible pass returns every element
	// this helper never sees.
	it('bounds its tolerance at a word, and admits a punctuation-only difference', () => {
		expect(computeNamePattern('Add building').test('New Add building')).toBe(false)
		expect(computeNamePattern('Save').test('Save!')).toBe(true)
	})
})

describe('resolveRendered', () => {
	it('resolves one interactive element by its bare accessible name', () => {
		const container = buildFixture('<button type="button">Save changes</button>')
		expect(resolveRendered('Save changes')).toBe(container.querySelector('button'))
	})

	it('resolves by role when a bare name answers for a tab and its panel', () => {
		const container = buildFixture(
			'<div role="tablist"><button type="button" role="tab" id="tab-drafts">Drafts</button></div>' +
				'<div role="tabpanel" tabindex="0" aria-labelledby="tab-drafts">Two drafts waiting</div>',
		)
		expect(resolveRendered('tab', 'Drafts')).toBe(container.querySelector('[role="tab"]'))
		expect(resolveRendered('tabpanel', 'Drafts')).toBe(container.querySelector('[role="tabpanel"]'))
		expect(() => resolveRendered('Drafts')).toThrow(
			'Interactive target "Drafts" is ambiguous across 2 elements',
		)
	})

	it('refuses a name no element carries', () => {
		buildFixture('<button type="button">Save changes</button>')
		expect(() => resolveRendered('Nowhere')).toThrow(
			'No interactive element has the accessible name "Nowhere"',
		)
	})

	it('refuses a name carried only by a role outside the searched set', () => {
		buildFixture('<h2 tabindex="0">Report</h2>')
		expect(ACCESSIBLE_ROLES).not.toContain('heading')
		expect(() => resolveRendered('Report')).toThrow(
			'No interactive element has the accessible name "Report"',
		)
	})

	it('refuses a disabled, hidden, or inert match as unreachable', () => {
		buildFixture(
			'<button type="button" disabled>Locked</button>' +
				'<button type="button" style="display: none">Folded</button>' +
				'<div inert><button type="button">Sealed</button></div>',
		)
		for (const name of ['Locked', 'Folded', 'Sealed']) {
			expect(() => resolveRendered(name)).toThrow(
				`Interactive target "${name}" is not visible and focus-reachable`,
			)
		}
	})

	it('resolves an exact name that sits beside an aria-hidden icon glyph', () => {
		buildStylesheet(GLYPH_STYLE)
		const container = buildFixture(`<button type="button">${GLYPH_ICON} Add building</button>`)
		const icon = requireValue(container.querySelector('.glyph'))
		expect(getComputedStyle(icon, '::before').content).toContain(GLYPH)
		expect(resolveRendered('button', 'Add building')).toBe(container.querySelector('button'))
		expect(resolveRendered('Add building')).toBe(container.querySelector('button'))
	})

	it('refuses a folded control beside a glyph as hidden rather than absent', () => {
		buildStylesheet(GLYPH_STYLE)
		buildFixture(`<button type="button" style="display: none">${GLYPH_ICON} Add building</button>`)
		expect(() => resolveRendered('button', 'Add building')).toThrow(
			'Interactive target "Add building" is not visible and focus-reachable',
		)
	})

	// The visible pass reads the accessibility tree, so a control the tree withholds is refused
	// where it was once returned. A journey that could still click it was acting on something no
	// reader is told about.
	it('refuses a control an aria-hidden ancestor withholds rather than returning it', () => {
		buildFixture('<div aria-hidden="true"><button type="button">Muted</button></div>')
		expect(() => resolveRendered('Muted')).toThrow(
			'Interactive target "Muted" is not visible and focus-reachable',
		)
	})

	it('refuses a folded control carrying no glyph as hidden rather than absent', () => {
		buildFixture('<button type="button" style="display: none">Save</button>')
		expect(() => resolveRendered('Save')).toThrow(
			'Interactive target "Save" is not visible and focus-reachable',
		)
	})

	it('refuses a name the page carries nowhere, hidden or not', () => {
		buildFixture('<button type="button">Add building</button>')
		expect(() => resolveRendered('Save')).toThrow(
			'No interactive element has the accessible name "Save"',
		)
	})

	it('keeps the exact contract in the hidden pass as well as the visible one', () => {
		buildStylesheet(GLYPH_STYLE)
		const container = buildFixture(
			`<button type="button">${GLYPH_ICON} Add building</button>` +
				`<button type="button" style="display: none">${GLYPH_ICON} Add column</button>`,
		)
		expect(resolveRendered('Add building')).toBe(container.querySelector('button'))
		expect(() => resolveRendered('Add')).toThrow(
			'No interactive element has the accessible name "Add"',
		)
		expect(() => resolveRendered('Add col')).toThrow(
			'No interactive element has the accessible name "Add col"',
		)
		expect(() => resolveRendered('Add column')).toThrow(
			'Interactive target "Add column" is not visible and focus-reachable',
		)
	})
})

describe('resolveAccessible', () => {
	it('scrolls a wholly off-viewport target into view before measuring it', () => {
		const container = buildFixture(
			'<div style="height: 4000px"></div><button type="button">Deep</button>',
		)
		const target = requireValue(container.querySelector('button'))
		expect(isOutsideViewport(target.getBoundingClientRect())).toBe(true)
		expect(resolveAccessible('Deep')).toBe(target)
		expect(isOutsideViewport(target.getBoundingClientRect())).toBe(false)
	})

	it('refuses a target that stays outside the viewport after being scrolled to', () => {
		buildFixture(
			'<button type="button" style="position: fixed; top: -200px; width: 80px; height: 40px">' +
				'Offscreen</button>',
		)
		expect(() => resolveAccessible('Offscreen')).toThrow(
			'Interactive target "Offscreen" is unreachable after scrolling',
		)
	})
})

describe('isOutsideViewport', () => {
	it('reports a rectangle wholly above, left of, below, or right of the viewport', () => {
		expect(isOutsideViewport(DOMRect.fromRect({ x: 10, y: -80, width: 40, height: 40 }))).toBe(true)
		expect(isOutsideViewport(DOMRect.fromRect({ x: -80, y: 10, width: 40, height: 40 }))).toBe(true)
		expect(
			isOutsideViewport(DOMRect.fromRect({ x: 10, y: window.innerHeight, width: 40, height: 40 })),
		).toBe(true)
		expect(
			isOutsideViewport(DOMRect.fromRect({ x: window.innerWidth, y: 10, width: 40, height: 40 })),
		).toBe(true)
		expect(isOutsideViewport(DOMRect.fromRect({ x: 10, y: 10, width: 40, height: 40 }))).toBe(false)
	})

	it('reports a rectangle straddling an edge as inside', () => {
		expect(isOutsideViewport(DOMRect.fromRect({ x: 10, y: -20, width: 40, height: 40 }))).toBe(
			false,
		)
	})
})

describe('isReachable', () => {
	it('accepts a plain control and refuses each condition it drops', () => {
		const container = buildFixture(
			'<button type="button" id="open">Open</button>' +
				'<button type="button" id="locked" disabled>Locked</button>' +
				'<button type="button" id="refused" aria-disabled="true">Refused</button>' +
				'<button type="button" id="folded" style="display: none">Folded</button>' +
				'<button type="button" id="skipped" tabindex="-1">Skipped</button>' +
				'<div inert><button type="button" id="sealed">Sealed</button></div>',
		)
		expect(isReachable(requireValue(container.querySelector('#open')))).toBe(true)
		for (const id of ['locked', 'refused', 'folded', 'skipped', 'sealed']) {
			expect(isReachable(requireValue(container.querySelector(`#${id}`)))).toBe(false)
		}
	})

	it('refuses a control the document no longer holds', () => {
		const container = buildFixture('<button type="button">Gone</button>')
		const target = requireValue(container.querySelector('button'))
		target.remove()
		expect(isReachable(target)).toBe(false)
	})

	it('accepts a focusable SVG and refuses an element from a foreign namespace', () => {
		const container = buildFixture('<svg tabindex="0" width="20" height="20"></svg>')
		expect(isReachable(requireValue(container.querySelector('svg')))).toBe(true)
		const foreign = document.createElementNS('urn:example:widgets', 'widget')
		container.append(foreign)
		expect(isReachable(foreign)).toBe(false)
	})

	it('is the one filter the acting verbs apply, so a refused summary throws its own voice', async () => {
		buildFixture('<details><summary aria-disabled="true">Sealed</summary><p>Body</p></details>')
		await expect(clickDisclosure('Sealed')).rejects.toThrow(
			'Native disclosure "Sealed" is not visible and focus-reachable',
		)
	})

	// The reading answers for the element's own facts inside a shadow tree, in an open root and a
	// closed one alike, and the ancestor reads stop at the boundary: `closest` never leaves the
	// element's own tree, so an `[inert]` host is invisible to it while a host the flat tree does not
	// lay out still takes the element off the page.
	it('answers for a shadow subject and stops at the boundary for an ancestor attribute', () => {
		const container = buildFixture(
			'<div id="plain" style="width: 200px; height: 60px"></div>' +
				'<div id="sealed" style="width: 200px; height: 60px"></div>' +
				'<div id="halted" inert style="width: 200px; height: 60px"></div>' +
				'<div id="folded" style="display: none"></div>',
		)
		const rows: ReadonlyArray<{
			readonly id: string
			readonly mode: ShadowRootMode
			readonly reachable: boolean
		}> = [
			{ id: 'plain', mode: 'open', reachable: true },
			{ id: 'sealed', mode: 'closed', reachable: true },
			{ id: 'halted', mode: 'open', reachable: true },
			{ id: 'folded', mode: 'open', reachable: false },
		]
		for (const row of rows) {
			const host = requireValue(container.querySelector(`#${row.id}`))
			const root = host.attachShadow({ mode: row.mode })
			root.innerHTML = '<button type="button" style="width: 120px; height: 40px">Open</button>'
			const inner = requireValue(root.querySelector('button'))
			expect(inner.closest('[inert]')).toBeNull()
			expect(`${row.id} reachable=${String(isReachable(inner))}`).toBe(
				`${row.id} reachable=${String(row.reachable)}`,
			)
		}
	})

	// A dialog announcing `aria-modal="true"` promises that the rest of the page is out of reach, so
	// the control a person cannot get to is the one the resolver used to count. The name is carried
	// twice deliberately: splitting one control's name across the page and the dialog is the
	// workaround a consumer writes when the layer counts the covered copy.
	it('refuses a control an open modal leaves behind and resolves the one the dialog holds', async () => {
		const container = buildFixture(
			'<header><a id="masthead" href="#start">Get started</a></header>' +
				'<div role="dialog" aria-modal="true" aria-label="Menu">' +
				'<button type="button">Close</button>' +
				'<a id="menu" href="#start">Get started</a>' +
				'</div>',
		)
		const masthead = requireValue(container.querySelector('#masthead'))
		const menu = requireValue(container.querySelector('#menu'))
		expect(isReachable(masthead)).toBe(false)
		expect(isReachable(menu)).toBe(true)
		expect(resolveAccessible('Get started')).toBe(menu)
		expect(readRefusal('Get started')).toBeUndefined()
		// Focus arrives the way an open dialog offers it, which is also what gives the page the real
		// input focus a Tab needs: the dialog holds focus, and forward traversal from there reaches
		// the dialog's own control rather than the masthead carrying the same name.
		await clickAccessible('Close')
		expect(await traverseAccessible('Get started')).toBe(menu)
	})

	it('accepts a control beside a dialog that is not modal and beside a modal the page withholds', () => {
		const container = buildFixture(
			'<header><a id="masthead" href="#start">Get started</a></header>' +
				'<div role="dialog" aria-label="Plain"><a href="#start">Plain</a></div>' +
				'<div role="dialog" aria-modal="true" aria-label="Folded" style="display: none">' +
				'<a href="#start">Folded</a></div>' +
				'<div role="dialog" aria-modal="true" aria-label="Blanked" style="visibility: hidden">' +
				'<a href="#start">Blanked</a></div>',
		)
		const masthead = requireValue(container.querySelector('#masthead'))
		expect(isReachable(masthead)).toBe(true)
		expect(resolveAccessible('Get started')).toBe(masthead)
	})

	// Containment is the flat tree's, so the innermost open modal rules and a host inside it carries
	// its own shadow content along.
	it('follows containment through a nested modal and across a shadow boundary', () => {
		const container = buildFixture(
			'<a id="page" href="#start">Page</a>' +
				'<div role="dialog" aria-modal="true" aria-label="Outer">' +
				'<a id="outer" href="#start">Outer</a>' +
				'<div role="dialog" aria-modal="true" aria-label="Inner">' +
				'<a id="inner" href="#start">Inner</a>' +
				'<div id="host" style="width: 200px; height: 60px"></div>' +
				'</div></div>',
		)
		const root = requireValue(container.querySelector('#host')).attachShadow({ mode: 'closed' })
		root.innerHTML = '<button type="button" style="width: 120px; height: 40px">Shadow</button>'
		const rows: ReadonlyArray<{ readonly id: string; readonly reachable: boolean }> = [
			{ id: 'page', reachable: false },
			{ id: 'outer', reachable: false },
			{ id: 'inner', reachable: true },
		]
		for (const row of rows) {
			const element = requireValue(container.querySelector(`#${row.id}`))
			expect(`${row.id} reachable=${String(isReachable(element))}`).toBe(
				`${row.id} reachable=${String(row.reachable)}`,
			)
		}
		expect(isReachable(requireValue(root.querySelector('button')))).toBe(true)
	})

	// The two arrangements the read cannot see, recorded here so the documented bound reddens with
	// the code. A native dialog opened through `showModal` carries no `aria-modal` attribute, and a
	// modal declared inside a shadow tree is outside what a document query returns.
	it('reports a control reachable beside a native modal and beside a shadow-declared modal', () => {
		const container = buildFixture(
			'<a id="page" href="#start">Page</a>' +
				'<dialog><a href="#start">Native</a></dialog>' +
				'<div id="host" style="width: 200px; height: 60px"></div>',
		)
		const root = requireValue(container.querySelector('#host')).attachShadow({ mode: 'open' })
		root.innerHTML =
			'<div role="dialog" aria-modal="true" aria-label="Sealed" style="width: 120px; height: 40px">' +
			'<a href="#start">Sealed</a></div>'
		const native = requireValue(container.querySelector('dialog'))
		native.showModal()
		expect(native.matches(':modal')).toBe(true)
		expect(isReachable(requireValue(container.querySelector('#page')))).toBe(true)
		native.close()
	})
})

describe('isRendered', () => {
	it('accepts a control the accessibility tree presents and refuses each removal it honours', () => {
		const container = buildFixture(
			'<button type="button" id="open">Open</button>' +
				'<div aria-hidden="true"><button type="button" id="muted">Muted</button></div>' +
				'<button type="button" id="withheld" hidden>Withheld</button>' +
				'<input type="hidden" id="carried" value="7">' +
				'<div style="display: none"><button type="button" id="folded">Folded</button></div>' +
				'<div style="visibility: hidden"><button type="button" id="blanked">Blanked</button></div>',
		)
		expect(isRendered(requireValue(container.querySelector('#open')))).toBe(true)
		for (const id of ['muted', 'withheld', 'carried', 'folded', 'blanked']) {
			expect(isRendered(requireValue(container.querySelector(`#${id}`)))).toBe(false)
		}
	})

	it('splits from isReachable on a zero-size announced control', () => {
		const container = buildFixture(
			'<button type="button" style="width: 0; height: 0; padding: 0; border: 0; overflow: hidden">' +
				'Skip to content</button>',
		)
		const target = requireValue(container.querySelector('button'))
		expect(target.getBoundingClientRect().width).toBe(0)
		expect(isRendered(target)).toBe(true)
		expect(isReachable(target)).toBe(false)
		expect(() => resolveRendered('Skip to content')).toThrow(
			'Interactive target "Skip to content" is not visible and focus-reachable',
		)
	})

	// The same boundary `isReachable` meets: the element's own facts are read inside a shadow tree
	// whatever the mode, and `closest` never leaves that tree, so an `aria-hidden` host is invisible
	// to this reading while a host the flat tree does not lay out is not.
	it('answers for a shadow subject and stops at the boundary for an ancestor attribute', () => {
		const container = buildFixture(
			'<div id="plain" style="width: 200px; height: 60px"></div>' +
				'<div id="sealed" style="width: 200px; height: 60px"></div>' +
				'<div id="muted" aria-hidden="true" style="width: 200px; height: 60px"></div>' +
				'<div id="folded" style="display: none"></div>',
		)
		const rows: ReadonlyArray<{
			readonly id: string
			readonly mode: ShadowRootMode
			readonly rendered: boolean
		}> = [
			{ id: 'plain', mode: 'open', rendered: true },
			{ id: 'sealed', mode: 'closed', rendered: true },
			{ id: 'muted', mode: 'open', rendered: true },
			{ id: 'folded', mode: 'open', rendered: false },
		]
		for (const row of rows) {
			const host = requireValue(container.querySelector(`#${row.id}`))
			const root = host.attachShadow({ mode: row.mode })
			root.innerHTML = '<button type="button" style="width: 120px; height: 40px">Open</button>'
			const inner = requireValue(root.querySelector('button'))
			expect(inner.closest('[aria-hidden="true"]')).toBeNull()
			expect(`${row.id} rendered=${String(isRendered(inner))}`).toBe(
				`${row.id} rendered=${String(row.rendered)}`,
			)
		}
	})
})

describe('readHit', () => {
	it('names the element itself when its own centre is what a pointer reaches', () => {
		const container = buildFixture(
			'<div style="position: fixed; top: 120px; left: 120px">' +
				'<button type="button" style="width: 160px; height: 40px">Open</button>' +
				'</div>',
		)
		const target = requireValue(container.querySelector('button'))
		const hit = readHit(target)
		expect(hit).toBe(target)
		expect(target.contains(requireValue(hit))).toBe(true)
	})

	it('names the cover a reachable control sits under', () => {
		const container = buildFixture(
			'<div style="position: fixed; top: 120px; left: 120px">' +
				'<button type="button" style="width: 160px; height: 40px">Open</button>' +
				'<div id="masthead" style="position: absolute; top: 0; left: 0; width: 160px; height: 40px"></div>' +
				'</div>',
		)
		const target = requireValue(container.querySelector('button'))
		const hit = requireValue(readHit(target))
		expect(hit.id).toBe('masthead')
		expect(target.contains(hit)).toBe(false)
		// The cover is the whole reason this reader exists: the control is connected, visible, laid
		// out, and in the focus order, so the reachability filter accepts it while the click misses.
		expect(isReachable(target)).toBe(true)
	})

	// A wrapped inline box paints one rectangle per line with a gap between them and spans a single
	// bounding box across both, so the box centre falls in that gap. The wrap is real soft wrapping:
	// the container is 7ch wide in the same monospace font the text is set in, which fits `alpha` and
	// refuses `alpha beta`, so exactly two line boxes form whatever font the host resolves. The
	// 60px line height is what opens the gap wide enough that no font metric closes it.
	it('names the ancestor under a wrapped inline target whose centre falls between its lines', () => {
		const container = buildFixture(
			'<ul style="position: fixed; top: 120px; left: 120px; margin: 0; padding: 0; list-style: none">' +
				'<li id="entry" style="font: 16px/60px monospace; width: 7ch">' +
				'<a href="#field">alpha beta</a>' +
				'</li></ul>',
		)
		const target = requireValue(container.querySelector('a'))
		const rectangles = target.getClientRects()
		expect(rectangles.length).toBe(2)
		expect(requireValue(rectangles[1]).top - requireValue(rectangles[0]).bottom).toBeGreaterThan(0)
		const hit = requireValue(readHit(target))
		expect(hit.id).toBe('entry')
		expect(target.contains(hit)).toBe(false)
		expect(isReachable(target)).toBe(true)
	})

	// Neither element has a box to aim at: the clipped control collapses to a point on its rail's
	// own corner, and the folded one reports the zero rectangle at the origin. The reader hit-tests
	// each point like any other, which is why the gates run before a caller trusts what it names.
	it('names whatever paints at a collapsed box, because it never asks for layout', () => {
		const container = buildFixture(
			'<div id="rail" style="position: fixed; top: 120px; left: 120px; width: 200px; height: 60px">' +
				'<button type="button" id="clipped" style="width: 0; height: 0; padding: 0; border: 0; overflow: hidden">' +
				'Skip to content</button></div>' +
				'<div style="display: none"><button type="button" id="folded">Folded</button></div>',
		)
		const clipped = requireValue(container.querySelector('#clipped'))
		expect(clipped.getBoundingClientRect().width).toBe(0)
		expect(isRendered(clipped)).toBe(true)
		expect(isReachable(clipped)).toBe(false)
		const clippedHit = requireValue(readHit(clipped))
		expect(clippedHit.id).toBe('rail')
		expect(clipped.contains(clippedHit)).toBe(false)

		const folded = requireValue(container.querySelector('#folded'))
		const box = folded.getBoundingClientRect()
		expect(box.width).toBe(0)
		expect(box.left).toBe(0)
		expect(isRendered(folded)).toBe(false)
		expect(readHit(folded)).toBe(document.body)
	})

	// The hit test runs against the owner document, so it stops at the shadow boundary and names the
	// host. The mode changes nothing — a closed root is no less visible to it than an open one — and
	// a caller that wants the encapsulated node asks the element's own root for its reading instead.
	it('names the host for an element inside a shadow tree, open root and closed alike', () => {
		const container = buildFixture(
			'<div id="host" style="position: fixed; top: 120px; left: 120px; width: 200px; height: 60px"></div>' +
				'<div id="sealed" style="position: fixed; top: 200px; left: 120px; width: 200px; height: 60px"></div>',
		)
		const hosts: ReadonlyArray<{ readonly id: string; readonly mode: ShadowRootMode }> = [
			{ id: 'host', mode: 'open' },
			{ id: 'sealed', mode: 'closed' },
		]
		for (const { id, mode } of hosts) {
			const host = requireValue(container.querySelector(`#${id}`))
			const root = host.attachShadow({ mode })
			root.innerHTML =
				'<button type="button" style="width: 120px; height: 40px; margin: 10px">Open</button>'
			const inner = requireValue(root.querySelector('button'))
			const hit = requireValue(readHit(inner))
			expect(hit).toBe(host)
			expect(inner.contains(hit)).toBe(false)
			const box = inner.getBoundingClientRect()
			const centre = root.elementFromPoint(box.left + box.width / 2, box.top + box.height / 2)
			expect(centre).toBe(inner)
		}
	})

	// Where the centre lands is the whole question, and whether the box still reaches the viewport is
	// a different one. The second arrangement separates them: its right edge is at 20, so
	// `isOutsideViewport` reports false while the centre sits at -30 and the hit test refuses it.
	it('reports nothing where the centre lies outside the viewport, whatever the box does', () => {
		const container = buildFixture(
			'<button type="button" id="gone" style="position: fixed; top: 120px; left: -400px; width: 200px; height: 40px">' +
				'Gone</button>' +
				'<button type="button" id="edge" style="position: fixed; top: 200px; left: -80px; width: 100px; height: 40px">' +
				'Edge</button>',
		)
		const gone = requireValue(container.querySelector('#gone'))
		expect(isOutsideViewport(gone.getBoundingClientRect())).toBe(true)
		expect(readHit(gone)).toBeUndefined()

		const edge = requireValue(container.querySelector('#edge'))
		const box = edge.getBoundingClientRect()
		expect(box.right).toBe(20)
		expect(isOutsideViewport(box)).toBe(false)
		expect(isReachable(edge)).toBe(true)
		expect(readHit(edge)).toBeUndefined()
	})
})

describe('clickAccessible', () => {
	it('activates a named control with a real pointer event', async () => {
		const container = buildFixture('<button type="button">Apply</button>')
		const recorder = createRecorder<[event: Event]>()
		requireValue(container.querySelector('button')).addEventListener('click', recorder.handler)
		await clickAccessible('Apply')
		expect(recorder.count).toBe(1)
		expect(requireValue(recorder.calls[0])[0]).toBeInstanceOf(MouseEvent)
	})

	it('activates the control the role names when a bare name is ambiguous', async () => {
		const container = buildFixture(
			'<div role="tablist"><button type="button" role="tab" id="tab-drafts">Drafts</button></div>' +
				'<div role="tabpanel" tabindex="0" aria-labelledby="tab-drafts">Two drafts waiting</div>',
		)
		const recorder = createRecorder<[event: Event]>()
		requireValue(container.querySelector('[role="tab"]')).addEventListener(
			'click',
			recorder.handler,
		)
		await clickAccessible('tab', 'Drafts')
		expect(recorder.count).toBe(1)
	})

	// guides/test.md → Patterns → "Drive an interface the way a person does". A browser fence
	// carries in this directory because the guides project runs with the browser disabled.
	it('runs one journey by role and name alone, touching no element', async () => {
		const container = buildFixture(
			'<label for="runs">Runs</label><input id="runs" type="text" value="9">' +
				'<div role="tablist">' +
				'<button type="button" role="tab" id="tab-drafts">Drafts</button></div>' +
				'<div role="tabpanel" tabindex="0" aria-labelledby="tab-drafts">Two drafts waiting</div>' +
				'<section aria-label="Ledger">' +
				'<button type="button">Monthly income · ready</button></section>' +
				'<section aria-label="Vault">' +
				'<button type="button">Monthly income · ready</button></section>' +
				'<button type="button" id="evaluate">Evaluate</button>' +
				'<section aria-label="Run"><p>Scored   3 of 3</p>' +
				'<span style="position: absolute; width: 1px; height: 1px; overflow: hidden; ' +
				'clip-path: inset(50%)">on the first pass</span></section>',
		)
		const drafts = createRecorder<[event: Event]>()
		const ledger = createRecorder<[event: Event]>()
		const vault = createRecorder<[event: Event]>()
		requireValue(container.querySelector('[role="tab"]')).addEventListener('click', drafts.handler)
		const twins = container.querySelectorAll('section button')
		requireValue(twins[0]).addEventListener('click', ledger.handler)
		requireValue(twins[1]).addEventListener('click', vault.handler)

		await typeAccessible('Runs', '3')
		expect(readValue('textbox', 'Runs')).toBe('3')

		// The tab and its own panel collide by construction, because the panel is labelled by the tab.
		// The bare name is refused, and the role is what separates them.
		await expect(clickAccessible('Drafts')).rejects.toThrow(
			'Interactive target "Drafts" is ambiguous across 2 elements',
		)
		await clickAccessible('tab', 'Drafts')
		expect(drafts.count).toBe(1)

		// The region completes a name a rendered status finishes, so the Ledger's own control is the
		// one that hears the click and its twin next door hears nothing.
		await clickAccessibleWithin('Ledger', 'button', 'Monthly income')
		expect(ledger.count).toBe(1)
		expect(vault.count).toBe(0)

		// Focus arrives the way the interface offers it. Nothing here calls element.focus().
		const reached = await traverseAccessible('Evaluate')
		expect(reached).toBe(container.querySelector('#evaluate'))
		expect(document.activeElement).toBe(reached)

		expect(readPerception('Run')).toBe('Scored 3 of 3 on the first pass')
	})
})

describe('clickAccessibleWithin', () => {
	it('activates the control inside the named region and leaves its twin alone', async () => {
		const container = buildFixture(
			'<section aria-label="Ledger"><button type="button">Monthly income · ready</button></section>' +
				'<section aria-label="Vault"><button type="button">Monthly income · ready</button></section>',
		)
		const sections = container.querySelectorAll('section button')
		const ledger = createRecorder<[event: Event]>()
		const vault = createRecorder<[event: Event]>()
		requireValue(sections[0]).addEventListener('click', ledger.handler)
		requireValue(sections[1]).addEventListener('click', vault.handler)
		await clickAccessibleWithin('Ledger', 'button', 'Monthly income')
		expect(ledger.count).toBe(1)
		expect(vault.count).toBe(0)
	})

	it('activates a glyph-captioned control inside a glyph-labelled region', async () => {
		buildStylesheet(GLYPH_STYLE)
		const container = buildFixture(
			'<section aria-labelledby="ledger-heading">' +
				`<h2 id="ledger-heading">${GLYPH_ICON} Ledger</h2>` +
				`<button type="button">${GLYPH_ICON} Monthly income ready</button></section>`,
		)
		const clicks = createRecorder<[event: Event]>()
		requireValue(container.querySelector('button')).addEventListener('click', clicks.handler)
		await clickAccessibleWithin('Ledger', 'button', 'Monthly income')
		expect(clicks.count).toBe(1)
	})

	it('refuses a control the region does not reach', async () => {
		buildFixture('<section aria-label="Ledger"><button type="button">Add row</button></section>')
		await expect(clickAccessibleWithin('Ledger', 'button', 'Remove')).rejects.toThrow(
			'Interactive target "Remove" is not reachable inside "Ledger"',
		)
	})

	it('refuses a name several controls in the region answer for', async () => {
		buildFixture(
			'<section aria-label="Ledger">' +
				'<button type="button">Add row</button><button type="button">Add column</button>' +
				'</section>',
		)
		await expect(clickAccessibleWithin('Ledger', 'button', 'Add')).rejects.toThrow(
			'Interactive target "Add" is ambiguous across 2 elements inside "Ledger"',
		)
	})
})

describe('clickDisclosure', () => {
	it('opens a native details disclosure by its rendered summary', async () => {
		const container = buildFixture('<details><summary>Advanced</summary><p>Body</p></details>')
		const details = requireValue(container.querySelector('details'))
		expect(details.open).toBe(false)
		await clickDisclosure('Advanced')
		expect(details.open).toBe(true)
	})

	it('refuses a summary no rendered disclosure carries', async () => {
		buildFixture('<details style="display: none"><summary>Folded</summary></details>')
		await expect(clickDisclosure('Folded')).rejects.toThrow(
			'Native disclosure "Folded" is not visible and focus-reachable',
		)
	})

	it('refuses a summary text several disclosures carry', async () => {
		buildFixture(
			'<details><summary>Advanced</summary></details><details><summary>Advanced</summary></details>',
		)
		await expect(clickDisclosure('Advanced')).rejects.toThrow(
			'Native disclosure "Advanced" is ambiguous across 2 elements',
		)
	})
})

describe('hoverAccessible', () => {
	it('hovers the named control while its twin keeps the base paint, then clears hover', async () => {
		buildStylesheet(
			'.journey-hover { padding-top: 16px } .journey-hover:hover { padding-top: 32px }',
		)
		buildFixture(
			'<button class="journey-hover">Hover me</button><button class="journey-hover">Twin</button>',
		)
		const target = resolveAccessible('Hover me')
		const twin = resolveAccessible('Twin')
		const clicks = createRecorder<[event: Event]>()
		target.addEventListener('click', clicks.handler)
		expect(readPixels(target, 'padding-top')).toBe(16)
		await hoverAccessible('button', 'Hover me')
		expect(target.matches(':hover')).toBe(true)
		expect(readPixels(target, 'padding-top')).toBe(32)
		expect(readPixels(twin, 'padding-top')).toBe(16)
		await releasePointer()
		expect(readPixels(target, 'padding-top')).toBe(16)
		expect(clicks.count).toBe(0)
	})

	it('refuses an absent name', async () => {
		await expect(hoverAccessible('Nowhere')).rejects.toThrow(
			'No interactive element has the accessible name "Nowhere"',
		)
	})

	it('refuses a gated control and disambiguates a tab from its panel', async () => {
		buildFixture(
			'<button disabled>Gated</button><button role="tab" id="journey-drafts">Drafts</button><div role="tabpanel" tabindex="0" aria-labelledby="journey-drafts">Draft content</div>',
		)
		await expect(hoverAccessible('Gated')).rejects.toThrow(
			'Interactive target "Gated" is not visible and focus-reachable',
		)
		await expect(hoverAccessible('Drafts')).rejects.toThrow(
			'Interactive target "Drafts" is ambiguous across 2 elements',
		)
		await hoverAccessible('tab', 'Drafts')
		expect(resolveAccessible('tab', 'Drafts').matches(':hover')).toBe(true)
	})
})

describe('holdAccessible', () => {
	it('records the marker only after the press send resolves', async () => {
		buildFixture('<button>Press delivery</button>')
		const button = resolveAccessible('Press delivery')
		const markers = createRecorder<[marked: boolean]>()
		button.addEventListener('pointerdown', () => {
			markers.handler(document.documentElement.hasAttribute(POINTER_HOLD))
		})
		// Control: a rejected send must record no marker, so the later `[[false]]` reading is
		// unambiguous evidence of the resolved press, not a leftover from this failed attempt.
		await expect(
			sendProtocol('Input.dispatchMouseEvent', {
				type: 'mousePressed',
				x: Number.NaN,
				y: Number.NaN,
				button: 'left',
				buttons: 1,
				clickCount: 1,
			}),
		).rejects.toThrow('Invalid parameters')
		await holdAccessible('Press delivery')
		expect(markers.calls).toEqual([[false]])
		expect(document.documentElement.hasAttribute(POINTER_HOLD)).toBe(true)
		expect(button.matches(':active')).toBe(true)
	})

	// guides/test.md → Patterns → "Hold a control and read the pressed paint"
	it('holds the pressed paint and restores it on release', async () => {
		buildStylesheet(
			'.journey-active { position: fixed; left: 140px; top: 140px; padding-top: 16px } .journey-active:active { padding-top: 32px }',
		)
		buildFixture('<button class="journey-active">Apply</button>')
		const button = resolveAccessible('button', 'Apply')
		const down = createRecorder<[event: PointerEvent]>()
		const up = createRecorder<[event: PointerEvent]>()
		button.addEventListener('pointerdown', down.handler)
		button.addEventListener('pointerup', up.handler)
		expect(readPixels(button, 'padding-top')).toBe(16)
		await holdAccessible('button', 'Apply')
		expect(readPixels(button, 'padding-top')).toBe(32)
		expect(button.matches(':active')).toBe(true)
		expect(document.activeElement).toBe(button)
		expect(requireValue(down.calls[0])[0].isTrusted).toBe(true)
		expect(document.documentElement.hasAttribute(POINTER_HOLD)).toBe(true)
		await releasePointer()
		expect(readPixels(button, 'padding-top')).toBe(16)
		expect(button.matches(':active')).toBe(false)
		expect(up.count).toBe(1)
		expect(requireValue(up.calls[0])[0].isTrusted).toBe(true)
		expect(document.documentElement.hasAttribute(POINTER_HOLD)).toBe(false)
	})

	it('misses at the unscaled point and reaches the pressed paint through the mapped hold', async () => {
		buildStylesheet(
			'.journey-active { position: fixed; left: 140px; top: 140px; padding-top: 16px } .journey-active:active { padding-top: 32px }',
		)
		buildFixture('<button class="journey-active">Scaled</button>')
		const button = resolveAccessible('Scaled')
		const box = button.getBoundingClientRect()
		const frame = requireValue(window.frameElement).getBoundingClientRect()
		expect(frame.width / window.innerWidth).not.toBe(1)
		const x = frame.left + box.left + box.width / 2
		const y = frame.top + box.top + box.height / 2
		try {
			await sendProtocol('Input.dispatchMouseEvent', { type: 'mouseMoved', x, y })
			await sendProtocol('Input.dispatchMouseEvent', {
				type: 'mousePressed',
				x,
				y,
				button: 'left',
				buttons: 1,
				clickCount: 1,
			})
			await waitForFrame()
			expect(readPixels(button, 'padding-top')).toBe(16)
		} finally {
			await sendProtocol('Input.dispatchMouseEvent', {
				type: 'mouseReleased',
				x,
				y,
				button: 'left',
				buttons: 0,
				clickCount: 1,
			})
		}
		await holdAccessible('Scaled')
		expect(readPixels(button, 'padding-top')).toBe(32)
	})

	it('releases a covered press before refusing the missed pressed state', async () => {
		buildFixture(
			'<button style="position: fixed; top: 140px; left: 140px">Covered</button><div class="journey-cover" style="position: fixed; inset: 0; z-index: 10"></div>',
		)
		await expect(holdAccessible('Covered')).rejects.toThrow(
			'Interactive target "Covered" did not enter the pressed state',
		)
		expect(document.documentElement.hasAttribute(POINTER_HOLD)).toBe(false)
		expect(resolveAccessible('Covered').matches(':active')).toBe(false)
	})

	it('refuses a double hold without releasing the held control', async () => {
		buildFixture('<button>Held</button>')
		await holdAccessible('Held')
		const held = document.documentElement.getAttribute(POINTER_HOLD)
		await expect(holdAccessible('Held')).rejects.toThrow(`Pointer is already held at ${held}`)
		expect(resolveAccessible('Held').matches(':active')).toBe(true)
	})

	it('refuses a double hold before resolving an absent second name', async () => {
		buildFixture('<button>Held</button>')
		await holdAccessible('Held')
		const held = document.documentElement.getAttribute(POINTER_HOLD)
		await expect(holdAccessible('Absent')).rejects.toThrow(`Pointer is already held at ${held}`)
		expect(resolveAccessible('Held').matches(':active')).toBe(true)
	})

	it('holds at a 390 by 844 viewport with its scale measured afresh', async () => {
		const previous = { width: window.innerWidth, height: window.innerHeight }
		try {
			await page.viewport(390, 844)
			buildStylesheet(
				'.journey-active { padding-top: 16px } .journey-active:active { padding-top: 32px }',
			)
			buildFixture('<button class="journey-active">Narrow</button>')
			await holdAccessible('Narrow')
			expect(readPixels(resolveAccessible('Narrow'), 'padding-top')).toBe(32)
		} finally {
			await releasePointer()
			await page.viewport(previous.width, previous.height)
		}
	})

	it('preserves the resolver voices before pressing', async () => {
		await expect(holdAccessible('Nowhere')).rejects.toThrow(
			'No interactive element has the accessible name "Nowhere"',
		)
		buildFixture(
			'<button disabled>Gated</button><button role="tab" id="journey-drafts">Drafts</button><div role="tabpanel" tabindex="0" aria-labelledby="journey-drafts">Draft content</div>',
		)
		await expect(holdAccessible('Gated')).rejects.toThrow(
			'Interactive target "Gated" is not visible and focus-reachable',
		)
		await expect(holdAccessible('Drafts')).rejects.toThrow(
			'Interactive target "Drafts" is ambiguous across 2 elements',
		)
		await holdAccessible('tab', 'Drafts')
		expect(resolveAccessible('tab', 'Drafts').matches(':active')).toBe(true)
	})
})

describe('releasePointer', () => {
	it('retains a rejected release marker so a corrected retry releases the held pointer', async () => {
		buildFixture('<button>Retry release</button>')
		await holdAccessible('Retry release')
		const held = requireValue(document.documentElement.getAttribute(POINTER_HOLD))
		try {
			document.documentElement.setAttribute(POINTER_HOLD, 'invalidxinvalid')
			await expect(releasePointer()).rejects.toThrow('Invalid parameters')
			expect(document.documentElement.getAttribute(POINTER_HOLD)).toBe('invalidxinvalid')
		} finally {
			document.documentElement.setAttribute(POINTER_HOLD, held)
			await releasePointer()
		}
		expect(document.documentElement.hasAttribute(POINTER_HOLD)).toBe(false)
		expect(resolveAccessible('Retry release').matches(':active')).toBe(false)
	})

	it('resolves with an idle pointer', async () => {
		await expect(releasePointer()).resolves.toBeUndefined()
		expect(document.documentElement.hasAttribute(POINTER_HOLD)).toBe(false)
	})
})

describe.sequential('pointer teardown after failure', () => {
	const releases = createRecorder<[event: PointerEvent]>()
	beforeAll(() => document.addEventListener('pointerup', releases.handler))
	afterAll(() => document.removeEventListener('pointerup', releases.handler))

	// An assertion inside an it.fails body cannot fail the suite; the following case carries the proof.
	it.fails('throws a sentinel after holding and leaves the release to afterEach', async () => {
		buildFixture('<button>Sentinel hold</button>')
		await holdAccessible('Sentinel hold')
		expect(resolveAccessible('Sentinel hold').matches(':active')).toBe(true)
		throw new Error('hold sentinel')
	})

	it('reads a released pointer in the following case', async () => {
		expect(releases.count).toBe(1)
		expect(document.documentElement.hasAttribute(POINTER_HOLD)).toBe(false)
		buildFixture('<button>Following hold</button>')
		const moves = createRecorder<[event: PointerEvent]>()
		resolveAccessible('Following hold').addEventListener('pointermove', moves.handler)
		await hoverAccessible('Following hold')
		expect(requireValue(moves.calls[0])[0].buttons).toBe(0)
		expect(resolveAccessible('Following hold').matches(':active')).toBe(false)
	})

	it('releases explicitly before its afterEach hook', async () => {
		releases.clear()
		buildFixture('<button>Explicit hold</button>')
		await holdAccessible('Explicit hold')
		await releasePointer()
		expect(releases.count).toBe(1)
	})

	it('reads no additional button release from the hook', () => {
		expect(releases.count).toBe(1)
	})
})

describe('typeAccessible', () => {
	it('replaces an existing value with real keystrokes', async () => {
		buildFixture('<label for="runs">Runs</label><input id="runs" type="text" value="9">')
		await typeAccessible('Runs', '3')
		expect(readValue('textbox', 'Runs')).toBe('3')
	})

	it('types the provider key syntax as literal text', async () => {
		buildFixture('<label for="runs">Runs</label><input id="runs" type="text">')
		await typeAccessible('Runs', '{a}[b]')
		expect(readValue('textbox', 'Runs')).toBe('{a}[b]')
	})

	it('clears the field when the text is empty', async () => {
		buildFixture('<label for="runs">Runs</label><input id="runs" type="text" value="9">')
		await typeAccessible('Runs', '')
		expect(readValue('textbox', 'Runs')).toBe('')
	})
})

describe('fillAccessible', () => {
	it('replaces a value in one operation and publishes a real input event', async () => {
		const container = buildFixture(
			'<label for="notes">Notes</label><textarea id="notes"></textarea>',
		)
		const recorder = createRecorder<[event: Event]>()
		requireValue(container.querySelector('textarea')).addEventListener('input', recorder.handler)
		await fillAccessible('Notes', '{"status":"ready"}')
		expect(readValue('textbox', 'Notes')).toBe('{"status":"ready"}')
		expect(recorder.count).toBeGreaterThan(0)
	})
})

describe('pressKeys', () => {
	it('sends the sequence to the control that holds focus', async () => {
		const container = buildFixture('<button type="button">Evaluate</button>')
		const button = requireValue(container.querySelector('button'))
		const recorder = createRecorder<[event: KeyboardEvent]>()
		button.addEventListener('keydown', (event) => {
			recorder.handler(event)
		})
		await traverseAccessible('Evaluate')

		await pressKeys('{Enter}')

		expect(recorder.count).toBe(1)
		expect(requireValue(recorder.calls[0])[0].key).toBe('Enter')
		expect(document.activeElement).toBe(button)
	})

	// The control: the body holding focus is what a page looks like before anything takes it, and a
	// key sent there reaches nothing while every assertion after it still runs. A refusal is what
	// separates this from the provider's own keyboard verb.
	it('refuses a sequence sent while nothing but the body holds focus', async () => {
		const container = buildFixture('<button type="button">Evaluate</button>')
		const recorder = createRecorder<[event: KeyboardEvent]>()
		requireValue(container.querySelector('button')).addEventListener('keydown', (event) => {
			recorder.handler(event)
		})
		if (document.activeElement instanceof HTMLElement) document.activeElement.blur()
		expect(document.activeElement).toBe(document.body)

		await expect(pressKeys('{Escape}')).rejects.toThrow(
			'Key sequence "{Escape}" was sent with nothing focused',
		)
		expect(recorder.count).toBe(0)
	})

	// guides/test.md → Patterns → "Send a key to what holds focus". A browser fence carries in this
	// directory because the guides project runs with the browser disabled.
	it('reaches the traversed control and refuses the same sequence sent to nothing', async () => {
		const container = buildFixture('<button type="button">Evaluate</button>')
		const recorder = createRecorder<[event: KeyboardEvent]>()
		requireValue(container.querySelector('button')).addEventListener('keydown', (event) => {
			recorder.handler(event)
		})

		await traverseAccessible('Evaluate')
		await pressKeys('{Enter}')
		expect(recorder.count).toBe(1)

		if (document.activeElement instanceof HTMLElement) document.activeElement.blur()
		await expect(pressKeys('{Escape}')).rejects.toThrow(
			'Key sequence "{Escape}" was sent with nothing focused',
		)
	})
})

describe('traverseAccessible', () => {
	it('reaches a named control through forward Tab alone', async () => {
		const container = buildFixture(
			'<button type="button">First</button><button type="button">Evaluate</button>',
		)
		const reached = await traverseAccessible('Evaluate')
		expect(reached).toBe(container.querySelectorAll('button')[1])
		expect(document.activeElement).toBe(reached)
	})

	it('fails on its own cap rather than hanging when focus never lands anywhere', async () => {
		const container = buildFixture('<button type="button">Ghost</button>')
		const ghost = requireValue(container.querySelector('button'))
		ghost.addEventListener('focus', () => ghost.blur())
		await expect(traverseAccessible('Ghost')).rejects.toThrow(
			/^Interactive target "Ghost" is not reachable through forward Tab traversal: $/u,
		)
	})

	it('carries the trail of what focus did reach when the target rejects focus', async () => {
		const container = buildFixture(
			'<button type="button">Anchor</button><button type="button">Ghost</button>',
		)
		const ghost = requireValue(container.querySelectorAll('button')[1])
		ghost.addEventListener('focus', () => ghost.blur())
		await expect(traverseAccessible('Ghost')).rejects.toThrow(
			/^Interactive target "Ghost" is not reachable through forward Tab traversal: .+$/u,
		)
	})
})

describe('readPerception', () => {
	it('reads one named region, including its visually hidden text', () => {
		buildFixture(
			'<section aria-label="Run"><p>Answer   ready</p>' +
				'<span style="position: absolute; width: 1px; height: 1px; overflow: hidden; ' +
				'clip-path: inset(50%)">plus detail</span></section>',
		)
		expect(readPerception('Run')).toBe('Answer ready plus detail')
	})

	it('refuses a named region nothing renders', () => {
		buildFixture('<section aria-label="Gone" style="display: none">Answer ready</section>')
		expect(() => readPerception('Gone')).toThrow('Named region "Gone" is not visible')
	})

	it('refuses a name several visible regions carry', () => {
		buildFixture(
			'<section aria-label="Twin">Left</section><section aria-label="Twin">Right</section>',
		)
		expect(() => readPerception('Twin')).toThrow(
			'Named region "Twin" is ambiguous across 2 elements',
		)
	})

	it('reads a region whose label carries an aria-hidden glyph', () => {
		buildStylesheet(GLYPH_STYLE)
		buildFixture(
			'<section aria-labelledby="plan-heading">' +
				`<h2 id="plan-heading">${GLYPH_ICON} Build a carrier-ready schedule</h2>` +
				'<p>Two runs queued</p></section>',
		)
		expect(readPerception('Build a carrier-ready schedule')).toBe(
			'Build a carrier-ready schedule Two runs queued',
		)
	})

	it('refuses a region the accessibility tree withholds, painted or not', () => {
		buildFixture('<section aria-label="Muted" aria-hidden="true">Answer ready</section>')
		expect(() => readPerception('Muted')).toThrow('Named region "Muted" is not visible')
	})
})

describe('readPage', () => {
	it('reads the whole page as one normalized sentence', () => {
		buildFixture('<p>Alpha</p><p>Beta   gamma</p>')
		expect(readPage()).toBe('Alpha Beta gamma')
	})
})

describe('readFocus', () => {
	it('reads the rendered text of the focused control', async () => {
		buildFixture('<button type="button">First</button><button type="button">Evaluate</button>')
		await traverseAccessible('Evaluate')
		expect(readFocus()).toBe('Evaluate')
	})

	it('reads nothing when focus rests on an element that renders no text', async () => {
		buildFixture('<svg tabindex="0" width="20" height="20"><title>Chart</title></svg>')
		await userEvent.keyboard('{Tab}')
		expect(document.activeElement).toBeInstanceOf(SVGElement)
		expect(readFocus()).toBeUndefined()
	})

	it('reads the whole page when nothing holds focus', async () => {
		buildFixture('<button type="button">Evaluate</button><p>Answer ready</p>')
		await clickAccessible('Evaluate')
		const active = document.activeElement
		if (active instanceof HTMLElement) active.blur()
		expect(document.activeElement).toBe(document.body)
		const perceived = requireValue(readFocus())
		expect(perceived).toContain('Evaluate')
		expect(perceived).toContain('Answer ready')
	})
})

describe('readValue', () => {
	it('reads the value a resolved control renders', () => {
		buildFixture('<label for="runs">Runs</label><input id="runs" type="text" value="7">')
		expect(readValue('textbox', 'Runs')).toBe('7')
	})

	it('refuses a resolved control that carries no value', () => {
		buildFixture('<button type="button">Save</button>')
		expect(() => readValue('button', 'Save')).toThrow(
			'Interactive target "Save" does not carry a value',
		)
	})
})

describe('readRefusal', () => {
	// guides/test.md → Patterns → "Read the refusal instead of catching it". A browser fence carries
	// in this directory because the guides project runs with the browser disabled.
	it('reads the absent, the gated, and the ambiguous voices, and nothing for a target that resolves', () => {
		buildFixture(
			'<button type="button">Save changes</button>' +
				'<button type="button" style="display: none">Menu</button>' +
				'<div role="tablist"><button type="button" role="tab" id="tab-drafts">Drafts</button></div>' +
				'<div role="tabpanel" tabindex="0" aria-labelledby="tab-drafts">Two drafts waiting</div>',
		)

		expect(readRefusal('Save changes')).toBeUndefined()
		expect(readRefusal('Menu')).toBe('Interactive target "Menu" is not visible and focus-reachable')
		expect(readRefusal('Nowhere')).toBe('No interactive element has the accessible name "Nowhere"')
		expect(readRefusal('Drafts')).toBe('Interactive target "Drafts" is ambiguous across 2 elements')
		expect(readRefusal('tab', 'Drafts')).toBeUndefined()
	})

	// The control for the rethrow: every refusal the resolver has is an `Error`, so the branch that
	// hands anything else straight back is reached with a fixture element whose own `tabIndex` getter
	// refuses with a string. The element is this test's own and nothing the package owns is stood in
	// for; `isReachable` reads that property while filtering the resolver's matches.
	it('rethrows what the resolver threw when it is not an Error', () => {
		const container = buildFixture('<button type="button">Hostile</button>')
		const button = requireValue(container.querySelector('button'))
		Object.defineProperty(button, 'tabIndex', {
			get() {
				throw 'the host refused the reading'
			},
		})

		let caught: unknown
		try {
			readRefusal('Hostile')
		} catch (error) {
			caught = error
		}

		expect(caught).toBe('the host refused the reading')
	})

	// T3-C6. `undefined` is the value the rethrow cannot afford to lose: a resolver that returned and
	// a hostile getter that threw `undefined` are different findings, and a captured thrown value
	// reads them as one. The flag is what separates a throw from a returned `undefined`, so the
	// reading is left at a sentinel this call never produces.
	it('rethrows undefined from a hostile target rather than reading it as resolved', () => {
		const container = buildFixture('<button type="button">Hostile</button>')
		const button = requireValue(container.querySelector('button'))
		Object.defineProperty(button, 'tabIndex', {
			get() {
				throw undefined
			},
		})

		let threw = false
		let reading: string | undefined = 'unread'
		try {
			reading = readRefusal('Hostile')
		} catch {
			threw = true
		}

		expect(threw).toBe(true)
		expect(reading).toBe('unread')
	})
})

describe('readText', () => {
	it('drops an aria-hidden glyph and collapses the runs around it', () => {
		const container = buildFixture(
			'<button type="button"><span aria-hidden="true">*</span>  Save   changes </button>',
		)
		const target = requireValue(container.querySelector('button'))
		expect(readText(target)).toBe('Save changes')
		// `readRows` reads what the page paints, so the glyph stays there. The two readers answer
		// different questions about the same node.
		expect(readRows(container, 'button')).toStrictEqual(['* Save changes'])
	})

	it('reads an element with no text as an empty string', () => {
		const container = buildFixture('<div><span aria-hidden="true">*</span></div>')
		expect(readText(requireValue(container.querySelector('div')))).toBe('')
	})
})

describe('readRole', () => {
	it('answers for exactly the tags the map carries', () => {
		expect(IMPLICIT_ROLE_CASES.map((entry) => entry.tag).sort()).toStrictEqual(
			Object.keys(IMPLICIT_ROLES).sort(),
		)
		for (const entry of IMPLICIT_ROLE_CASES) {
			const container = buildFixture(entry.markup)
			expect({
				tag: entry.tag,
				role: readRole(requireValue(container.querySelector('#subject'))),
			}).toStrictEqual({ tag: entry.tag, role: entry.role })
		}
	})

	it('answers nothing for a tag the map leaves out', () => {
		const container = buildFixture('<blockquote id="subject">Quoted</blockquote>')
		expect(IMPLICIT_ROLES['BLOCKQUOTE']).toBeUndefined()
		expect(readRole(requireValue(container.querySelector('#subject')))).toBeUndefined()
	})

	it('takes a declared role over the implicit one, and its first token', () => {
		const container = buildFixture(
			'<ul id="tabs" role="tablist"></ul><ul id="menu" role="  menu   menubar ">One</ul>',
		)
		expect(readRole(requireValue(container.querySelector('#tabs')))).toBe('tablist')
		expect(readRole(requireValue(container.querySelector('#menu')))).toBe('menu')
	})

	it('makes a section a region only once something names it', () => {
		const container = buildFixture(
			'<section id="named" aria-label="Ledger">One</section>' +
				'<span id="caption">Vault</span><section id="referenced" aria-labelledby="caption">Two' +
				'</section><section id="bare">Three</section>',
		)
		expect(readRole(requireValue(container.querySelector('#named')))).toBe('region')
		expect(readRole(requireValue(container.querySelector('#referenced')))).toBe('region')
		expect(readRole(requireValue(container.querySelector('#bare')))).toBeUndefined()
	})

	it('heads whichever axis a th declares, and a column when it declares none', () => {
		const container = buildFixture(
			'<table><thead><tr><th id="column" scope="col">Month</th>' +
				'<th id="bare">Total</th></tr></thead>' +
				'<tbody><tr><th id="row" scope="row">April</th><td>7</td></tr></tbody></table>',
		)
		expect(readRole(requireValue(container.querySelector('#column')))).toBe('columnheader')
		expect(readRole(requireValue(container.querySelector('#row')))).toBe('rowheader')
		expect(readRole(requireValue(container.querySelector('#bare')))).toBe('columnheader')
	})

	it('makes an anchor a link only while it holds an href', () => {
		const container = buildFixture('<a id="linked" href="#ledger">Ledger</a><a id="bare">Vault</a>')
		expect(readRole(requireValue(container.querySelector('#linked')))).toBe('link')
		expect(readRole(requireValue(container.querySelector('#bare')))).toBeUndefined()
	})

	it('makes a select a combobox until it offers several rows at once', () => {
		const container = buildFixture(
			'<select id="one"><option>April</option></select>' +
				'<select id="many" multiple><option>April</option></select>' +
				'<select id="sized" size="3"><option>April</option></select>',
		)
		expect(readRole(requireValue(container.querySelector('#one')))).toBe('combobox')
		expect(readRole(requireValue(container.querySelector('#many')))).toBe('listbox')
		expect(readRole(requireValue(container.querySelector('#sized')))).toBe('listbox')
	})

	it('answers for exactly the input types the field map carries', () => {
		expect(FIELD_ROLE_CASES.map((entry) => entry.type).sort()).toStrictEqual(
			Object.keys(FIELD_ROLES).sort(),
		)
		for (const entry of FIELD_ROLE_CASES) {
			const container = buildFixture(`<input id="subject" type="${entry.type}">`)
			expect({
				type: entry.type,
				role: readRole(requireValue(container.querySelector('#subject'))),
			}).toStrictEqual({ type: entry.type, role: entry.role })
		}
	})

	it('answers nothing for an input type the field map leaves out', () => {
		const container = buildFixture('<input id="subject" type="color">')
		expect(FIELD_ROLES['color']).toBeUndefined()
		expect(readRole(requireValue(container.querySelector('#subject')))).toBeUndefined()
	})
})

describe('readName', () => {
	it('joins every id aria-labelledby names, in that order, skipping one nothing answers for', () => {
		const container = buildFixture(
			'<span id="verb">Save</span><span id="noun">changes</span>' +
				'<button type="button" aria-labelledby="verb absent noun">Ignored</button>',
		)
		expect(readName(requireValue(container.querySelector('button')))).toBe('Save changes')
	})

	it('drops an aria-hidden glyph from the text a content role is named by', () => {
		const container = buildFixture(
			'<button type="button"><span aria-hidden="true">*</span> Save </button>',
		)
		expect(readName(requireValue(container.querySelector('button')))).toBe('Save')
	})

	it('takes aria-label over the text inside the control', () => {
		const container = buildFixture('<button type="button" aria-label="Persist">Save</button>')
		expect(readName(requireValue(container.querySelector('button')))).toBe('Persist')
	})

	it("takes a form control's own labels", () => {
		const container = buildFixture('<label for="runs">Runs</label><input id="runs" type="text">')
		expect(readName(requireValue(container.querySelector('input')))).toBe('Runs')
	})

	it('names a button input by its value, because it renders no text', () => {
		const container = buildFixture('<input type="submit" value="Send">')
		expect(readName(requireValue(container.querySelector('input')))).toBe('Send')
	})

	it('names an image by its alternative text, over a title it also carries', () => {
		const container = buildFixture(
			'<img alt="Chart" title="Quarterly figures" src="data:image/gif;base64,R0lGODlhAQABAAAAACw=">',
		)
		expect(readName(requireValue(container.querySelector('img')))).toBe('Chart')
	})

	it('carries an image with no alternative text on down the chain to its title', () => {
		const container = buildFixture(
			'<img alt="" title="Chart" src="data:image/gif;base64,R0lGODlhAQABAAAAACw=">' +
				'<img id="untitled" alt="" src="data:image/gif;base64,R0lGODlhAQABAAAAACw=">',
		)
		expect(readName(requireValue(container.querySelector('img')))).toBe('Chart')
		expect(readName(requireValue(container.querySelector('#untitled')))).toBe('')
	})

	it('falls through to title, and to an empty string when nothing names it', () => {
		const container = buildFixture(
			'<div id="hinted" role="note" title="Why this matters">Body</div>' +
				'<div id="bare" role="note"></div>',
		)
		expect(readName(requireValue(container.querySelector('#hinted')))).toBe('Why this matters')
		expect(readName(requireValue(container.querySelector('#bare')))).toBe('')
	})
})

describe('readStates', () => {
	it('reports every declared state in one fixed order', () => {
		const container = buildFixture(
			'<span id="hint">Why</span><button type="button" disabled aria-expanded="true" ' +
				'aria-pressed="mixed" aria-current="page" aria-invalid="true" aria-selected="false" ' +
				'aria-live="polite" aria-describedby="hint" aria-busy="true">Save</button>',
		)
		expect(readStates(requireValue(container.querySelector('button')))).toStrictEqual([
			'disabled',
			'expanded',
			'pressed=mixed',
			'current',
			'invalid',
			'selected=false',
			'live=polite',
			'described',
			'busy',
		])
	})

	it('reads a native disclosure from the platform copy of its expansion', () => {
		const container = buildFixture(
			'<details id="shut"><summary>Advanced</summary></details>' +
				'<details id="open" open><summary>Basic</summary></details>',
		)
		expect(readStates(requireValue(container.querySelector('#shut summary')))).toStrictEqual([
			'collapsed',
		])
		expect(readStates(requireValue(container.querySelector('#open summary')))).toStrictEqual([
			'expanded',
		])
	})

	it('reads a field from the platform properties rather than from attributes alone', () => {
		const container = buildFixture(
			'<input id="agreed" type="checkbox" checked required><input id="fixed" type="text" readonly>',
		)
		expect(readStates(requireValue(container.querySelector('#agreed')))).toStrictEqual([
			'checked',
			'required',
		])
		expect(readStates(requireValue(container.querySelector('#fixed')))).toStrictEqual(['readonly'])
	})

	it('reads a control that declares nothing as no states at all', () => {
		const container = buildFixture('<button type="button">Save</button>')
		expect(readStates(requireValue(container.querySelector('button')))).toStrictEqual([])
	})
})

describe('describeTree', () => {
	it('indents by role, so an element carrying none leaves its children where it sat', () => {
		const container = buildFixture(
			'<main aria-label="Board"><div class="wrapper"><h2>Totals</h2>' +
				'<blockquote><h3>Quoted</h3></blockquote>' +
				'<ul><li>One</li><li aria-hidden="true">Muted</li></ul></div></main>',
		)
		// `div` and `blockquote` carry no role, so neither writes a line and neither adds a depth:
		// the `h3` inside the blockquote sits at the same indent as the `h2` outside it.
		expect(describeTree(requireValue(container.querySelector('main')))).toBe(
			[
				'main "Board"',
				'  heading "Totals"',
				'  heading "Quoted"',
				'  list',
				'    listitem "One"',
			].join('\n'),
		)
	})

	it('writes each line with its name and its states', () => {
		const container = buildFixture(
			'<section aria-label="Ledger"><button type="button" aria-expanded="false" disabled>' +
				'Add row</button></section>',
		)
		expect(describeTree(requireValue(container.querySelector('section')))).toBe(
			['region "Ledger"', '  button "Add row" [disabled, collapsed]'].join('\n'),
		)
	})

	it('drops an element the accessibility tree does not present, with its whole subtree', () => {
		const container = buildFixture(
			'<main aria-label="Board"><div style="display: none"><h2>Folded</h2></div>' +
				'<h2>Standing</h2></main>',
		)
		expect(describeTree(requireValue(container.querySelector('main')))).toBe(
			['main "Board"', '  heading "Standing"'].join('\n'),
		)
	})

	it('describes a subtree in which nothing carries a role as nothing', () => {
		const container = buildFixture('<div><span>One</span></div>')
		expect(describeTree(requireValue(container.querySelector('div')))).toBe('')
	})
})

describe('describeFocus', () => {
	it('puts a positive tabindex first in ascending order, then document order', () => {
		const container = buildFixture(
			'<button type="button">First</button>' +
				'<button type="button" tabindex="2">Second</button>' +
				'<button type="button" tabindex="1">Third</button>' +
				'<button type="button" disabled>Fourth</button>' +
				'<button type="button" tabindex="-1">Fifth</button>' +
				'<div style="display: none"><button type="button">Sixth</button></div>' +
				'<a href="#ledger">Seventh</a>',
		)
		expect(describeFocus(container)).toBe(
			['1. button "Third"', '2. button "Second"', '3. button "First"', '4. link "Seventh"'].join(
				'\n',
			),
		)
	})

	it('names a reachable control the role map does not answer for by its tag', () => {
		const container = buildFixture('<svg tabindex="0" width="20" height="20"></svg>')
		expect(describeFocus(container)).toBe('1. svg')
	})

	it('describes a subtree with no reachable control as nothing', () => {
		const container = buildFixture('<p>Answer ready</p>')
		expect(describeFocus(container)).toBe('')
	})
})

describe('waitForFrame', () => {
	it('resolves after the frame callbacks already queued have run', async () => {
		let painted = false
		requestAnimationFrame(() => {
			painted = true
		})
		await waitForFrame()
		expect(painted).toBe(true)
	})
})

describe('waitForState', () => {
	// The state flips on a timer rather than on the act, so the poll really goes from false to true:
	// a reading taken once after the act would pass whether or not anything waited.
	it('resolves after a timer flips the state and returns what the control announced', async () => {
		const container = buildFixture('<button type="button" aria-pressed="false">Pin note</button>')
		const button = requireValue(container.querySelector('button'))
		const pending = setTimeout(() => button.setAttribute('aria-pressed', 'true'), 30)
		try {
			expect(
				await waitForState('Pin note', 'pressed=true', { budget: 2000, interval: 5 }),
			).toStrictEqual(['pressed=true'])
		} finally {
			clearTimeout(pending)
		}
	})

	it('resolves the control afresh on every reading, so a replaced node is still the subject', async () => {
		const container = buildFixture('<button type="button" aria-pressed="false">Pin note</button>')
		const pending = setTimeout(() => {
			container.innerHTML = '<button type="button" aria-pressed="true">Pin note</button>'
		}, 30)
		try {
			expect(
				await waitForState('Pin note', 'pressed=true', { budget: 2000, interval: 5 }),
			).toStrictEqual(['pressed=true'])
		} finally {
			clearTimeout(pending)
		}
	})

	it('waits for the state to go away under absent', async () => {
		const container = buildFixture('<button type="button" aria-expanded="true">Filters</button>')
		const button = requireValue(container.querySelector('button'))
		const pending = setTimeout(() => button.setAttribute('aria-expanded', 'false'), 30)
		try {
			expect(
				await waitForState('button', 'Filters', 'expanded', {
					absent: true,
					budget: 2000,
					interval: 5,
				}),
			).toStrictEqual(['collapsed'])
		} finally {
			clearTimeout(pending)
		}
	})

	it('names the control, the state, and the last states read when it never arrives', async () => {
		buildFixture('<button type="button" aria-pressed="false">Pin note</button>')

		const thrown = await waitForState('Pin note', 'pressed=true', {
			budget: 10,
			interval: 5,
		}).catch((error: unknown) => error)

		const failure = requireValue(thrown instanceof Error ? thrown : undefined)
		expect(failure.message).toContain(
			'Condition ""Pin note" to announce "pressed=true"" did not hold within 10ms',
		)
		expect(failure.message).toContain('(last states: ["pressed=false"])')
	})

	// The resolver's own finding is the more useful one, so it reaches the caller rather than being
	// spent as one unsatisfying reading and reported as a timeout.
	it('propagates the resolver refusal rather than timing out on it', async () => {
		buildFixture('<button type="button" aria-pressed="false">Pin note</button>')

		await expect(waitForState('Unpin note', 'pressed=true', { budget: 2000 })).rejects.toThrow(
			'No interactive element has the accessible name "Unpin note"',
		)
	})

	it('refuses an invalid bound through the wait family', async () => {
		buildFixture('<button type="button" aria-pressed="false">Pin note</button>')

		await expect(waitForState('Pin note', 'pressed=true', { budget: Number.NaN })).rejects.toThrow(
			'Wait budget must be finite and non-negative',
		)
	})

	// T3-C14. The augmentation keys on what the reading threw and on the value the caller put on the
	// signal, never on how another module worded a message. An abort reason spelled exactly like this
	// wait's own timeout voice is the vector that separates the two: it leaves by identity, and the
	// caller's own error is not rewritten behind its back.
	it('rethrows an abort reason spelled like its own timeout voice by identity', async () => {
		buildFixture('<button type="button" aria-pressed="false">Pin</button>')
		const controller = new AbortController()
		const reason = new Error(
			'Condition ""Pin" to announce "pressed=true"" did not hold within 100ms (waited 0ms)',
		)
		const pending = setTimeout(() => controller.abort(reason), 20)
		try {
			const thrown = await waitForState('Pin', 'pressed=true', {
				signal: controller.signal,
				budget: 2000,
				interval: 5,
			}).catch((error: unknown) => error)

			// The abort lands after several readings, so the wait had a last observation to append and
			// did not append it.
			expect(thrown === reason).toBe(true)
			expect(reason.message).not.toContain('last states')
		} finally {
			clearTimeout(pending)
		}

		const aborted = new AbortController()
		const forged = new Error(
			'Condition ""Pin" to announce "pressed=true"" did not hold within 100ms (waited 0ms)',
		)
		aborted.abort(forged)

		// The same reason on a signal already aborted, where no reading was ever taken.
		const refused = await waitForState('Pin', 'pressed=true', {
			signal: aborted.signal,
			budget: 100,
		}).catch((error: unknown) => error)

		expect(refused === forged).toBe(true)
		expect(forged.message).not.toContain('last states')
	})

	// guides/test.md → Patterns → "Wait for what a control announces". A browser fence carries in
	// this directory because the guides project runs with the browser disabled.
	it('settles a pressed control after the act and a folded one after it collapses', async () => {
		const container = buildFixture(
			'<button type="button" aria-pressed="false">Pin note</button>' +
				'<button type="button" aria-expanded="true">Filters</button>',
		)
		const [pin, filters] = container.querySelectorAll('button')
		requireValue(pin).addEventListener('click', () => {
			setTimeout(() => requireValue(pin).setAttribute('aria-pressed', 'true'), 20)
		})
		requireValue(filters).addEventListener('click', () => {
			setTimeout(() => requireValue(filters).setAttribute('aria-expanded', 'false'), 20)
		})

		await clickAccessible('Pin note')
		expect(await waitForState('Pin note', 'pressed=true')).toStrictEqual(['pressed=true'])

		await clickAccessible('Filters')
		expect(await waitForState('button', 'Filters', 'expanded', { absent: true })).toStrictEqual([
			'collapsed',
		])
	})
})

describe('waitForAnimations', () => {
	it('resolves after a transition on a descendant ends', async () => {
		buildStylesheet('.settle-box { width: 10px; transition: width 80ms linear }')
		const container = buildFixture('<section><div class="settle-box"></div></section>')
		const section = requireValue(container.querySelector('section'))
		const box = requireValue(container.querySelector<HTMLElement>('.settle-box'))

		// A transition starts from a resolved value, so the starting width is read before it is
		// written. Without that read the browser has nothing to interpolate from and paints the new
		// width outright, which is a fact about starting transitions rather than about this wait.
		expect(readStyle(box, 'width')).toBe('10px')
		box.style.width = '200px'
		expect(section.getAnimations({ subtree: true })).toHaveLength(1)

		await waitForAnimations(section, { budget: 2000 })

		expect(section.getAnimations({ subtree: true })).toHaveLength(0)
		expect(readPixels(box, 'width')).toBe(200)
	})

	it('names the subject and the animation still running when the budget runs out', async () => {
		buildStylesheet('.slow-box { width: 10px; transition: width 5000ms linear }')
		const container = buildFixture(
			'<section aria-label="Ledger"><div class="slow-box"></div></section>',
		)
		const section = requireValue(container.querySelector('section'))
		const box = requireValue(container.querySelector<HTMLElement>('.slow-box'))
		expect(readStyle(box, 'width')).toBe('10px')
		box.style.width = '200px'

		const thrown = await waitForAnimations(section, { budget: 20 }).catch((error: unknown) => error)

		const failure = requireValue(thrown instanceof Error ? thrown : undefined)
		expect(failure.message).toContain('Animation "region "Ledger"" did not settle within 20ms')
		expect(failure.message).toContain('width')
	})

	// The control for the exclusion: an animation declaring infinite iterations is still running when
	// this resolves, so a wait that emptied the list outright would have timed out here instead.
	it('resolves while an animation declaring infinite iterations is still running', async () => {
		buildStylesheet(
			'@keyframes settle-spin { from { opacity: 1 } to { opacity: 0.2 } }' +
				'.settle-spin { animation: settle-spin 60ms linear infinite }',
		)
		const container = buildFixture('<section><span class="settle-spin">Working</span></section>')
		const section = requireValue(container.querySelector('section'))
		expect(section.getAnimations({ subtree: true })).toHaveLength(1)

		await waitForAnimations(section, { budget: 50 })

		expect(section.getAnimations({ subtree: true })).toHaveLength(1)
	})

	// T3-C11. The control for the `playState` exclusion the doc block, the bounds bullet, and the
	// Limits row all state: a paused animation is at rest, so the wait resolves while that animation
	// is still in the list a browser reports. Dropping the `playState` clause leaves it counted as
	// running and this case hangs to its budget instead.
	it('resolves while a paused animation is still in the list', async () => {
		const container = buildFixture('<section><div class="settle-paused"></div></section>')
		const section = requireValue(container.querySelector('section'))
		const box = requireValue(container.querySelector<HTMLElement>('.settle-paused'))
		const animation = box.animate({ opacity: [1, 0.2] }, { duration: 5000 })
		animation.pause()
		try {
			expect(animation.playState).toBe('paused')
			expect(section.getAnimations({ subtree: true })).toHaveLength(1)

			await waitForAnimations(section, { budget: 60 })

			expect(section.getAnimations({ subtree: true })).toHaveLength(1)
			expect(animation.playState).toBe('paused')
		} finally {
			animation.cancel()
		}
	})

	// T3-C11. The other half of the same exclusion: a finished animation filling its target stays in
	// the list a browser reports and is already at rest, so the wait resolves rather than parking on
	// something that has stopped moving.
	it('resolves while a finished animation filling its target is still in the list', async () => {
		const container = buildFixture('<section><div class="settle-filled"></div></section>')
		const section = requireValue(container.querySelector('section'))
		const box = requireValue(container.querySelector<HTMLElement>('.settle-filled'))
		const animation = box.animate({ opacity: [1, 0.2] }, { duration: 20, fill: 'forwards' })
		try {
			await animation.finished

			expect(animation.playState).toBe('finished')
			expect(section.getAnimations({ subtree: true })).toHaveLength(1)

			await waitForAnimations(section, { budget: 60 })

			expect(section.getAnimations({ subtree: true })).toHaveLength(1)
		} finally {
			animation.cancel()
		}
	})

	it('refuses a subject the document does not hold', async () => {
		await expect(waitForAnimations(build('div'))).rejects.toThrow(
			'Animation subject is not connected',
		)
	})

	it('refuses an invalid bound through the wait family', async () => {
		const container = buildFixture('<section></section>')

		await expect(
			waitForAnimations(requireValue(container.querySelector('section')), { budget: -1 }),
		).rejects.toThrow('Animation budget must be finite and non-negative')
	})

	// guides/test.md → Patterns → "Wait for the paint to stop moving". A browser fence carries in
	// this directory because the guides project runs with the browser disabled.
	it('reads the settled paint rather than the frame a transition was passing through', async () => {
		buildStylesheet(
			'.settle-panel { background-color: rgb(255, 255, 255); color: rgb(190, 190, 190);' +
				' transition: color 120ms linear }' +
				'.settle-panel.settle-done { color: rgb(0, 0, 0) }',
		)
		const container = buildFixture('<section class="settle-panel">Ready</section>')
		const panel = requireValue(container.querySelector('section'))

		expect(readStyle(panel, 'color')).toBe('rgb(190, 190, 190)')
		panel.classList.add('settle-done')
		const moving = readContrast(panel)

		await waitForAnimations(panel, { budget: 2000 })
		const settled = readContrast(panel)

		expect(settled).toBeGreaterThan(moving)
		expect(readStyle(panel, 'color')).toBe('rgb(0, 0, 0)')
	})
})

describe('build', () => {
	it('builds the element the tag names, wearing its classes, text, and attributes', () => {
		const element = build('button', {
			classes: 'primary wide',
			text: 'Save',
			attributes: { type: 'button', 'data-row': '3' },
		})
		expect(element.tagName).toBe('BUTTON')
		expect(element.className).toBe('primary wide')
		expect(element.textContent).toBe('Save')
		expect(element.type).toBe('button')
		expect(element.getAttribute('data-row')).toBe('3')
	})

	it('leaves the built element out of the document', () => {
		const element = build('div', { text: 'Ready' })
		expect(element.isConnected).toBe(false)
		expect(element.parentElement).toBeNull()
		expect(document.body.contains(element)).toBe(false)
	})

	it('builds a bare element when no options are given', () => {
		const element = build('span')
		expect(element.tagName).toBe('SPAN')
		expect(element.className).toBe('')
		expect(element.textContent).toBe('')
		expect(element.attributes).toHaveLength(0)
	})

	it('sets the text as text rather than parsing it as markup', () => {
		const element = build('p', { text: '<em>Save</em>' })
		expect(element.textContent).toBe('<em>Save</em>')
		expect(element.querySelector('em')).toBeNull()
	})
})

describe('mount', () => {
	it('attaches the element and hands the same one back', () => {
		const built = build('div', { classes: 'surface' })
		const mounted = mount(built)
		try {
			expect(mounted).toBe(built)
			expect(mounted.parentElement).toBe(document.body)
			expect(mounted.isConnected).toBe(true)
		} finally {
			built.remove()
		}
	})

	it('is what makes the element resolve against the cascade and lay out a box', () => {
		buildStylesheet(
			'.journey-mounted { box-sizing: border-box; display: block; padding-left: 12px; width: 40px }',
		)
		const built = build('div', { classes: 'journey-mounted' })
		// Unmounted, the element resolves the initial value for every property and has no box. This
		// pair is the whole contract: the append is what changes both answers.
		expect(readStyle(built, 'padding-left')).toBe('')
		expect(built.getBoundingClientRect().width).toBe(0)
		const mounted = mount(built)
		try {
			expect(readStyle(mounted, 'padding-left')).toBe('12px')
			expect(mounted.getBoundingClientRect().width).toBe(40)
		} finally {
			mounted.remove()
		}
	})

	// guides/test.md → Patterns → "Build and mount a fixture". A browser fence carries in this
	// directory because the guides project runs with the browser disabled.
	it('mounts a built fixture and takes every one back out on one hook', async () => {
		buildStylesheet('.primary { padding-left: 12px }')
		const teardown = createTeardown()
		const panel = mount(
			build('section', { classes: 'surface', attributes: { 'aria-label': 'Ledger' } }),
		)
		teardown.add(() => panel.remove())
		expect(panel.tagName).toBe('SECTION')
		expect(panel.className).toBe('surface')
		expect(panel.getAttribute('aria-label')).toBe('Ledger')
		expect(panel.isConnected).toBe(true)

		// Built and appended inside the mounted panel, so it resolves against the cascade: the
		// declared padding is what an unmounted element would have read as the initial value.
		panel.append(
			build('button', { classes: 'primary', text: 'Save', attributes: { type: 'button' } }),
		)
		const save = requireValue(panel.querySelector('button'))
		expect(save.textContent).toBe('Save')
		expect(save.getAttribute('type')).toBe('button')
		expect(readPixels(save, 'padding-left')).toBe(12)

		const markup = render('<button type="button">Save</button>')
		const heading = render('h2', 'title')
		teardown.add(() => markup.remove())
		teardown.add(() => heading.remove())
		// `render` hands back the attached container for markup and the attached element itself for a
		// tag, which is the pair the fence's two comments claim.
		expect(markup.tagName).toBe('DIV')
		expect(requireValue(markup.querySelector('button')).textContent).toBe('Save')
		expect(heading).toBeInstanceOf(HTMLHeadingElement)
		expect(heading.className).toBe('title')

		// The fence registers each removal as it goes, so one hook takes every fixture back out and
		// leaves the next test no resolver ambiguity.
		await teardown.destroy()
		expect(panel.isConnected).toBe(false)
		expect(markup.isConnected).toBe(false)
		expect(heading.isConnected).toBe(false)
	})
})

describe('render', () => {
	it('attaches parsed fixture markup to the document', () => {
		const container = render('<button type="button">Save</button>')
		try {
			expect(container.parentElement).toBe(document.body)
			expect(container.tagName).toBe('DIV')
			expect(requireValue(container.querySelector('button')).textContent).toBe('Save')
		} finally {
			container.remove()
		}
	})

	it('attaches the element itself for a tag and its classes', () => {
		const panel = render('section', 'surface muted')
		try {
			expect(panel.tagName).toBe('SECTION')
			expect(panel.className).toBe('surface muted')
			expect(panel.parentElement).toBe(document.body)
			expect(panel.isConnected).toBe(true)
		} finally {
			panel.remove()
		}
	})

	it('reads a lone argument as markup even when it spells a tag name', () => {
		const container = render('section')
		try {
			expect(container.tagName).toBe('DIV')
			expect(container.childElementCount).toBe(0)
			expect(container.textContent).toBe('section')
		} finally {
			container.remove()
		}
	})
})

describe('typeInput', () => {
	it('sets the value and dispatches one input event that bubbles', () => {
		const container = buildFixture('<input value="old">')
		const field = requireValue(container.querySelector('input'))
		const heard = createRecorder<[string, boolean]>()
		container.addEventListener('input', (event) => heard.handler(event.type, event.bubbles))
		typeInput(field, 'Ada')
		expect(field.value).toBe('Ada')
		expect(heard.calls).toStrictEqual([['input', true]])
	})

	it('has the value already set by the time the event is heard', () => {
		const container = buildFixture('<input value="old">')
		const field = requireValue(container.querySelector('input'))
		const seen = createRecorder<[string]>()
		container.addEventListener('input', () => seen.handler(field.value))
		typeInput(field, 'Ada')
		expect(seen.calls).toStrictEqual([['Ada']])
	})

	it('writes into a textarea as well as an input', () => {
		const container = buildFixture('<textarea></textarea>')
		const field = requireValue(container.querySelector('textarea'))
		typeInput(field, 'Two\nLines')
		expect(field.value).toBe('Two\nLines')
	})

	it('dispatches no change event', () => {
		const container = buildFixture('<input value="old">')
		const field = requireValue(container.querySelector('input'))
		const heard = createRecorder<[string]>()
		container.addEventListener('change', (event) => heard.handler(event.type))
		typeInput(field, 'Ada')
		expect(heard.count).toBe(0)
	})

	// guides/test.md → Patterns → "Drive a field the component listens to". A browser fence carries
	// in this directory because the guides project runs with the browser disabled.
	it('sends one input for a keystroke and an input then a change for a commit', () => {
		const container = render('<input aria-label="Runs" value="0">')
		try {
			const field = requireValue(container.querySelector('input'))
			// Each call records what a listener of the component's own would read: the event name, that
			// it bubbles, the value already on the field, and whether it is a plain `Event`.
			const heard = createRecorder<[string, boolean, string, boolean]>()
			for (const name of ['input', 'change']) {
				container.addEventListener(name, (event) =>
					heard.handler(
						event.type,
						event.bubbles,
						field.value,
						event.constructor === Event && !(event instanceof InputEvent),
					),
				)
			}

			typeInput(field, '3')
			expect(field.value).toBe('3')
			expect(heard.calls).toStrictEqual([['input', true, '3', true]])

			heard.clear()
			commitInput(field, '4')
			expect(field.value).toBe('4')
			expect(heard.calls).toStrictEqual([
				['input', true, '4', true],
				['change', true, '4', true],
			])
		} finally {
			container.remove()
		}
	})
})

describe('commitInput', () => {
	it('dispatches input and then change, both bubbling', () => {
		const container = buildFixture('<input value="old">')
		const field = requireValue(container.querySelector('input'))
		const heard = createRecorder<[string, boolean]>()
		container.addEventListener('input', (event) => heard.handler(event.type, event.bubbles))
		container.addEventListener('change', (event) => heard.handler(event.type, event.bubbles))
		commitInput(field, 'Ada')
		expect(field.value).toBe('Ada')
		expect(heard.calls).toStrictEqual([
			['input', true],
			['change', true],
		])
	})

	it('has the value set for both events', () => {
		const container = buildFixture('<input value="old">')
		const field = requireValue(container.querySelector('input'))
		const seen = createRecorder<[string]>()
		container.addEventListener('input', () => seen.handler(field.value))
		container.addEventListener('change', () => seen.handler(field.value))
		commitInput(field, 'Ada')
		expect(seen.calls).toStrictEqual([['Ada'], ['Ada']])
	})
})

describe('clearStorage', () => {
	it('empties local and session storage together', () => {
		localStorage.setItem('journey', 'one')
		sessionStorage.setItem('journey', 'two')
		expect(localStorage.getItem('journey')).toBe('one')
		expect(sessionStorage.getItem('journey')).toBe('two')
		clearStorage()
		expect(localStorage.getItem('journey')).toBeNull()
		expect(sessionStorage.getItem('journey')).toBeNull()
	})
})

describe('removeDatabase', () => {
	it('deletes a database the page created', async () => {
		const opened = await new Promise<IDBDatabase>((resolve, reject) => {
			const request = globalThis.indexedDB.open('journey-ledger', 1)
			request.addEventListener('success', () => resolve(request.result))
			request.addEventListener('error', () => reject(new Error('Ledger database did not open')))
		})
		opened.close()
		await expect(removeDatabase('journey-ledger')).resolves.toBeUndefined()
		// Read the deletion back through the registry rather than trusting the resolve, so a helper
		// that resolved without deleting anything reddens here.
		const registered = await globalThis.indexedDB.databases()
		expect(registered.map((entry) => entry.name)).not.toContain('journey-ledger')
	})

	it('resolves for a database that was never created', async () => {
		await expect(removeDatabase('journey-absent')).resolves.toBeUndefined()
	})

	it('rejects rather than waiting when an open connection blocks the deletion', async () => {
		const opened = await new Promise<IDBDatabase>((resolve, reject) => {
			const request = globalThis.indexedDB.open('journey-blocked', 1)
			request.addEventListener('success', () => resolve(request.result))
			request.addEventListener('error', () => reject(new Error('Blocked database did not open')))
		})
		try {
			await expect(removeDatabase('journey-blocked')).rejects.toThrow(
				'IndexedDB database "journey-blocked" is blocked by an open connection',
			)
		} finally {
			opened.close()
			await removeDatabase('journey-blocked')
		}
	})

	// guides/test.md → Patterns → "Remove an IndexedDB database". A browser fence carries in this
	// directory because the guides project runs with the browser disabled.
	it('deletes an absent database, refuses a held one, and deletes it after the close', async () => {
		// The fence's `afterEach` hook runs whether or not the test opened anything, which is this
		// call: deleting a database nothing created succeeds.
		await expect(removeDatabase('never-created')).resolves.toBeUndefined()

		const connection = await new Promise<IDBDatabase>((resolve, reject) => {
			const request = globalThis.indexedDB.open('ledger', 1)
			request.addEventListener('success', () => resolve(request.result))
			request.addEventListener('error', () => reject(new Error('Ledger database did not open')))
		})
		try {
			// With that connection still open the call rejects rather than waiting, so the suite cannot
			// leave the next test reading records through a database that reports itself deleted.
			await expect(removeDatabase('ledger')).rejects.toThrow(
				'IndexedDB database "ledger" is blocked by an open connection',
			)
		} finally {
			connection.close()
		}
		await expect(removeDatabase('ledger')).resolves.toBeUndefined()
		const registered = await globalThis.indexedDB.databases()
		expect(registered.map((entry) => entry.name)).not.toContain('ledger')
	})
})

describe('parseColor', () => {
	it('reads the legacy syntaxes, defaulting an absent alpha to one', () => {
		expect(parseColor('rgb(1, 2, 3)')).toStrictEqual([1, 2, 3, 1])
		expect(parseColor('rgba(1, 2, 3, 0.5)')).toStrictEqual([1, 2, 3, 0.5])
		expect(parseColor('rgba(0, 0, 0, 0)')).toStrictEqual([0, 0, 0, 0])
	})

	it('reads the modern syntax onto the same 0-255 scale', () => {
		expect(parseColor('color(srgb 0.5 0 0.5)')).toStrictEqual([127.5, 0, 127.5, 1])
		expect(parseColor('color(srgb 1 1 1 / 0.25)')).toStrictEqual([255, 255, 255, 0.25])
	})

	it('refuses a keyword, a hex triple, and the empty value a detached element computes', () => {
		expect(parseColor('rebeccapurple')).toBeUndefined()
		expect(parseColor('#ffffff')).toBeUndefined()
		expect(parseColor('')).toBeUndefined()
		expect(parseColor('color(unread 0.2 0.3 0.4)')).toBeUndefined()
	})

	it('reads what this browser actually computes, rather than only what a literal declares', () => {
		// The cases above are declarations. This one asks the engine which syntax it hands back for a
		// keyword and for a `color-mix()`, so a browser that changed either answer reddens here.
		const container = buildFixture(
			'<p id="named" style="color: rebeccapurple">Ready</p>' +
				'<p id="mixed" style="color: color-mix(in srgb, red 50%, blue)">Ready</p>',
		)
		const named = getComputedStyle(requireValue(container.querySelector('#named'))).color
		const mixed = getComputedStyle(requireValue(container.querySelector('#mixed'))).color
		expect(named).toBe('rgb(102, 51, 153)')
		expect(mixed).toBe('color(srgb 0.5 0 0.5)')
		expect(parseColor(named)).toStrictEqual([102, 51, 153, 1])
		expect(parseColor(mixed)).toStrictEqual([127.5, 0, 127.5, 1])
	})

	it('hands back a frozen color', () => {
		const parsed = requireValue(parseColor('rgb(1, 2, 3)'))
		expect(Object.isFrozen(parsed)).toBe(true)
	})
})

describe('parseCSSColor', () => {
	it('resolves the syntaxes parseColor refuses, by asking the browser', () => {
		// Each of these returns `undefined` from `parseColor`, which is what the live resolver is for.
		expect(parseColor('rebeccapurple')).toBeUndefined()
		expect(parseColor('#ff0000')).toBeUndefined()
		expect(parseCSSColor('rebeccapurple')).toStrictEqual([102, 51, 153, 1])
		expect(parseCSSColor('#ff0000')).toStrictEqual([255, 0, 0, 1])
		expect(parseCSSColor('rgb(1, 2, 3)')).toStrictEqual([1, 2, 3, 1])
	})

	it('resolves a var() reference against the tokens the document declares', () => {
		buildStylesheet(':root { --journey-ink: rgb(10, 20, 30) }')
		expect(parseCSSColor('var(--journey-ink)')).toStrictEqual([10, 20, 30, 1])
	})

	it('refuses an expression the CSSOM will not parse', () => {
		expect(parseCSSColor('not-a-color')).toBeUndefined()
		expect(parseCSSColor('')).toBeUndefined()
		expect(parseCSSColor('12px')).toBeUndefined()
	})

	it('leaves no probe element behind, on the refusing path as well as the reading one', () => {
		const before = document.body.childElementCount
		expect(parseCSSColor('rebeccapurple')).toStrictEqual([102, 51, 153, 1])
		expect(parseCSSColor('not-a-color')).toBeUndefined()
		expect(document.body.childElementCount).toBe(before)
		expect(document.body.querySelector(':scope > span')).toBeNull()
	})
})

describe('matchesColor', () => {
	it('reads two spellings of one color as equal', () => {
		expect(matchesColor('rebeccapurple', 'rgb(102, 51, 153)')).toBe(true)
		expect(matchesColor('#ff0000', [255, 0, 0, 1])).toBe(true)
		expect(matchesColor([1, 2, 3, 1], [1, 2, 3, 1])).toBe(true)
	})

	it('reads different colors as unequal, including on alpha alone', () => {
		expect(matchesColor('red', [0, 0, 255, 1])).toBe(false)
		expect(matchesColor([1, 2, 3, 1], [1, 2, 3, 0.5])).toBe(false)
	})

	it('holds at the tolerance and parts one step past it', () => {
		expect(matchesColor([10, 20, 30, 1], [10.5, 20, 30, 1])).toBe(true)
		expect(matchesColor([10, 20, 30, 1], [10.6, 20, 30, 1])).toBe(false)
		// The alpha is scaled onto the same 0-255 range before it is compared, so half a channel step
		// on the 0-1 scale is `0.5 / 255`.
		expect(matchesColor([10, 20, 30, 1], [10, 20, 30, 1 - 0.5 / 255])).toBe(true)
		expect(matchesColor([10, 20, 30, 1], [10, 20, 30, 1 - 0.6 / 255])).toBe(false)
	})

	it('reports false when either side names no readable color', () => {
		expect(matchesColor('not-a-color', 'red')).toBe(false)
		expect(matchesColor('red', 'not-a-color')).toBe(false)
		expect(matchesColor('not-a-color', 'not-a-color')).toBe(false)
	})
})

describe('blendColor', () => {
	it('composites a translucent front onto an opaque back', () => {
		expect(blendColor([255, 255, 255, 0.5], [0, 0, 0, 1])).toStrictEqual([127.5, 127.5, 127.5, 1])
	})

	it('keeps an opaque front and keeps the back under a fully transparent one', () => {
		expect(blendColor([10, 20, 30, 1], [0, 0, 0, 1])).toStrictEqual([10, 20, 30, 1])
		expect(blendColor([10, 20, 30, 0], [1, 2, 3, 1])).toStrictEqual([1, 2, 3, 1])
	})

	it('always returns an opaque result', () => {
		const [, , , alpha] = blendColor([10, 20, 30, 0.25], [0, 0, 0, 0.5])
		expect(alpha).toBe(1)
	})
})

describe('measureLuminance', () => {
	it('weighs black at zero and white at one', () => {
		expect(measureLuminance([0, 0, 0, 1])).toBe(0)
		expect(measureLuminance([255, 255, 255, 1])).toBeCloseTo(1, 10)
	})

	it('weighs green above red above blue at one channel value', () => {
		const red = measureLuminance([255, 0, 0, 1])
		const green = measureLuminance([0, 255, 0, 1])
		const blue = measureLuminance([0, 0, 255, 1])
		expect(green).toBeGreaterThan(red)
		expect(red).toBeGreaterThan(blue)
	})

	it('ignores the alpha it is handed', () => {
		expect(measureLuminance([255, 255, 255, 0])).toBe(measureLuminance([255, 255, 255, 1]))
	})
})

describe('measureContrast', () => {
	it('reaches 21 for black against white and 1 for a color against itself', () => {
		expect(measureContrast([0, 0, 0, 1], [255, 255, 255, 1])).toBeCloseTo(21, 10)
		expect(measureContrast([17, 34, 51, 1], [17, 34, 51, 1])).toBe(1)
	})

	it('returns the same ratio whichever way the pair is handed over', () => {
		const front: Color = [30, 60, 90, 1]
		const back: Color = [200, 210, 220, 1]
		expect(measureContrast(front, back)).toBe(measureContrast(back, front))
	})
})

describe('readLayers', () => {
	it('collects nothing when nothing from the element upwards paints', () => {
		const container = buildFixture('<p style="color: #000">Ready</p>')
		expect(readLayers(requireValue(container.querySelector('p')))).toStrictEqual([])
	})

	it('collects the painted layers element first and leaves a transparent one out', () => {
		const container = buildFixture(
			'<div style="background: rgba(255, 0, 0, 0.5)">' +
				'<div style="background: transparent">' +
				'<p style="background: rgba(0, 0, 255, 0.25); color: #000">Ready</p></div></div>',
		)
		expect(readLayers(requireValue(container.querySelector('p')))).toStrictEqual([
			[0, 0, 255, 0.25],
			[255, 0, 0, 0.5],
		])
	})

	it('stops at the first opaque layer, so nothing above it is collected', () => {
		const container = buildFixture(
			'<div style="background: rgba(0, 255, 0, 0.5)">' +
				'<div style="background: rgb(255, 0, 0)">' +
				'<p style="color: #000">Ready</p></div></div>',
		)
		expect(readLayers(requireValue(container.querySelector('p')))).toStrictEqual([[255, 0, 0, 1]])
	})

	it('keeps the deepest layer translucent where the composite rounds to the floor', () => {
		// The reading that separates a resolved backdrop from an assumed one survives here while the
		// composite does not: 64 half-white layers blend to white over black and over white alike.
		const depth = 64
		const container = buildFixture(
			'<div style="background: rgba(255, 255, 255, 0.5)">'.repeat(depth) +
				'<p style="color: #000">Ready</p>' +
				'</div>'.repeat(depth),
		)
		const paragraph = requireValue(container.querySelector('p'))
		expect(readLayers(paragraph)).toHaveLength(depth)
		expect(readLayers(paragraph).at(-1)).toStrictEqual([255, 255, 255, 0.5])
		expect(readBackdrop(paragraph, CANVAS_COLOR)).toStrictEqual(
			readBackdrop(paragraph, [0, 0, 0, 1]),
		)
	})
})

describe('readBackdrop', () => {
	it('hands the floor back by identity when nothing above the element paints', () => {
		const container = buildFixture('<p style="color: #000">Ready</p>')
		const floor: Color = [1, 2, 3, 1]
		expect(readBackdrop(requireValue(container.querySelector('p')), floor)).toBe(floor)
	})

	it('composites every translucent layer onto the supplied floor', () => {
		const container = buildFixture(
			'<div style="background: rgba(255, 255, 255, 0.5)">' +
				'<p style="color: #000">Ready</p></div>',
		)
		expect(readBackdrop(requireValue(container.querySelector('p')), [0, 0, 0, 1])).toStrictEqual([
			127.5, 127.5, 127.5, 1,
		])
	})

	it('stops at the first opaque layer, so a floor beneath it changes nothing', () => {
		const container = buildFixture(
			'<div style="background: #000"><p style="color: #fff">Ready</p></div>',
		)
		const paragraph = requireValue(container.querySelector('p'))
		expect(readBackdrop(paragraph, CANVAS_COLOR)).toStrictEqual([0, 0, 0, 1])
		expect(readBackdrop(paragraph, [255, 0, 0, 1])).toStrictEqual([0, 0, 0, 1])
	})
})

describe('readContrast', () => {
	it('refuses a detached element whose foreground has no computed channels', () => {
		const detached = document.createElement('p')
		expect(() => readContrast(detached)).toThrow('Computed foreground color is unavailable')
	})

	it('measures a fully opaque stack from the element that paints, ignoring its ancestors', () => {
		const container = buildFixture(
			'<div style="background: #fff"><p style="background: #000; color: #fff">Ready</p></div>' +
				'<div style="background: #000"><p style="background: #000; color: #fff">Ready</p></div>',
		)
		const [over, under] = container.querySelectorAll('p')
		expect(readContrast(requireValue(over))).toBeCloseTo(21, 5)
		expect(readContrast(requireValue(under))).toBeCloseTo(21, 5)
	})

	it('composites a translucent surface onto the opaque layer beneath it', () => {
		const container = buildFixture(
			'<div style="background: #000">' +
				'<p style="background: rgba(255, 255, 255, 0.5); color: #000">Ready</p></div>',
		)
		const composited = readContrast(requireValue(container.querySelector('p')))
		// A 50% white tint over black paints mid-grey, so black text on it reads far below the 21
		// an uncomposited reading of the same declaration would report.
		expect(composited).toBeCloseTo(5.28, 1)
		expect(composited).toBeLessThan(21)
	})

	it('refuses a stack where nothing from the element upwards paints a background', () => {
		const container = buildFixture('<p style="color: #000">Ready</p>')
		expect(() => readContrast(requireValue(container.querySelector('p')))).toThrow(
			'Computed background color is unavailable',
		)
	})

	it('refuses a stack whose painted layers are all translucent, because the canvas shows through', () => {
		const container = buildFixture(
			'<div style="background: rgba(255, 255, 255, 0.5)">' +
				'<p style="color: #000">Ready</p></div>',
		)
		expect(() => readContrast(requireValue(container.querySelector('p')))).toThrow(
			'Computed background color is unavailable',
		)
	})

	it('refuses a deep translucent stack whose composite has rounded to the floor itself', () => {
		// 64 half-white layers composite to 255 exactly in binary floating point, because the
		// remaining 2^-64 of the floor falls below the last bit 255 carries. A refusal decided by
		// reading the same stack over two opposite floors therefore sees two identical answers and
		// admits a stack no layer of which is opaque. The refusal must turn on the deepest layer's
		// own alpha instead.
		const depth = 64
		const container = buildFixture(
			'<div style="background: rgba(255, 255, 255, 0.5)">'.repeat(depth) +
				'<p style="color: #000">Ready</p>' +
				'</div>'.repeat(depth),
		)
		expect(() => readContrast(requireValue(container.querySelector('p')))).toThrow(
			'Computed background color is unavailable',
		)
	})

	it('measures the same unpainted stack against a supplied floor instead of refusing it', () => {
		const container = buildFixture('<p style="color: #000">Ready</p>')
		const paragraph = requireValue(container.querySelector('p'))
		expect(readContrast(paragraph, CANVAS_COLOR)).toBeCloseTo(21, 5)
		expect(readContrast(paragraph, [0, 0, 0, 1])).toBe(1)
	})

	it('composites a translucent stack onto the supplied floor', () => {
		const container = buildFixture(
			'<div style="background: rgba(255, 255, 255, 0.5)">' +
				'<p style="color: #000">Ready</p></div>',
		)
		const paragraph = requireValue(container.querySelector('p'))
		// The same half-white tint resolves to white over the canvas and to mid grey over black, so
		// the floor is what the answer turns on rather than an argument the measurement ignores.
		expect(readContrast(paragraph, CANVAS_COLOR)).toBeCloseTo(21, 5)
		expect(readContrast(paragraph, [0, 0, 0, 1])).toBeCloseTo(5.28, 1)
	})

	it('refuses a detached element whichever floor it is handed', () => {
		expect(() => readContrast(document.createElement('p'), CANVAS_COLOR)).toThrow(
			'Computed foreground color is unavailable',
		)
	})

	// guides/test.md → Patterns → "Measure what a reader sees", the `readContrast` fence. A browser fence
	// carries in this directory because the guides project runs with the browser disabled.
	it('reads grey on white at 4.54, refuses it unpainted, and measures it on a named floor', () => {
		const surface = buildFixture(
			'<main style="background:#fff"><p style="color:#767676">Ready</p></main>',
		)
		const text = requireValue(surface.querySelector('p'))
		expect(readContrast(text).toFixed(2)).toBe('4.54')
		expect(readContrast(text) >= 4.5).toBe(true)

		const fragment = buildFixture('<p style="color:#767676">Ready</p>')
		const orphan = requireValue(fragment.querySelector('p'))
		expect(() => readContrast(orphan)).toThrow('Computed background color is unavailable')
		expect(readContrast(orphan, CANVAS_COLOR).toFixed(2)).toBe('4.54')
	})
})

describe('readRing', () => {
	// guides/test.md → Patterns → "Measure what a reader sees", the `readRing` fence. A browser fence
	// carries in this directory because the guides project runs with the browser disabled.
	it('measures the ring the cascade paints once focus has landed, and the label it is worn on', async () => {
		buildStylesheet(
			'.journey-ring:focus-visible { outline: 3px solid rgb(0, 0, 0) }' +
				'.journey-ring-label { outline: 3px solid rgb(250, 250, 250) }',
		)
		const container = buildFixture(
			'<div style="background: #fff">' +
				'<button type="button" id="evaluate" class="journey-ring">Evaluate</button>' +
				'<label for="evaluate" class="journey-ring-label">Evaluate</label></div>',
		)
		const focused = await traverseAccessible('Evaluate')
		expect(focused.matches(':focus-visible')).toBe(true)
		// Black against white is the strongest ratio a ring can reach, so a reading below it means
		// the measurement found some other paint.
		expect(readRing(focused)).toBeCloseTo(21, 5)
		// The label is the second element the control is: it wears a near-white ring that is nearly
		// invisible on white, so this reading is the worn element's paint rather than the control's.
		const worn = requireValue(container.querySelector('label[for="evaluate"]'))
		expect(requireValue(readRing(focused, worn))).toBeLessThan(1.1)
	})

	it('reports nothing for a control that is not showing focus chrome', () => {
		const container = buildFixture('<button type="button">Idle</button>')
		expect(readRing(requireValue(container.querySelector('button')))).toBeUndefined()
	})

	it('reports nothing for a focused control the cascade leaves the browser ring', async () => {
		buildFixture('<button type="button">Bare</button>')
		const control = await traverseAccessible('Bare')
		expect(control.matches(':focus-visible')).toBe(true)
		expect(readStyle(control, 'outline-style')).toBe('auto')
		expect(readRing(control)).toBeUndefined()
	})

	it('measures the element the chrome is worn on rather than the one holding focus', async () => {
		buildStylesheet(
			'.journey-worn { outline: 3px solid rgb(0, 0, 0) }' +
				'.journey-holder:focus-visible { outline: 3px solid rgb(250, 250, 250) }',
		)
		const container = buildFixture(
			'<div style="background: #fff">' +
				'<button type="button" class="journey-holder">Hold</button>' +
				'<span class="journey-worn">Worn</span></div>',
		)
		const control = await traverseAccessible('Hold')
		const worn = requireValue(container.querySelector('.journey-worn'))
		// The holder's own near-white ring is nearly invisible on white; the worn element's black one
		// is not, so the two readings separate and `worn` is what decided the second.
		expect(requireValue(readRing(control))).toBeLessThan(1.1)
		expect(readRing(control, worn)).toBeCloseTo(21, 5)
	})

	it('reports nothing for a focus style that only repaints the control fill', async () => {
		buildStylesheet(
			'.journey-fill { background: rgb(255, 255, 255) }' +
				'.journey-fill:focus-visible { outline: none; background: rgb(0, 0, 0) }',
		)
		buildFixture(
			'<div style="background: #fff">' +
				'<button type="button" class="journey-fill">Filled</button></div>',
		)
		const control = await traverseAccessible('Filled')
		expect(readStyle(control, 'background-color')).toBe('rgb(0, 0, 0)')
		// The resting fill is gone by the time focus is on the control, so nothing here is a reading
		// about focus and the measurement says so rather than scoring the control's ordinary chrome.
		expect(readRing(control)).toBeUndefined()
	})

	it('reads a box-shadow ring when no outline is painted', async () => {
		buildStylesheet(
			'.journey-shadow:focus-visible { outline: none; box-shadow: 0 0 0 3px rgb(0, 0, 0) }',
		)
		buildFixture(
			'<div style="background: #fff">' +
				'<button type="button" class="journey-shadow">Shadowed</button></div>',
		)
		const control = await traverseAccessible('Shadowed')
		expect(readRing(control)).toBeCloseTo(21, 5)
	})
})

describe('measureContent', () => {
	// guides/test.md → Patterns → "Measure a document's content edge". A browser fence carries in
	// this directory because the guides project runs with the browser disabled.
	it('reads one content edge under a pane the document outruns and under a pane it does not', async () => {
		buildFixture('<div style="height: 1600px">Taller than the pane</div>')
		await stagePane(390, 844)
		const short = [measureContent(), document.documentElement.scrollHeight]
		await stagePane(390, 2356)
		const tall = [measureContent(), document.documentElement.scrollHeight]
		await releasePane()

		// The scroll height is the second reading of each pair, and it is what the content edge is
		// measured against: the two agree under the shorter pane, where the body's box is the
		// document's own height, and part company under the taller one, where the box is the pane.
		expect(short).toStrictEqual([1600, 1600])
		expect(tall).toStrictEqual([1600, 2356])
	})

	it('counts a trailing bottom margin and a bottom padding on the body', async () => {
		// The last element's own bottom margin sits outside its client rectangle, and the body's
		// bottom padding sits under every child, so a reading taken from rectangles alone stops 100
		// rows short of the document here.
		buildStylesheet('body { padding-bottom: 40px }')
		buildFixture('<div style="height: 1600px; margin-bottom: 60px">Trailing margin</div>')
		await stagePane(390, 844)
		const short = [measureContent(), document.documentElement.scrollHeight]
		await stagePane(390, 2356)
		const tall = measureContent()
		await releasePane()

		// 1600 rows of content, the child's 60-row bottom margin, and the body's 40-row bottom
		// padding. The scroll height agrees under the shorter pane, which is what makes 1700 the
		// document's own height rather than this helper's opinion of it.
		expect(short).toStrictEqual([1700, 1700])
		expect(tall).toBe(1700)
	})
})

describe('stagePane', () => {
	it('marks the pane, renders the tester at the viewport it was given, and releases both', async () => {
		const pane = requireValue(window.frameElement?.parentElement)
		const owner = pane.ownerDocument
		expect(pane.hasAttribute(CAPTURE_PANE)).toBe(false)
		await stagePane(390, 844)
		expect(pane.hasAttribute(CAPTURE_PANE)).toBe(true)
		expect(owner.querySelector(`style[${CAPTURE_PANE}]`)).not.toBeNull()
		const box = requireValue(window.frameElement).getBoundingClientRect()
		expect(Math.round(box.width)).toBe(390)
		expect(Math.round(box.height)).toBe(844)
		expect(window.innerWidth).toBe(390)
		await releasePane()
		expect(pane.hasAttribute(CAPTURE_PANE)).toBe(false)
		expect(owner.querySelector(`style[${CAPTURE_PANE}]`)).toBeNull()
	})

	it('hands the tester back the viewport it had before the staging', async () => {
		// Read rather than written out, so the case pins the hand-back itself instead of the size the
		// runner happens to start this file at.
		const before = [window.innerWidth, window.innerHeight]
		await stagePane(390, 844)
		expect([window.innerWidth, window.innerHeight]).toStrictEqual([390, 844])
		// A capture stages twice when the document outruns the pane, and the release owes the tester
		// the viewport it had before the first staging rather than the one the second left.
		await stagePane(390, 1200)
		expect([window.innerWidth, window.innerHeight]).toStrictEqual([390, 1200])
		await releasePane()
		expect([window.innerWidth, window.innerHeight]).toStrictEqual(before)
	})

	it('releases an unstaged pane without complaining', async () => {
		const pane = requireValue(window.frameElement?.parentElement)
		const before = [window.innerWidth, window.innerHeight]
		await releasePane()
		await releasePane()
		expect(pane.hasAttribute(CAPTURE_PANE)).toBe(false)
		expect([window.innerWidth, window.innerHeight]).toStrictEqual(before)
	})
})

describe('captureFrame', () => {
	it('writes a real file, reads it back, and returns the verified absolute path', async () => {
		const written = await captureFrame({ path: `${FRAMES}/page.png`, width: 390, height: 844 })
		// The provider returns the written path in its host's own separator, and the runner reports
		// its root with forward slashes on every host, so each side is compared through
		// `rewriteWindowsAbsolutePath` and the comparison reads the file rather than the separator.
		expect(rewriteWindowsAbsolutePath(written)).toBe(
			rewriteWindowsAbsolutePath(`${server.config.root}/tmp/capture/frame/page.png`),
		)
		const onDisk = await commands.readFile(written, 'base64')
		expect(onDisk.length).toBeGreaterThan(0)
		// The negative control for the equality `captureFrame` asserts: bytes that are not this
		// frame's read back different, so the comparison discriminates rather than always holding.
		const planted = `${server.config.root}/tmp/capture/frame/planted.png`
		await commands.writeFile(planted, 'not a frame')
		expect(await commands.readFile(planted, 'base64')).not.toBe(onDisk)
	})

	it('refuses a pane that will not render at the viewport, and hands it back anyway', async () => {
		const pane = requireValue(window.frameElement?.parentElement)
		// The staging rule sizes the tester from the runner's own custom properties. A rule of higher
		// specificity, marked important, outranks it, so the pane renders at a size the viewport never
		// asked for and `stagePane` refuses instead of shooting a frame of the wrong surface.
		const pinned = pane.ownerDocument.createElement('style')
		pinned.textContent =
			'html iframe[data-vitest] { width: 200px !important; height: 200px !important }'
		pane.ownerDocument.head.append(pinned)
		try {
			await expect(
				captureFrame({ path: `${FRAMES}/refused.png`, width: 390, height: 844 }),
			).rejects.toThrow('Tester pane rendered 200x200 for a 390x844 viewport')
		} finally {
			pinned.remove()
		}
		expect(pane.hasAttribute(CAPTURE_PANE)).toBe(false)
		expect(pane.ownerDocument.querySelector(`style[${CAPTURE_PANE}]`)).toBeNull()
	})

	it('shoots one element rather than the page, and releases the pane either way', async () => {
		const container = buildFixture(
			'<div style="background: #000; width: 40px; height: 40px">.</div>',
		)
		const pane = requireValue(window.frameElement?.parentElement)
		const whole = await captureFrame({ path: `${FRAMES}/whole.png`, width: 390, height: 844 })
		const part = await captureFrame({
			path: `${FRAMES}/part.png`,
			width: 390,
			height: 844,
			element: requireValue(container.firstElementChild),
		})
		expect(pane.hasAttribute(CAPTURE_PANE)).toBe(false)
		const shot = await commands.readFile(part, 'base64')
		expect(shot.length).toBeGreaterThan(0)
		expect(shot).not.toBe(await commands.readFile(whole, 'base64'))
	})

	it('covers a document taller than the pane, down to its last row and no further', async () => {
		// The background is declared on the root element, so the browser paints it across the whole
		// canvas the document owns rather than across a box inside it. Everything the frame holds
		// beyond that canvas is the runner's own page, which is white, so the bottom row is what
		// separates a covered document from a clipped one.
		//
		// The height is an equality against the fixture's own declared 1600, not a floor. A frame
		// taller than the document is rows nothing in the document asked for, and it paints the same
		// floor as a covered one because the root's background covers the whole canvas the pane
		// stretched — so `toBeGreaterThanOrEqual` reads a 2356-row frame as coverage.
		buildStylesheet('html { background: rgb(0, 128, 0) }')
		buildFixture('<div style="height: 1600px">Taller than the pane</div>')

		const written = await captureFrame({ path: `${FRAMES}/tall.png`, width: 390, height: 844 })
		const reading = await readFrame(written)
		expect(reading.width).toBe(390)
		expect(reading.height).toBe(1600)
		expect(reading.floor).toBe('rgb(0, 128, 0)')
	})

	it('settles a document whose height converges under a viewport-bound rule', async () => {
		// `min-height: 50vh` plus a fixed 900-row block is a document whose height is half the pane
		// plus 900, so it converges on 1800 and never reaches it by restaging at the height last
		// read: each staging closes half the remaining gap. The two readings below are that
		// approach measured — 1322 under the declared pane, 1561 under a pane staged at 1322 — so a
		// fixture that stops converging reddens here rather than passing on a document that settles
		// on its own.
		buildStylesheet('html { background: rgb(0, 128, 0) } .half { min-height: 50vh }')
		buildFixture('<div class="half">Half</div><div style="height: 900px">Beyond</div>')
		await stagePane(390, 844)
		const first = document.documentElement.scrollHeight
		await stagePane(390, first)
		const second = document.documentElement.scrollHeight
		await releasePane()
		expect([first, second]).toStrictEqual([1322, 1561])

		const written = await captureFrame({
			path: `${FRAMES}/converging.png`,
			width: 390,
			height: 844,
		})
		const reading = await readFrame(written)
		expect(reading.width).toBe(390)
		// 900 fixed rows over a rule that keeps half the pane: the fixed point is 900 / (1 - 1/2),
		// written out rather than read back from the capture that staged it.
		expect(reading.height).toBe(1800)
		expect(reading.floor).toBe('rgb(0, 128, 0)')
	})

	it('shoots a document shorter than the pane at the pane height, on the same floor', async () => {
		buildStylesheet('html { background: rgb(0, 128, 0) }')
		buildFixture('<div style="height: 40px">Shorter than the pane</div>')
		const written = await captureFrame({ path: `${FRAMES}/short.png`, width: 390, height: 844 })
		const reading = await readFrame(written)
		expect(reading.width).toBe(390)
		expect(reading.height).toBe(844)
		expect(reading.floor).toBe('rgb(0, 128, 0)')
	})

	it('covers a body whose box ends on a fraction of a pixel', async () => {
		// The provider clips the shot to the body's own box, and that box can end part way through a
		// row. `scrollHeight` is an integer, so a box ending on a fraction under a half reads back a
		// row short and a pane staged from that reading leaves the last row to the runner's page.
		// The rounding is what the case turns on, so it is measured under the staged pane rather
		// than assumed: a browser that rounds the other way reddens here instead of passing quietly.
		buildStylesheet('html { background: rgb(0, 128, 0) }')
		buildFixture('<div style="height: 1600px; padding-bottom: 0.25px">Fractional</div>')
		await stagePane(390, 844)
		const box = document.body.getBoundingClientRect().height
		const rounded = document.documentElement.scrollHeight
		await releasePane()
		expect(rounded).toBeLessThan(Math.ceil(box))

		const written = await captureFrame({ path: `${FRAMES}/fraction.png`, width: 390, height: 844 })
		const reading = await readFrame(written)
		expect(reading.width).toBe(390)
		expect(reading.height).toBeGreaterThanOrEqual(Math.ceil(box))
		expect(reading.floor).toBe('rgb(0, 128, 0)')
	})

	it('re-reads the document after the pane grows, and covers what the reflow added', async () => {
		// A rule bound to the viewport height lays the document out taller against the taller pane,
		// so the height read before the restaging is already stale when the shot is taken. The media
		// query caps that growth, which is what makes this the re-reading case rather than the
		// refusal below. The height before the reflow and the height after it are measured here, so
		// a fixture that stops reflowing reddens rather than passing on a document that never moved.
		buildStylesheet(
			'html { background: rgb(0, 128, 0) } .grow { min-height: 100vh }' +
				' @media (min-height: 900px) { .grow { min-height: 900px } }',
		)
		buildFixture('<div class="grow">Full height</div><div style="height: 200px">Beyond</div>')
		await stagePane(390, 844)
		const first = document.documentElement.scrollHeight
		await stagePane(390, first)
		const reflowed = document.documentElement.scrollHeight
		await releasePane()
		expect(first).toBeGreaterThan(844)
		expect(reflowed).toBeGreaterThan(first)

		const written = await captureFrame({ path: `${FRAMES}/reflow.png`, width: 390, height: 844 })
		const reading = await readFrame(written)
		expect(reading.width).toBe(390)
		expect(reading.height).toBeGreaterThanOrEqual(reflowed)
		expect(reading.floor).toBe('rgb(0, 128, 0)')
	})

	it('refuses a document whose height never settles, and hands the pane back anyway', async () => {
		// Nothing caps this one: the full-height panel grows with every pane the capture stages, so
		// the document outruns each staged height however many times the capture restages, and each
		// staging's overshoot carries the growth forward rather than closing on anything. The count
		// is written out rather than read from the constant, so a changed bound reddens here instead
		// of re-deriving its own answer.
		buildStylesheet('html { background: rgb(0, 128, 0) } .grow { min-height: 100vh }')
		buildFixture(
			'<div class="grow">Grows with the pane</div><div style="height: 200px">Beyond</div>',
		)
		const pane = requireValue(window.frameElement?.parentElement)
		const before = [window.innerWidth, window.innerHeight]

		await expect(
			captureFrame({ path: `${FRAMES}/growing.png`, width: 390, height: 844 }),
		).rejects.toThrow(`Capture frame at ${FRAMES}/growing.png never settled after 4 restagings`)
		expect(pane.hasAttribute(CAPTURE_PANE)).toBe(false)
		expect([window.innerWidth, window.innerHeight]).toStrictEqual(before)
	})
})

describe('readFrame', () => {
	// guides/test.md → Patterns → "Read a written frame back". A browser fence carries in this
	// directory because the guides project runs with the browser disabled.
	it('reports the size of a written frame and the color its bottom row paints', async () => {
		buildStylesheet('html { background: rgb(0, 128, 0) }')
		const written = await captureFrame({ path: `${FRAMES}/read.png`, width: 390, height: 844 })

		const reading = await readFrame(written)
		expect(reading.width).toBe(390)
		expect(reading.height).toBe(844)
		expect(reading.floor).toBe('rgb(0, 128, 0)')

		// The frame is decoded rather than computed, so the floor is a second reading of the same
		// claim: the cascade's own answer for the canvas this document paints.
		expect(reading.floor).toBe(readStyle(document.documentElement, 'background-color'))
	})

	it('reports no floor for a frame whose bottom row paints more than one color', async () => {
		const container = buildFixture(
			'<div style="width: 40px; height: 40px; background: linear-gradient(' +
				'to right, rgb(0, 0, 0) 50%, rgb(255, 255, 255) 50%)">.</div>',
		)
		const written = await captureFrame({
			path: `${FRAMES}/split.png`,
			width: 390,
			height: 844,
			element: requireValue(container.firstElementChild),
		})

		const reading = await readFrame(written)
		expect(reading.width).toBe(40)
		expect(reading.floor).toBeUndefined()
	})

	it('refuses a path holding no file, and a file holding no image', async () => {
		const absent = `${server.config.root}/tmp/capture/frame/absent.png`
		await expect(readFrame(absent)).rejects.toThrow(`Capture frame at ${absent} could not be read`)

		const planted = `${server.config.root}/tmp/capture/frame/planted-read.png`
		await commands.writeFile(planted, 'not a frame')
		await expect(readFrame(planted)).rejects.toThrow(
			`Capture frame at ${planted} is not an image this browser decodes`,
		)
	})
})

describe('readCascade', () => {
	it('collects class tokens from plain and grouped rules, and only real ones', () => {
		buildStylesheet(
			'.journey-alpha { color: rgb(1, 2, 3) }' +
				'@media (min-width: 1px) { .journey-beta { color: rgb(4, 5, 6) } }',
		)
		const known = readCascade()
		expect(known.has('journey-alpha')).toBe(true)
		expect(known.has('journey-beta')).toBe(true)
		expect(known.has('journey-absent')).toBe(false)
	})

	it('admits a class declared inside a media block', () => {
		buildStylesheet('@media (min-width: 1px) { .journey-conditional { color: rgb(7, 8, 9) } }')
		expect(readCascade().has('journey-conditional')).toBe(true)
	})

	it('inserts a top-level class before a class declared inside an earlier grouping rule', () => {
		buildStylesheet(
			'@media (min-width: 1px) { .journey-first-inner { color: rgb(1, 2, 3) } }' +
				'.journey-second-outer { color: rgb(4, 5, 6) }',
		)
		const order = [...readCascade()]
		expect(order.indexOf('journey-second-outer')).toBeLessThan(order.indexOf('journey-first-inner'))
		expect(order.indexOf('journey-first-inner')).toBeGreaterThan(-1)
	})
})

describe('readRules', () => {
	it('collects a sheet own rules and the rules nested inside them', () => {
		buildStylesheet(
			'.journey-flat { color: rgb(1, 2, 3) }' +
				'@media (min-width: 1px) { .journey-nested { color: rgb(4, 5, 6) } }' +
				'@keyframes journey-fade { from { opacity: 0 } to { opacity: 1 } }',
		)
		const selectors = readRules()
			.filter((rule) => rule instanceof CSSStyleRule)
			.map((rule) => rule.selectorText)
		expect(selectors).toContain('.journey-flat')
		expect(selectors).toContain('.journey-nested')
		const names = readRules()
			.filter((rule) => rule instanceof CSSKeyframesRule)
			.map((rule) => rule.name)
		expect(names).toContain('journey-fade')
	})

	it('meets a top-level rule before a rule nested inside an earlier one', () => {
		buildStylesheet(
			'@media (min-width: 1px) { .journey-inner { color: rgb(1, 2, 3) } }' +
				'.journey-outer { color: rgb(4, 5, 6) }',
		)
		const collected = readRules()
			.filter((rule) => rule instanceof CSSStyleRule)
			.map((rule) => rule.selectorText)
		expect(collected.indexOf('.journey-outer')).toBeLessThan(collected.indexOf('.journey-inner'))
	})
})

describe('findRule', () => {
	it('finds a rule declared at the top level of a sheet', () => {
		buildStylesheet('.journey-card { padding: 8px }')
		expect(requireValue(findRule('.journey-card')).style.getPropertyValue('padding')).toBe('8px')
	})

	it('finds a rule nested inside a grouping rule', () => {
		buildStylesheet('@media (min-width: 1px) { .journey-grouped { padding: 9px } }')
		expect(requireValue(findRule('.journey-grouped')).style.getPropertyValue('padding')).toBe('9px')
	})

	it('matches the fragment anywhere in the selector text', () => {
		buildStylesheet('.journey-panel > .journey-slot:hover { padding: 10px }')
		expect(requireValue(findRule('.journey-slot')).selectorText).toBe(
			'.journey-panel > .journey-slot:hover',
		)
	})

	it('reports undefined for a selector no loaded sheet declares', () => {
		expect(findRule('.journey-never-declared')).toBeUndefined()
	})

	// guides/test.md → Patterns → "Find a rule in the cascade". A browser fence carries in this
	// directory because the guides project runs with the browser disabled.
	it('finds a grouped rule and a named animation, and reports nothing for either miss', () => {
		buildStylesheet(
			'@media (min-width: 1px) { .card { padding: 8px } }' +
				'@keyframes slide { from { opacity: 0 } to { opacity: 1 } }',
		)
		expect(requireValue(findRule('.card')).style.getPropertyValue('padding')).toBe('8px')
		expect(findRule('.never-declared')).toBeUndefined()

		expect(requireValue(findKeyframes('slide')).cssRules).toHaveLength(2)
		expect(findKeyframes('slid')).toBeUndefined()

		// The descent collects the `@keyframes` rule where it sits and never its stops, so the
		// animation is in this list and the `from` and `to` inside it are not.
		const animations = readRules().filter((rule) => rule instanceof CSSKeyframesRule)
		expect(animations.map((rule) => rule.name)).toContain('slide')
		expect(readRules().some((rule) => rule instanceof CSSKeyframeRule)).toBe(false)
	})
})

describe('findKeyframes', () => {
	it('finds an animation the cascade declares', () => {
		buildStylesheet('@keyframes journey-slide { from { opacity: 0 } to { opacity: 1 } }')
		expect(requireValue(findKeyframes('journey-slide')).cssRules).toHaveLength(2)
	})

	it('finds an animation declared inside a grouping rule', () => {
		buildStylesheet(
			'@media (min-width: 1px) { @keyframes journey-grouped-slide { from { opacity: 0 } } }',
		)
		expect(requireValue(findKeyframes('journey-grouped-slide')).name).toBe('journey-grouped-slide')
	})

	it('matches the name exactly rather than as a fragment', () => {
		buildStylesheet('@keyframes journey-pulse { from { opacity: 0 } }')
		expect(findKeyframes('journey-pulse')).toBeDefined()
		expect(findKeyframes('journey-puls')).toBeUndefined()
		expect(findKeyframes('journey-pulse-slow')).toBeUndefined()
	})

	it('reports undefined for a name no loaded sheet declares', () => {
		expect(findKeyframes('journey-never-animated')).toBeUndefined()
	})
})

describe('readRows', () => {
	it('joins each row from its own text nodes rather than from run-together content', () => {
		const container = buildFixture(
			'<ul><li><span>Alpha</span><span>One</span></li><li>Beta   Two</li></ul>',
		)
		expect(readRows(container, 'li')).toStrictEqual(['Alpha One', 'Beta Two'])
	})

	it('reads an empty list as no rows', () => {
		const container = buildFixture('<ul></ul>')
		expect(readRows(container, 'li')).toStrictEqual([])
	})
})

describe('extractOrphans', () => {
	it('reports a child class rendered outside its container and leaves a nested one alone', () => {
		const container = buildFixture(
			'<div class="list-group"><span class="list-group-item">Nested</span></div>' +
				'<span class="list-group-item" data-row="loose">Loose</span>',
		)
		expect(extractOrphans(container, 'list-group-item', 'list-group')).toStrictEqual([
			'<span class="list-group-item" data-row="loose">Loose</span>',
		])
	})

	it('reports nothing when every child class sits inside a container', () => {
		const container = buildFixture(
			'<div class="list-group"><span class="list-group-item">One</span>' +
				'<div class="row"><span class="list-group-item">Two</span></div></div>',
		)
		expect(extractOrphans(container, 'list-group-item', 'list-group')).toStrictEqual([])
	})

	it('refuses an element that answers the invariant by carrying both classes itself', () => {
		const container = buildFixture('<span class="list-group list-group-item">Both</span>')
		expect(extractOrphans(container, 'list-group-item', 'list-group')).toStrictEqual([
			'<span class="list-group list-group-item">Both</span>',
		])
	})
})

describe('readStyle', () => {
	// guides/test.md → Patterns → "Read a pseudo-element's paint"
	it('distinguishes pseudo-element paint from its originating element', () => {
		buildStylesheet(
			'.journey-marked { padding-top: 0 } .journey-marked::after { content: ""; padding-top: 7px }',
		)
		buildFixture('<button class="journey-marked">Marked</button>')
		const button = resolveAccessible('Marked')
		expect(readStyle(button, 'padding-top', '::after')).toBe('7px')
		expect(readPixels(button, 'padding-top', '::after')).toBe(7)
		expect(readStyle(button, 'padding-top')).toBe('0px')
		expect(readStyle(button, '--journey-absent', '::after')).toBe('')
	})

	it('reads the modal backdrop and the open details content', () => {
		buildStylesheet(
			'.journey-dialog::backdrop { background-color: rgb(1, 2, 3) } .journey-details::details-content { padding-top: 9px }',
		)
		const fixture = buildFixture(
			'<dialog class="journey-dialog">Modal</dialog><details class="journey-details" open><summary>Details</summary>Content</details>',
		)
		const dialog = requireValue(fixture.querySelector('dialog'))
		const details = requireValue(fixture.querySelector('details'))
		dialog.showModal()
		expect(readStyle(dialog, 'background-color', '::backdrop')).toBe('rgb(1, 2, 3)')
		expect(readStyle(dialog, 'background-color')).not.toBe('rgb(1, 2, 3)')
		expect(readPixels(details, 'padding-top', '::details-content')).toBe(9)
		expect(readPixels(details, 'padding-top')).toBe(0)
		dialog.close()
	})

	it('refuses a pseudo-class before the engine support check and refuses an unknown pseudo-element', () => {
		buildFixture('<button>Subject</button>')
		const button = resolveAccessible('Subject')
		expect(CSS.supports('selector(:hover)')).toBe(true)
		expect(() => readStyle(button, 'padding-top', ':hover')).toThrow(
			'Pseudo-element ":hover" must start with "::"',
		)
		expect(() => readPixels(button, 'padding-top', '::journey-absent')).toThrow(
			'Pseudo-element "::journey-absent" is not one this engine exposes',
		)
	})

	it('reads the browser resolved value of one property', () => {
		const container = buildFixture('<p style="padding-left: 12px">Ready</p>')
		expect(readStyle(requireValue(container.querySelector('p')), 'padding-left')).toBe('12px')
	})

	it('returns a custom property with no surrounding whitespace, however it was declared', () => {
		buildStylesheet(
			'.journey-gapped { --journey-base: 8px; --journey-padded:   8px  ;' +
				' --journey-substituted: var(--journey-base);' +
				' --journey-fallback: var(--journey-missing, 8px) }',
		)
		const container = buildFixture(
			'<p class="journey-gapped" style="--journey-inline:  8px  ">Ready</p>',
		)
		const subject = requireValue(container.querySelector('p'))
		expect(readStyle(subject, '--journey-padded')).toBe('8px')
		expect(readStyle(subject, '--journey-substituted')).toBe('8px')
		expect(readStyle(subject, '--journey-fallback')).toBe('8px')
		expect(readStyle(subject, '--journey-inline')).toBe('8px')
		// This assertion does not discriminate the trim on the engine the suite runs against. Chromium
		// 1194 returns every one of these already trimmed — a padded declaration, a `var()`
		// substitution, a fallback, and an inline style alike — so the same values come back with the
		// trim removed. What is proven here is the contract: the value carries no surrounding
		// whitespace. What is unproven is that the trim is ever reached, because a custom property's
		// computed value is its declaration's token stream and nothing requires an engine to trim it.
		// A build that returns ' 8px' would redden the assertions above and prove the rest.
		expect(getComputedStyle(subject).getPropertyValue('--journey-padded')).toBe('8px')
	})

	it('keeps the whitespace inside a value', () => {
		const container = buildFixture('<p style="--journey-shadow: 0 0 2px">Ready</p>')
		expect(readStyle(requireValue(container.querySelector('p')), '--journey-shadow')).toBe(
			'0 0 2px',
		)
	})

	it('reads a property the element resolves none of as an empty string', () => {
		const container = buildFixture('<p>Ready</p>')
		expect(readStyle(requireValue(container.querySelector('p')), '--journey-absent')).toBe('')
	})
})

describe('readToken', () => {
	it('reads a custom property with and without its leading dashes', () => {
		const container = buildFixture('<p style="--journey-ink: rgb(1, 2, 3)">Ready</p>')
		const subject = requireValue(container.querySelector('p'))
		expect(readToken(subject, 'journey-ink')).toBe('rgb(1, 2, 3)')
		expect(readToken(subject, '--journey-ink')).toBe('rgb(1, 2, 3)')
	})

	it('reads a token declared on an ancestor', () => {
		const container = buildFixture('<div style="--journey-ink: rgb(4, 5, 6)"><p>Ready</p></div>')
		expect(readToken(requireValue(container.querySelector('p')), 'journey-ink')).toBe(
			'rgb(4, 5, 6)',
		)
	})

	it('reads a token nothing declares as an empty string', () => {
		const container = buildFixture('<p>Ready</p>')
		const subject = requireValue(container.querySelector('p'))
		expect(readToken(subject, 'journey-undeclared')).toBe('')
		expect(readToken(subject, '--journey-undeclared')).toBe('')
	})

	// guides/test.md → Patterns → "Read the tokens and colors a theme declares". A browser fence
	// carries in this directory because the guides project runs with the browser disabled.
	it('reads the theme through the cascade, resolves its colors, and measures its lengths', () => {
		buildStylesheet(':root { --ink: rgb(1, 2, 3) } .card { padding-left: 12px }')
		// The card is an inline box, which is the case the fence's `width` comment names: an inline
		// non-replaced element resolves `width` to `auto` and so carries no number.
		const container = buildFixture('<span class="card">Ledger</span>')
		const card = requireValue(container.querySelector('span'))

		expect(readRootToken('ink')).toBe('rgb(1, 2, 3)')
		expect(readRootToken('--ink')).toBe('rgb(1, 2, 3)')
		expect(readToken(card, 'ink')).toBe('rgb(1, 2, 3)')
		expect(readToken(card, 'absent')).toBe('')

		expect(parseCSSColor('var(--ink)')).toStrictEqual([1, 2, 3, 1])
		expect(parseCSSColor('rebeccapurple')).toStrictEqual([102, 51, 153, 1])
		expect(parseCSSColor('not-a-color')).toBeUndefined()
		expect(matchesColor('rebeccapurple', 'rgb(102, 51, 153)')).toBe(true)
		expect(matchesColor(readToken(card, 'ink'), 'rgb(1, 2, 3)')).toBe(true)

		expect(readPixels(card, 'padding-left')).toBe(12)
		expect(readStyle(card, 'width')).toBe('auto')
		expect(readPixels(card, 'width')).toBe(0)
	})
})

describe('readRootToken', () => {
	it('reads a token the document declares, with and without its leading dashes', () => {
		buildStylesheet(':root { --journey-surface: rgb(7, 8, 9) }')
		expect(readRootToken('journey-surface')).toBe('rgb(7, 8, 9)')
		expect(readRootToken('--journey-surface')).toBe('rgb(7, 8, 9)')
		expect(readRootToken('journey-surface')).toBe(
			readToken(document.documentElement, 'journey-surface'),
		)
	})

	it('reads a token the document does not declare as an empty string', () => {
		expect(readRootToken('journey-unthemed')).toBe('')
	})
})

describe('readPixels', () => {
	it('reads a resolved length as its number of pixels', () => {
		const container = buildFixture('<p style="padding-left: 12px; margin-top: 0.5px">Ready</p>')
		const subject = requireValue(container.querySelector('p'))
		expect(readPixels(subject, 'padding-left')).toBe(12)
		expect(readPixels(subject, 'margin-top')).toBe(0.5)
	})

	it('reads a custom property carrying a length', () => {
		const container = buildFixture('<p style="--journey-gap: 8px">Ready</p>')
		expect(readPixels(requireValue(container.querySelector('p')), '--journey-gap')).toBe(8)
	})

	it('reads an unparsable value as zero', () => {
		const container = buildFixture('<p style="--journey-label: wide">Ready</p>')
		const subject = requireValue(container.querySelector('p'))
		expect(readStyle(subject, '--journey-label')).toBe('wide')
		expect(readPixels(subject, '--journey-label')).toBe(0)
		expect(readPixels(subject, '--journey-absent')).toBe(0)
	})
})

describe('stageMedia', () => {
	// guides/test.md → Patterns → "Emulate reduced motion and print"
	it('pins the base, stages motion and print, and restores the host medium', async () => {
		await releaseMedia()
		const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches
		const dark = matchMedia('(prefers-color-scheme: dark)').matches
		const forced = matchMedia('(forced-colors: active)').matches
		buildStylesheet(
			'.journey-media { padding-top: 1px } @media (prefers-reduced-motion: reduce) { .journey-media { padding-top: 2px } } @media print { .journey-media { padding-top: 3px } }',
		)
		buildFixture('<button class="journey-media">Media</button>')
		const button = resolveAccessible('Media')
		await stageMedia({ motion: true })
		expect(document.documentElement.getAttribute(MEDIA_STAGE)).toBe(
			`0${Number(reduced)}${Number(dark)}${Number(forced)}`,
		)
		expect(readPixels(button, 'padding-top')).toBe(1)
		expect(matchMedia('(prefers-reduced-motion: no-preference)').matches).toBe(true)
		await stageMedia({ motion: false })
		expect(readPixels(button, 'padding-top')).toBe(2)
		expect(matchMedia('(prefers-reduced-motion: reduce)').matches).toBe(true)
		await stageMedia({ motion: reduced })
		expect(matchMedia('(prefers-reduced-motion: reduce)').matches).toBe(!reduced)
		expect(readPixels(button, 'padding-top')).toBe(reduced ? 1 : 2)
		await stageMedia({ print: true })
		expect(readPixels(button, 'padding-top')).toBe(3)
		expect(matchMedia('print').matches).toBe(true)
		expect(matchMedia('(prefers-reduced-motion: reduce)').matches).toBe(!reduced)
		await releaseMedia()
		expect(matchMedia('print').matches).toBe(false)
		expect(matchMedia('(prefers-reduced-motion: reduce)').matches).toBe(reduced)
		expect(readPixels(button, 'padding-top')).toBe(reduced ? 2 : 1)
		expect(document.documentElement.hasAttribute(MEDIA_STAGE)).toBe(false)
	})

	it('preserves print and its paint through a motion-only stage', async () => {
		const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches
		buildStylesheet(
			'.journey-media { padding-top: 1px } @media print { .journey-media { padding-top: 3px } }',
		)
		buildFixture('<button class="journey-media">Media</button>')
		const button = resolveAccessible('Media')
		await stageMedia({ print: true })
		expect(readPixels(button, 'padding-top')).toBe(3)
		await stageMedia({ motion: reduced })
		expect(matchMedia('(prefers-reduced-motion: reduce)').matches).toBe(!reduced)
		expect(matchMedia('print').matches).toBe(true)
		expect(readPixels(button, 'padding-top')).toBe(3)
	})

	it('preserves a provider color scheme inverse through stage and release', async () => {
		await releaseMedia()
		const dark = matchMedia('(prefers-color-scheme: dark)').matches
		const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches
		await sendProtocol('Emulation.setEmulatedMedia', {
			features: [{ name: 'prefers-color-scheme', value: dark ? 'light' : 'dark' }],
		})
		await waitForCondition(
			'inverse color scheme override',
			() => matchMedia('(prefers-color-scheme: dark)').matches === !dark,
		)
		expect(matchMedia('(prefers-color-scheme: dark)').matches).toBe(!dark)
		await stageMedia({ motion: reduced })
		expect(matchMedia('(prefers-color-scheme: dark)').matches).toBe(!dark)
		await releaseMedia()
		expect(matchMedia('(prefers-color-scheme: dark)').matches).toBe(!dark)
	})

	it('preserves a provider forced colors inverse through stage and release', async () => {
		await releaseMedia()
		const forced = matchMedia('(forced-colors: active)').matches
		const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches
		await sendProtocol('Emulation.setEmulatedMedia', {
			features: [{ name: 'forced-colors', value: forced ? 'none' : 'active' }],
		})
		await waitForCondition(
			'inverse forced colors override',
			() => matchMedia('(forced-colors: active)').matches === !forced,
		)
		expect(matchMedia('(forced-colors: active)').matches).toBe(!forced)
		await stageMedia({ motion: reduced })
		expect(matchMedia('(forced-colors: active)').matches).toBe(!forced)
		await releaseMedia()
		expect(matchMedia('(forced-colors: active)').matches).toBe(!forced)
	})

	it('stages screen explicitly and preserves an omitted motion axis', async () => {
		await stageMedia({ print: true, motion: false })
		await stageMedia({ print: false })
		expect(matchMedia('print').matches).toBe(false)
		expect(matchMedia('screen').matches).toBe(true)
		expect(matchMedia('(prefers-reduced-motion: reduce)').matches).toBe(true)
	})

	it('refuses an empty media stage', async () => {
		await expect(stageMedia({})).rejects.toThrow(
			'Media emulation was staged with nothing to emulate',
		)
	})
})

describe('releaseMedia', () => {
	it('restores every media axis before the next line reads it', async () => {
		await releaseMedia()
		const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches
		const dark = matchMedia('(prefers-color-scheme: dark)').matches
		const forced = matchMedia('(forced-colors: active)').matches
		await stageMedia({ print: true, motion: reduced })
		await sendProtocol('Emulation.setEmulatedMedia', {
			media: 'print',
			features: [
				{ name: 'prefers-reduced-motion', value: reduced ? 'no-preference' : 'reduce' },
				{ name: 'prefers-color-scheme', value: dark ? 'light' : 'dark' },
				{ name: 'forced-colors', value: forced ? 'none' : 'active' },
			],
		})
		await waitForCondition(
			'every inverse media axis staged',
			() =>
				matchMedia('print').matches &&
				matchMedia('(prefers-reduced-motion: reduce)').matches === !reduced &&
				matchMedia('(prefers-color-scheme: dark)').matches === !dark &&
				matchMedia('(forced-colors: active)').matches === !forced,
		)
		await stageMedia({ print: true, motion: reduced })
		await releaseMedia()
		expect([
			matchMedia('print').matches,
			matchMedia('(prefers-reduced-motion: reduce)').matches,
			matchMedia('(prefers-color-scheme: dark)').matches,
			matchMedia('(forced-colors: active)').matches,
		]).toEqual([false, reduced, dark, forced])
	})

	it('restores provider inverses on every axis after changing print and motion', async () => {
		await releaseMedia()
		const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches
		const dark = matchMedia('(prefers-color-scheme: dark)').matches
		const forced = matchMedia('(forced-colors: active)').matches
		await sendProtocol('Emulation.setEmulatedMedia', {
			media: 'print',
			features: [
				{ name: 'prefers-reduced-motion', value: reduced ? 'no-preference' : 'reduce' },
				{ name: 'prefers-color-scheme', value: dark ? 'light' : 'dark' },
				{ name: 'forced-colors', value: forced ? 'none' : 'active' },
			],
		})
		await waitForCondition(
			'provider inverses arrived',
			() =>
				matchMedia('print').matches &&
				matchMedia('(prefers-reduced-motion: reduce)').matches === !reduced &&
				matchMedia('(prefers-color-scheme: dark)').matches === !dark &&
				matchMedia('(forced-colors: active)').matches === !forced,
		)
		await stageMedia({ print: false, motion: !reduced })
		expect(document.documentElement.getAttribute(MEDIA_STAGE)).toBe(
			`1${Number(!reduced)}${Number(!dark)}${Number(!forced)}`,
		)
		expect(matchMedia('print').matches).toBe(false)
		expect(matchMedia('(prefers-reduced-motion: reduce)').matches).toBe(reduced)
		await releaseMedia()
		expect([
			matchMedia('print').matches,
			matchMedia('(prefers-reduced-motion: reduce)').matches,
			matchMedia('(prefers-color-scheme: dark)').matches,
			matchMedia('(forced-colors: active)').matches,
		]).toEqual([true, !reduced, !dark, !forced])
		expect(document.documentElement.hasAttribute(MEDIA_STAGE)).toBe(false)
	})

	it('reads a stable value after a release with nothing staged', async () => {
		expect(document.documentElement.hasAttribute(MEDIA_STAGE)).toBe(false)
		await releaseMedia()
		const readings = [
			matchMedia('print').matches,
			matchMedia('(prefers-reduced-motion: reduce)').matches,
			matchMedia('(prefers-color-scheme: dark)').matches,
			matchMedia('(forced-colors: active)').matches,
		]
		await waitForFrame()
		expect([
			matchMedia('print').matches,
			matchMedia('(prefers-reduced-motion: reduce)').matches,
			matchMedia('(prefers-color-scheme: dark)').matches,
			matchMedia('(forced-colors: active)').matches,
		]).toEqual(readings)
	})
})

describe.sequential('media teardown after failure', () => {
	let reduced = false
	beforeAll(() => {
		reduced = matchMedia('(prefers-reduced-motion: reduce)').matches
	})

	// An assertion inside an it.fails body cannot fail the suite; the following case carries the proof.
	it.fails('throws a sentinel after staging and leaves the release to afterEach', async () => {
		await stageMedia({ print: true, motion: reduced })
		expect(matchMedia('print').matches).toBe(true)
		expect(matchMedia('(prefers-reduced-motion: reduce)').matches).toBe(!reduced)
		throw new Error('media sentinel')
	})

	it('reads restored media in the following case', () => {
		expect(matchMedia('print').matches).toBe(false)
		expect(matchMedia('(prefers-reduced-motion: reduce)').matches).toBe(reduced)
	})

	it('releases explicitly before its afterEach hook', async () => {
		await stageMedia({ print: true, motion: reduced })
		expect(matchMedia('(prefers-reduced-motion: reduce)').matches).toBe(!reduced)
		await releaseMedia()
		expect(matchMedia('print').matches).toBe(false)
		expect(matchMedia('(prefers-reduced-motion: reduce)').matches).toBe(reduced)
	})

	it('reads provider defaults after the repeated release', () => {
		expect(matchMedia('print').matches).toBe(false)
		expect(matchMedia('(prefers-reduced-motion: reduce)').matches).toBe(reduced)
	})
})

describe('expandCaptures', () => {
	it('expands the registry across every variant, each state first', () => {
		expect(expandCaptures(['start', 'answer'], VARIANTS)).toStrictEqual([
			'start--light-1440.png',
			'start--dark-390.png',
			'answer--light-1440.png',
			'answer--dark-390.png',
		])
	})

	it('expands an empty registry and an empty variant matrix to no files', () => {
		expect(expandCaptures([], VARIANTS)).toStrictEqual([])
		expect(expandCaptures(['start'], [])).toStrictEqual([])
	})
})

describe('readClasses', () => {
	it('collects the root own classes and every descendant class in document order', () => {
		const container = buildFixture(
			'<section class="card shadow"><p class="lead">Ready</p>' +
				'<span class="badge lead">New</span></section>',
		)
		const section = requireValue(container.querySelector('section'))

		expect([...readClasses(section)]).toStrictEqual(['card', 'shadow', 'lead', 'badge'])
	})

	it('reads an SVG class through classList rather than through className', () => {
		const container = buildFixture('<svg class="chart"><path class="series" d="M0 0"></path></svg>')
		const chart = requireValue(container.querySelector('svg'))

		expect(typeof chart.className).not.toBe('string')
		expect([...readClasses(chart)]).toStrictEqual(['chart', 'series'])
	})

	it('contributes only its descendants when the root is not an element', () => {
		const fragment = document.createDocumentFragment()
		fragment.append(build('p', { classes: 'lead' }))

		expect([...readClasses(fragment)]).toStrictEqual(['lead'])
	})

	it('reports an empty set for markup carrying no class at all', () => {
		const container = buildFixture('<section><p>Ready</p></section>')

		expect(readClasses(container).size).toBe(0)
	})

	it('leaves a class no loaded stylesheet declares in the difference against the cascade', () => {
		buildStylesheet('.journey-declared { color: rgb(1, 2, 3) }')
		const container = buildFixture('<p class="journey-declared journey-undeclared">Ready</p>')

		const authored = [...readClasses(container)]
		expect(authored).toStrictEqual(['journey-declared', 'journey-undeclared'])
		expect(authored.filter((name) => !readCascade().has(name))).toStrictEqual([
			'journey-undeclared',
		])
	})
})

describe('extractStyles', () => {
	it('reports an inline style attribute and a style element in document order', () => {
		const container = buildFixture(
			'<p style="color: red">One</p><span class="badge">Two</span>' +
				'<style>.late { color: blue }</style>',
		)

		expect(extractStyles(container)).toStrictEqual([
			'<p style="color: red">One</p>',
			'<style>.late { color: blue }</style>',
		])
	})

	it('counts a style root and a styled root, and leaves a root carrying neither out', () => {
		const container = buildFixture(
			'<style>.late { color: blue }</style><section style="gap: 4px"><p>Ready</p></section>' +
				'<div><p>Ready</p></div>',
		)
		const sheet = requireValue(container.querySelector('style'))
		const section = requireValue(container.querySelector('section'))
		const plain = requireValue(container.querySelector('div'))

		expect(extractStyles(sheet)).toStrictEqual(['<style>.late { color: blue }</style>'])
		expect(extractStyles(section)).toStrictEqual([
			'<section style="gap: 4px"><p>Ready</p></section>',
		])
		expect(extractStyles(plain)).toStrictEqual([])
	})

	it('reports an inline style on an SVG path', () => {
		const container = buildFixture(
			'<svg class="chart"><path style="fill: red" d="M0 0"></path></svg>',
		)

		expect(extractStyles(container)).toStrictEqual(['<path style="fill: red" d="M0 0"></path>'])
	})

	it('reports a style element carrying an inline attribute once', () => {
		const container = buildFixture('<style style="display: none">.late { color: blue }</style>')

		expect(extractStyles(container)).toStrictEqual([
			'<style style="display: none">.late { color: blue }</style>',
		])
	})

	it('reads past a style attribute holding nothing but whitespace', () => {
		const container = buildFixture('<p style="">One</p><span style="   ">Two</span>')

		expect(extractStyles(container)).toStrictEqual([])
	})

	it('sweeps the descendants alone when the root is not an element', () => {
		const fragment = document.createDocumentFragment()
		fragment.append(build('p', { attributes: { style: 'color: red' }, text: 'Ready' }))

		expect(extractStyles(fragment)).toStrictEqual(['<p style="color: red">Ready</p>'])
	})

	it('reports nothing for markup with no style attribute and no style element', () => {
		const container = buildFixture(
			'<section class="card" data-role="panel"><p class="lead">Ready</p></section>',
		)

		expect(extractStyles(container)).toStrictEqual([])
	})

	// guides/test.md → Patterns → "Read the classes and styles the markup carries". A browser fence
	// carries in this directory because the guides project runs with the browser disabled.
	it('separates the classes the cascade declares from the markup that styles itself', () => {
		buildStylesheet('.card { padding: 8px }')
		const container = buildFixture(
			'<section class="card"><p class="lead" style="color: red">Ready</p>' +
				'<style>.late { color: blue }</style></section>',
		)
		const section = requireValue(container.querySelector('section'))

		const authored = readClasses(section)
		expect(authored.has('card')).toBe(true)
		expect(authored.has('lead')).toBe(true)

		const undeclared = [...authored].filter((name) => !readCascade().has(name))
		expect(undeclared).toStrictEqual(['lead'])

		expect(extractStyles(section)).toStrictEqual([
			'<p class="lead" style="color: red">Ready</p>',
			'<style>.late { color: blue }</style>',
		])
	})
})

describe('readCensus', () => {
	it('reports the population, the sorted tokens, and the undeclared ones', () => {
		buildStylesheet('.census-declared { padding: 8px }')
		const control = buildCensus()
		const container = buildFixture('<section class="census-declared"></section>')
		const section = requireValue(container.querySelector('section'))
		section.append(control.root)

		const reading = readCensus(section)

		expect(reading.elements).toBe(4)
		expect(reading.tokens).toStrictEqual(['census-declared', control.mark, control.token].sort())
		expect(reading.undeclared).toStrictEqual([control.mark, control.token])
	})

	it('sorts the tokens rather than reporting them in document order', () => {
		const container = buildFixture('<div class="zeta"><span class="alpha"></span></div>')

		expect(readCensus(container).tokens).toStrictEqual(['alpha', 'zeta'])
	})

	// The two readings a population check cannot tell apart without `elements`: markup whose every
	// class the cascade declares, and a walk that read nothing at all. The first reports an empty
	// difference and the second is refused outright.
	it('reports nothing undeclared where the cascade declares every carried class', () => {
		buildStylesheet('.census-known { color: red }')
		const container = buildFixture('<p class="census-known">Ready</p>')

		const reading = readCensus(container)

		expect(reading.elements).toBe(2)
		expect(reading.tokens).toStrictEqual(['census-known'])
		expect(reading.undeclared).toStrictEqual([])
	})

	it('refuses a walk that reads no element', () => {
		expect(() => readCensus(document.createDocumentFragment())).toThrow(
			'Class census walked no element',
		)
	})

	// guides/test.md → Patterns → "Take an authored-class census". A browser fence carries in this
	// directory because the guides project runs with the browser disabled.
	it('counts the walked elements and reports both undeclared tokens the control carries', () => {
		buildStylesheet('.census-screen { padding: 8px }')
		const container = buildFixture('<section class="census-screen"></section>')
		const screen = requireValue(container.querySelector('section'))
		const control = buildCensus()
		screen.append(control.root)

		const census = readCensus(screen)

		expect(census.elements).toBe(4)
		expect(census.undeclared).toStrictEqual([control.mark, control.token])
	})
})

describe('buildDenial', () => {
	it('names the operation and the key in the voice a denied origin raises', () => {
		const keyed = buildDenial('getItem', 'theme')

		expect(keyed).toBeInstanceOf(DOMException)
		expect(keyed.name).toBe('SecurityError')
		expect(keyed.message).toBe('Access is denied for getItem "theme"')
		expect(buildDenial('length').message).toBe('Access is denied for length')
	})
})

describe('buildContrast', () => {
	it('straddles the bar composited while the flat reading disagrees for both foregrounds', () => {
		const control = buildContrast(4.5)
		mount(control.root)
		try {
			expect(readContrast(control.refused)).toBeLessThan(4.5)
			expect(readContrast(control.accepted)).toBeGreaterThanOrEqual(4.5)

			// The rival reading: the first painted background, taken at full strength. It answers the
			// opposite pair, which is what no single non-compositing reading can satisfy.
			const tint = requireValue(
				parseColor(readStyle(requireValue(control.refused.parentElement), 'background-color')),
			)
			const flat: Color = [tint[0], tint[1], tint[2], 1]
			const refused = requireValue(parseColor(readStyle(control.refused, 'color')))
			const accepted = requireValue(parseColor(readStyle(control.accepted, 'color')))

			expect(measureContrast(refused, flat)).toBeGreaterThanOrEqual(4.5)
			expect(measureContrast(accepted, flat)).toBeLessThan(4.5)
		} finally {
			control.root.remove()
		}
	})

	// A stack written down once cannot straddle every bar: a grey clearing 4.5 flat falls well under
	// 15 flat, so this bar is the control for the search actually following its argument.
	it('follows the bar it was asked for rather than one written into the stack', () => {
		const strict = buildContrast(15)
		mount(strict.root)
		try {
			expect(readContrast(strict.refused)).toBeLessThan(15)
			expect(readContrast(strict.accepted)).toBeGreaterThanOrEqual(15)

			const tint = requireValue(
				parseColor(readStyle(requireValue(strict.refused.parentElement), 'background-color')),
			)
			const flat: Color = [tint[0], tint[1], tint[2], 1]

			expect(
				measureContrast(requireValue(parseColor(readStyle(strict.refused, 'color'))), flat),
			).toBeGreaterThanOrEqual(15)
			expect(
				measureContrast(requireValue(parseColor(readStyle(strict.accepted, 'color'))), flat),
			).toBeLessThan(15)
		} finally {
			strict.root.remove()
		}
	})

	it('refuses a bar no stack can straddle at either end', () => {
		expect(() => buildContrast(21)).toThrow('Contrast control cannot straddle the bar 21')
		expect(() => buildContrast(1)).toThrow('Contrast control cannot straddle the bar 1')
	})

	// guides/test.md → Patterns → "Control a reading before you trust it". A browser fence carries
	// in this directory because the guides project runs with the browser disabled.
	it('reads a composited stack, carries both style escapes, and refuses an unreachable bar', () => {
		const contrast = buildContrast(4.5)
		mount(contrast.root)
		try {
			expect(readContrast(contrast.refused)).toBeLessThan(4.5)
			expect(readContrast(contrast.accepted)).toBeGreaterThanOrEqual(4.5)
		} finally {
			contrast.root.remove()
		}

		const escapes = buildEscapes('project-stylesheet')
		expect(extractStyles(escapes.root)).toHaveLength(3)

		expect(() => buildContrast(21)).toThrow('Contrast control cannot straddle the bar 21')
	})
})

describe('buildEscapes', () => {
	it('carries both escapes and the sheet the caller exempts by id', () => {
		const control = buildEscapes('project-stylesheet')

		const reported = extractStyles(control.root)

		expect(reported).toStrictEqual([
			control.inline.outerHTML,
			control.embedded.outerHTML,
			control.permitted.outerHTML,
		])
		expect(reported.filter((markup) => !markup.includes('id="project-stylesheet"'))).toStrictEqual([
			control.inline.outerHTML,
			control.embedded.outerHTML,
		])
	})

	it('leaves the root detached, so an embedded sheet never joins the cascade', () => {
		const control = buildEscapes('project-stylesheet')

		expect(control.root.isConnected).toBe(false)
		expect(readCascade().has('escape-embedded')).toBe(false)
	})
})

describe('buildCensus', () => {
	it('carries one token on HTML and another on an SVG whose class list is no string', () => {
		const control = buildCensus()
		const glyph = requireValue(control.root.querySelector('svg'))

		expect(typeof glyph.className).not.toBe('string')
		expect(glyph.getAttribute('class')).toBe(control.mark)
		expect([...readClasses(control.root)].sort()).toStrictEqual([control.mark, control.token])
	})

	// T3-C15. The tokens are derived per call, so a consumer cascade cannot declare either of them in
	// advance and two controls in one document never share a token. A fixed pair would move the
	// fixture and its assertion apart the moment a consumer's stylesheet happened to declare one.
	it('derives distinct tokens per call, each undeclared by the cascade', () => {
		const first = buildCensus()
		const second = buildCensus()

		expect(first.token).not.toBe(second.token)
		expect(first.mark).not.toBe(second.mark)
		expect(first.token).not.toBe(first.mark)

		const declared = readCascade()
		for (const token of [first.token, first.mark, second.token, second.mark]) {
			expect(declared.has(token)).toBe(false)
		}

		const container = buildFixture('<section></section>')
		const section = requireValue(container.querySelector('section'))
		section.append(first.root, second.root)

		expect(readCensus(section).undeclared).toStrictEqual(
			[first.mark, first.token, second.mark, second.token].sort(),
		)
	})
})

describe('the browser barrel', () => {
	it('resolves every published journey name from the specifier a consumer imports', async () => {
		const browser = await import('@orkestrel/test/browser')
		const core = await import('@orkestrel/test')

		for (const published of [
			browser.pressKeys,
			browser.waitForState,
			browser.waitForAnimations,
			browser.readRefusal,
			browser.readCensus,
			browser.buildDenial,
			browser.buildContrast,
			browser.buildEscapes,
			browser.buildCensus,
			browser.createStorage,
		]) {
			expect(published).toBeTypeOf('function')
		}
		expect(core.waitForText).toBeTypeOf('function')
	})

	it('takes a bare journey variant wherever a capture variant is asked for', () => {
		const declared: JourneyVariant = { name: 'dark-390', width: 390, height: 844 }
		const variants: readonly CaptureVariant[] = [declared]

		expect(expandCaptures(['start'], variants)).toStrictEqual(['start--dark-390.png'])
	})
})

describe('modern paint readings', () => {
	it('reads oklch(0.208 0.042 265.755) against the browser sRGB control', () => {
		const container = buildFixture('<p style="color: oklch(0.208 0.042 265.755)">Paint</p>')
		const computed = readStyle(requireValue(container.querySelector('p')), 'color')
		const control = requireValue(
			parseCSSColor('color-mix(in srgb, oklch(0.208 0.042 265.755) 100%, transparent)'),
		)
		expect(matchesColor(requireValue(parseColor(computed)), control)).toBe(true)
		expect(matchesColor(requireValue(parseColor('oklch(0.208 0.042 265.755)')), control)).toBe(true)
	})

	it('reads oklab(60% -0.04 0.08 / 0.6) against the browser sRGB control', () => {
		const container = buildFixture('<p style="color: oklab(60% -0.04 0.08 / 0.6)">Paint</p>')
		const computed = readStyle(requireValue(container.querySelector('p')), 'color')
		const control = requireValue(
			parseCSSColor('color-mix(in srgb, oklab(60% -0.04 0.08 / 0.6) 100%, transparent)'),
		)
		expect(matchesColor(requireValue(parseColor(computed)), control)).toBe(true)
		expect(matchesColor(requireValue(parseColor('oklab(60% -0.04 0.08 / 0.6)')), control)).toBe(
			true,
		)
	})

	it('reads lab(60% -10 20 / 0.6) against the browser sRGB control', () => {
		const container = buildFixture('<p style="color: lab(60% -10 20 / 0.6)">Paint</p>')
		const computed = readStyle(requireValue(container.querySelector('p')), 'color')
		const control = requireValue(
			parseCSSColor('color-mix(in srgb, lab(60% -10 20 / 0.6) 100%, transparent)'),
		)
		expect(matchesColor(requireValue(parseColor(computed)), control)).toBe(true)
		expect(matchesColor(requireValue(parseColor('lab(60% -10 20 / 0.6)')), control)).toBe(true)
	})

	it('reads lch(60% 30 260 / 0.6) against the browser sRGB control', () => {
		const container = buildFixture('<p style="color: lch(60% 30 260 / 0.6)">Paint</p>')
		const computed = readStyle(requireValue(container.querySelector('p')), 'color')
		const control = requireValue(
			parseCSSColor('color-mix(in srgb, lch(60% 30 260 / 0.6) 100%, transparent)'),
		)
		expect(matchesColor(requireValue(parseColor(computed)), control)).toBe(true)
		expect(matchesColor(requireValue(parseColor('lch(60% 30 260 / 0.6)')), control)).toBe(true)
	})

	it('reads color(srgb 0.25 0.4 0.3 / 0.6) against the browser sRGB control', () => {
		const container = buildFixture('<p style="color: color(srgb 0.25 0.4 0.3 / 0.6)">Paint</p>')
		const computed = readStyle(requireValue(container.querySelector('p')), 'color')
		const control = requireValue(
			parseCSSColor('color-mix(in srgb, color(srgb 0.25 0.4 0.3 / 0.6) 100%, transparent)'),
		)
		expect(matchesColor(requireValue(parseColor(computed)), control)).toBe(true)
		expect(matchesColor(requireValue(parseColor('color(srgb 0.25 0.4 0.3 / 0.6)')), control)).toBe(
			true,
		)
	})

	it('reads color(srgb-linear 0.25 0.4 0.3 / 0.6) against the browser sRGB control', () => {
		const container = buildFixture(
			'<p style="color: color(srgb-linear 0.25 0.4 0.3 / 0.6)">Paint</p>',
		)
		const computed = readStyle(requireValue(container.querySelector('p')), 'color')
		const control = requireValue(
			parseCSSColor('color-mix(in srgb, color(srgb-linear 0.25 0.4 0.3 / 0.6) 100%, transparent)'),
		)
		expect(matchesColor(requireValue(parseColor(computed)), control)).toBe(true)
		expect(
			matchesColor(requireValue(parseColor('color(srgb-linear 0.25 0.4 0.3 / 0.6)')), control),
		).toBe(true)
	})

	it('reads color(display-p3 0.25 0.4 0.3 / 0.6) against the browser sRGB control', () => {
		const container = buildFixture(
			'<p style="color: color(display-p3 0.25 0.4 0.3 / 0.6)">Paint</p>',
		)
		const computed = readStyle(requireValue(container.querySelector('p')), 'color')
		const control = requireValue(
			parseCSSColor('color-mix(in srgb, color(display-p3 0.25 0.4 0.3 / 0.6) 100%, transparent)'),
		)
		expect(matchesColor(requireValue(parseColor(computed)), control)).toBe(true)
		expect(
			matchesColor(requireValue(parseColor('color(display-p3 0.25 0.4 0.3 / 0.6)')), control),
		).toBe(true)
	})

	it('reads color(a98-rgb 0.25 0.4 0.3 / 0.6) against the browser sRGB control', () => {
		const container = buildFixture('<p style="color: color(a98-rgb 0.25 0.4 0.3 / 0.6)">Paint</p>')
		const computed = readStyle(requireValue(container.querySelector('p')), 'color')
		const control = requireValue(
			parseCSSColor('color-mix(in srgb, color(a98-rgb 0.25 0.4 0.3 / 0.6) 100%, transparent)'),
		)
		expect(matchesColor(requireValue(parseColor(computed)), control)).toBe(true)
		expect(
			matchesColor(requireValue(parseColor('color(a98-rgb 0.25 0.4 0.3 / 0.6)')), control),
		).toBe(true)
	})

	it('reads color(prophoto-rgb 0.25 0.4 0.3 / 0.6) against the browser sRGB control', () => {
		const container = buildFixture(
			'<p style="color: color(prophoto-rgb 0.25 0.4 0.3 / 0.6)">Paint</p>',
		)
		const computed = readStyle(requireValue(container.querySelector('p')), 'color')
		const control = requireValue(
			parseCSSColor('color-mix(in srgb, color(prophoto-rgb 0.25 0.4 0.3 / 0.6) 100%, transparent)'),
		)
		expect(matchesColor(requireValue(parseColor(computed)), control)).toBe(true)
		expect(
			matchesColor(requireValue(parseColor('color(prophoto-rgb 0.25 0.4 0.3 / 0.6)')), control),
		).toBe(true)
	})

	it('reads color(rec2020 0.25 0.4 0.3 / 0.6) against the browser sRGB control', () => {
		const container = buildFixture('<p style="color: color(rec2020 0.25 0.4 0.3 / 0.6)">Paint</p>')
		const computed = readStyle(requireValue(container.querySelector('p')), 'color')
		const control = requireValue(
			parseCSSColor('color-mix(in srgb, color(rec2020 0.25 0.4 0.3 / 0.6) 100%, transparent)'),
		)
		expect(matchesColor(requireValue(parseColor(computed)), control)).toBe(true)
		expect(
			matchesColor(requireValue(parseColor('color(rec2020 0.25 0.4 0.3 / 0.6)')), control),
		).toBe(true)
	})

	it('reads color(xyz 0.25 0.4 0.3 / 0.6) against the browser sRGB control', () => {
		const container = buildFixture('<p style="color: color(xyz 0.25 0.4 0.3 / 0.6)">Paint</p>')
		const computed = readStyle(requireValue(container.querySelector('p')), 'color')
		const control = requireValue(
			parseCSSColor('color-mix(in srgb, color(xyz 0.25 0.4 0.3 / 0.6) 100%, transparent)'),
		)
		expect(matchesColor(requireValue(parseColor(computed)), control)).toBe(true)
		expect(matchesColor(requireValue(parseColor('color(xyz 0.25 0.4 0.3 / 0.6)')), control)).toBe(
			true,
		)
	})

	it('reads color(xyz-d50 0.25 0.4 0.3 / 0.6) against the browser sRGB control', () => {
		const container = buildFixture('<p style="color: color(xyz-d50 0.25 0.4 0.3 / 0.6)">Paint</p>')
		const computed = readStyle(requireValue(container.querySelector('p')), 'color')
		const control = requireValue(
			parseCSSColor('color-mix(in srgb, color(xyz-d50 0.25 0.4 0.3 / 0.6) 100%, transparent)'),
		)
		expect(matchesColor(requireValue(parseColor(computed)), control)).toBe(true)
		expect(
			matchesColor(requireValue(parseColor('color(xyz-d50 0.25 0.4 0.3 / 0.6)')), control),
		).toBe(true)
	})

	it('reads color(xyz-d65 0.25 0.4 0.3 / 0.6) against the browser sRGB control', () => {
		const container = buildFixture('<p style="color: color(xyz-d65 0.25 0.4 0.3 / 0.6)">Paint</p>')
		const computed = readStyle(requireValue(container.querySelector('p')), 'color')
		const control = requireValue(
			parseCSSColor('color-mix(in srgb, color(xyz-d65 0.25 0.4 0.3 / 0.6) 100%, transparent)'),
		)
		expect(matchesColor(requireValue(parseColor(computed)), control)).toBe(true)
		expect(
			matchesColor(requireValue(parseColor('color(xyz-d65 0.25 0.4 0.3 / 0.6)')), control),
		).toBe(true)
	})

	it('clips the signed channels of an out-of-gamut color-mix tint', () => {
		const container = buildFixture(
			'<p style="color: color-mix(in srgb, oklch(0.7 0.4 30) 90%, white)">Tint</p>',
		)
		const computed = readStyle(requireValue(container.querySelector('p')), 'color')
		expect(computed).toMatch(/^color\(srgb 1\.\d+ -0\.\d+ -0\.\d+\)$/u)
		expect(parseColor(computed)).toStrictEqual([255, 0, 0, 1])
	})

	it('measures the dark oklch text against the browser sRGB control', () => {
		const container = buildFixture(
			'<p style="color: oklch(0.208 0.042 265.755); background: white">Ink</p>',
		)
		const foreground = requireValue(
			parseCSSColor('color-mix(in srgb, oklch(0.208 0.042 265.755) 100%, transparent)'),
		)
		expect(readContrast(requireValue(container.querySelector('p')))).toBeCloseTo(
			measureContrast(foreground, [255, 255, 255, 1]),
			3,
		)
	})

	it('measures the light oklch text on an oklch surface against browser controls', () => {
		const container = buildFixture(
			'<p style="color: oklch(0.929 0.013 255.508); background: oklch(0.21 0.013 256)">Ink</p>',
		)
		const foreground = requireValue(
			parseCSSColor('color-mix(in srgb, oklch(0.929 0.013 255.508) 100%, transparent)'),
		)
		const background = requireValue(
			parseCSSColor('color-mix(in srgb, oklch(0.21 0.013 256) 100%, transparent)'),
		)
		expect(readContrast(requireValue(container.querySelector('p')))).toBeCloseTo(
			measureContrast(foreground, background),
			3,
		)
	})

	it('measures the contrast ratio of an oklch box-shadow on a focused control', async () => {
		buildStylesheet(
			'.modern-ring:focus-visible { outline: none; box-shadow: 0 0 0 3px oklch(0.208 0.042 265.755) }',
		)
		buildFixture(
			'<div style="background: white"><button class="modern-ring" type="button">Modern ring</button></div>',
		)
		const control = resolveRendered('Modern ring')
		control.focus()
		await userEvent.keyboard('{ArrowRight}')
		expect(control.matches(':focus-visible')).toBe(true)
		expect(readStyle(control, 'box-shadow')).toContain('oklch(')
		const ring = requireValue(
			parseCSSColor('color-mix(in srgb, oklch(0.208 0.042 265.755) 100%, transparent)'),
		)
		expect(readRing(control)).toBeCloseTo(measureContrast(ring, [255, 255, 255, 1]), 3)
	})

	it('refuses an unreadable painted layer through every backdrop reader', async () => {
		const container = buildFixture(
			'<div style="background: white"><div id="unreadable-paint" style="background-color: color(srgb calc(infinity) 0 0)"><button type="button" style="color: black; background: transparent; outline: 3px solid black">Unreadable paint</button></div></div>',
		)
		const layer = requireValue(container.querySelector('#unreadable-paint'))
		const control = resolveRendered('Unreadable paint')
		control.focus()
		await userEvent.keyboard('{ArrowRight}')
		expect(control.matches(':focus-visible')).toBe(true)
		const computed = readStyle(layer, 'background-color')
		expect(computed).toBe('color(srgb calc(infinity) 0 0)')
		expect(parseColor(computed)).toBeUndefined()
		expect(() => readLayers(control)).toThrow(
			/div#unreadable-paint.*color\(srgb calc\(infinity\) 0 0\)/u,
		)
		expect(() => readBackdrop(control, CANVAS_COLOR)).toThrow(computed)
		expect(() => readContrast(control, CANVAS_COLOR)).toThrow(computed)
		expect(() => readRing(control)).toThrow(computed)
	})
})

describe('convertSRGB', () => {
	it('agrees with browser sRGB controls for translucent and signed channels', () => {
		expect(convertSRGB(0.25, 0.4, 0.3, 0.6)).toStrictEqual([63.75, 102, 76.5, 0.6])
		const control = requireValue(
			parseCSSColor('color-mix(in srgb, color(srgb 0.25 0.4 0.3 / 0.6) 100%, transparent)'),
		)
		const signed = requireValue(
			parseCSSColor('color-mix(in srgb, color(srgb -0.1 0.2 1.2) 100%, transparent)'),
		)
		expect(matchesColor(convertSRGB(0.25, 0.4, 0.3, 0.6), control)).toBe(true)
		expect(matchesColor(convertSRGB(-0.1, 0.2, 1.2), signed)).toBe(true)
		expect(matchesColor(requireValue(parseColor('color(srgb -0.1 0.2 1.2)')), signed)).toBe(true)
		expect(Object.isFrozen(convertSRGB(0.25, 0.4, 0.3, 0.6))).toBe(true)
		expect(convertSRGB(0, 0, 0)).toStrictEqual([0, 0, 0, 1])
	})
})

describe('convertLinearSRGB', () => {
	it('agrees with browser sRGB controls for translucent and signed channels', () => {
		const control = requireValue(
			parseCSSColor('color-mix(in srgb, color(srgb-linear 0.25 0.4 0.3 / 0.6) 100%, transparent)'),
		)
		const signed = requireValue(
			parseCSSColor('color-mix(in srgb, color(srgb-linear -0.001 0.002 1.2) 100%, transparent)'),
		)
		expect(matchesColor(convertLinearSRGB(0.25, 0.4, 0.3, 0.6), control)).toBe(true)
		expect(matchesColor(convertLinearSRGB(-0.001, 0.002, 1.2), signed)).toBe(true)
		expect(
			matchesColor(requireValue(parseColor('color(srgb-linear -0.001 0.002 1.2)')), signed),
		).toBe(true)
		expect(Object.isFrozen(convertLinearSRGB(0.25, 0.4, 0.3, 0.6))).toBe(true)
		expect(convertLinearSRGB(0, 0, 0)).toStrictEqual([0, 0, 0, 1])
	})
})

describe('convertXYZD65', () => {
	it('agrees with browser sRGB controls for translucent and signed channels', () => {
		const control = requireValue(
			parseCSSColor('color-mix(in srgb, color(xyz-d65 0.25 0.4 0.3 / 0.6) 100%, transparent)'),
		)
		const signed = requireValue(
			parseCSSColor('color-mix(in srgb, color(xyz-d65 -0.1 0.2 1.2) 100%, transparent)'),
		)
		expect(matchesColor(convertXYZD65(0.25, 0.4, 0.3, 0.6), control)).toBe(true)
		expect(matchesColor(convertXYZD65(-0.1, 0.2, 1.2), signed)).toBe(true)
		expect(matchesColor(requireValue(parseColor('color(xyz-d65 -0.1 0.2 1.2)')), signed)).toBe(true)
		expect(Object.isFrozen(convertXYZD65(0.25, 0.4, 0.3, 0.6))).toBe(true)
		expect(convertXYZD65(0, 0, 0)).toStrictEqual([0, 0, 0, 1])
	})
})

describe('convertXYZD50', () => {
	it('agrees with browser sRGB controls for translucent and signed channels', () => {
		const control = requireValue(
			parseCSSColor('color-mix(in srgb, color(xyz-d50 0.25 0.4 0.3 / 0.6) 100%, transparent)'),
		)
		const signed = requireValue(
			parseCSSColor('color-mix(in srgb, color(xyz-d50 -0.1 0.2 1.2) 100%, transparent)'),
		)
		expect(matchesColor(convertXYZD50(0.25, 0.4, 0.3, 0.6), control)).toBe(true)
		expect(matchesColor(convertXYZD50(-0.1, 0.2, 1.2), signed)).toBe(true)
		expect(matchesColor(requireValue(parseColor('color(xyz-d50 -0.1 0.2 1.2)')), signed)).toBe(true)
		expect(Object.isFrozen(convertXYZD50(0.25, 0.4, 0.3, 0.6))).toBe(true)
		expect(convertXYZD50(0, 0, 0)).toStrictEqual([0, 0, 0, 1])
	})
})

describe('convertOKLab', () => {
	it('agrees with browser sRGB controls for translucent and signed channels', () => {
		const control = requireValue(
			parseCSSColor('color-mix(in srgb, oklab( 0.6 -0.04 0.08 / 0.6) 100%, transparent)'),
		)
		const signed = requireValue(
			parseCSSColor('color-mix(in srgb, oklab( 0.7 0.3 -0.3) 100%, transparent)'),
		)
		expect(matchesColor(convertOKLab(0.6, -0.04, 0.08, 0.6), control)).toBe(true)
		expect(matchesColor(convertOKLab(0.7, 0.3, -0.3), signed)).toBe(true)
		expect(matchesColor(requireValue(parseColor('oklab( 0.7 0.3 -0.3)')), signed)).toBe(true)
		expect(Object.isFrozen(convertOKLab(0.6, -0.04, 0.08, 0.6))).toBe(true)
		expect(convertOKLab(0, 0, 0)).toStrictEqual([0, 0, 0, 1])
	})
})

describe('convertLab', () => {
	it('agrees with browser sRGB controls for translucent and signed channels', () => {
		const control = requireValue(
			parseCSSColor('color-mix(in srgb, lab( 60 -10 20 / 0.6) 100%, transparent)'),
		)
		const signed = requireValue(
			parseCSSColor('color-mix(in srgb, lab( 4 -10 20) 100%, transparent)'),
		)
		expect(matchesColor(convertLab(60, -10, 20, 0.6), control)).toBe(true)
		expect(matchesColor(convertLab(4, -10, 20), signed)).toBe(true)
		expect(matchesColor(requireValue(parseColor('lab( 4 -10 20)')), signed)).toBe(true)
		expect(Object.isFrozen(convertLab(60, -10, 20, 0.6))).toBe(true)
		expect(convertLab(0, 0, 0)).toStrictEqual([0, 0, 0, 1])
	})
})

describe('convertDisplayP3', () => {
	it('agrees with browser sRGB controls for translucent and signed channels', () => {
		const control = requireValue(
			parseCSSColor('color-mix(in srgb, color(display-p3 0.25 0.4 0.3 / 0.6) 100%, transparent)'),
		)
		const signed = requireValue(
			parseCSSColor('color-mix(in srgb, color(display-p3 -0.01 0.03 1.2) 100%, transparent)'),
		)
		expect(matchesColor(convertDisplayP3(0.25, 0.4, 0.3, 0.6), control)).toBe(true)
		expect(matchesColor(convertDisplayP3(-0.01, 0.03, 1.2), signed)).toBe(true)
		expect(matchesColor(requireValue(parseColor('color(display-p3 -0.01 0.03 1.2)')), signed)).toBe(
			true,
		)
		expect(Object.isFrozen(convertDisplayP3(0.25, 0.4, 0.3, 0.6))).toBe(true)
		expect(convertDisplayP3(0, 0, 0)).toStrictEqual([0, 0, 0, 1])
	})
})

describe('convertA98RGB', () => {
	it('agrees with browser sRGB controls for translucent and signed channels', () => {
		const control = requireValue(
			parseCSSColor('color-mix(in srgb, color(a98-rgb 0.25 0.4 0.3 / 0.6) 100%, transparent)'),
		)
		const signed = requireValue(
			parseCSSColor('color-mix(in srgb, color(a98-rgb -0.1 0.2 1.2) 100%, transparent)'),
		)
		expect(matchesColor(convertA98RGB(0.25, 0.4, 0.3, 0.6), control)).toBe(true)
		expect(matchesColor(convertA98RGB(-0.1, 0.2, 1.2), signed)).toBe(true)
		expect(matchesColor(requireValue(parseColor('color(a98-rgb -0.1 0.2 1.2)')), signed)).toBe(true)
		expect(Object.isFrozen(convertA98RGB(0.25, 0.4, 0.3, 0.6))).toBe(true)
		expect(convertA98RGB(0, 0, 0)).toStrictEqual([0, 0, 0, 1])
	})
})

describe('convertProPhotoRGB', () => {
	it('agrees with browser sRGB controls for translucent and signed channels', () => {
		const control = requireValue(
			parseCSSColor('color-mix(in srgb, color(prophoto-rgb 0.25 0.4 0.3 / 0.6) 100%, transparent)'),
		)
		const signed = requireValue(
			parseCSSColor('color-mix(in srgb, color(prophoto-rgb -0.01 0.02 1.2) 100%, transparent)'),
		)
		expect(matchesColor(convertProPhotoRGB(0.25, 0.4, 0.3, 0.6), control)).toBe(true)
		expect(matchesColor(convertProPhotoRGB(-0.01, 0.02, 1.2), signed)).toBe(true)
		expect(
			matchesColor(requireValue(parseColor('color(prophoto-rgb -0.01 0.02 1.2)')), signed),
		).toBe(true)
		expect(Object.isFrozen(convertProPhotoRGB(0.25, 0.4, 0.3, 0.6))).toBe(true)
		expect(convertProPhotoRGB(0, 0, 0)).toStrictEqual([0, 0, 0, 1])
	})
})

describe('convertRec2020', () => {
	it('agrees with browser sRGB controls for translucent and signed channels', () => {
		const control = requireValue(
			parseCSSColor('color-mix(in srgb, color(rec2020 0.25 0.4 0.3 / 0.6) 100%, transparent)'),
		)
		const signed = requireValue(
			parseCSSColor('color-mix(in srgb, color(rec2020 -0.01 0.07 1.2) 100%, transparent)'),
		)
		expect(matchesColor(convertRec2020(0.25, 0.4, 0.3, 0.6), control)).toBe(true)
		expect(matchesColor(convertRec2020(-0.01, 0.07, 1.2), signed)).toBe(true)
		expect(matchesColor(requireValue(parseColor('color(rec2020 -0.01 0.07 1.2)')), signed)).toBe(
			true,
		)
		expect(Object.isFrozen(convertRec2020(0.25, 0.4, 0.3, 0.6))).toBe(true)
		expect(convertRec2020(0, 0, 0)).toStrictEqual([0, 0, 0, 1])
	})
})

describe('paint parser boundaries', () => {
	it('reads percentage lightness, degree hues, scientific notation, and missing components', () => {
		expect(
			matchesColor(
				requireValue(parseColor('oklch(70% 0.08 -30deg / 50%)')),
				requireValue(
					parseCSSColor('color-mix(in srgb, oklch(70% 0.08 -30deg / 50%) 100%, transparent)'),
				),
			),
		).toBe(true)
		expect(
			matchesColor(
				requireValue(parseColor('lch(60% 30 -100deg / 50%)')),
				requireValue(
					parseCSSColor('color-mix(in srgb, lch(60% 30 -100deg / 50%) 100%, transparent)'),
				),
			),
		).toBe(true)
		expect(parseColor('color(srgb -1e-1 +2e-1 1.2 / 50%)')).toStrictEqual([0, 51, 255, 0.5])
		expect(parseColor('oklch(none none none / none)')).toStrictEqual([0, 0, 0, 0])
		expect(parseColor('oklab(none none none)')).toStrictEqual([0, 0, 0, 1])
		expect(parseColor('lab(none none none)')).toStrictEqual([0, 0, 0, 1])
		expect(parseColor('lch(none none none)')).toStrictEqual([0, 0, 0, 1])
		expect(parseColor('color(srgb none none none)')).toStrictEqual([0, 0, 0, 1])
		expect(parseColor('rgb(-10, +20, 300)')).toStrictEqual([0, 20, 255, 1])
		expect(parseColor('rgba(-10, +20, 300, 2)')).toStrictEqual([0, 20, 255, 1])
		expect(parseColor('rgb(100% 0% 50% / -1)')).toStrictEqual([255, 0, 127.5, 0])
	})

	it('refuses malformed components, separators, units, and non-finite values', () => {
		expect(parseColor('rgb(1 / 2 3)')).toBeUndefined()
		expect(parseColor('color(srgb 1 / 2 3)')).toBeUndefined()
		expect(parseColor('oklab(0.5 0 0 /)')).toBeUndefined()
		expect(parseColor('rgb(1,,2,3)')).toBeUndefined()
		expect(parseColor('rgb(1 2 3 4 5)')).toBeUndefined()
		expect(parseColor('rgb(1px 2 3)')).toBeUndefined()
		expect(parseColor('oklab(0.5 0 30deg)')).toBeUndefined()
		expect(parseColor('oklch(0.5 0.2 50%)')).toBeUndefined()
		expect(parseColor('color(srgb 1e999 0 0)')).toBeUndefined()
		expect(parseColor('color(srgb calc(infinity) 0 0)')).toBeUndefined()
		expect(parseColor('color(srgb NaN 0 0)')).toBeUndefined()
		expect(parseColor('color(srgb 1 2 3) trailing')).toBeUndefined()
		expect(parseColor('color(unknown 1 2 3)')).toBeUndefined()
	})

	it('skips unreadable transparent paint and stops before an occluded unreadable layer', () => {
		const container = buildFixture(
			'<div id="infinite" style="background: color(srgb calc(infinity) 0 0)"><p style="background: white">Opaque</p></div><p id="transparent-infinite" style="background: color(srgb calc(infinity) 0 0 / 0)">Transparent</p><p id="image-only" style="background-image: linear-gradient(red, blue)">Image</p>',
		)
		const transparent = requireValue(container.querySelector('#transparent-infinite'))
		expect(readStyle(transparent, 'background-color')).toBe('color(srgb calc(infinity) 0 0 / 0)')
		expect(readLayers(transparent)).toStrictEqual([])
		expect(readLayers(requireValue(container.querySelector('#infinite p')))).toStrictEqual([
			[255, 255, 255, 1],
		])
		expect(readLayers(requireValue(container.querySelector('#image-only')))).toStrictEqual([])
	})
})
