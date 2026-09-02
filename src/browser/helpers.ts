import type { CaptureVariant, Color, ElementOptions, FrameOptions, FrameReading } from './types.js'
import { commands, page, userEvent } from 'vitest/browser'
import {
	ACCESSIBLE_ROLES,
	CANVAS_COLOR,
	CAPTURE_PANE,
	CONTENT_ROLES,
	FIELD_ROLES,
	FOCUSABLE_SELECTOR,
	HEADER_ROLES,
	IMPLICIT_ROLES,
} from './constants.js'

/**
 * Determines whether a rectangle lies wholly outside the browser viewport.
 *
 * @param rectangle - The measured client rectangle to inspect.
 * @returns `true` when no part of the rectangle intersects the viewport.
 *
 * @example
 * ```ts
 * isOutsideViewport(element.getBoundingClientRect())
 * ```
 */
export function isOutsideViewport(rectangle: DOMRectReadOnly): boolean {
	return (
		rectangle.bottom <= 0 ||
		rectangle.right <= 0 ||
		rectangle.top >= window.innerHeight ||
		rectangle.left >= window.innerWidth
	)
}

/**
 * Determines whether a person can click one element where it currently sits.
 *
 * @param element - The element to judge.
 * @returns `true` when the element is connected, visible, laid out with a non-zero box, in the
 * sequential focus order, neither disabled nor marked `aria-disabled="true"`, and outside every
 * `[inert]` subtree; `false` otherwise.
 *
 * @remarks
 * This is the one reachability filter the layer applies. `resolveRendered`, `clickAccessibleWithin`,
 * and `clickDisclosure` each narrow their own candidates and then keep the ones this accepts, so a
 * journey meets one rule rather than three near-copies of it.
 *
 * It measures geometry, which is what separates it from {@link isRendered}. A control clipped to a
 * zero-size rectangle is announced and is not clickable, so `isRendered` accepts it and this
 * refuses it. Nothing here asks about the viewport: `resolveAccessible` scrolls a wholly
 * off-viewport target into view and measures that separately with {@link isOutsideViewport}.
 *
 * @example
 * ```ts
 * isReachable(requireValue(container.querySelector('button')))
 * ```
 */
export function isReachable(element: Element): boolean {
	if (!(element instanceof HTMLElement) && !(element instanceof SVGElement)) return false
	const rectangle = element.getBoundingClientRect()
	return (
		element.isConnected &&
		element.checkVisibility({ checkOpacity: true, checkVisibilityCSS: true }) &&
		rectangle.width > 0 &&
		rectangle.height > 0 &&
		element.tabIndex >= 0 &&
		!element.matches(':disabled, [aria-disabled="true"]') &&
		element.closest('[inert]') === null
	)
}

/**
 * Determines whether the accessibility tree presents one element at all.
 *
 * @param element - The element to judge.
 * @returns `false` when the element is hidden from assistive technology, from sight, or from both;
 * `true` otherwise.
 *
 * @remarks
 * A control clipped to a zero-size rectangle is still announced, which is the whole point of that
 * idiom, so nothing here reads geometry: only the removals a browser honours — `aria-hidden`
 * anywhere above it, the `hidden` attribute, a hidden input, and a `display` or `visibility` that
 * takes it off the page. {@link isReachable} is the clickable half of the pair and does read
 * geometry.
 *
 * The last two are asked about the element's ancestors as well as itself, which reading a computed
 * `display` cannot do: the computed value of a child of a `display: none` container is the child's
 * own, so a control inside a closed drawer reports itself as laid out. `checkVisibility` answers
 * for the box tree, and `visibility` inherits, so between them an ancestor cannot hide a control
 * from a reader and leave it standing in a description.
 *
 * @example
 * ```ts
 * isRendered(requireValue(container.querySelector('[aria-hidden="true"] button'))) // false
 * ```
 */
export function isRendered(element: Element): boolean {
	if (element.closest('[aria-hidden="true"]') !== null) return false
	if (element instanceof HTMLElement && element.hidden) return false
	if (element instanceof HTMLInputElement && element.type === 'hidden') return false
	if (!element.checkVisibility()) return false
	return getComputedStyle(element).visibility !== 'hidden'
}

/**
 * Computes the pattern that matches one accessible name a decorative glyph may sit beside.
 *
 * @param name - The exact accessible name a person reads, whitespace runs collapsed on the way in.
 * @returns A pattern anchored at both ends, admitting a run of characters that are neither letters
 * nor digits before the name and after it.
 *
 * @remarks
 * A role query that includes hidden elements computes a name from the `aria-hidden` subtrees too,
 * so an icon font's `::before` glyph joins the name a person never hears and an exact string never
 * matches again. This pattern is what {@link resolveRendered} asks the hidden pass with, and its
 * tolerance is bounded to what a glyph can be: a leading or trailing run carrying no letter and no
 * digit. A hidden icon whose own content is a word still defeats it, and a name differing from the
 * requested one by punctuation alone still satisfies it.
 *
 * That bound is affordable because the hidden pass chooses between two refusal voices and returns
 * nothing. The visible pass decides which element a resolver returns, and it matches the exact
 * string against the name the accessibility tree actually publishes.
 *
 * Pass this to a role query with `exact: true`. That flag is the engine's case-sensitivity switch
 * as well as its exactness one, so a query carrying `exact: false` uppercases the computed name
 * before testing a pattern against it and a lowercase letter in the requested name never matches.
 *
 * @example
 * ```ts
 * computeNamePattern('Add building').test('\uF4FE Add building') // true
 * ```
 */
export function computeNamePattern(name: string): RegExp {
	const wanted = name
		.replaceAll(/\s+/g, ' ')
		.trim()
		.replaceAll(/[$()*+.?[\\\]^{|}]/g, '\\$&')
	return new RegExp(`^[^\\p{L}\\p{N}]*${wanted}[^\\p{L}\\p{N}]*$`, 'u')
}

/**
 * Resolves one rendered, focus-reachable interactive element without requiring it to intersect the
 * viewport yet.
 *
 * @param first - The accessible name, or the exact ARIA role when `second` is present.
 * @param second - The accessible name when `first` supplies the role.
 * @returns The one rendered element carrying that name and optional role.
 * @throws When no matching element exists, every match is hidden or unreachable, or several
 * rendered matches make the name ambiguous.
 *
 * @remarks
 * This is the resolver the acting verbs use, so a click does not fail on a target the act itself
 * scrolls into view. Use {@link resolveAccessible} wherever the target must already be on screen.
 *
 * It runs two passes, and only the first one can return an element. The visible pass asks the role
 * engine for the exact name over the elements the accessibility tree presents, which is the name a
 * screen reader announces: an `aria-hidden` icon beside the text contributes nothing to it. The
 * hidden pass runs only when the visible pass found nothing at all, and it decides which refusal
 * the caller hears — a name the page carries nowhere, or a target that is there and out of reach.
 * That pass must include hidden elements to see a folded control, which is what puts a glyph back
 * into the computed name, so it asks with {@link computeNamePattern} rather than the exact string.
 *
 * @example
 * ```ts
 * resolveRendered('tab', 'Drafts')
 * ```
 */
export function resolveRendered(first: string, second?: string): HTMLElement {
	const name = second ?? first
	const roles = second === undefined ? ACCESSIBLE_ROLES : [first]
	const matches: HTMLElement[] = []
	for (const role of roles) {
		for (const element of page.getByRole(role, { name, exact: true }).elements()) {
			if (element instanceof HTMLElement && !matches.includes(element)) matches.push(element)
		}
	}
	if (matches.length === 0) {
		const pattern = computeNamePattern(name)
		const hidden = roles.some(
			(role) =>
				page.getByRole(role, { name: pattern, exact: true, includeHidden: true }).elements()
					.length > 0,
		)
		if (!hidden) throw new Error(`No interactive element has the accessible name "${name}"`)
		throw new Error(`Interactive target "${name}" is not visible and focus-reachable`)
	}
	const reachable = matches.filter((element) => isReachable(element))
	if (reachable.length === 0) {
		throw new Error(`Interactive target "${name}" is not visible and focus-reachable`)
	}
	if (reachable.length > 1) {
		throw new Error(`Interactive target "${name}" is ambiguous across ${reachable.length} elements`)
	}
	const [target] = reachable
	if (target === undefined) throw new Error(`Interactive target "${name}" could not be resolved`)
	return target
}

/**
 * Resolves one visible, focus-reachable interactive element by its exact accessible name. A
 * wholly-off-viewport target is scrolled into view before reachability is measured.
 *
 * @param name - The accessible name rendered for the target.
 * @returns The one reachable element carrying that name.
 * @throws When no matching element exists; every match is disconnected, hidden, zero-sized, still
 * outside the viewport after being scrolled into view, removed from sequential focus, disabled, or
 * inside an inert subtree; or several reachable matches make the name ambiguous.
 *
 * @example
 * ```ts
 * resolveAccessible('Save changes')
 * ```
 */
