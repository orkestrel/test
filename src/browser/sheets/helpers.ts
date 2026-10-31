import type { CensusFixture, CensusResult, EscapeFixture, SheetAdoption } from './types.js'
import { collectSelectorClasses } from '@src/core'
import { build, readStyle } from '../helpers.js'

/**
 * Adopts CSS text into the document with an idempotent release operation.
 *
 * @param text - The compiled sheet text.
 * @returns The adopted sheet and its release operation.
 *
 * @example
 * ```ts
 * const adopted = adoptSheet('.sample { display: block }')
 * adopted.release()
 * ```
 */
export function adoptSheet(text: string): SheetAdoption {
	const sheet = new CSSStyleSheet()
	sheet.replaceSync(text)
	document.adoptedStyleSheets = [...document.adoptedStyleSheets, sheet]
	return {
		sheet,
		release: () => {
			document.adoptedStyleSheets = document.adoptedStyleSheets.filter(
				(candidate) => candidate !== sheet,
			)
		},
	}
}

/**
 * Reads layer statements and blocks in declaration order, including repeated names.
 *
 * @param source - The parsed sheet, or a grouping or style rule inside it.
 * @param layer - The qualified name of the layer enclosing the source, when one does.
 * @returns Qualified layer names, with an empty name for an anonymous top-level layer.
 *
 * @remarks
 * Descends through grouping and style rules at any depth, qualifying each name by its enclosing layer.
 * An anonymous layer inside a named layer contributes a trailing dot to that qualified name.
 * Conditions are read whether or not they match the document.
 * An `@import ... layer()` rule contributes nothing, and neither do its imported sheet's rules.
 * A dotted declaration such as `@layer a.b` contributes `a.b` as declared, without an implicit `a`.
 * Distinct anonymous layers produce the same names; the result does not distinguish their identities.
 *
 * @example
 * ```ts
 * readLayerNames(new CSSStyleSheet()) // []
 * ```
 */
export function readLayerNames(
	source: CSSStyleSheet | CSSGroupingRule | CSSStyleRule,
	layer?: string,
): readonly string[] {
	return Array.from(source.cssRules).flatMap((rule) => [
		...(rule instanceof CSSLayerStatementRule
			? rule.nameList
			: rule instanceof CSSLayerBlockRule
				? [rule.name]
				: []
		).map((name) => (layer === undefined ? name : `${layer}.${name}`)),
		...(rule instanceof CSSGroupingRule || rule instanceof CSSStyleRule
			? readLayerNames(
					rule,
					rule instanceof CSSLayerBlockRule
						? layer === undefined
							? rule.name
							: `${layer}.${rule.name}`
						: layer,
				)
			: []),
	])
}

/**
 * Collects every class token the stylesheets loaded into this document actually define.
 *
 * @returns The set of class names reachable in the shipped cascade, in {@link readRules} order.
 *
 * @remarks
 * The set is what an authored-class conformance check measures against, so a class no loaded
 * stylesheet defines — an invented utility, a misspelled framework name — is absent from it.
 *
 * The tokens come from the {@link readRules} walk, which decides both the membership and the
 * insertion order this reader reports, and each answer is a deliberate difference from 0.0.8. A
 * class declared inside a grouping rule — a media query, a supports block, a layer, a nested style
 * rule — counts as defined, because a class the cascade defines under a condition is still one the
 * cascade defines; 0.0.8 read the top-level rules alone. Insertion order is breadth-first, so a
 * top-level class lands before a class declared inside an earlier grouping rule; 0.0.8 popped a
 * stack and inserted the deepest rule first. Iterate the set where the order is the subject, and
 * read `has` where membership is.
 *
 * Each rule's selector text is read by {@link collectSelectorClasses}, so the tokens are the class
 * names a selector means rather than what a pattern over its text finds: an escaped name decodes,
 * so `.sm\:flex` defines `sm:flex` rather than `sm`; text inside an attribute value, a string, or
 * a comment defines nothing, so `[title=".card"]` defines no `card`; and a name opening with an
 * underscore, a hyphen, or a non-ASCII letter counts, and a non-ASCII letter inside a name stays in
 * it, so `.café` defines `café` where 0.0.26 ended the class at the first code point outside ASCII
 * letters, digits, `_`, and `-` and defined `caf`. One rule's own tokens enter in code-unit order.
 *
 * `@keyframes` children are outside that walk, so an animation's own rules define no token here.
 * Reach the animation itself through {@link findKeyframes}.
 *
 * @example
 * ```ts
 * readCascade().has('card')
 * ```
 */
export function readCascade(): ReadonlySet<string> {
	return new Set(
		readRules().flatMap((rule) =>
			rule instanceof CSSStyleRule ? collectSelectorClasses(rule.selectorText) : [],
		),
	)
}

