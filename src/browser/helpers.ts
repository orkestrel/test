import type { CaptureVariant } from './types.js'
import { page, userEvent } from 'vitest/browser'
import { ACCESSIBLE_ROLES } from './constants.js'

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
		for (const element of page
			.getByRole(role, { name, exact: true, includeHidden: true })
			.elements()) {
			if (element instanceof HTMLElement && !matches.includes(element)) matches.push(element)
		}
	}
	if (matches.length === 0) {
		throw new Error(`No interactive element has the accessible name "${name}"`)
	}
	const reachable = matches.filter((element) => {
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
	})
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
	const reachable = matches.filter((element) => {
		if (!(element instanceof HTMLElement)) return false
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
	})
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
 * @throws When no visible, focus-reachable native summary has that rendered name, or several do.
 *
 * @remarks
 * Chromium exposes `<summary>` as a native disclosure rather than through an ARIA role accepted by
 * `getByRole`, so this resolver names the platform element and its rendered text directly.
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
	const reachable = matches.filter((element) => {
		const rectangle = element.getBoundingClientRect()
		return (
			element.isConnected &&
			element.checkVisibility({ checkOpacity: true, checkVisibilityCSS: true }) &&
			rectangle.width > 0 &&
			rectangle.height > 0 &&
			element.tabIndex >= 0 &&
			element.closest('[inert]') === null
		)
	})
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
	const cap =
		document.querySelectorAll<HTMLElement>('a[href], button, input, select, textarea, [tabindex]')
			.length *
			3 +
		10
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
 * @example
 * ```ts
 * readPerception('Run')
 * ```
 */
export function readPerception(name: string): string {
	const matches: HTMLElement[] = []
	for (const role of ['alert', 'alertdialog', 'dialog', 'region', 'status', 'table', 'tabpanel']) {
		for (const element of page
			.getByRole(role, { name, exact: true, includeHidden: true })
			.elements()) {
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
 * Renders trusted fixture markup into a container attached to the document.
 *
 * @param markup - The fixture markup to render.
 * @returns The attached container.
 *
 * @example
 * ```ts
 * const container = render('<button type="button">Save</button>')
 * container.remove()
 * ```
 */
export function render(markup: string): HTMLDivElement {
	const container = document.createElement('div')
	container.innerHTML = markup
	document.body.append(container)
	return container
}

/**
 * Measures the WCAG 2.x contrast ratio between an element's computed text and background colors.
 *
 * @param element - The element whose rendered text contrast to measure.
 * @returns The relative-luminance contrast ratio.
 * @throws When the browser does not expose parseable computed colors.
 *
 * @remarks
 * A transparent or translucent background resolves through the element's ancestors: every painted
 * layer from the element up to the first opaque one composites top-over-bottom onto that opaque
 * base, so a 3% surface tint reads as a tint over what shows through it rather than as a
 * full-strength paint. A translucent foreground then resolves against that effective background
 * before luminance is measured.
 *
 * Every element from the target upwards must be reachable, and at least one of them must paint:
 * the measurement throws rather than assuming a white canvas when nothing in the chain declares a
 * background color. The element itself must expose a computed foreground color — a detached
 * element exposes none, and the measurement throws rather than guessing one.
 *
 * @example
 * ```ts
 * const container = render('<p style="background: #000; color: #fff">Ready</p>')
 * contrast(requireValue(container.firstElementChild)) // 21
 * ```
 */
export function contrast(element: Element): number {
	const foreground = getComputedStyle(element).color.match(/\d+(?:\.\d+)?/g)
	if (foreground === null || foreground.length < 3) {
		throw new Error('Computed foreground color is unavailable')
	}
	const layers: number[][] = []
	let current: Element | null = element
	let opaque = false
	while (current !== null) {
		const channels = getComputedStyle(current).backgroundColor.match(/\d+(?:\.\d+)?/g)
		if (channels !== null && channels.length >= 3) {
			const layerAlpha = channels[3] === undefined ? 1 : Number(channels[3])
			if (layerAlpha > 0) {
				layers.push([...channels.slice(0, 3).map(Number), layerAlpha])
			}
			if (layerAlpha >= 1) {
				opaque = true
				break
			}
		}
		current = current.parentElement
	}
	if (layers.length === 0) throw new Error('Computed background color is unavailable')
	const base = layers[layers.length - 1]
	if (base === undefined) throw new Error('Computed background color is unavailable')
	let composed = base.slice(0, 3).map((channel) => channel / 255)
	if (!opaque) composed = [1, 1, 1]
	const start = opaque ? layers.length - 2 : layers.length - 1
	for (let index = start; index >= 0; index -= 1) {
		const layer = layers[index]
		if (layer === undefined) continue
		const layerAlpha = layer[3] ?? 1
		composed = composed.map((channel, position) => {
			const top = (layer[position] ?? 0) / 255
			return top * layerAlpha + channel * (1 - layerAlpha)
		})
	}

	const alpha = foreground[3] === undefined ? 1 : Number(foreground[3])
	const backgroundChannels = composed
	const foregroundChannels = foreground.slice(0, 3).map((channel, index) => {
		const behind = backgroundChannels[index]
		if (behind === undefined) throw new Error('Computed background channel is unavailable')
		return (Number(channel) / 255) * alpha + behind * (1 - alpha)
	})
	const foregroundLinear = foregroundChannels.map((channel) =>
		channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4,
	)
	const backgroundLinear = backgroundChannels.map((channel) =>
		channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4,
	)
	const foregroundLuminance =
		0.2126 * (foregroundLinear[0] ?? 0) +
		0.7152 * (foregroundLinear[1] ?? 0) +
		0.0722 * (foregroundLinear[2] ?? 0)
	const backgroundLuminance =
		0.2126 * (backgroundLinear[0] ?? 0) +
		0.7152 * (backgroundLinear[1] ?? 0) +
		0.0722 * (backgroundLinear[2] ?? 0)
	const lighter = Math.max(foregroundLuminance, backgroundLuminance)
	const darker = Math.min(foregroundLuminance, backgroundLuminance)
	return (lighter + 0.05) / (darker + 0.05)
}

/**
 * Collects every class token the stylesheets loaded into this document actually define.
 *
 * @returns The set of class names reachable in the shipped cascade.
 *
 * @remarks
 * The set is what an authored-class conformance check measures against, so a class no loaded
 * stylesheet defines — an invented utility, a misspelled framework name — is absent from it.
 *
 * @example
 * ```ts
 * readCascade().has('card')
 * ```
 */
export function readCascade(): ReadonlySet<string> {
	const known = new Set<string>()
	const rules: CSSRule[] = []
	for (const sheet of document.styleSheets) rules.push(...sheet.cssRules)
	while (rules.length > 0) {
		const rule = rules.pop()
		if (rule instanceof CSSGroupingRule) rules.push(...rule.cssRules)
		if (!(rule instanceof CSSStyleRule)) continue
		for (const match of rule.selectorText.matchAll(/\.([a-zA-Z][\w-]*)/g)) {
			known.add(String(match[1]))
		}
	}
	return known
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
 * Reads one resolved CSS property from a real browser element.
 *
 * @param element - The element whose resolved style to inspect.
 * @param property - The CSS property name.
 * @returns The browser's resolved property value.
 *
 * @example
 * ```ts
 * style(button, 'padding-left')
 * ```
 */
export function style(element: Element, property: string): string {
	return getComputedStyle(element).getPropertyValue(property)
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