export function resolveAccessible(name: string): HTMLElement
/**
 * Resolves one visible, focus-reachable interactive element by its exact ARIA role and accessible
 * name, disambiguating a bare name that answers for more than one rendered element. A
 * wholly-off-viewport target is scrolled into view before reachability is measured.
 *
 * @param role - The element's exact ARIA role.
 * @param name - The accessible name rendered for the target.
 * @returns The one reachable element carrying that role and name.
 * @throws When no matching element exists; every match is disconnected, hidden, zero-sized, still
 * outside the viewport after being scrolled into view, removed from sequential focus, disabled, or
 * inside an inert subtree; or several reachable matches make the role/name pair ambiguous.
 *
 * @example
 * ```ts
 * resolveAccessible('tab', 'Drafts')
 * ```
 */
export function resolveAccessible(role: string, name: string): HTMLElement
export function resolveAccessible(first: string, second?: string): HTMLElement {
	const target = resolveRendered(first, second)
	let rectangle = target.getBoundingClientRect()
	if (isOutsideViewport(rectangle)) {
		target.scrollIntoView({ block: 'nearest', behavior: 'instant' })
		rectangle = target.getBoundingClientRect()
	}
	if (isOutsideViewport(rectangle)) {
		throw new Error(`Interactive target "${second ?? first}" is unreachable after scrolling`)
	}
	return target
}

/**
 * Clicks one visible, focus-reachable control by its accessible name through the browser provider.
 *
 * @param name - The target's exact accessible name.
 * @returns A promise resolving after trusted activation completes.
 *
 * @example
 * ```ts
 * await clickAccessible('Apply')
 * ```
 */
export async function clickAccessible(name: string): Promise<void>
/**
 * Clicks one visible, focus-reachable control by its exact ARIA role and accessible name,
 * disambiguating a bare name that answers for more than one rendered element.
 *
 * @param role - The control's exact ARIA role.
 * @param name - The target's exact accessible name.
 * @returns A promise resolving after trusted activation completes.
 *
 * @example
 * ```ts
 * await clickAccessible('tab', 'Drafts')
 * ```
 */
export async function clickAccessible(role: string, name: string): Promise<void>
export async function clickAccessible(first: string, second?: string): Promise<void> {
	const target = resolveRendered(first, second)
	await userEvent.click(target)
}

/**
 * Clicks one human-reachable control by role and accessible-name text inside a named region.
 *
 * @param region - The containing region's exact accessible name.
 * @param role - The control's exact ARIA role.
 * @param name - The rendered accessible-name text that identifies the control in that region.
 * @returns A promise resolving after trusted activation completes.
 * @throws When the named control is absent, unreachable, or ambiguous inside the region.
 *
 * @remarks
 * Use this form when repeated short verbs such as `Add`, or a line whose status completes its
 * accessible name, need the same region context a person uses to disambiguate them.
 *
 * @example
 * ```ts
 * await clickAccessibleWithin('Ledger', 'button', 'Monthly income')
 * ```
 */
export async function clickAccessibleWithin(
	region: string,
	role: string,
	name: string,
): Promise<void> {
	const matches = page
		.getByRole('region', { name: region, exact: true })
		.getByRole(role, { name, exact: false, includeHidden: true })
		.elements()
	const reachable = matches.filter(
		(element) => element instanceof HTMLElement && isReachable(element),
	)
	if (reachable.length === 0) {
		throw new Error(`Interactive target "${name}" is not reachable inside "${region}"`)
	}
	if (reachable.length > 1) {
		throw new Error(
			`Interactive target "${name}" is ambiguous across ${reachable.length} elements inside "${region}"`,
		)
	}
	const [target] = reachable
	if (!(target instanceof HTMLElement)) {
		throw new Error(`Interactive target "${name}" could not be resolved inside "${region}"`)
	}
	await userEvent.click(target)
}

/**
 * Opens or closes one native details disclosure by its rendered summary.
 *
 * @param name - The summary text a person reads.
 * @returns A promise resolving after trusted activation completes.
 * @throws When no native summary with that rendered name passes {@link isReachable}, or several do.
 *
 * @remarks
 * Chromium exposes `<summary>` as a native disclosure rather than through an ARIA role accepted by
 * `getByRole`, so this resolver names the platform element and its rendered text directly.
 *
 * It applies the same {@link isReachable} filter the other acting verbs apply, so a summary marked
 * `aria-disabled="true"` is refused here exactly as a button marked that way is refused there.
 *
 * @example
 * ```ts
 * await clickDisclosure('Advanced')
 * ```
 */
export async function clickDisclosure(name: string): Promise<void> {
	const matches = [...document.querySelectorAll('summary')].filter(
		(element) => element.innerText.replaceAll(/\s+/g, ' ').trim() === name,
	)
	const reachable = matches.filter((element) => isReachable(element))
	if (reachable.length === 0) {
		throw new Error(`Native disclosure "${name}" is not visible and focus-reachable`)
	}
	if (reachable.length > 1) {
		throw new Error(`Native disclosure "${name}" is ambiguous across ${reachable.length} elements`)
	}
	const [target] = reachable
	if (target === undefined) throw new Error(`Native disclosure "${name}" could not be resolved`)
	await userEvent.click(target)
}

/**
 * Replaces a named field's value through focus, select-all, deletion, and real keystrokes.
 *
 * @param name - The field's exact accessible name.
 * @param text - The text to type.
 * @returns A promise resolving after every keystroke completes.
 *
 * @example
 * ```ts
 * await typeAccessible('Runs', '3')
 * ```
 */
export async function typeAccessible(name: string, text: string): Promise<void> {
	await userEvent.click(resolveRendered(name))
	await userEvent.keyboard('{Control>}a{/Control}{Backspace}')
	if (text === '') return
	await userEvent.keyboard(text.replaceAll('{', '{{').replaceAll('[', '[['))
}

/**
 * Replaces a named field's value in one operation, for text too long to type key by key.
 *
 * @param name - The field's exact accessible name.
 * @param text - The text to place in the field.
 * @returns A promise resolving after the browser commits the value.
 *
 * @remarks
 * The provider drives the real element, so the field publishes the same input event a person's
 * typing publishes. Use {@link typeAccessible} wherever the keystrokes themselves are the subject.
 *
 * @example
 * ```ts
 * await fillAccessible('Payload', '{"status":"ready"}')
 * ```
 */
export async function fillAccessible(name: string, text: string): Promise<void> {
	await userEvent.fill(resolveRendered(name), text)
}

/**
 * Presses a browser-keyboard sequence using Vitest's installed user-event syntax.
 *
 * @param keys - The keys or key descriptors to press.
 * @returns A promise resolving after the sequence completes.
 *
 * @example
 * ```ts
 * await pressKeys('{ArrowRight}{Enter}')
 * ```
 */
export async function pressKeys(keys: string): Promise<void> {
	await userEvent.keyboard(keys)
}

/**
 * Reaches a named control only through natural forward Tab traversal from the current focus.
 *
 * @param name - The target's exact accessible name.
 * @returns The target after the browser moves focus to it.
 * @throws When one complete traversal cannot reach the target.
 *
 * @example
 * ```ts
 * await traverseAccessible('Evaluate')
 * ```
 */
export async function traverseAccessible(name: string): Promise<HTMLElement> {
	resolveRendered(name)
	// Two facts shape the loop. A Tab pressed before the page has real input focus moves nothing,
	// so a step counts only when focus actually lands somewhere; the traversal is over when focus
	// revisits an element, because that is one full cycle of the tab order. And the target is
	// re-resolved on every step, because a framework may replace the node between resolution and
	// focus arrival: the person's target is the role and name, never one node.
	// The bound is counted off `FOCUSABLE_SELECTOR`, the one population this environment reads
	// sequential navigation from, so a tag the selector gains is a tag this traversal budgets for.
	const cap = document.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR).length * 3 + 10
	const visited = new Set<Element>()
	const trail: string[] = []
	for (let attempt = 0; attempt < cap; attempt += 1) {
		await userEvent.tab()
		const focused = document.activeElement
		if (!(focused instanceof HTMLElement) || focused === document.body) continue
		let current: HTMLElement | undefined
		try {
			current = resolveRendered(name)
		} catch {
			continue
		}
		if (focused === current) return current
		if (visited.has(focused)) break
		visited.add(focused)
		trail.push(`${focused.tagName}:${focused.innerText.slice(0, 20)}`)
	}
	throw new Error(
		`Interactive target "${name}" is not reachable through forward Tab traversal: ${trail.join(' > ')}`,
	)
}

/**
 * Reads the normalized visible text of one named region, dialog, table, tab panel, or alert.
 *
 * @param name - The region's exact accessible name.
 * @returns The text a screen reader can perceive in the visible region, including descendant
 * visually-hidden content.
 * @throws When the named region is absent, hidden, or ambiguous.
 *
 * @remarks
 * One pass answers this, because absence and concealment share the refusal. The pass asks the role
 * engine over the elements the accessibility tree presents, so the name matched is the one a screen
 * reader announces and an `aria-hidden` glyph in a heading a region points at contributes nothing
 * to it. A region the tree does not present is refused as not visible, which is what a reader
 * perceiving nothing there means.
 *
 * @example
 * ```ts
 * readPerception('Run')
 * ```
 */