/**
 * Collects every class token the markup under one root carries.
 *
 * @param root - The subtree to sweep. A detached element and a `DocumentFragment` both work.
 * @returns The class tokens in document order of first sighting; an empty set for markup carrying no
 * class at all.
 *
 * @remarks
 * The root's own classes count when the root is an `Element`, so a `DocumentFragment` contributes
 * its descendants alone. Every element is read through `classList`, which is what makes an SVG
 * element count the same as an HTML one: `className` on an SVG element is an `SVGAnimatedString`
 * rather than a string, and a reader splitting that value finds nothing.
 *
 * This is the authored half of a class conformance check and {@link readCascade} is the defined
 * half, so the difference between them is the set of classes the markup uses and no loaded
 * stylesheet declares.
 *
 * @example
 * ```ts
 * [...readClasses(container)].filter((name) => !readCascade().has(name))
 * ```
 */
export function readClasses(root: ParentNode): ReadonlySet<string> {
	const authored = new Set<string>()
	if (root instanceof Element) for (const name of root.classList) authored.add(name)
	for (const element of root.querySelectorAll('*')) {
		for (const name of element.classList) authored.add(name)
	}
	return authored
}

/**
 * Takes the authored-class census of one subtree against the cascade this document loaded.
 *
 * @param root - The subtree to walk. A detached element and a `DocumentFragment` both work.
 * @returns The population walked, every class token the markup carries, and every one of them no
 * loaded stylesheet declares; both lists sorted.
 * @throws An `Error` when the walk reads no element at all.
 *
 * @remarks
 * This is {@link readClasses} differenced against {@link readCascade}, with the population reported
 * beside the difference. The population is what makes the reading falsifiable: an empty walk
 * reports no undeclared token, and so does a subtree whose every class the cascade declares, so a
 * check reading `undeclared` alone passes for a census that read nothing. The empty walk is refused
 * outright for the same reason.
 *
 * The root counts when it is an `Element`, so a `DocumentFragment` contributes its descendants
 * alone. Both lists are sorted rather than left in sighting order, because a census is compared
 * against a previous one or against an expected list, and document order is not a fact about the
 * classes.
 *
 * @example
 * ```ts
 * readCensus(container).undeclared // ['lead'] — no loaded stylesheet declares it
 * ```
 */
export function readCensus(root: ParentNode): CensusResult {
	const elements = (root instanceof Element ? 1 : 0) + root.querySelectorAll('*').length
	if (elements === 0) throw new Error('Class census walked no element')
	const declared = readCascade()
	const tokens = [...readClasses(root)].sort()
	return Object.freeze({
		elements,
		tokens: Object.freeze(tokens),
		undeclared: Object.freeze(tokens.filter((token) => !declared.has(token))),
	})
}

/**
 * Collects every rule the stylesheets loaded into this document hold, nested grouping rules
 * included.
 *
 * @returns Every rule reachable in the shipped cascade: each sheet's own rules in sheet order, then
 * the rules nested inside them, level by level.
 *
 * @remarks
 * The walk is iterative and reads the list it is still appending to, which is what expands a media
 * query, a supports block, a layer, and a nested style rule without recursion. Expanding by level
 * rather than by depth is why a top-level rule is always met before a rule nested inside an earlier
 * one; {@link findStyleRule} returns the first match in exactly this order.
 *
 * The descent reaches a `CSSGroupingRule` and nothing else, and a `@keyframes` rule is not one. The
 * `@keyframes` rule itself is collected wherever it sits, and the keyframe rules inside it are not;
 * {@link findKeyframes} is the door to those.
 *
 * A stylesheet the document cannot read — a cross-origin sheet with no CORS grant — throws from its
 * own `cssRules` getter, and that sheet is skipped rather than ending the walk. What a page loaded
 * from another origin declares is unreadable to every caller here, so the alternative is a helper
 * that works until a test page adds a font or an analytics stylesheet.
 *
 * @example
 * ```ts
 * readRules().filter((rule) => rule instanceof CSSKeyframesRule)
 * ```
 */
export function readRules(): readonly CSSRule[] {
	const rules: CSSRule[] = []
	for (const sheet of document.styleSheets) {
		try {
			rules.push(...sheet.cssRules)
		} catch {
			continue
		}
	}
	for (const rule of rules) {
		if (rule instanceof CSSGroupingRule) rules.push(...rule.cssRules)
	}
	return rules
}

