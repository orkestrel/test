import {
	ACCESSIBLE_ROLES,
	build,
	buildDenial,
	chooseAccessible,
	clearStorage,
	clickAccessible,
	clickAccessibleWithin,
	clickDisclosure,
	collectScrollRegions,
	collectTabStops,
	commitInput,
	computeNamePattern,
	describeFocus,
	describeScrollRegions,
	describeTree,
	driveHold,
	driveTraversal,
	FIELD_ROLES,
	fillAccessible,
	holdAccessible,
	holdAccessibleWithin,
	hoverAccessible,
	IMPLICIT_ROLES,
	isOutsideViewport,
	isReachable,
	isRendered,
	parkPointer,
	POINTER_HOLD,
	pressKeys,
	readAnimations,
	readContrast,
	readFocus,
	readHit,
	readName,
	readPage,
	readPerception,
	readPixels,
	readRefusal,
	readRole,
	readRows,
	readStates,
	readStyle,
	readText,
	readValue,
	releasePointer,
	removeDatabase,
	render,
	resolveAccessible,
	resolveAccessibleWithin,
	resolveFileInput,
	resolveRendered,
	sendProtocol,
	settleCapture,
	traverseAccessible,
	traverseAccessibleWithin,
	typeAccessible,
	typeInput,
	waitForAnimations,
	waitForFrame,
	waitForState,
	walkFocus,
} from '@src/browser'
import { createRecorder, requireValue } from '@src/core'
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest'
import { page, userEvent } from 'vitest/browser'
import {
	buildFileFixture,
	buildFixture,
	buildStylesheet,
	FIELD_ROLE_CASES,
	FILE_REFUSALS,
	IMPLICIT_ROLE_CASES,
	resetFixtures,
} from '../../../setupBrowser.js'

// An icon font paints its glyph as `::before` content on an element marked `aria-hidden`, which is
// how Bootstrap Icons writes one. The character is a private-use codepoint, so only a name
// computation that reads hidden subtrees ever sees it. The stylesheet is what makes the glyph real:
// without it the element paints nothing and a case built on it proves nothing.
const GLYPH = '\uF4FE'

const GLYPH_STYLE = `.glyph::before { content: "${GLYPH}" }`

const GLYPH_ICON = '<i class="glyph" aria-hidden="true"></i>'

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

describe('native file choice', () => {
	it('resolves the labeled native input without inventing an ARIA role', () => {
		const { input } = buildFileFixture()
		expect(resolveFileInput('Attachments')).toBe(input)
		expect(readRole(input)).toBeUndefined()
		expect(() => resolveFileInput('Missing')).toThrow(
			'No native file input has the accessible name "Missing"',
		)
	})

	it('activates the native chooser with a trusted pointer and selects fixture bytes', async () => {
		const { input, other } = buildFileFixture()
		const clicks = createRecorder<readonly [MouseEvent]>()
		input.addEventListener('click', clicks.handler)
		await chooseAccessible('Attachments', [
			{ name: 'note.txt', mime: 'text/plain', bytes: [72, 105] },
		])
		expect(clicks.count).toBe(1)
		expect(clicks.calls[0]?.[0].isTrusted).toBe(true)
		expect(input.files?.[0]?.name).toBe('note.txt')
		expect(input.files?.[0]?.type).toBe('text/plain')
		expect(await input.files?.[0]?.text()).toBe('Hi')
		expect(other.files?.length).toBe(0)
	})

	it('reaches the input by Tab and opens its chooser with a trusted Enter key', async () => {
		const { input } = buildFileFixture()
		const keys = createRecorder<readonly [KeyboardEvent]>()
		input.addEventListener('keydown', keys.handler)
		await chooseAccessible('Attachments', [{ name: 'keys.txt', mime: 'text/plain', bytes: [75] }], {
			keyboard: true,
		})
		expect(keys.calls.some(([event]) => event.key === 'Enter' && event.isTrusted)).toBe(true)
		expect(document.activeElement).toBe(input)
		expect(input.files?.[0]?.name).toBe('keys.txt')
	})

	it('opens a chooser for same-file reselection and fixture-driven empty selection', async () => {
		const { input } = buildFileFixture()
		const clicks = createRecorder<readonly [MouseEvent]>()
		input.addEventListener('click', clicks.handler)
		const files = [{ name: 'same.txt', mime: 'text/plain', bytes: [83] }]
		await chooseAccessible('Attachments', files)
		await chooseAccessible('Attachments', files)
		expect(input.files?.[0]?.name).toBe('same.txt')
		await chooseAccessible('Attachments', [])
		expect(clicks.count).toBe(3)
		expect(input.files?.length).toBe(0)
	})

	it.each(FILE_REFUSALS)('refuses $name inputs', async ({ markup, message }) => {
		buildFixture(markup)
		await expect(chooseAccessible('Attachments', [])).rejects.toThrow(message)
	})

	it('refuses a missing chooser even when a trusted click reaches the input', async () => {
		const { input } = buildFileFixture()
		const clicks = createRecorder<readonly [MouseEvent]>()
		input.addEventListener('click', clicks.handler)
		input.addEventListener('click', (event) => event.preventDefault(), { once: true })
		await expect(chooseAccessible('Attachments', [], { budget: 150 })).rejects.toThrow(
			'native file chooser',
		)
		expect(clicks.calls[0]?.[0].isTrusted).toBe(true)
		await chooseAccessible('Attachments', [])
	})

	it('rejects a chooser opened by a different native input', async () => {
		const { input, other } = buildFileFixture()
		input.addEventListener(
			'click',
			(event) => {
				event.preventDefault()
				other.showPicker()
			},
			{ once: true },
		)
		await expect(chooseAccessible('Attachments', [])).rejects.toThrow(
			'belongs to a different input',
		)
		await chooseAccessible('Attachments', [])
	})
})

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