export function readPerception(name: string): string {
	const matches: HTMLElement[] = []
	for (const role of ['alert', 'alertdialog', 'dialog', 'region', 'status', 'table', 'tabpanel']) {
		for (const element of page.getByRole(role, { name, exact: true }).elements()) {
			if (element instanceof HTMLElement && !matches.includes(element)) matches.push(element)
		}
	}
	const visible = matches.filter((element) => {
		const rectangle = element.getBoundingClientRect()
		return (
			element.isConnected &&
			element.checkVisibility({ checkOpacity: true, checkVisibilityCSS: true }) &&
			rectangle.width > 0 &&
			rectangle.height > 0
		)
	})
	if (visible.length === 0) throw new Error(`Named region "${name}" is not visible`)
	if (visible.length > 1) {
		throw new Error(`Named region "${name}" is ambiguous across ${visible.length} elements`)
	}
	const [region] = visible
	if (region === undefined) throw new Error(`Named region "${name}" could not be resolved`)
	return region.innerText.replaceAll(/\s+/g, ' ').trim()
}

/**
 * Reads the normalized visible text of the whole page.
 *
 * @returns Every rendered word in the document body, its whitespace runs collapsed and trimmed.
 *
 * @remarks
 * This is the reader for a sentence that spans two regions and for a vocabulary sweep over the
 * words an interface uses. Reach for {@link readPerception} wherever one named region is the
 * subject, because that one throws when the region is missing and this one returns whatever is
 * there.
 *
 * @example
 * ```ts
 * readPage().includes('No cases yet')
 * ```
 */
export function readPage(): string {
	return document.body.innerText.replaceAll(/\s+/g, ' ').trim()
}

/**
 * Reads the rendered text of the element that currently holds focus.
 *
 * @returns The focused HTML element's trimmed rendered text, including an empty string, or
 * `undefined` when focus rests on a non-HTML element. When nothing holds focus, the browser
 * reports the document body as active, so the whole page's rendered text returns.
 *
 * @example
 * ```ts
 * await traverseAccessible('Evaluate')
 * readFocus() // 'Evaluate'
 * ```
 */
export function readFocus(): string | undefined {
	const focused = document.activeElement
	return focused instanceof HTMLElement ? focused.innerText.trim() : undefined
}

/**
 * Reads the value a resolved control renders.
 *
 * @param role - The control's exact ARIA role.
 * @param name - The control's exact accessible name.
 * @returns The control's current value.
 * @throws When the target does not resolve, or resolves to an element that carries no value.
 *
 * @remarks
 * A control's value is a rendered fact a person can read, not internal state, so it is read from
 * the resolved element rather than from the component that produced it.
 *
 * @example
 * ```ts
 * readValue('spinbutton', 'Runs') // '3'
 * ```
 */
export function readValue(role: string, name: string): string {
	const control = resolveAccessible(role, name)
	if (
		!(control instanceof HTMLInputElement) &&
		!(control instanceof HTMLTextAreaElement) &&
		!(control instanceof HTMLSelectElement)
	) {
		throw new Error(`Interactive target "${name}" does not carry a value`)
	}
	return control.value
}

/**
 * Reads one element's rendered text the way a name computation reads it.
 *
 * @param element - The element whose announced words are wanted.
 * @returns The text with every `aria-hidden` descendant dropped and whitespace runs collapsed.
 *
 * @remarks
 * A glyph marked `aria-hidden` contributes nothing to a name, so a control captioned by an icon
 * plus a word reads as the word alone — which is what a reader hears, and what a verdict citing a
 * description has to compare against the copy a template writes. Reach for `readRows` wherever the
 * subject is what the page paints rather than what it announces: that one keeps the glyph.
 *
 * @example
 * ```ts
 * readText(requireValue(container.querySelector('button'))) // 'Save'
 * ```
 */
export function readText(element: Element): string {
	const parts: string[] = []
	const walker = element.ownerDocument.createTreeWalker(element, NodeFilter.SHOW_TEXT)
	for (let node = walker.nextNode(); node !== null; node = walker.nextNode()) {
		const owner = node.parentElement
		if (owner === null || owner.closest('[aria-hidden="true"]') !== null) continue
		parts.push(node.textContent ?? '')
	}
	return parts.join(' ').replaceAll(/\s+/g, ' ').trim()
}

/**
 * Reads the role one element carries in the accessibility tree.
 *
 * @param element - The element to classify.
 * @returns The declared role, the implicit one, or `undefined` when the element carries none.
 *
 * @remarks
 * A declared `role` wins outright, and its first token is the answer when several are listed.
 * Otherwise the element's own anatomy decides: an anchor is a link only while it holds an `href`,
 * an `input` takes the role {@link FIELD_ROLES} gives its type, a `select` is a combobox until it
 * offers several rows at once, a `section` is a region only once something names it, and a `th`
 * heads whichever axis its `scope` names. Every other tag answers from {@link IMPLICIT_ROLES},
 * whose membership is the contract for what this can answer at all.
 *
 * @example
 * ```ts
 * readRole(requireValue(container.querySelector('a[href]'))) // 'link'
 * ```
 */
export function readRole(element: Element): string | undefined {
	const declared = element.getAttribute('role')?.trim()
	if (declared !== undefined && declared.length > 0) return declared.split(/\s+/)[0]
	if (element instanceof HTMLAnchorElement) return element.href.length > 0 ? 'link' : undefined
	if (element instanceof HTMLInputElement) return FIELD_ROLES[element.type]
	if (element instanceof HTMLSelectElement) {
		return element.multiple || element.size > 1 ? 'listbox' : 'combobox'
	}
	const implicit = IMPLICIT_ROLES[element.tagName]
	const scope = element.tagName === 'TH' ? element.getAttribute('scope')?.trim() : undefined
	if (scope !== undefined) return HEADER_ROLES[scope] ?? implicit
	if (
		implicit === 'region' &&
		!element.hasAttribute('aria-label') &&
		!element.hasAttribute('aria-labelledby')
	) {
		return undefined
	}
	return implicit
}

/**
 * Reads the accessible name one element is announced under.
 *
 * @param element - The element to name.
 * @returns The computed name, or an empty string when the element carries none.
 *
 * @remarks
 * The order is the one a browser follows: `aria-labelledby`, then `aria-label`, then a form
 * control's own labels, then an image's `alt`, then the text inside a role {@link CONTENT_ROLES}
 * names, then `title`. A submit, reset, or button input is named by its value, because it renders
 * no text to read. An `aria-labelledby` naming several ids joins their texts in the order the
 * attribute lists them, and an id nothing answers for is skipped rather than fatal.
 *
 * Each step answers only when it has something to say, so a step that carries nothing hands the
 * element to the next one. An image whose `alt` is absent or blank is the case that shows it:
 * `<img title="Chart">` is named `Chart` rather than the empty string its own `alt` step would
 * have returned, and an image carrying both keeps answering `alt`.
 *
 * @example
 * ```ts
 * readName(requireValue(container.querySelector('button'))) // 'Save changes'
 * ```
 */
export function readName(element: Element): string {
	const referenced = element.getAttribute('aria-labelledby')
	if (referenced !== null) {
		const named = referenced
			.split(/\s+/)
			.map((id) => element.ownerDocument.getElementById(id))
			.filter((node) => node !== null)
			.map((node) => readText(node))
			.filter((text) => text.length > 0)
		if (named.length > 0) return named.join(' ')
	}
	const labelled = element.getAttribute('aria-label')?.trim()
	if (labelled !== undefined && labelled.length > 0) return labelled
	if (
		element instanceof HTMLInputElement ||
		element instanceof HTMLSelectElement ||
		element instanceof HTMLTextAreaElement
	) {
		const labels = [...(element.labels ?? [])]
			.map((label) => readText(label))
			.filter((text) => text.length > 0)
		if (labels.length > 0) return labels.join(' ')
		if (element instanceof HTMLInputElement && element.value.length > 0) {
			if (FIELD_ROLES[element.type] === 'button') return element.value
		}
	}
	if (element instanceof HTMLImageElement) {
		const alternative = element.alt.trim()
		if (alternative.length > 0) return alternative
	}
	const role = readRole(element)
	if (role !== undefined && CONTENT_ROLES.includes(role)) {
		const text = readText(element)
		if (text.length > 0) return text
	}
	return element.getAttribute('title')?.trim() ?? ''
}

/**
 * Reads the states one element is announced in.
 *
 * @param element - The element to read.
 * @returns Every state the element declares, in one fixed order.
 *
 * @remarks
 * A state a reader is told about is one this records: what is unavailable, disclosed, pressed,
 * current, refused, chosen, announcing itself, demanded, uneditable, described, or busy. The order
 * is fixed, so two descriptions of the same surface are comparable line for line.
 *
 * A native disclosure states its expansion on the parent `details` element's own `open` rather than
 * on an ARIA attribute, so a summary that declares no `aria-expanded` is read from the platform's
 * one copy of that fact.
 *
 * @example
 * ```ts
 * readStates(requireValue(container.querySelector('summary'))) // ['collapsed']
 * ```
 */
