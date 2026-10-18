import type { Color } from '@src/browser'
import {
	blendColor,
	buildContrast,
	buildEscapes,
	CANVAS_COLOR,
	convertA98RGB,
	convertDisplayP3,
	convertLab,
	convertLinearSRGB,
	convertOKLab,
	convertProPhotoRGB,
	convertRec2020,
	convertSRGB,
	convertXYZD50,
	convertXYZD65,
	extractStyles,
	matchesColor,
	measureContrast,
	measureLuminance,
	mount,
	parseColor,
	parseCSSColor,
	readBackdrop,
	readColorContrast,
	readContrast,
	readLayers,
	readRing,
	readStyle,
	releasePointer,
	resolveRendered,
	traverseAccessible,
} from '@src/browser'
import { requireValue } from '@src/core'
import { afterEach, beforeAll, describe, expect, it } from 'vitest'
import { userEvent } from 'vitest/browser'
import { buildFixture, buildStylesheet, resetFixtures } from '../../../setupBrowser.js'

// A Tab pressed before the page holds real input focus moves nothing, and a file that opens on a
// traversal case gets no focus from an earlier one. A trusted click gives the page that focus, and
// the release returns the pointer to the origin it started from.
beforeAll(async () => {
	await userEvent.click(document.body)
	await releasePointer()
})

afterEach(resetFixtures)

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

describe('readColorContrast', () => {
	it('reads the contrast a resolved color reaches against the surface behind an element', () => {
		const container = buildFixture('<div style="background: #fff"><span>Mark</span></div>')
		const mark = requireValue(container.querySelector('span'))
		// Black on the white surface reads the ceiling, white on white the floor, and a clear color the
		// same floor, because the surface shows through it.
		expect(readColorContrast(mark, 'rgb(0, 0, 0)')).toBeCloseTo(21, 1)
		expect(readColorContrast(mark, 'rgb(255, 255, 255)')).toBeCloseTo(1, 5)
		expect(readColorContrast(mark, 'rgba(0, 0, 0, 0)')).toBeCloseTo(1, 5)
		// A half-opaque black blends with the surface first, so it reads between the two.
		const half = readColorContrast(mark, 'rgba(0, 0, 0, 0.5)')
		expect(half).toBeGreaterThan(3.5)
		expect(half).toBeLessThan(4.5)
		expect(() => readColorContrast(mark, 'not a color')).toThrow(
			'Color "not a color" is unreadable',
		)
	})

	it('resolves a keyword and a token reference through the cascade', () => {
		const container = buildFixture(
			'<div style="background: #fff; --journey-ink: #000"><span>Mark</span></div>',
		)
		const mark = requireValue(container.querySelector('span'))
		expect(readColorContrast(mark, 'black')).toBeCloseTo(21, 5)
		expect(readColorContrast(mark, 'var(--journey-ink)')).toBeCloseTo(21, 5)
	})

	it('refuses a stack ending translucent unless a floor is named, and composites onto that floor', () => {
		const container = buildFixture(
			'<div style="background: rgba(255, 255, 255, 0.5)"><span>Mark</span></div>',
		)
		const mark = requireValue(container.querySelector('span'))
		expect(() => readColorContrast(mark, 'rgb(0, 0, 0)')).toThrow(
			'Computed background color is unavailable',
		)
		// The half-white tint is white over the canvas and mid grey over black, so the floor decides
		// the answer rather than standing in for a refusal.
		expect(readColorContrast(mark, 'rgb(0, 0, 0)', { floor: CANVAS_COLOR })).toBeCloseTo(21, 5)
		expect(readColorContrast(mark, 'rgb(0, 0, 0)', { floor: [0, 0, 0, 1] })).toBeCloseTo(5.28, 1)
	})

	it('refuses a stack where nothing paints, and measures it on a named floor', () => {
		const container = buildFixture('<p>Ready</p>')
		const paragraph = requireValue(container.querySelector('p'))
		expect(() => readColorContrast(paragraph, 'rgb(0, 0, 0)')).toThrow(
			'Computed background color is unavailable',
		)
		expect(readColorContrast(paragraph, 'rgb(0, 0, 0)', { floor: CANVAS_COLOR })).toBeCloseTo(21, 5)
	})

	it('multiplies the color alpha by the opacity before compositing', () => {
		const container = buildFixture('<div style="background: #fff"><span>Mark</span></div>')
		const mark = requireValue(container.querySelector('span'))
		const declared = readColorContrast(mark, 'rgba(0, 0, 0, 0.5)')
		expect(readColorContrast(mark, 'rgb(0, 0, 0)', { opacity: 0.5 })).toBe(declared)
		expect(readColorContrast(mark, 'rgba(0, 0, 0, 0.5)', { opacity: 1 })).toBe(declared)
		expect(readColorContrast(mark, 'rgb(0, 0, 0)', { opacity: 0 })).toBe(1)
		for (const opacity of [Number.NaN, -0.1, 1.1, Number.POSITIVE_INFINITY]) {
			expect(() => readColorContrast(mark, 'rgb(0, 0, 0)', { opacity })).toThrow(
				'Contrast opacity must be between 0 and 1',
			)
		}
	})

	it('refuses an unreadable painted layer even with a floor named', () => {
		const container = buildFixture(
			'<div id="unreadable-surface" style="background-color: color(srgb calc(infinity) 0 0)"><span>Mark</span></div>',
		)
		const mark = requireValue(container.querySelector('span'))
		expect(() => readColorContrast(mark, 'rgb(0, 0, 0)', { floor: CANVAS_COLOR })).toThrow(
			/div#unreadable-surface/u,
		)
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

	it('reads no backdrop for a focused control whose cascade paints no chrome', async () => {
		buildFixture(
			'<div style="background-color: color(srgb calc(infinity) 0 0)">' +
				'<button type="button">Unpainted</button></div>',
		)
		const control = resolveRendered('Unpainted')
		control.focus()
		await userEvent.keyboard('{ArrowRight}')
		expect(control.matches(':focus-visible')).toBe(true)
		expect(readStyle(control, 'outline-style')).toBe('auto')
		// Nothing is measured, so the unreadable surface behind the control is never read; the same
		// surface behind painted chrome is refused in the modern paint readings.
		expect(readRing(control)).toBeUndefined()
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

	// The agreement between this package's conversion and the browser's sRGB rendering of a
	// modern colour is a property measured across browser versions, not a fixed number: Chromium
	// 141 and Chromium 151 disagree by about 0.0015 of contrast ratio at the fourth decimal of
	// their colour math. Two decimal places admit that measured cross-version gap with margin
	// while still refusing a converter that drifts by a hundredth.
	it('measures the dark oklch text against the browser sRGB control', () => {
		const container = buildFixture(
			'<p style="color: oklch(0.208 0.042 265.755); background: white">Ink</p>',
		)
		const foreground = requireValue(
			parseCSSColor('color-mix(in srgb, oklch(0.208 0.042 265.755) 100%, transparent)'),
		)
		expect(readContrast(requireValue(container.querySelector('p')))).toBeCloseTo(
			measureContrast(foreground, [255, 255, 255, 1]),
			2,
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
			2,
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
		expect(readRing(control)).toBeCloseTo(measureContrast(ring, [255, 255, 255, 1]), 2)
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