describe('resolveAccessibleWithin', () => {
	it('resolves the control inside the named region and leaves its twin alone', () => {
		const container = buildFixture(
			'<section aria-label="Ledger"><button type="button">Monthly income · ready</button></section>' +
				'<section aria-label="Vault"><button type="button">Monthly income · ready</button></section>',
		)
		expect(resolveAccessibleWithin('Ledger', 'button', 'Monthly income')).toBe(
			container.querySelector('section button'),
		)
		expect(resolveAccessibleWithin('Vault', 'button', 'Monthly income')).toBe(
			container.querySelectorAll('section button')[1],
		)
	})

	it('refuses a control the region does not reach, and a name several controls answer for', () => {
		buildFixture(
			'<section aria-label="Ledger">' +
				'<button type="button">Add row</button><button type="button">Add column</button>' +
				'</section>',
		)
		expect(() => resolveAccessibleWithin('Ledger', 'button', 'Remove')).toThrow(
			'Interactive target "Remove" is not reachable inside "Ledger"',
		)
		expect(() => resolveAccessibleWithin('Ledger', 'button', 'Add')).toThrow(
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

describe('parkPointer', () => {
	it('moves the pointer off a hovered control and clears its hover', async () => {
		buildFixture('<button type="button">Hovered</button>')
		await hoverAccessible('Hovered')
		const button = resolveAccessible('Hovered')
		expect(button.matches(':hover')).toBe(true)
		await parkPointer()
		expect(button.matches(':hover')).toBe(false)
	})

	// The control is the release that follows: it shows the recorder sees a button-up, so the zero
	// before it reads as a press left held rather than as a recorder that sees nothing.
	it('leaves a held press held, and the release clears it', async () => {
		buildFixture('<button type="button">Held</button>')
		const releases = createRecorder<[event: PointerEvent]>()
		document.addEventListener('pointerup', releases.handler)
		try {
			await holdAccessible('Held')
			const held = document.documentElement.getAttribute(POINTER_HOLD)
			expect(held).not.toBeNull()
			await parkPointer()
			expect(document.documentElement.getAttribute(POINTER_HOLD)).toBe(held)
			expect(releases.count).toBe(0)
			// The pointer left the control, so its `:active` paint is gone although the press is owed a release.
			expect(resolveAccessible('Held').matches(':active')).toBe(false)
			await releasePointer()
			expect(releases.count).toBe(1)
			expect(document.documentElement.hasAttribute(POINTER_HOLD)).toBe(false)
			expect(resolveAccessible('Held').matches(':active')).toBe(false)
		} finally {
			document.removeEventListener('pointerup', releases.handler)
		}
	})

	it('resolves with an idle pointer', async () => {
		await expect(parkPointer()).resolves.toBeUndefined()
		expect(document.documentElement.hasAttribute(POINTER_HOLD)).toBe(false)
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

describe('holdAccessibleWithin', () => {
	it('holds the control inside the named region and leaves its twin unpressed', async () => {
		buildStylesheet(
			'.journey-hold { position: fixed; top: 140px; padding-top: 16px } .journey-hold:active { padding-top: 32px }',
		)
		const container = buildFixture(
			'<section aria-label="Ledger"><button class="journey-hold" style="left: 140px">Apply</button></section>' +
				'<section aria-label="Vault"><button class="journey-hold" style="left: 300px">Apply</button></section>',
		)
		const ledger = requireValue(container.querySelector('section button'))
		const vault = requireValue(container.querySelectorAll('section button')[1])
		await holdAccessibleWithin('Ledger', 'button', 'Apply')
		expect(readPixels(ledger, 'padding-top')).toBe(32)
		expect(ledger.matches(':active')).toBe(true)
		expect(vault.matches(':active')).toBe(false)
		expect(document.documentElement.hasAttribute(POINTER_HOLD)).toBe(true)
		await releasePointer()
		expect(readPixels(ledger, 'padding-top')).toBe(16)
		expect(document.documentElement.hasAttribute(POINTER_HOLD)).toBe(false)
	})

	it('scrolls a control below the fold into view before holding it', async () => {
		buildStylesheet(
			'.journey-fold { padding-top: 16px } .journey-fold:active { padding-top: 32px }',
		)
		const container = buildFixture(
			'<section aria-label="Ledger"><div style="height: 300vh"></div><button class="journey-fold">Apply</button></section>',
		)
		const button = requireValue(container.querySelector('button'))
		expect(isOutsideViewport(button.getBoundingClientRect())).toBe(true)
		await holdAccessibleWithin('Ledger', 'button', 'Apply')
		expect(readPixels(button, 'padding-top')).toBe(32)
		expect(button.matches(':active')).toBe(true)
		await releasePointer()
		window.scrollTo(0, 0)
	})

	it('refuses a control the region does not reach, and a double hold before resolving', async () => {
		buildStylesheet('.journey-hold { position: fixed; top: 140px; left: 140px }')
		buildFixture(
			'<section aria-label="Ledger"><button class="journey-hold">Apply</button></section>',
		)
		await expect(holdAccessibleWithin('Ledger', 'button', 'Remove')).rejects.toThrow(
			'Interactive target "Remove" is not reachable inside "Ledger"',
		)
		await holdAccessibleWithin('Ledger', 'button', 'Apply')
		await expect(holdAccessibleWithin('Ledger', 'button', 'Remove')).rejects.toThrow(
			'Pointer is already held at',
		)
	})
})

describe('driveHold', () => {
	it('holds the control a resolver returns, and refuses a double hold before resolving', async () => {
		buildStylesheet('.journey-hold { position: fixed; top: 140px; left: 140px }')
		const container = buildFixture('<button class="journey-hold">Apply</button>')
		const button = requireValue(container.querySelector('button'))
		await driveHold(() => button, 'Apply')
		expect(button.matches(':active')).toBe(true)
		await expect(
			driveHold(() => {
				throw new Error('resolver reached')
			}, 'Apply'),
		).rejects.toThrow('Pointer is already held at')
		await releasePointer()
		await expect(
			driveHold(() => {
				throw new Error('resolver reached')
			}, 'Apply'),
		).rejects.toThrow('resolver reached')
	})

	it('releases the pointer and rethrows when the pressed-state read fails after the marker is written', async () => {
		buildStylesheet('.journey-hold { position: fixed; top: 140px; left: 140px }')
		const container = buildFixture('<button class="journey-hold">Apply</button>')
		const button = requireValue(container.querySelector('button'))
		Object.defineProperty(button, 'matches', {
			value: () => {
				throw new Error('read refused')
			},
		})
		await expect(driveHold(() => button, 'Apply')).rejects.toThrow('read refused')
		expect(document.documentElement.hasAttribute(POINTER_HOLD)).toBe(false)
		const next = buildFixture('<button class="journey-hold">Retry</button>')
		const nextButton = requireValue(next.querySelector('button'))
		await driveHold(() => nextButton, 'Retry')
		expect(nextButton.matches(':active')).toBe(true)
		await releasePointer()
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

describe('traverseAccessibleWithin', () => {
	it('passes over a twin outside the region and reaches the control inside it', async () => {
		const container = buildFixture(
			'<section aria-label="Vault"><button type="button">Evaluate</button></section>' +
				'<section aria-label="Ledger"><button type="button">Evaluate</button></section>',
		)
		const ledger = requireValue(container.querySelectorAll('section button')[1])
		await expect(traverseAccessible('Evaluate')).rejects.toThrow(
			'Interactive target "Evaluate" is ambiguous across 2 elements',
		)
		const reached = await traverseAccessibleWithin('Ledger', 'button', 'Evaluate')
		expect(reached).toBe(ledger)
		expect(document.activeElement).toBe(ledger)
	})

	it('refuses a control the region does not reach before pressing any key', async () => {
		const container = buildFixture(
			'<section aria-label="Ledger"><button type="button">Evaluate</button></section>',
		)
		const focus = createRecorder<[event: FocusEvent]>()
		requireValue(container.querySelector('button')).addEventListener('focus', focus.handler)
		await expect(traverseAccessibleWithin('Ledger', 'button', 'Remove')).rejects.toThrow(
			'Interactive target "Remove" is not reachable inside "Ledger"',
		)
		expect(focus.count).toBe(0)
	})
})

describe('driveTraversal', () => {
	it('reaches the control a resolver returns, re-resolving on every step', async () => {
		const container = buildFixture(
			'<button type="button">First</button><button type="button">Second</button>',
		)
		const first = requireValue(container.querySelectorAll('button')[0])
		const second = requireValue(container.querySelectorAll('button')[1])
		const resolutions = createRecorder<[]>()
		// The resolver answers with the first button before the loop starts and with the second on
		// every step after that: a loop that compared focus against its first resolution would stop
		// on the first button, and a loop that resolves on every step passes it and reaches the second.
		const reached = await driveTraversal(() => {
			resolutions.handler()
			return resolutions.count > 1 ? second : first
		}, 'Second')
		expect(reached).toBe(second)
		expect(document.activeElement).toBe(second)
		expect(resolutions.count).toBeGreaterThan(2)
	})
})

describe('walkFocus', () => {
	it('lists every node a forward Tab reaches, once and in order, from the focused control', async () => {
		const container = buildFixture(
			'<button type="button">One</button><a href="#two">Two</a><input type="text" aria-label="Three">',
		)
		requireValue(container.querySelector('button')).focus()
		expect((await walkFocus()).map((stop) => readName(stop))).toStrictEqual(['One', 'Two', 'Three'])
	})

	it('stops at the first node the predicate accepts and includes it', async () => {
		const container = buildFixture(
			'<button type="button">One</button><a href="#two">Two</a><input type="text" aria-label="Three">',
		)
		requireValue(container.querySelector('button')).focus()
		expect(
			(await walkFocus((focused) => readName(focused) === 'Two')).map((stop) => readName(stop)),
		).toStrictEqual(['One', 'Two'])
	})

	it('lists nothing when only the body holds focus', async () => {
		buildFixture('<button type="button">One</button>')
		if (document.activeElement instanceof HTMLElement) document.activeElement.blur()
		expect(document.activeElement).toBe(document.body)
		expect(await walkFocus()).toStrictEqual([])
	})

	it('reaches the focusable scroller that describeFocus leaves out', async () => {
		const container = buildFixture(
			'<button type="button">One</button>' +
				'<div style="height: 40px; overflow-y: auto"><div style="height: 400px"></div></div>',
		)
		const scroller = requireValue(container.querySelector<HTMLElement>('div'))
		requireValue(container.querySelector('button')).focus()
		expect(await walkFocus()).toContain(scroller)
		// Control: the static selector sort is a second mechanism, and it disagrees about the scroller.
		expect(describeFocus(container)).toBe('1. button "One"')
	})
})

describe('collectTabStops', () => {
	const REGION = [
		'<section data-region>',
		'<h2 data-start tabindex="-1">Heading</h2>',
		'<button type="button">One</button>',
		'<button type="button" tabindex="-1">Skipped</button>',
		'<a href="#two">Two</a>',
		'<input type="text" aria-label="Three">',
		'</section>',
		'<button type="button">After</button>',
	].join('')

	it('collects the stops of a region after a start element, leaving out the start and a stop outside', async () => {
		const container = buildFixture(REGION)
		const region = requireValue(container.querySelector<HTMLElement>('[data-region]'))
		const start = requireValue(container.querySelector<HTMLElement>('[data-start]'))
		const stops = await collectTabStops(region, start)
		expect(stops.map((stop) => readName(stop))).toStrictEqual(['One', 'Two', 'Three'])
		expect(stops).not.toContain(start)
		expect(stops).not.toContain(resolveAccessible('After'))
	})

	it('includes the scroller Chromium focuses on its own, which describeFocus omits', async () => {
		const container = buildFixture(REGION)
		const region = requireValue(container.querySelector<HTMLElement>('[data-region]'))
		const start = requireValue(container.querySelector<HTMLElement>('[data-start]'))
		const planted = region.appendChild(document.createElement('div'))
		planted.setAttribute('style', 'height: 40px; overflow-y: auto')
		planted.appendChild(document.createElement('div')).setAttribute('style', 'height: 400px')
		const stops = await collectTabStops(region, start)
		expect(stops.at(-1)).toBe(planted)
		expect(stops).toHaveLength(4)
		// Control: the static selector sort reads the same region and lists three, so the two
		// mechanisms disagree about exactly the scroller.
		expect(describeFocus(region).split('\n')).toHaveLength(3)
	})

	it('refuses a start element that cannot take focus', async () => {
		const container = buildFixture(REGION)
		const region = requireValue(container.querySelector<HTMLElement>('[data-region]'))
		await expect(collectTabStops(region, document.createElement('div'))).rejects.toThrow(
			'The start element cannot take focus',
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

describe('readAnimations', () => {
	it('splits the running animations by whether each one ends, beside a paused one and an outside one it leaves out', () => {
		buildStylesheet(
			'@keyframes settle-turn { to { transform: rotate(360deg) } }' +
				'.settle-turn { width: 20px; height: 20px; animation: settle-turn 800ms linear infinite }' +
				'.settle-grow { width: 10px; transition: width 5000ms linear }',
		)
		const container = buildFixture(
			'<section><div class="settle-turn"></div><div class="settle-grow"></div><div class="settle-rest"></div></section>',
		)
		const outside = buildFixture('<div class="settle-turn"></div>')
		const section = requireValue(container.querySelector('section'))
		const grow = requireValue(container.querySelector<HTMLElement>('.settle-grow'))
		const rest = requireValue(container.querySelector<HTMLElement>('.settle-rest'))
		expect(readStyle(grow, 'width')).toBe('10px')
		grow.style.width = '200px'
		const paused = rest.animate({ opacity: [1, 0.2] }, { duration: 5000 })
		paused.pause()
		try {
			const reading = readAnimations(section)
			expect(
				reading.finite.map((animation) =>
					animation instanceof CSSTransition ? animation.transitionProperty : animation.id,
				),
			).toStrictEqual(['width'])
			expect(
				reading.endless.map((animation) =>
					animation instanceof CSSAnimation ? animation.animationName : animation.id,
				),
			).toStrictEqual(['settle-turn'])
			// Control: the browser reports the paused animation on the section, and neither list holds
			// it; the spinner outside the section is the outside element's alone.
			expect(section.getAnimations({ subtree: true })).toContain(paused)
			expect([...reading.finite, ...reading.endless]).not.toContain(paused)
			expect(readAnimations(requireValue(outside.firstElementChild)).endless).toHaveLength(1)
			expect(readAnimations(build('div'))).toStrictEqual({ finite: [], endless: [] })
		} finally {
			paused.cancel()
		}
	})
})

describe('settleCapture', () => {
	it('parks the pointer, waits out transitions, and holds endless animations at their first frame, beside the page left unsettled', async () => {
		buildStylesheet(
			'.settle-fill { background-color: rgb(255, 255, 255); transition: background-color 400ms linear }' +
				'.settle-fill:hover { background-color: rgb(200, 0, 0) }' +
				'@keyframes settle-turn { to { transform: rotate(360deg) } }' +
				'.settle-turn { width: 20px; height: 20px; animation: settle-turn 800ms linear infinite }',
		)
		const container = buildFixture(
			'<button class="settle-fill" type="button">Hover target</button><div class="settle-turn"></div>',
		)
		const button = resolveAccessible('Hover target')
		const turn = requireValue(container.querySelector<HTMLElement>('.settle-turn'))
		await hoverAccessible('Hover target')
		// Control: before the settle the pointer holds the hover, a transition runs, and the spinner turns.
		expect(button.matches(':hover')).toBe(true)
		expect(readAnimations(container).finite.length).toBeGreaterThan(0)
		expect(readAnimations(container).endless.map((animation) => animation.playState)).toStrictEqual(
			['running'],
		)
		const resume = await settleCapture({ budget: 2000 })
		try {
			expect(button.matches(':hover')).toBe(false)
			expect(readAnimations(document.documentElement).finite).toStrictEqual([])
			expect(readStyle(button, 'background-color')).toBe('rgb(255, 255, 255)')
			const [held] = turn.getAnimations()
			expect(held?.playState).toBe('paused')
			expect(held?.currentTime).toBe(0)
			expect(readStyle(turn, 'transform')).toBe('matrix(1, 0, 0, 1, 0, 0)')
		} finally {
			resume()
		}
		expect(turn.getAnimations()[0]?.playState).toBe('running')
	})

	it('leaves the pointer and its pressed paint where they are when asked, beside the default park that takes the pressed paint away', async () => {
		buildFixture('<button type="button">Held</button>')
		await holdAccessible('Held')
		const held = document.documentElement.getAttribute(POINTER_HOLD)
		expect(held).not.toBeNull()
		const kept = await settleCapture({ pointer: false })
		try {
			expect(resolveAccessible('Held').matches(':hover')).toBe(true)
			expect(resolveAccessible('Held').matches(':active')).toBe(true)
		} finally {
			kept()
		}
		// Control: the default settle parks the pointer, so the control loses its hover and its pressed
		// paint, and the press stays owed its release either way.
		const parked = await settleCapture()
		try {
			expect(resolveAccessible('Held').matches(':hover')).toBe(false)
			expect(resolveAccessible('Held').matches(':active')).toBe(false)
			expect(document.documentElement.getAttribute(POINTER_HOLD)).toBe(held)
		} finally {
			parked()
		}
	})

	it('refuses with the wait voice when a finite animation outlasts the budget, and holds nothing', async () => {
		buildStylesheet(
			'@keyframes settle-turn { to { transform: rotate(360deg) } }' +
				'.settle-turn { width: 20px; height: 20px; animation: settle-turn 800ms linear infinite }' +
				'.settle-slow { width: 10px; transition: width 5000ms linear }',
		)
		const container = buildFixture('<div class="settle-turn"></div><div class="settle-slow"></div>')
		const turn = requireValue(container.querySelector<HTMLElement>('.settle-turn'))
		const slow = requireValue(container.querySelector<HTMLElement>('.settle-slow'))
		expect(readStyle(slow, 'width')).toBe('10px')
		slow.style.width = '200px'
		await expect(settleCapture({ budget: 20 })).rejects.toThrow(
			'Animation "html" did not settle within 20ms',
		)
		expect(turn.getAnimations()[0]?.playState).toBe('running')
	})
})

describe('collectScrollRegions', () => {
	it('collects the rendered boxes that scroll and describes each offset beside the largest one it reaches', () => {
		const root = buildFixture(
			[
				'<div id="vertical" style="overflow: auto; height: 50px"><div style="height: 200px"></div></div>',
				'<div id="horizontal" style="overflow-x: auto; width: 100px; height: 40px"><div style="width: 300px; height: 10px"></div></div>',
				'<div id="fits" style="overflow: auto; height: 100px"><div style="height: 20px"></div></div>',
				'<div id="clipped" style="overflow: hidden; height: 50px"><div style="height: 200px"></div></div>',
				'<div id="absent" hidden style="overflow: auto; height: 50px"><div style="height: 200px"></div></div>',
			].join(''),
		)
		const regions = collectScrollRegions(root)
		expect(regions.map(({ id }) => id)).toStrictEqual(['vertical', 'horizontal'])
		// Each axis keeps only the boxes that scroll along it.
		expect(collectScrollRegions(root, 'inline').map(({ id }) => id)).toStrictEqual(['horizontal'])
		expect(collectScrollRegions(root, 'block').map(({ id }) => id)).toStrictEqual(['vertical'])
		const text = describeScrollRegions(regions)
		expect(text.split('\n')[0]).toMatch(/^window \d+x\d+ scroll /u)
		expect(text).toContain('scroll div#vertical: left 0/0 top 0/150')
		expect(text).toContain('scroll div#horizontal: left 0/200 top 0/0')
		for (const id of ['fits', 'clipped', 'absent']) expect(text).not.toContain(`#${id}`)
		// Control: a population with no scrolling box says so.
		expect(describeScrollRegions([]).split('\n')[1]).toBe('no scroll region overflows')
	})

	it('counts the root itself when it scrolls', () => {
		const root = buildFixture('<div style="height: 200px"></div>')
		root.style.overflowY = 'auto'
		root.style.height = '50px'
		expect(collectScrollRegions(root)).toStrictEqual([root])
		// Control: the same root with room for its content scrolls nowhere.
		root.style.height = '300px'
		expect(collectScrollRegions(root)).toStrictEqual([])
	})
})

describe('describeScrollRegions', () => {
	it('names a region by its tag, its id, and its accessible name cut to 40 characters, with its offsets after a scroll', () => {
		const name = 'A pane whose accessible name runs past forty characters'
		// The scrollbars are hidden so each box measures its declared size on a host that draws
		// classic scrollbars as well as on one that overlays them.
		const root = buildFixture(
			[
				`<section aria-label="${name}" style="overflow: auto; scrollbar-width: none; width: 100px; height: 50px">`,
				'<div style="width: 300px; height: 200px"></div>',
				'</section>',
				'<div style="overflow: auto; scrollbar-width: none; width: 100px; height: 50px"><div style="height: 120px"></div></div>',
				'<div style="height: 3000px"></div>',
			].join(''),
		)
		const [pane, bare] = collectScrollRegions(root)
		const scrolled = requireValue(pane)
		scrolled.scrollTo({ left: 20, top: 30, behavior: 'instant' })
		try {
			window.scrollTo({ left: 0, top: 25, behavior: 'instant' })
			const lines = describeScrollRegions([scrolled, requireValue(bare)]).split('\n')
			expect(lines.slice(1)).toStrictEqual([
				`scroll section "${name.slice(0, 40)}": left 20/200 top 30/150 box 100x50 content 300x200`,
				'scroll div: left 0/0 top 0/70 box 100x50 content 100x120',
			])
			expect(lines[0]).toMatch(
				new RegExp(
					`^window ${String(innerWidth)}x${String(innerHeight)} scroll 0,25 of \\d+,\\d+$`,
					'u',
				),
			)
		} finally {
			window.scrollTo({ left: 0, top: 0, behavior: 'instant' })
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

describe('buildDenial', () => {
	it('names the operation and the key in the voice a denied origin raises', () => {
		const keyed = buildDenial('getItem', 'theme')

		expect(keyed).toBeInstanceOf(DOMException)
		expect(keyed.name).toBe('SecurityError')
		expect(keyed.message).toBe('Access is denied for getItem "theme"')
		expect(buildDenial('length').message).toBe('Access is denied for length')
	})
})