export function readStates(element: Element): readonly string[] {
	const states: string[] = []
	if (element.matches(':disabled') || element.getAttribute('aria-disabled') === 'true') {
		states.push('disabled')
	}
	const expanded = element.getAttribute('aria-expanded')
	if (expanded === 'true') states.push('expanded')
	if (expanded === 'false') states.push('collapsed')
	if (
		expanded === null &&
		element.tagName === 'SUMMARY' &&
		element.parentElement instanceof HTMLDetailsElement
	) {
		states.push(element.parentElement.open ? 'expanded' : 'collapsed')
	}
	const pressed = element.getAttribute('aria-pressed')
	if (pressed !== null) states.push(`pressed=${pressed}`)
	const current = element.getAttribute('aria-current')
	if (current !== null && current !== 'false') states.push('current')
	if (element.getAttribute('aria-invalid') === 'true') states.push('invalid')
	const checked =
		element instanceof HTMLInputElement
			? element.checked
			: element.getAttribute('aria-checked') === 'true'
	if (checked) states.push('checked')
	const selected = element.getAttribute('aria-selected')
	if (selected !== null) states.push(`selected=${selected}`)
	const live = element.getAttribute('aria-live')
	if (live !== null) states.push(`live=${live}`)
	if (element.matches(':required')) states.push('required')
	if (element instanceof HTMLInputElement && element.readOnly) states.push('readonly')
	if (element.hasAttribute('aria-describedby')) states.push('described')
	if (element.getAttribute('aria-busy') === 'true') states.push('busy')
	return Object.freeze(states)
}

/**
 * Describes the accessible tree one rendered element presents.
 *
 * @param element - The host to walk, which is described first when it carries a role of its own.
 * @returns One indented line per element carrying a role, naming its role, its name, and its
 * states, in document order; an empty string when nothing in the subtree carries one.
 *
 * @remarks
 * The walk is over the real rendered DOM, so what it reports is the tree the shipped markup and the
 * shipped cascade produce together — a landmark lost to a hidden ancestor is missing here exactly as
 * it is missing for a reader. An element {@link isRendered} refuses is dropped with its whole
 * subtree.
 *
 * Depth follows the roles rather than the elements, so the indentation reads as the structure a
 * screen reader announces instead of as the markup's nesting. An element {@link readRole} answers
 * `undefined` for writes no line and adds no depth, so its children sit where it sat. That is how
 * a wrapper `div` disappears, and it is also how an element {@link IMPLICIT_ROLES} does not answer
 * for disappears — visibly, because its roled children stay at the depth it occupied.
 *
 * @example
 * ```ts
 * describeTree(container)
 * // main "Board"
 * //   heading "Totals"
 * ```
 */
export function describeTree(element: Element): string {
	const lines: string[] = []
	const pending: Array<{ readonly node: Element; readonly depth: number }> = [
		{ node: element, depth: 0 },
	]
	while (pending.length > 0) {
		const entry = pending.pop()
		if (entry === undefined) break
		if (!isRendered(entry.node)) continue
		const role = readRole(entry.node)
		let depth = entry.depth
		if (role !== undefined) {
			const name = readName(entry.node)
			const states = readStates(entry.node)
			lines.push(
				`${'  '.repeat(depth)}${role}${name.length > 0 ? ` "${name}"` : ''}${
					states.length > 0 ? ` [${states.join(', ')}]` : ''
				}`,
			)
			depth += 1
		}
		for (let index = entry.node.children.length - 1; index >= 0; index -= 1) {
			const child = entry.node.children[index]
			if (child !== undefined) pending.push({ node: child, depth })
		}
	}
	return lines.join('\n')
}

/**
 * Describes the order sequential keyboard navigation visits one element's controls in.
 *
 * @param element - The host to walk; its own controls are described, and it is not itself one.
 * @returns One numbered line per reachable control, naming its role and its name.
 *
 * @remarks
 * A positive `tabindex` is honoured, because a browser honours it: those controls come first in
 * ascending order and everything else follows in document order. A control removed from the
 * sequence by `tabindex="-1"`, by being disabled, or by not being rendered at all is absent here,
 * which is the fact a focus-order verdict is about. A control {@link readRole} answers `undefined`
 * for is named by its lowercased tag, so it is still counted rather than silently dropped.
 *
 * @example
 * ```ts
 * describeFocus(container)
 * // 1. button "Save"
 * // 2. link "Cancel"
 * ```
 */
export function describeFocus(element: Element): string {
	return [...element.querySelectorAll(FOCUSABLE_SELECTOR)]
		.filter(
			(node) =>
				isRendered(node) && !node.matches(':disabled') && node.getAttribute('tabindex') !== '-1',
		)
		.sort((first, second) => {
			const left = Number.parseInt(first.getAttribute('tabindex') ?? '0', 10)
			const right = Number.parseInt(second.getAttribute('tabindex') ?? '0', 10)
			if (left > 0 && right > 0) return left - right
			if (left > 0) return -1
			if (right > 0) return 1
			return 0
		})
		.map((node, index) => {
			const role = readRole(node) ?? node.tagName.toLowerCase()
			const name = readName(node)
			return `${String(index + 1)}. ${role}${name.length > 0 ? ` "${name}"` : ''}`
		})
		.join('\n')
}

/**
 * Waits for one animation frame to settle pending browser paint work.
 *
 * @returns A promise resolving after one `requestAnimationFrame`.
 *
 * @example
 * ```ts
 * await waitForFrame()
 * ```
 */
export function waitForFrame(): Promise<void> {
	return new Promise<void>((resolve) => requestAnimationFrame(() => resolve()))
}

/**
 * Builds one unmounted element of a known tag, wearing the classes, text, and attributes asked for.
 *
 * @param tag - The HTML tag name, which fixes the returned element's exact type.
 * @param options - The class list, the text, and the attributes to apply.
 * @returns The built element, not yet in any document.
 *
 * @remarks
 * The element is unmounted on purpose, so a fixture is assembled before the page ever sees it and a
 * test decides where it goes. Nothing here resolves against the cascade: a built element computes no
 * style and lays out no box until {@link mount} puts it in the document.
 *
 * The text is set as text rather than parsed as markup, so a `<` in it stays a `<`. Use
 * {@link render} where the fixture is markup.
 *
 * @example
 * ```ts
 * const button = build('button', { classes: 'primary', text: 'Save', attributes: { type: 'button' } })
 * ```
 */
export function build<K extends keyof HTMLElementTagNameMap>(
	tag: K,
	options?: ElementOptions,
): HTMLElementTagNameMap[K] {
	const element = document.createElement(tag)
	if (options?.classes !== undefined) element.className = options.classes
	if (options?.text !== undefined) element.textContent = options.text
	for (const [name, value] of Object.entries(options?.attributes ?? {})) {
		element.setAttribute(name, value)
	}
	return element
}

/**
 * Puts one element into the document and hands it straight back.
 *
 * @param element - The element to attach.
 * @returns The same element, now appended to `document.body`.
 *
 * @remarks
 * What this buys is the composition, not the attachment: the `append` method returns `void`, and
 * this hands the element back, so it fits where an expression is expected. The {@link render} helper
 * returns its fixture through it, and the {@link rgba} helper probes through `mount(build('span'))`.
 * A bare `append` call breaks each of those call sites.
 *
 * Being connected is what the attachment then buys: `getComputedStyle` resolves against the shipped
 * cascade, custom properties inherit from `:root`, and the element lays out a real box. A detached
 * element answers each of those questions with the initial value instead, which reads as a styling
 * defect rather than as a detached node.
 *
 * Taking it back out belongs to the consumer's teardown, because this records nothing: a browser
 * test file shares one page, so a fixture left behind is the next test's resolver ambiguity. Build a
 * recorded container in a setup module and remove it from an `afterEach` hook.
 *
 * @example
 * ```ts
 * const panel = mount(build('div', { classes: 'surface' }))
 * panel.remove()
 * ```
 */
export function mount<T extends Element>(element: T): T {
	document.body.append(element)
	return element
}

/**
 * Renders one fixture into the document, from trusted markup or from a tag and its classes.
 *
 * @param first - The fixture markup, or the HTML tag name when `second` is present.
 * @param second - The class list when `first` supplies the tag name.
 * @returns The attached container for the markup form, and the attached element itself for the tag
 * form.
 *
 * @remarks
 * The class list is required in the tag form, which is what keeps the two forms apart: a
 * one-argument call is always markup. A tag with no classes is `mount(build(tag))`.
 *
 * The markup form parses `first` into a fresh container and returns that container, so the fixture's
 * own nodes are its children. The tag form returns the element itself, typed as exactly that tag.
 * Both attach to `document.body` and neither records anything, so removal is the caller's, exactly
 * as it is for {@link mount}.
 *
 * @example
 * ```ts
 * const container = render('<button type="button">Save</button>')
 * const panel = render('section', 'surface muted')
 * container.remove()
 * panel.remove()
 * ```
 */