/**
 * Finds the first style rule in the cascade whose selector carries a fragment.
 *
 * @param selector - The selector fragment to look for, matched as a substring of the whole selector
 * text.
 * @returns The first matching rule in {@link readRules} order, or `undefined` when no rule carries
 * the fragment.
 *
 * @remarks
 * This proves a declaration exists in the cascade at all, which is a different question from what an
 * element resolves to: {@link readStyle} reads the winner, and a rule this finds may be overridden by
 * another. Assert on this where the subject is the stylesheet, and on `readStyle` where the subject is
 * the rendered result.
 *
 * The match is a substring, so `findStyleRule('.card')` finds `.card`, `.card:hover`, and
 * `.panel > .card` alike. Pass more of the selector to narrow it.
 *
 * @example
 * ```ts
 * findStyleRule('.card')?.style.getPropertyValue('padding')
 * ```
 */
export function findStyleRule(selector: string): CSSStyleRule | undefined {
	for (const rule of readRules()) {
		if (rule instanceof CSSStyleRule && rule.selectorText.includes(selector)) return rule
	}
	return undefined
}

/**
 * Finds the animation the cascade declares under one name.
 *
 * @param name - The exact `@keyframes` name.
 * @returns The first matching rule in {@link readRules} order, or `undefined` when the cascade
 * declares no animation under that name.
 *
 * @remarks
 * The name is matched exactly, which is where this parts from {@link findStyleRule}: a selector is
 * compound and a fragment of one is a useful question, and an animation name is one atom that either
 * is or is not the one an `animation` declaration references.
 *
 * @example
 * ```ts
 * findKeyframes('fade')?.cssRules.length
 * ```
 */
export function findKeyframes(name: string): CSSKeyframesRule | undefined {
	for (const rule of readRules()) {
		if (rule instanceof CSSKeyframesRule && rule.name === name) return rule
	}
	return undefined
}

/**
 * Collects every element carrying a component class rendered outside the container it belongs to.
 *
 * @param root - The subtree to sweep.
 * @param child - The component class whose anatomy requires a container, such as `list-group-item`.
 * @param parent - The container class that child class must render inside, such as `list-group`.
 * @returns The markup of every element carrying `child` with no `parent` above it, in document
 * order; an empty list when every one of them is nested correctly.
 *
 * @remarks
 * A component keeps its padding, borders, and radii on the container, so a child class rendered
 * outside one is an unstyled box wearing a component's name, and the interface has to hand-roll the
 * chrome back. The search for the container starts at the element's parent, so an element can never
 * answer the invariant by carrying both classes itself.
 *
 * The class names are arguments, so the check belongs to no framework: name the pair your own
 * cascade defines.
 *
 * @example
 * ```ts
 * extractOrphans(container, 'list-group-item', 'list-group') // []
 * ```
 */
export function extractOrphans(root: ParentNode, child: string, parent: string): readonly string[] {
	return [...root.querySelectorAll(`.${child}`)]
		.filter((node) => (node.parentElement?.closest(`.${parent}`) ?? null) === null)
		.map((node) => node.outerHTML)
}

/**
 * Collects the markup of every element carrying a non-empty `style` attribute and of every `<style>`
 * element, in document order, `root` included in both populations when it is an `Element`.
 *
 * @param root - The subtree to sweep. A detached element and a `DocumentFragment` both work.
 * @returns The `outerHTML` of each such element, in document order; an empty list when the markup
 * declares no style of its own.
 *
 * @remarks
 * These are the declarations the stylesheet never sees: an inline `style` attribute, wherever it
 * sits, and a `<style>` element, whatever it holds. Nothing else counts. A class and a `data-*`
 * attribute name something the cascade resolves, so neither is reported however unusual it looks;
 * an inline `style` on a `<path>` inside an SVG is reported, because a namespace changes nothing
 * about what an inline declaration is.
 *
 * A `style` attribute holding nothing but whitespace declares nothing, so it is not reported. A
 * `DocumentFragment` root contributes its descendants alone, because it is not an `Element`; a
 * `<style>` root and a root carrying an inline attribute are each reported, and an element that is a
 * `<style>` element and carries an inline attribute too is reported once.
 *
 * @example
 * ```ts
 * extractStyles(container) // []
 * ```
 */
export function extractStyles(root: ParentNode): readonly string[] {
	const elements: Element[] = root instanceof Element ? [root] : []
	elements.push(...root.querySelectorAll('*'))
	const styled: string[] = []
	for (const element of elements) {
		const inline = element.getAttribute('style') ?? ''
		if (inline.trim() !== '' || element.localName === 'style') styled.push(element.outerHTML)
	}
	return styled
}

