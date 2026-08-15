import type { CaptureVariant } from '@src/browser'
import {
	ACCESSIBLE_ROLES,
	clickAccessible,
	clickAccessibleWithin,
	clickDisclosure,
	contrast,
	expandCaptures,
	fillAccessible,
	isOutsideViewport,
	pressKeys,
	readCascade,
	readFocus,
	readPage,
	readPerception,
	readRows,
	readValue,
	render,
	resolveAccessible,
	resolveRendered,
	style,
	traverseAccessible,
	typeAccessible,
	waitForFrame,
} from '@src/browser'
import { createRecorder, requireValue } from '@src/core'
import { afterEach, describe, expect, it } from 'vitest'
import { buildFixture, buildStylesheet, resetFixtures } from '../../setupBrowser.js'

const VARIANTS: readonly CaptureVariant[] = [
	{ name: 'light-1440', width: 1440, height: 1000 },
	{ name: 'dark-390', width: 390, height: 844 },
]

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
		expect(() => resolveRendered('Drafts')).toThrowError(
			'Interactive target "Drafts" is ambiguous across 2 elements',
		)
	})

	it('refuses a name no element carries', () => {
		buildFixture('<button type="button">Save changes</button>')
		expect(() => resolveRendered('Nowhere')).toThrowError(
			'No interactive element has the accessible name "Nowhere"',
		)
	})

	it('refuses a name carried only by a role outside the searched set', () => {
		buildFixture('<h2 tabindex="0">Report</h2>')
		expect(ACCESSIBLE_ROLES).not.toContain('heading')
		expect(() => resolveRendered('Report')).toThrowError(
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
			expect(() => resolveRendered(name)).toThrowError(
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
		expect(() => resolveAccessible('Offscreen')).toThrowError(
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
		await expect(clickAccessibleWithin('Ledger', 'button', 'Remove')).rejects.toThrowError(
			'Interactive target "Remove" is not reachable inside "Ledger"',
		)
	})

	it('refuses a name several controls in the region answer for', async () => {
		buildFixture(
			'<section aria-label="Ledger">' +
				'<button type="button">Add row</button><button type="button">Add column</button>' +
				'</section>',
		)
		await expect(clickAccessibleWithin('Ledger', 'button', 'Add')).rejects.toThrowError(
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
		await expect(clickDisclosure('Folded')).rejects.toThrowError(
			'Native disclosure "Folded" is not visible and focus-reachable',
		)
	})

	it('refuses a summary text several disclosures carry', async () => {
		buildFixture(
			'<details><summary>Advanced</summary></details><details><summary>Advanced</summary></details>',
		)
		await expect(clickDisclosure('Advanced')).rejects.toThrowError(
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
		await fillAccessible('Notes', '{"reasoning":"logical"}')
		expect(readValue('textbox', 'Notes')).toBe('{"reasoning":"logical"}')
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
		await expect(traverseAccessible('Ghost')).rejects.toThrowError(
			'Interactive target "Ghost" is not reachable through forward Tab traversal',
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
		expect(() => readPerception('Gone')).toThrowError('Named region "Gone" is not visible')
	})

	it('refuses a name several visible regions carry', () => {
		buildFixture(
			'<section aria-label="Twin">Left</section><section aria-label="Twin">Right</section>',
		)
		expect(() => readPerception('Twin')).toThrowError(
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
})

describe('readValue', () => {
	it('reads the value a resolved control renders', () => {
		buildFixture('<label for="runs">Runs</label><input id="runs" type="text" value="7">')
		expect(readValue('textbox', 'Runs')).toBe('7')
	})

	it('refuses a resolved control that carries no value', () => {
		buildFixture('<button type="button">Save</button>')
		expect(() => readValue('button', 'Save')).toThrowError(
			'Interactive target "Save" does not carry a value',
		)
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

describe('render', () => {
	it('attaches parsed fixture markup to the document', () => {
		const container = render('<button type="button">Save</button>')
		try {
			expect(container.parentElement).toBe(document.body)
			expect(requireValue(container.querySelector('button')).textContent).toBe('Save')
		} finally {
			container.remove()
		}
	})
})

describe('contrast', () => {
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
		expect(() => contrast(requireValue(container.querySelector('p')))).toThrowError(
			'Computed background color is unavailable',
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

describe('style', () => {
	it('reads the browser resolved value of one property', () => {
		const container = buildFixture('<p style="padding-left: 12px">Ready</p>')
		expect(style(requireValue(container.querySelector('p')), 'padding-left')).toBe('12px')
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