export function render(markup: string): HTMLDivElement
export function render<K extends keyof HTMLElementTagNameMap>(
	tag: K,
	classes: string,
): HTMLElementTagNameMap[K]
export function render(first: string, second?: string): HTMLElement {
	if (second === undefined) {
		const container = build('div')
		container.innerHTML = first
		return mount(container)
	}
	// `build` is generic over the known tag names and this signature carries a plain string, so the
	// tag branch cannot route through it without an assertion. It applies the class list the one way
	// `build` applies it, so the two forms stay one behaviour.
	const element = document.createElement(first)
	element.className = second
	return mount(element)
}

/**
 * Sets one field's value and announces it the way typing into the field does.
 *
 * @param element - The input or textarea to write into.
 * @param text - The value to set.
 *
 * @remarks
 * This is the synthetic pair of {@link typeAccessible}, for a component that listens for `input` and
 * a test that has the element already. It sets the value in one write and dispatches one bubbling
 * `input` event, so a delegated listener on an ancestor hears it. It sends no keystrokes, so a
 * component reading `key`, composition, or selection sees nothing. The dispatched event is a plain
 * `Event`, never an `InputEvent`, so a component reading `inputType` or testing
 * `instanceof InputEvent` sees neither. Drive a component that reads any of those through
 * `typeAccessible` instead.
 *
 * No `change` event follows. Use {@link commitInput} where the component waits for the field to be
 * committed.
 *
 * @example
 * ```ts
 * typeInput(requireValue(container.querySelector('input')), 'Ada')
 * ```
 */
export function typeInput(element: HTMLInputElement | HTMLTextAreaElement, text: string): void {
	element.value = text
	element.dispatchEvent(new Event('input', { bubbles: true }))
}

/**
 * Sets one field's value and commits it, the way typing and then leaving the field does.
 *
 * @param element - The input or textarea to write into.
 * @param text - The value to set.
 *
 * @remarks
 * The order is the browser's: {@link typeInput} first, so `input` is dispatched with the value
 * already set, and one bubbling `change` after it. A component that reads the value from either
 * event therefore reads `text` from both.
 *
 * @example
 * ```ts
 * commitInput(requireValue(container.querySelector('input')), 'Ada')
 * ```
 */
export function commitInput(element: HTMLInputElement | HTMLTextAreaElement, text: string): void {
	typeInput(element, text)
	element.dispatchEvent(new Event('change', { bubbles: true }))
}

/**
 * Clears both browser storage surfaces.
 *
 * @remarks
 * A browser test file shares one page, so a key written by one test is read by the next one that
 * looks for it. Call this from an `afterEach` hook, which runs after a failed test as well as a
 * passing one, rather than at the end of each test that happens to write a key.
 *
 * @example
 * ```ts
 * afterEach(clearStorage)
 * ```
 */
export function clearStorage(): void {
	localStorage.clear()
	sessionStorage.clear()
}

/**
 * Deletes one IndexedDB database and reports what the request actually did.
 *
 * @param name - The database name to delete.
 * @returns A promise resolving after the deletion completes.
 * @throws Thrown when the request errors, and when an open connection blocks it.
 *
 * @remarks
 * Deleting a database that was never created succeeds, so this is safe to call from a teardown hook
 * that runs whether or not the test reached the code that opens one.
 *
 * A block is a rejection rather than a wait. `blocked` fires when another connection is still open,
 * and a suite that swallowed it would leave the next test reading the previous test's records
 * through a database that reports itself deleted. The connection holding it open is the caller's to
 * close, so the block is handed back rather than absorbed.
 *
 * @example
 * ```ts
 * afterEach(() => removeDatabase('ledger'))
 * ```
 */
export function removeDatabase(name: string): Promise<void> {
	return new Promise<void>((resolve, reject) => {
		const request = globalThis.indexedDB.deleteDatabase(name)
		request.addEventListener('success', () => resolve())
		request.addEventListener('error', () =>
			reject(new Error(`IndexedDB database "${name}" could not be deleted`)),
		)
		request.addEventListener('blocked', () =>
			reject(new Error(`IndexedDB database "${name}" is blocked by an open connection`)),
		)
	})
}

/**
 * Parses one computed CSS color value into straight sRGB channels.
 *
 * @param value - A computed `rgb()`, `rgba()`, or `color(srgb …)` value.
 * @returns The color's channels, or `undefined` when the value names no color this reader speaks.
 *
 * @remarks
 * A computed color resolves to `rgb()` or `rgba()` for every legacy source, and a `color-mix()`
 * declaration resolves to `color(srgb r g b [/ a])` with channels on the 0–1 scale. Both forms are
 * read here and nothing else is: a keyword, a hex triple, an empty string from a detached element,
 * and a color space the cascade never hands back all return `undefined`. Absence is the answer
 * rather than a transparent color, so a caller decides what an unreadable value means instead of
 * measuring a black it never saw.
 *
 * @example
 * ```ts
 * parseColor('rgba(255, 255, 255, 0.5)') // [255, 255, 255, 0.5]
 * parseColor('rebeccapurple') // undefined
 * ```
 */
export function parseColor(value: string): Color | undefined {
	const modern =
		/^color\(srgb\s+(?<red>[\d.]+)\s+(?<green>[\d.]+)\s+(?<blue>[\d.]+)(?:\s*\/\s*(?<alpha>[\d.]+))?\)$/u.exec(
			value,
		)
	const legacy = /^rgba?\((?<channels>[^)]*)\)$/u.exec(value)
	const parts =
		modern?.groups === undefined
			? (legacy?.groups?.channels ?? '')
					.split(/[\s,/]+/u)
					.filter((part) => part.length > 0)
					.map((part) => Number.parseFloat(part))
			: [
					Number.parseFloat(modern.groups.red ?? '') * 255,
					Number.parseFloat(modern.groups.green ?? '') * 255,
					Number.parseFloat(modern.groups.blue ?? '') * 255,
					modern.groups.alpha === undefined ? 1 : Number.parseFloat(modern.groups.alpha),
				]
	const [red, green, blue, alpha = 1] = parts
	if (red === undefined || green === undefined || blue === undefined) return undefined
	if (![red, green, blue, alpha].every((channel) => Number.isFinite(channel))) return undefined
	return Object.freeze([red, green, blue, alpha])
}

/**
 * Resolves any CSS color expression to straight sRGB channels, by asking the browser.
 *
 * @param value - Any value the `color` property accepts: a keyword, a hex triple, a `var()`
 * reference, a `color-mix()`, or an already-computed `rgb()`.
 * @returns The resolved color's channels, or `undefined` when the CSSOM refuses the value or the
 * computed result names no color {@link parseColor} speaks.
 *
 * @remarks
 * This is the live half of the pair {@link parseColor} opens. `parseColor` reads text and speaks
 * only the computed syntaxes a cascade hands back; this stages a probe element, hands it to the real
 * cascade, and reads back what the engine computed — which is the only way a keyword, a hex triple,
 * or a `var()` reference becomes channels at all. The read itself goes through `parseColor`, so both
 * halves agree on what a computed value means.
 *
 * The probe is mounted, because an unmounted element inherits nothing and a `var()` reference to a
 * token declared on `:root` would resolve to the initial value instead. It is removed in a `finally`,
 * so a value that throws on the way through leaves no node behind.
 *
 * Refusal is the CSSOM's: an expression it will not parse leaves the probe's inline `color` empty
 * and this returns `undefined`. A `var()` naming an undeclared custom property is not refused,
 * because the cascade accepts it and computes the inherited color, so a test that means to catch a
 * missing token asserts on {@link token} rather than on this.
 *
 * @example
 * ```ts
 * rgba('rebeccapurple') // [102, 51, 153, 1]
 * rgba('not-a-color') // undefined
 * ```
 */
export function rgba(value: string): Color | undefined {
	const probe = mount(build('span'))
	try {
		probe.style.color = value
		if (probe.style.color === '') return undefined
		return parseColor(style(probe, 'color'))
	} finally {
		probe.remove()
	}
}

/**
 * Determines whether two colors render the same, within the rounding a browser does.
 *
 * @param first - A CSS color expression or an already-parsed color.
 * @param second - A CSS color expression or an already-parsed color.
 * @returns `true` when every channel and the alpha agree within the tolerance; `false` otherwise,
 * including when either side names no readable color.
 *
 * @remarks
 * Each string side is resolved through {@link rgba}, so a keyword, a token reference, and the
 * `rgb()` the engine computes for either of them compare equal without a test converting anything
 * first. A side that resolves to nothing makes the answer `false` rather than a throw, because this
 * is a predicate.
 *
 * The tolerance is half a channel step on the 0–255 scale, and the alpha is scaled onto that same
 * range before it is compared, so one number covers both. Half a step is what a composite of
 * translucent layers and a `color-mix()` round trip actually drift by; anything a reader could see
 * is further than that and reports unequal.
 *
 * @example
 * ```ts
 * colorEqual('rebeccapurple', 'rgb(102, 51, 153)') // true
 * colorEqual('red', [0, 0, 255, 1]) // false
 * ```
 */