/**
 * Reads one custom property from an element's resolved style.
 *
 * @param element - The element whose resolved style to inspect.
 * @param name - The custom property name, with or without its leading dashes.
 * @returns The resolved value, trimmed; an empty string when the element inherits no such property.
 *
 * @remarks
 * The dashes are optional because a token is spoken about both ways — `--surface` in a stylesheet
 * and `surface` in prose — and a reader that accepted only one spelling would turn that into a silent
 * empty string. An absent token reads as `''`, which is what the CSSOM returns and is
 * indistinguishable from a token declared empty; assert on the value you expect rather than on
 * presence.
 *
 * Resolution is inheritance, so a token declared on `:root` reads from any mounted descendant and
 * from an unmounted element reads as `''`. Use {@link readRootToken} where the declaration is the
 * document's.
 *
 * @example
 * ```ts
 * readToken(panel, 'surface') // '#ffffff'
 * readToken(panel, '--surface') // '#ffffff'
 * ```
 */
export function readToken(element: Element, name: string): string {
	return readStyle(element, name.startsWith('--') ? name : `--${name}`)
}

/**
 * Reads one custom property from the document element.
 *
 * @param name - The custom property name, with or without its leading dashes.
 * @returns The resolved value, trimmed; an empty string when the document declares no such property.
 *
 * @remarks
 * This is {@link readToken} against `document.documentElement`, which is where a theme declares its
 * tokens and where a `[data-theme]` switch retunes them. It exists as its own name because that
 * element is the one a token question is nearly always about, and naming it at every call site
 * buries the question.
 *
 * @example
 * ```ts
 * readRootToken('surface')
 * ```
 */
export function readRootToken(name: string): string {
	return readToken(document.documentElement, name)
}

/**
 * Builds detached markup carrying one style escape of each kind, plus the sheet a project allows.
 *
 * @param permitted - The `id` the caller's reading exempts, placed on the third element.
 * @returns The detached root, the inline escape, the embedded escape, and the exempt sheet.
 *
 * @remarks
 * {@link extractStyles} has two branches — an inline `style` attribute and a `<style>` element —
 * and a reading fed only the first never exercises the second. The exempt sheet is the other half
 * of the control: a project that allows one standalone stylesheet writes an exemption for its id,
 * and a reading that passes by refusing every `<style>` element clears the two escapes and fails
 * that exemption.
 *
 * The declaration `inline`, `embedded`, and `permitted` carry is this package's, so assert on which
 * elements are reported rather than on what they declare.
 *
 * The nodes are detached and stay that way: `extractStyles` takes any `ParentNode`, so the reading
 * runs without mounting, and an embedded sheet that reached the document would join the cascade
 * every other reading measures against.
 *
 * @example
 * ```ts
 * const control = buildEscapes('project-stylesheet')
 * extractStyles(control.root).length // 3 — the inline escape, the embedded sheet, and the exempt one
 * ```
 */
export function buildEscapes(permitted: string): EscapeFixture {
	const declaration = 'color: rgb(1, 2, 3)'
	const root = build('div')
	const inline = build('p', {
		text: 'Inline escape control',
		attributes: { style: declaration },
	})
	const embedded = build('style')
	embedded.textContent = `.escape-embedded { ${declaration} }`
	const exempt = build('style', { attributes: { id: permitted } })
	exempt.textContent = `#escape-permitted { ${declaration} }`
	root.append(inline, embedded, exempt)
	return Object.freeze({ root, inline, embedded, permitted: exempt })
}

/**
 * Builds detached markup carrying one undeclared class token on HTML and another on SVG.
 *
 * @returns The detached root, the token the HTML element carries, and the one the SVG carries.
 *
 * @remarks
 * The SVG element is the trap a census has to survive: `className` on an SVG element is an
 * `SVGAnimatedString` rather than a string, so a reader splitting that value finds nothing and
 * reports one undeclared token where two are carried. {@link readCensus} reads every element
 * through `classList`, and this is the control that proves it.
 *
 * The two tokens are returned rather than written into a caller's expectation, so a cascade that
 * later declares one of these names moves the fixture and the assertion together. Each token also
 * carries a suffix drawn per call from `crypto.getRandomValues`, so a consumer cascade cannot
 * declare either of them in advance and two controls in one document never share a token.
 * `getRandomValues` rather than `randomUUID`, because that one answers outside a secure context
 * too, and a browser project served from a remote host is not one.
 *
 * @example
 * ```ts
 * const control = buildCensus()
 * readCensus(control.root).undeclared // [control.mark, control.token], sorted
 * ```
 */
export function buildCensus(): CensusFixture {
	const suffix = crypto.getRandomValues(new Uint32Array(1)).join('')
	const token = `census-authored-token-${suffix}`
	const mark = `census-authored-mark-${suffix}`
	const root = build('div')
	root.append(build('p', { classes: token, text: 'Authored class control' }))
	const glyph = document.createElementNS('http://www.w3.org/2000/svg', 'svg')
	glyph.setAttribute('class', mark)
	root.append(glyph)
	return Object.freeze({ root, token, mark })
}
