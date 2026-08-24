import type { CaptureVariant, Color } from '@src/browser'
import {
	ACCESSIBLE_ROLES,
	blendColor,
	build,
	CANVAS_COLOR,
	CAPTURE_PANE,
	captureFrame,
	clearStorage,
	clickAccessible,
	clickAccessibleWithin,
	clickDisclosure,
	colorEqual,
	commitInput,
	contrast,
	describeFocus,
	describeTree,
	expandCaptures,
	extractOrphans,
	FIELD_ROLES,
	fillAccessible,
	findKeyframes,
	findRule,
	IMPLICIT_ROLES,
	isOutsideViewport,
	isReachable,
	isRendered,
	measureContrast,
	measureLuminance,
	mount,
	parseColor,
	pixels,
	pressKeys,
	readBackdrop,
	readCascade,
	readFocus,
	readLayers,
	readName,
	readPage,
	readPerception,
	readRing,
	readRole,
	readRows,
	readRules,
	readStates,
	readText,
	readValue,
	releasePane,
	removeDatabase,
	render,
	resolveAccessible,
	resolveRendered,
	rgba,
	rootToken,
	stagePane,
	style,
	token,
	traverseAccessible,
	typeAccessible,
	typeInput,
	waitForFrame,
} from '@src/browser'
import { createRecorder, requireValue } from '@src/core'
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest'
import { commands, page, server } from 'vitest/browser'
import { normalizePath } from '../../setup.js'
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
	it('sends letters and key descriptors to whatever holds focus', async () => {
		buildFixture('<label for="notes">Notes</label><textarea id="notes"></textarea>')
		await clickAccessible('Notes')
		await pressKeys('ab{Enter}c')
		expect(readValue('textbox', 'Notes')).toBe('ab\nc')
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
		await pressKeys('{Tab}')
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
		expect(style(built, 'padding-left')).toBe('')
		expect(built.getBoundingClientRect().width).toBe(0)
		const mounted = mount(built)
		try {
			expect(style(mounted, 'padding-left')).toBe('12px')
			expect(mounted.getBoundingClientRect().width).toBe(40)
		} finally {
			mounted.remove()
		}
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
		expect(parseColor('lab(50% 40 59.5)')).toBeUndefined()
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

describe('rgba', () => {
	it('resolves the syntaxes parseColor refuses, by asking the browser', () => {
		// Each of these returns `undefined` from `parseColor`, which is what the live resolver is for.
		expect(parseColor('rebeccapurple')).toBeUndefined()
		expect(parseColor('#ff0000')).toBeUndefined()
		expect(rgba('rebeccapurple')).toStrictEqual([102, 51, 153, 1])
		expect(rgba('#ff0000')).toStrictEqual([255, 0, 0, 1])
		expect(rgba('rgb(1, 2, 3)')).toStrictEqual([1, 2, 3, 1])
	})

	it('resolves a var() reference against the tokens the document declares', () => {
		buildStylesheet(':root { --journey-ink: rgb(10, 20, 30) }')
		expect(rgba('var(--journey-ink)')).toStrictEqual([10, 20, 30, 1])
	})

	it('refuses an expression the CSSOM will not parse', () => {
		expect(rgba('not-a-color')).toBeUndefined()
		expect(rgba('')).toBeUndefined()
		expect(rgba('12px')).toBeUndefined()
	})

	it('leaves no probe element behind, on the refusing path as well as the reading one', () => {
		const before = document.body.childElementCount
		expect(rgba('rebeccapurple')).toStrictEqual([102, 51, 153, 1])
		expect(rgba('not-a-color')).toBeUndefined()
		expect(document.body.childElementCount).toBe(before)
		expect(document.body.querySelector(':scope > span')).toBeNull()
	})
})

describe('colorEqual', () => {
	it('reads two spellings of one color as equal', () => {
		expect(colorEqual('rebeccapurple', 'rgb(102, 51, 153)')).toBe(true)
		expect(colorEqual('#ff0000', [255, 0, 0, 1])).toBe(true)
		expect(colorEqual([1, 2, 3, 1], [1, 2, 3, 1])).toBe(true)
	})

	it('reads different colors as unequal, including on alpha alone', () => {
		expect(colorEqual('red', [0, 0, 255, 1])).toBe(false)
		expect(colorEqual([1, 2, 3, 1], [1, 2, 3, 0.5])).toBe(false)
	})

	it('holds at the tolerance and parts one step past it', () => {
		expect(colorEqual([10, 20, 30, 1], [10.5, 20, 30, 1])).toBe(true)
		expect(colorEqual([10, 20, 30, 1], [10.6, 20, 30, 1])).toBe(false)
		// The alpha is scaled onto the same 0-255 range before it is compared, so half a channel step
		// on the 0-1 scale is `0.5 / 255`.
		expect(colorEqual([10, 20, 30, 1], [10, 20, 30, 1 - 0.5 / 255])).toBe(true)
		expect(colorEqual([10, 20, 30, 1], [10, 20, 30, 1 - 0.6 / 255])).toBe(false)
	})

	it('reports false when either side names no readable color', () => {
		expect(colorEqual('not-a-color', 'red')).toBe(false)
		expect(colorEqual('red', 'not-a-color')).toBe(false)
		expect(colorEqual('not-a-color', 'not-a-color')).toBe(false)
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

describe('contrast', () => {
	it('refuses a detached element whose foreground has no computed channels', () => {
		const detached = document.createElement('p')
		expect(() => contrast(detached)).toThrow('Computed foreground color is unavailable')
	})

	it('measures a fully opaque stack from the element that paints, ignoring its ancestors', () => {
		const container = buildFixture(
			'<div style="background: #fff"><p style="background: #000; color: #fff">Ready</p></div>' +
				'<div style="background: #000"><p style="background: #000; color: #fff">Ready</p></div>',
		)
		const [over, under] = container.querySelectorAll('p')
		expect(contrast(requireValue(over))).toBeCloseTo(21, 5)
		expect(contrast(requireValue(under))).toBeCloseTo(21, 5)
	})

	it('composites a translucent surface onto the opaque layer beneath it', () => {
		const container = buildFixture(
			'<div style="background: #000">' +
				'<p style="background: rgba(255, 255, 255, 0.5); color: #000">Ready</p></div>',
		)
		const composited = contrast(requireValue(container.querySelector('p')))
		// A 50% white tint over black paints mid-grey, so black text on it reads far below the 21
		// an uncomposited reading of the same declaration would report.
		expect(composited).toBeCloseTo(5.28, 1)
		expect(composited).toBeLessThan(21)
	})

	it('refuses a stack where nothing from the element upwards paints a background', () => {
		const container = buildFixture('<p style="color: #000">Ready</p>')
		expect(() => contrast(requireValue(container.querySelector('p')))).toThrow(
			'Computed background color is unavailable',
		)
	})

	it('refuses a stack whose painted layers are all translucent, because the canvas shows through', () => {
		const container = buildFixture(
			'<div style="background: rgba(255, 255, 255, 0.5)">' +
				'<p style="color: #000">Ready</p></div>',
		)
		expect(() => contrast(requireValue(container.querySelector('p')))).toThrow(
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
		expect(() => contrast(requireValue(container.querySelector('p')))).toThrow(
			'Computed background color is unavailable',
		)
	})

	it('measures the same unpainted stack against a supplied floor instead of refusing it', () => {
		const container = buildFixture('<p style="color: #000">Ready</p>')
		const paragraph = requireValue(container.querySelector('p'))
		expect(contrast(paragraph, CANVAS_COLOR)).toBeCloseTo(21, 5)
		expect(contrast(paragraph, [0, 0, 0, 1])).toBe(1)
	})

	it('composites a translucent stack onto the supplied floor', () => {
		const container = buildFixture(
			'<div style="background: rgba(255, 255, 255, 0.5)">' +
				'<p style="color: #000">Ready</p></div>',
		)
		const paragraph = requireValue(container.querySelector('p'))
		// The same half-white tint resolves to white over the canvas and to mid grey over black, so
		// the floor is what the answer turns on rather than an argument the measurement ignores.
		expect(contrast(paragraph, CANVAS_COLOR)).toBeCloseTo(21, 5)
		expect(contrast(paragraph, [0, 0, 0, 1])).toBeCloseTo(5.28, 1)
	})

	it('refuses a detached element whichever floor it is handed', () => {
		expect(() => contrast(document.createElement('p'), CANVAS_COLOR)).toThrow(
			'Computed foreground color is unavailable',
		)
	})

	// guides/test.md → Patterns → "Measure what a reader sees", the `contrast` fence. A browser fence
	// carries in this directory because the guides project runs with the browser disabled.
	it('reads grey on white at 4.54, refuses it unpainted, and measures it on a named floor', () => {
		const surface = buildFixture(
			'<main style="background:#fff"><p style="color:#767676">Ready</p></main>',
		)
		const text = requireValue(surface.querySelector('p'))
		expect(contrast(text).toFixed(2)).toBe('4.54')
		expect(contrast(text) >= 4.5).toBe(true)

		const fragment = buildFixture('<p style="color:#767676">Ready</p>')
		const orphan = requireValue(fragment.querySelector('p'))
		expect(() => contrast(orphan)).toThrow('Computed background color is unavailable')
		expect(contrast(orphan, CANVAS_COLOR).toFixed(2)).toBe('4.54')
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
		expect(style(control, 'outline-style')).toBe('auto')
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
		expect(style(control, 'background-color')).toBe('rgb(0, 0, 0)')
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
		releasePane()
		expect(pane.hasAttribute(CAPTURE_PANE)).toBe(false)
		expect(owner.querySelector(`style[${CAPTURE_PANE}]`)).toBeNull()
	})

	it('releases an unstaged pane without complaining', () => {
		const pane = requireValue(window.frameElement?.parentElement)
		releasePane()
		releasePane()
		expect(pane.hasAttribute(CAPTURE_PANE)).toBe(false)
	})
})

describe('captureFrame', () => {
	it('writes a real file, reads it back, and returns the verified absolute path', async () => {
		const written = await captureFrame({ path: `${FRAMES}/page.png`, width: 390, height: 844 })
		// The provider returns the written path in its host's own separator, and the runner reports
		// its root with forward slashes on every host, so each side is compared through
		// `normalizePath` and the comparison reads the file rather than the separator.
		expect(normalizePath(written)).toBe(
			normalizePath(`${server.config.root}/tmp/capture/frame/page.png`),
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

describe('style', () => {
	it('reads the browser resolved value of one property', () => {
		const container = buildFixture('<p style="padding-left: 12px">Ready</p>')
		expect(style(requireValue(container.querySelector('p')), 'padding-left')).toBe('12px')
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
		expect(style(subject, '--journey-padded')).toBe('8px')
		expect(style(subject, '--journey-substituted')).toBe('8px')
		expect(style(subject, '--journey-fallback')).toBe('8px')
		expect(style(subject, '--journey-inline')).toBe('8px')
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
		expect(style(requireValue(container.querySelector('p')), '--journey-shadow')).toBe('0 0 2px')
	})

	it('reads a property the element resolves none of as an empty string', () => {
		const container = buildFixture('<p>Ready</p>')
		expect(style(requireValue(container.querySelector('p')), '--journey-absent')).toBe('')
	})
})

describe('token', () => {
	it('reads a custom property with and without its leading dashes', () => {
		const container = buildFixture('<p style="--journey-ink: rgb(1, 2, 3)">Ready</p>')
		const subject = requireValue(container.querySelector('p'))
		expect(token(subject, 'journey-ink')).toBe('rgb(1, 2, 3)')
		expect(token(subject, '--journey-ink')).toBe('rgb(1, 2, 3)')
	})

	it('reads a token declared on an ancestor', () => {
		const container = buildFixture('<div style="--journey-ink: rgb(4, 5, 6)"><p>Ready</p></div>')
		expect(token(requireValue(container.querySelector('p')), 'journey-ink')).toBe('rgb(4, 5, 6)')
	})

	it('reads a token nothing declares as an empty string', () => {
		const container = buildFixture('<p>Ready</p>')
		const subject = requireValue(container.querySelector('p'))
		expect(token(subject, 'journey-undeclared')).toBe('')
		expect(token(subject, '--journey-undeclared')).toBe('')
	})
})

describe('rootToken', () => {
	it('reads a token the document declares, with and without its leading dashes', () => {
		buildStylesheet(':root { --journey-surface: rgb(7, 8, 9) }')
		expect(rootToken('journey-surface')).toBe('rgb(7, 8, 9)')
		expect(rootToken('--journey-surface')).toBe('rgb(7, 8, 9)')
		expect(rootToken('journey-surface')).toBe(token(document.documentElement, 'journey-surface'))
	})

	it('reads a token the document does not declare as an empty string', () => {
		expect(rootToken('journey-unthemed')).toBe('')
	})
})

describe('pixels', () => {
	it('reads a resolved length as its number of pixels', () => {
		const container = buildFixture('<p style="padding-left: 12px; margin-top: 0.5px">Ready</p>')
		const subject = requireValue(container.querySelector('p'))
		expect(pixels(subject, 'padding-left')).toBe(12)
		expect(pixels(subject, 'margin-top')).toBe(0.5)
	})

	it('reads a custom property carrying a length', () => {
		const container = buildFixture('<p style="--journey-gap: 8px">Ready</p>')
		expect(pixels(requireValue(container.querySelector('p')), '--journey-gap')).toBe(8)
	})

	it('reads an unparsable value as zero', () => {
		const container = buildFixture('<p style="--journey-label: wide">Ready</p>')
		const subject = requireValue(container.querySelector('p'))
		expect(style(subject, '--journey-label')).toBe('wide')
		expect(pixels(subject, '--journey-label')).toBe(0)
		expect(pixels(subject, '--journey-absent')).toBe(0)
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