export function colorEqual(first: string | Color, second: string | Color): boolean {
	const left = typeof first === 'string' ? rgba(first) : first
	const right = typeof second === 'string' ? rgba(second) : second
	if (left === undefined || right === undefined) return false
	const tolerance = 0.5
	const [leftRed, leftGreen, leftBlue, leftAlpha] = left
	const [rightRed, rightGreen, rightBlue, rightAlpha] = right
	return (
		Math.abs(leftRed - rightRed) <= tolerance &&
		Math.abs(leftGreen - rightGreen) <= tolerance &&
		Math.abs(leftBlue - rightBlue) <= tolerance &&
		Math.abs(leftAlpha - rightAlpha) * 255 <= tolerance
	)
}

/**
 * Composites one color over another.
 *
 * @param front - The color painted on top.
 * @param back - The color already on the surface.
 * @returns The opaque result a reader sees, its alpha always `1`.
 *
 * @example
 * ```ts
 * blendColor([255, 255, 255, 0.5], [0, 0, 0, 1]) // [127.5, 127.5, 127.5, 1]
 * ```
 */
export function blendColor(front: Color, back: Color): Color {
	const [red, green, blue, alpha] = front
	const [under, over, beneath] = back
	return Object.freeze([
		red * alpha + under * (1 - alpha),
		green * alpha + over * (1 - alpha),
		blue * alpha + beneath * (1 - alpha),
		1,
	])
}

/**
 * Measures one opaque color's WCAG relative luminance.
 *
 * @param color - The color to weigh. Its alpha is ignored, so composite before calling.
 * @returns The relative luminance, from `0` for black to `1` for white.
 *
 * @example
 * ```ts
 * measureLuminance([255, 255, 255, 1]) // 1
 * ```
 */
export function measureLuminance(color: Color): number {
	const [red, green, blue] = color
	const [first = 0, second = 0, third = 0] = [red, green, blue].map((channel) => {
		const part = channel / 255
		return part <= 0.040_45 ? part / 12.92 : ((part + 0.055) / 1.055) ** 2.4
	})
	return 0.2126 * first + 0.7152 * second + 0.0722 * third
}

/**
 * Measures the WCAG 2.x contrast ratio between two opaque colors.
 *
 * @param front - The foreground color, already composited.
 * @param back - The opaque backdrop.
 * @returns The ratio, from `1` for two identical colors to `21` for black against white.
 *
 * @remarks
 * The ratio is symmetric: the brighter of the two luminances is always the numerator, so swapping
 * the arguments returns the same number.
 *
 * @example
 * ```ts
 * measureContrast([0, 0, 0, 1], [255, 255, 255, 1]) // 21
 * ```
 */
export function measureContrast(front: Color, back: Color): number {
	const bright = Math.max(measureLuminance(front), measureLuminance(back))
	const dark = Math.min(measureLuminance(front), measureLuminance(back))
	return (bright + 0.05) / (dark + 0.05)
}

/**
 * Collects the painted layers standing between one element and the surface it sits on.
 *
 * @param element - The element to walk up from.
 * @returns Every layer the walk paints, the element's own first and the deepest last.
 *
 * @remarks
 * A surface token paints one ancestor while every element between it and the text paints nothing,
 * so a backdrop is found by walking up rather than by reading the element's own `background-color`,
 * which is almost always transparent. A fully transparent layer paints nothing and is left out, and
 * the walk stops at the first fully opaque layer, because nothing above that layer is visible.
 *
 * The stack is what tells a resolved backdrop from an assumed one: the walk reached an opaque
 * surface exactly when its last layer's alpha is `1`. {@link contrast} refuses on that reading,
 * which no comparison of composited colors can replace — 64 half-transparent layers composite to
 * the same channels over opposite floors, because the floor's remaining share falls below the last
 * bit a channel carries.
 *
 * @example
 * ```ts
 * readLayers(requireValue(container.querySelector('p')))
 * ```
 */
export function readLayers(element: Element): readonly Color[] {
	const layers: Color[] = []
	for (let node: Element | null = element; node !== null; node = node.parentElement) {
		const layer = parseColor(getComputedStyle(node).backgroundColor)
		if (layer === undefined || layer[3] === 0) continue
		layers.push(layer)
		if (layer[3] >= 1) break
	}
	return Object.freeze(layers)
}

/**
 * Resolves the opaque color standing behind one element.
 *
 * @param element - The element whose backdrop to resolve.
 * @param floor - The opaque color the walk ends on when nothing above it paints.
 * @returns The composited color a reader sees behind the element.
 *
 * @remarks
 * The layers {@link readLayers} collects composite top-over-bottom onto the floor, so a 3% surface
 * tint reads as a tint over what shows through it rather than as a full-strength paint.
 *
 * The floor is required, because this leaf never guesses what a document sits on. Pass
 * {@link CANVAS_COLOR} for the page a browser paints behind an unstyled document, or the color of
 * the surface a fragment is really rendered into. When no layer paints, the floor is returned by
 * identity.
 *
 * The composite alone never says whether the floor is part of the answer. A caller that must know
 * reads the stack instead.
 *
 * @example
 * ```ts
 * readBackdrop(requireValue(container.querySelector('p')), CANVAS_COLOR)
 * ```
 */
export function readBackdrop(element: Element, floor: Color): Color {
	return readLayers(element).reduceRight((back, front) => blendColor(front, back), floor)
}

/**
 * Measures the WCAG 2.x contrast ratio between an element's computed text and background colors.
 *
 * @param element - The element whose rendered text contrast to measure.
 * @param floor - The opaque color the backdrop walk ends on. Omit it to refuse a stack the floor
 * would show through instead of assuming one.
 * @returns The relative-luminance contrast ratio.
 * @throws Thrown when the element exposes no computed foreground color, and — with `floor` omitted
 * — when the walk from the element upwards reaches no opaque layer.
 *
 * @remarks
 * A transparent or translucent background resolves through the element's ancestors: every painted
 * layer from the element up to the first opaque one composites top-over-bottom onto that opaque
 * base, so a 3% surface tint reads as a tint over what shows through it rather than as a
 * full-strength paint. A translucent foreground then resolves against that effective background
 * before luminance is measured.
 *
 * With `floor` omitted, the walk from the target upwards must reach a fully opaque layer: the
 * measurement throws rather than assuming a white canvas wherever that canvas would still be part
 * of the answer. The refusal reads the alpha of the deepest layer {@link readLayers} collected, so
 * a chain that declares no background color at all, a chain painting only translucent layers, and a
 * chain deep enough for its composite to round to the canvas's own channels are refused alike,
 * because the number any of them produces is as much a report of the assumption as of the page.
 * Supply a floor wherever the caller knows what the stack sits on — a fragment mounted into a
 * painted host, or a document whose canvas is {@link CANVAS_COLOR} — and the composite is taken
 * over it rather than refused.
 *
 * The element itself must expose a computed foreground color either way. A detached element exposes
 * none, and the measurement throws rather than guessing one.
 *
 * @example
 * ```ts
 * const container = render('<p style="background: #000; color: #fff">Ready</p>')
 * contrast(requireValue(container.firstElementChild)) // 21
 * contrast(requireValue(container.firstElementChild), CANVAS_COLOR) // 21, and never refuses
 * ```
 */
export function contrast(element: Element, floor?: Color): number {
	const foreground = parseColor(getComputedStyle(element).color)
	if (foreground === undefined) throw new Error('Computed foreground color is unavailable')
	const layers = readLayers(element)
	const deepest = layers.at(-1)
	// The walk reached a real surface exactly when its deepest layer is fully opaque. An empty stack
	// paints nothing, and a stack ending translucent leaves the floor showing through whatever the
	// composite reports: 64 half-transparent layers round to identical channels over opposite floors,
	// so comparing two composited readings admits the stack this refusal exists for.
	if (floor === undefined && (deepest === undefined || deepest[3] < 1)) {
		throw new Error('Computed background color is unavailable')
	}
	const backdrop = layers.reduceRight(
		(back, front) => blendColor(front, back),
		floor ?? CANVAS_COLOR,
	)
	return measureContrast(blendColor(foreground, backdrop), backdrop)
}

/**
 * Measures the contrast the focus chrome painted on one control reaches against its own backdrop.
 *
 * @param control - The control that holds the focus.
 * @param worn - The element the control's focus chrome is painted onto. Default: `control`.
 * @returns The strongest ratio the painted focus chrome reaches, or `undefined` when the control is
 * not showing `:focus-visible` or the cascade paints no chrome of its own.
 *
 * @remarks
 * This reads and never acts. Focus arrives through the published verbs — `traverseAccessible`,
 * `pressKeys`, a real click — and this measures what the browser painted once it landed. A control
 * that is not matching `:focus-visible` when the call is made reports nothing, because no
 * measurement taken then would be about focus.
 *
 * Some controls are two elements: one that takes the focus and one a reader can see. A hidden radio
 * beside the label that carries every pixel of its chrome is the case `worn` exists for, so a
 * measurement is not taken on a rectangle nobody is looking at. The focus state is still read off
 * `control`, because that is what holds it.
 *
 * The backdrop is the surface behind the element the chrome is worn on, resolved from that element's
 * parent through {@link readBackdrop} onto {@link CANVAS_COLOR}. A control whose ancestry paints
 * nothing is therefore measured against the browser's own canvas, which is what a reader looking at
 * an unstyled document sees.
 *
 * Only chrome the cascade paints is measured — an `outline` with a real style and width, and the
 * first color in a `box-shadow`. A control left the browser's own `outline-style: auto` ring reports
 * `undefined`, because that ring's two tones are guaranteed against any backdrop and its computed
 * color names neither. A focus style that only changes the control's own fill reports `undefined`
 * too: the resting fill is gone by the time focus is on the control, and this never moves focus to
 * go and read it.
 *
 * @example
 * ```ts
 * await traverseAccessible('Evaluate')
 * readRing(resolveRendered('Evaluate')) // the ratio the painted ring reaches
 * ```
 */
