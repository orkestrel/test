import type { SheetAdoption } from '@src/browser'
import * as browser from '@src/browser'
import {
	build,
	buildCensus,
	buildEscapes,
	extractOrphans,
	extractStyles,
	findKeyframes,
	findRule,
	matchesColor,
	parseCSSColor,
	readCascade,
	readCensus,
	readClasses,
	readPixels,
	readRootToken,
	readRules,
	readStyle,
	readToken,
} from '@src/browser'
import { requireValue } from '@src/core'
import { afterEach, describe, expect, it } from 'vitest'
import { buildFixture, buildStylesheet, resetFixtures } from '../../../setupBrowser.js'

afterEach(resetFixtures)

describe('sheet adoption and layer names', () => {
	it('adopts and releases only its own sheet, including repeated release', () => {
		const previous = [...document.adoptedStyleSheets]
		const first: SheetAdoption = browser.adoptSheet('.sample { color: red }')
		try {
			const second = browser.adoptSheet('.other { display: block }')
			try {
				expect(document.adoptedStyleSheets).toEqual([...previous, first.sheet, second.sheet])
				expect(first.sheet.cssRules.length).toBe(1)
				first.release()
				first.release()
				expect(document.adoptedStyleSheets).toEqual([...previous, second.sheet])
			} finally {
				second.release()
			}
		} finally {
			first.release()
		}
		expect(document.adoptedStyleSheets).toEqual(previous)
	})

	it('reads statements, blocks, nested conditions, and anonymous layers in order', () => {
		const sheet = new CSSStyleSheet()
		sheet.replaceSync(
			'@layer first, second; @layer first { @media all { @layer nested {} } } @layer {}',
		)
		expect(browser.readLayerNames(sheet)).toEqual(['first', 'second', 'first', 'first.nested', ''])
		const layer = requireValue(
			Array.from(sheet.cssRules).find((rule) => rule instanceof CSSLayerBlockRule),
		)
		expect(browser.readLayerNames(layer, 'first')).toEqual(['first.nested'])
	})

	it('returns no layer names for an empty sheet or an unlayered rule', () => {
		const sheet = new CSSStyleSheet()
		expect(browser.readLayerNames(sheet)).toEqual([])
		sheet.replaceSync('.sample { color: red }')
		expect(browser.readLayerNames(sheet)).toEqual([])
	})

	it('reads layers two style rules deep inside a named layer', () => {
		const sheet = new CSSStyleSheet()
		sheet.replaceSync(
			'@layer outer { .parent { & .child { @layer nested { @layer leaf {} } @layer {} } } }',
		)
		expect(browser.readLayerNames(sheet)).toEqual([
			'outer',
			'outer.nested',
			'outer.nested.leaf',
			'outer.',
		])
	})

	it('compares complete descent with the Veneer scan through an outer style rule', () => {
		const sheet = new CSSStyleSheet()
		sheet.replaceSync(
			'@layer repeated; @media all { @layer conditional {} } .outer { @layer direct {} & .inner { @layer nested {} } } @layer {} @layer repeated {}',
		)
		const outer = requireValue(
			Array.from(sheet.cssRules).find((rule) => rule instanceof CSSStyleRule),
		)
		expect(outer.cssRules.length).toBe(2)
		const direct = requireValue(outer.cssRules[0])
		expect(direct).toBeInstanceOf(CSSLayerBlockRule)
		const inner = requireValue(outer.cssRules[1])
		expect(inner).toBeInstanceOf(CSSStyleRule)
		const names = browser.readLayerNames(sheet)
		expect(names).toEqual(['repeated', 'conditional', 'direct', 'nested', '', 'repeated'])
		// Veneer's scan skips a style rule nested inside another style rule.
		const pending: Array<{
			readonly rule: CSSRule
			readonly layer?: string | undefined
			readonly enclosing?: string | undefined
		}> = Array.from(sheet.cssRules, (rule) => ({ rule })).reverse()
		const scanned: Array<{ readonly rule: CSSRule; readonly layer?: string | undefined }> = []
		while (pending.length > 0) {
			const entry = requireValue(pending.pop())
			const { rule } = entry
			if (rule instanceof CSSStyleRule && entry.enclosing !== undefined) continue
			scanned.push(entry)
			if (!(rule instanceof CSSGroupingRule || rule instanceof CSSStyleRule)) continue
			const layer =
				rule instanceof CSSLayerBlockRule
					? entry.layer === undefined
						? rule.name
						: `${entry.layer}.${rule.name}`
					: entry.layer
			const enclosing = rule instanceof CSSStyleRule ? rule.selectorText : entry.enclosing
			for (const child of Array.from(rule.cssRules).reverse()) {
				pending.push({ rule: child, layer, enclosing })
			}
		}
		expect(
			scanned.flatMap(({ rule, layer }) =>
				(rule instanceof CSSLayerStatementRule
					? rule.nameList
					: rule instanceof CSSLayerBlockRule
						? [rule.name]
						: []
				).map((name) => (layer === undefined ? name : `${layer}.${name}`)),
			),
		).toEqual(['repeated', 'conditional', 'direct', '', 'repeated'])
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

	it('decodes an escaped class and reads no class inside an attribute value', () => {
		buildStylesheet(
			String.raw`.journey-escaped\:state { color: rgb(1, 2, 3) }` +
				'[title=".journey-quoted"] { color: rgb(4, 5, 6) }' +
				'.-journey-offset { color: rgb(7, 8, 9) }',
		)
		const known = readCascade()
		expect(known.has('journey-escaped:state')).toBe(true)
		expect(known.has('-journey-offset')).toBe(true)
		// A pattern stopping at the escape reads the half before it, and one blind to quoting reads
		// the attribute value's text as a class.
		expect(known.has('journey-escaped')).toBe(false)
		expect(known.has('journey-quoted')).toBe(false)
	})

	it('reads a non-ASCII letter inside a name as part of it', () => {
		buildStylesheet('.café { color: rgb(1, 2, 3) }')
		const known = readCascade()
		expect(known.has('café')).toBe(true)
		// A pattern ending its class at the first code point outside ASCII letters, digits, `_`, and
		// `-` defines the half before the letter.
		expect(known.has('caf')).toBe(false)
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