export function readRing(control: Element, worn?: Element): number | undefined {
	if (!control.matches(':focus-visible')) return undefined
	const target = worn ?? control
	const declared = getComputedStyle(target)
	const backdrop = readBackdrop(target.parentElement ?? target, CANVAS_COLOR)
	const outline =
		declared.outlineStyle === 'none' ||
		declared.outlineStyle === 'auto' ||
		Number.parseFloat(declared.outlineWidth) === 0
			? undefined
			: parseColor(declared.outlineColor)
	const shadow = parseColor(/(?:rgba?|color)\([^)]*\)/u.exec(declared.boxShadow)?.[0] ?? '')
	const ratios: number[] = []
	for (const painted of [outline, shadow]) {
		if (painted === undefined) continue
		ratios.push(measureContrast(blendColor(painted, backdrop), backdrop))
	}
	return ratios.length === 0 ? undefined : Math.max(...ratios)
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
 * `@keyframes` children are outside that walk, so an animation's own rules define no token here.
 * Reach the animation itself through {@link findKeyframes}.
 *
 * @example
 * ```ts
 * readCascade().has('card')
 * ```
 */
export function readCascade(): ReadonlySet<string> {
	const known = new Set<string>()
	for (const rule of readRules()) {
		if (!(rule instanceof CSSStyleRule)) continue
		for (const match of rule.selectorText.matchAll(/\.([a-zA-Z][\w-]*)/g)) {
			known.add(String(match[1]))
		}
	}
	return known
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
 * one; {@link findRule} returns the first match in exactly this order.
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
	for (let index = 0; index < rules.length; index += 1) {
		const rule = rules[index]
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
 * element resolves to: {@link style} reads the winner, and a rule this finds may be overridden by
 * another. Assert on this where the subject is the stylesheet, and on `style` where the subject is
 * the rendered result.
 *
 * The match is a substring, so `findRule('.card')` finds `.card`, `.card:hover`, and
 * `.panel > .card` alike. Pass more of the selector to narrow it.
 *
 * @example
 * ```ts
 * findRule('.card')?.style.getPropertyValue('padding')
 * ```
 */
export function findRule(selector: string): CSSStyleRule | undefined {
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
 * The name is matched exactly, which is where this parts from {@link findRule}: a selector is
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
 * Reads the normalized visible text of every element a selector matches, in document order.
 *
 * @param root - The subtree to search.
 * @param selector - The CSS selector naming the rows.
 * @returns One line per matched element, its text runs collapsed and single-space joined.
 *
 * @remarks
 * The line is built from the row's text nodes rather than from `textContent`, because adjacent
 * inline elements carry no whitespace between them in compiled template output and would otherwise
 * read as one run-together word.
 *
 * @example
 * ```ts
 * readRows(container, 'li')
 * ```
 */
export function readRows(root: ParentNode, selector: string): readonly string[] {
	const rows: string[] = []
	for (const row of root.querySelectorAll(selector)) {
		const parts: string[] = []
		const walker = document.createTreeWalker(row, NodeFilter.SHOW_TEXT)
		while (walker.nextNode() !== null) {
			const text = (walker.currentNode.textContent ?? '').replaceAll(/\s+/g, ' ').trim()
			if (text !== '') parts.push(text)
		}
		rows.push(parts.join(' '))
	}
	return rows
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
 * Reads one resolved CSS property from a real browser element.
 *
 * @param element - The element whose resolved style to inspect.
 * @param property - The CSS property name, registered or custom.
 * @returns The browser's resolved property value, trimmed; an empty string when the element resolves
 * none.
 *
 * @remarks
 * The value is trimmed, so what comes back is the value and never the whitespace around it. Internal
 * whitespace is kept: `--shadow: 0 0 2px` reads back with its spaces.
 *
 * @example
 * ```ts
 * style(button, 'padding-left')
 * ```
 */
export function style(element: Element, property: string): string {
	return getComputedStyle(element).getPropertyValue(property).trim()
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
 * from an unmounted element reads as `''`. Use {@link rootToken} where the declaration is the
 * document's.
 *
 * @example
 * ```ts
 * token(panel, 'surface') // '#ffffff'
 * token(panel, '--surface') // '#ffffff'
 * ```
 */
export function token(element: Element, name: string): string {
	return style(element, name.startsWith('--') ? name : `--${name}`)
}

/**
 * Reads one custom property from the document element.
 *
 * @param name - The custom property name, with or without its leading dashes.
 * @returns The resolved value, trimmed; an empty string when the document declares no such property.
 *
 * @remarks
 * This is {@link token} against `document.documentElement`, which is where a theme declares its
 * tokens and where a `[data-theme]` switch retunes them. It exists as its own name because that
 * element is the one a token question is nearly always about, and naming it at every call site
 * buries the question.
 *
 * @example
 * ```ts
 * rootToken('surface')
 * ```
 */
export function rootToken(name: string): string {
	return token(document.documentElement, name)
}

/**
 * Reads one resolved CSS length as a number of pixels.
 *
 * @param element - The element whose resolved style to inspect.
 * @param property - The CSS property name, registered or custom.
 * @returns The leading numeric part of the resolved value, and `0` when it carries none.
 *
 * @remarks
 * A resolved length is text with a unit — `'12px'` — so this reads the number in front of the unit
 * and discards the rest. The unit is not checked: the resolved value of a length is in pixels in
 * every case a browser hands back, and a property that resolves to something else is the caller's
 * mistake rather than this reader's.
 *
 * An unparsable value reads as `0` rather than as absence, because every caller of this is measuring
 * and `'auto'`, `'none'`, and `''` each contribute no pixels to what a reader sees. Where the
 * distinction matters, read the text with {@link style} instead.
 *
 * @example
 * ```ts
 * pixels(button, 'padding-left') // 12
 * pixels(button, 'width') // 0 when the width resolves to `auto`
 * ```
 */
export function pixels(element: Element, property: string): number {
	const measured = Number.parseFloat(style(element, property))
	return Number.isFinite(measured) ? measured : 0
}

/**
 * Sets the tester's viewport and renders the runner's pane at the size that viewport claims.
 *
 * @param width - The viewport width in CSS pixels.
 * @param height - The viewport height in CSS pixels.
 * @returns A promise resolving after the resized pane has been painted.
 * @throws Thrown when the tester sits inside no pane a capture can size, and when the staged pane
 * does not render at the viewport it was given.
 *
 * @remarks
 * This depends on the runner's own tester layout, and that dependency is contract rather than an
 * accident: `vitest@4.1.11` lays its tester out inside a smaller page, fits it by scaling the pane
 * the tester sits in, and clips whatever overflows that pane. Layout inside the tester is
 * unaffected — the tester reports the viewport it was given and every breakpoint answers to it —
 * but a screenshot is taken off the page the runner painted, so a frame shot through that scale is
 * a thumbnail of the surface and a frame shot after only unscaling it is a sliver. The tester is
 * therefore unscaled and lifted to the window's own origin for the shot. The `iframe[data-vitest]`
 * selector and the `--tester-transform`, `--tester-margin-left`, `--viewport-width`, and
 * `--viewport-height` custom properties are the runner's, so a Vitest release that renames any of
 * them reddens the size check below rather than writing a wrong frame.
 *
 * Hand the pane straight back with {@link releasePane}. A tester pinned at a viewport taller than
 * the window puts its lower half beyond what a pointer can reach, so an ordinary press then fails
 * as a control outside the viewport, in a test that took no picture at all.
 *
 * The rule is declared rather than written inline, because the runner writes its own scale onto the
 * pane as inline custom properties and rewrites them whenever the tester resizes. A declared rule
 * marked important outranks an inline value and survives every rewrite. It finds the pane by the
 * tester it contains as well as by {@link CAPTURE_PANE}, because a re-render between the staging and
 * the shot replaces the node and takes any attribute of ours with it.
 *
 * The wait is two frames rather than a delay: the first carries the resize into layout and the
 * second is the paint a screenshot reads.
 *
 * The viewport the tester had before this staging is written onto that rule element as the
 * {@link CAPTURE_PANE} value, in `<width>x<height>` form, and {@link releasePane} hands it back.
 * Staging an already-staged pane leaves that value alone, so a capture that stages a second time to
 * cover a taller document still releases to the viewport the tester started with.
 *
 * @example
 * ```ts
 * await stagePane(390, 844)
 * ```
 */
export async function stagePane(width: number, height: number): Promise<void> {
	const viewport = `${String(window.innerWidth)}x${String(window.innerHeight)}`
	await page.viewport(width, height)
	const frame = window.frameElement
	const pane = frame?.parentElement
	const owner = pane?.ownerDocument
	if (frame === null || pane === null || pane === undefined || owner === undefined) {
		throw new Error('Tester pane is unavailable for a capture')
	}
	pane.setAttribute(CAPTURE_PANE, '')
	if (owner.querySelector(`style[${CAPTURE_PANE}]`) === null) {
		const rule = owner.createElement('style')
		rule.setAttribute(CAPTURE_PANE, viewport)
		rule.textContent = [
			`[${CAPTURE_PANE}],:has(>iframe[data-vitest])`,
			'{--tester-transform:none !important;--tester-margin-left:0px !important}',
			'iframe[data-vitest]',
			'{position:fixed !important;left:0 !important;top:0 !important;right:auto !important;',
			'bottom:auto !important;width:var(--viewport-width) !important;',
			'height:var(--viewport-height) !important;z-index:2147483647 !important}',
		].join('')
		owner.head.append(rule)
	}
	await waitForFrame()
	await waitForFrame()
	const box = frame.getBoundingClientRect()
	if (Math.round(box.width) !== width || Math.round(box.height) !== height) {
		throw new Error(
			`Tester pane rendered ${String(Math.round(box.width))}x${String(Math.round(box.height))} for a ${String(width)}x${String(height)} viewport`,
		)
	}
}

/**
 * Hands the tester pane back to the runner's own layout, at the viewport it had before staging.
 *
 * @remarks
 * A staged pane is the runner's fitting scale suppressed, so a pane left staged outlives the capture
 * that needed it and every later act in the file happens on a surface the runner is no longer
 * fitting to its window. What that costs is not a wrong picture: it is a control whose page
 * coordinates fall outside the pane, which the runner's own layout then intercepts, so an ordinary
 * press fails with the voice of a control that is covered.
 *
 * The viewport goes back too, because a capture resizes the tester and the size it chose belongs to
 * the frame rather than to the file: a test that runs after one and reads a breakpoint would
 * otherwise read the last capture's variant. The size comes off the {@link CAPTURE_PANE} value
 * {@link stagePane} wrote onto the rule element, which is the reading taken before the first
 * staging. Calling this on an unstaged pane finds no such value, so it changes nothing and resizes
 * nothing.
 *
 * @example
 * ```ts
 * await releasePane()
 * ```
 */
export async function releasePane(): Promise<void> {
	const pane = window.frameElement?.parentElement
	const rule = pane?.ownerDocument.querySelector(`style[${CAPTURE_PANE}]`)
	const viewport = rule?.getAttribute(CAPTURE_PANE)?.split('x') ?? []
	pane?.removeAttribute(CAPTURE_PANE)
	rule?.remove()
	const width = Number(viewport[0])
	const height = Number(viewport[1])
	if (Number.isFinite(width) && Number.isFinite(height)) await page.viewport(width, height)
}

/**
 * Shoots one frame at one viewport size and proves the file on disk holds this run's bytes.
 *
 * @param options - The path to write, the viewport to shoot at, and the element to shoot.
 * @returns The absolute path of the written frame, after it has been read back and matched.
 * @throws Thrown when the pane cannot be staged, when the provider wrote the frame somewhere else,
 * and when the bytes on disk are not the ones this shot produced.
 *
 * @remarks
 * The path a screenshot call returns is the path it meant to write, so it is not evidence a file
 * exists. The file is read back through the runner's built-in `readFile` command and compared with
 * the shot itself, which is what separates a frame this run wrote from one an earlier run left
 * behind. The provider resolves `options.path` against the calling test file and returns an absolute
 * path, so the two are compared by the segments that survive resolving `.` and `..` lexically — the
 * refusal is what a provider resolving that path against a different base would trip.
 *
 * The frame covers the whole document at `options.width`, whatever `options.height` is. The
 * provider shoots the tester's body in the top-level page's own coordinates, so a document taller
 * than the pane is painted for the pane's height and the rows below it are the runner's page rather
 * than the document — a frame that reads as the surface down to the fold and as bare canvas after
 * it. The document is therefore laid out at the declared viewport first and, where it is taller
 * than that, the pane is staged a second time at the document's own height for the shot alone. One
 * layout caveat rides with that: a rule bound to the viewport height — a `vh` length, a fixed
 * footer, a full-height panel — lays out against the taller pane while the shot is taken, so a
 * surface built out of those reports its scrolled-open height rather than one screen of it.
 *
 * Omit `options.element` to shoot the whole page. The pane is staged for the frame and released
 * before this returns, on the failing path as well as the passing one, which hands the tester back
 * the viewport it had before the first staging.
 *
 * @example
 * ```ts
 * await captureFrame({ path: '../../tmp/capture/start.png', width: 390, height: 844 })
 * ```
 */
export async function captureFrame(options: FrameOptions): Promise<string> {
	try {
		await stagePane(options.width, options.height)
		const covered = document.documentElement.scrollHeight
		if (covered > options.height) await stagePane(options.width, covered)
		const shot =
			options.element === undefined
				? await page.screenshot({ path: options.path, base64: true })
				: await page.screenshot({ element: options.element, path: options.path, base64: true })
		const segments: string[] = []
		for (const segment of options.path.replaceAll('\\', '/').split('/')) {
			if (segment === '' || segment === '.') continue
			if (segment === '..') segments.pop()
			else segments.push(segment)
		}
		if (!shot.path.replaceAll('\\', '/').endsWith(segments.join('/'))) {
			throw new Error(
				`Capture frame was written to ${shot.path} where ${options.path} was asked for`,
			)
		}
		if ((await commands.readFile(shot.path, 'base64')) !== shot.base64) {
			throw new Error(`Capture frame at ${options.path} is not the one this run shot`)
		}
		return shot.path
	} finally {
		await releasePane()
	}
}

/**
 * Reads one written frame back and reports its size and the color its bottom row paints.
 *
 * @param path - The frame's absolute path, as `captureFrame` returns it.
 * @returns The frame's size in device pixels and its floor.
 * @throws Thrown when the runner cannot read the path, when the bytes there are not an image this
 * browser decodes, and when the browser hands out no 2D canvas to measure them on.
 *
 * @remarks
 * The reading comes off the written file rather than off the document that produced it, which is
 * what makes it evidence about a capture: the browser's own image decoding and an
 * `OffscreenCanvas` answer for the pixels a viewer would see, so a frame that ends on the runner's
 * canvas reports that canvas whatever the document's style resolves to. Pass the path the provider
 * resolved and `captureFrame` returned; the runner's `readFile` command resolves a relative path
 * against its own root rather than against the calling test file, so a relative path names a file
 * somewhere else.
 *
 * @example
 * ```ts
 * const reading = await readFrame(written)
 * ```
 */
export async function readFrame(path: string): Promise<FrameReading> {
	const encoded = await commands.readFile(path, 'base64').catch((cause: unknown) => {
		throw new Error(`Capture frame at ${path} could not be read`, { cause })
	})
	const image = new Image()
	image.src = `data:image/png;base64,${encoded}`
	await image.decode().catch((cause: unknown) => {
		throw new Error(`Capture frame at ${path} is not an image this browser decodes`, { cause })
	})
	const context = new OffscreenCanvas(image.width, image.height).getContext('2d')
	if (context === null) {
		throw new Error(`Capture frame at ${path} cannot be measured without a 2D canvas`)
	}
	context.drawImage(image, 0, 0)
	const row = context.getImageData(0, image.height - 1, image.width, 1).data
	const red = row[0]
	const green = row[1]
	const blue = row[2]
	const alpha = row[3]
	let single = red !== undefined && green !== undefined && blue !== undefined
	for (let pixel = 4; single && pixel < row.length; pixel += 4) {
		single =
			row[pixel] === red &&
			row[pixel + 1] === green &&
			row[pixel + 2] === blue &&
			row[pixel + 3] === alpha
	}
	return {
		width: image.width,
		height: image.height,
		floor: single ? `rgb(${String(red)}, ${String(green)}, ${String(blue)})` : undefined,
	}
}

/**
 * Expands a capture registry across every variant into the filenames a complete portfolio holds.
 *
 * @param states - The registered state names.
 * @param variants - The variants the portfolio is rendered in.
 * @returns One `<state>--<variant>.png` name per pair, each state's variants together, in registry
 * order.
 *
 * @remarks
 * The expansion is the portfolio's own definition of complete, so a duplicate in it is a registry
 * defect a proof reads directly rather than a collision discovered on disk.
 *
 * @example
 * ```ts
 * expandCaptures(['start'], [{ name: 'dark-390', width: 390, height: 844 }])
 * // ['start--dark-390.png']
 * ```
 */
export function expandCaptures(
	states: readonly string[],
	variants: readonly CaptureVariant[],
): readonly string[] {
	const files: string[] = []
	for (const state of states) {
		for (const variant of variants) files.push(`${state}--${variant.name}.png`)
	}
	return files
}
