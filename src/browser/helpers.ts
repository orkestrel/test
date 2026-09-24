import type { WaitOptions } from '@src/core'
import type {
	CaptureVariant,
	CensusFixture,
	CensusReading,
	Color,
	ContrastFixture,
	ElementOptions,
	EscapeFixture,
	FrameOptions,
	FrameReading,
	MediaOptions,
	StateOptions,
} from './types.js'
import { isError, isString } from '@orkestrel/contract'
import {
	checkBounds,
	invokeUnchecked,
	readProperty,
	waitForAbort,
	waitForCondition,
} from '@src/core'
import { cdp, commands, page, userEvent } from 'vitest/browser'
import {
	ACCESSIBLE_ROLES,
	CANVAS_COLOR,
	CAPTURE_PANE,
	CAPTURE_STAGINGS,
	CONTENT_ROLES,
	FIELD_ROLES,
	FOCUSABLE_SELECTOR,
	HEADER_ROLES,
	IMPLICIT_ROLES,
	MEDIA_STAGE,
	POINTER_HOLD,
} from './constants.js'

/**
 * Determines whether a rectangle lies wholly outside the browser viewport.
 *
 * @param rectangle - The measured client rectangle to inspect.
 * @returns True if no part of the rectangle intersects the viewport; false otherwise.
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
 * Determines whether a person can click one element where it sits.
 *
 * @param element - The element to judge.
 * @returns True if the element is connected, visible, laid out with a non-zero box, in the
 * sequential focus order, neither disabled nor marked `aria-disabled="true"`, outside every
 * `[inert]` subtree, and inside every shown `[aria-modal="true"]` element its document carries;
 * false otherwise.
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
 * An open modal dialog takes the page behind it away, and the element's own facts cannot report
 * that: the covered control stays connected, laid out, focusable, and outside every `[inert]`
 * subtree while a pointer, a Tab, and a reader honouring `aria-modal` all stop at the dialog. So
 * this asks the document for its `[aria-modal="true"]` elements, puts each through
 * {@link isRendered}, and refuses the subject wherever a shown one does not contain it. A closed
 * dialog is hidden and excludes nothing, which is why the visibility reading is the announced one
 * rather than a bare `checkVisibility` call: a drawer parked at `visibility: hidden` is still laid
 * out. Nesting needs no separate rule, because an element inside the innermost dialog sits inside
 * every dialog around it.
 *
 * Containment follows the flat tree, so a subject inside a shadow tree is judged by its host chain
 * as well as itself and a dialog holding the host holds its shadow content too. Two arrangements
 * stay outside the read: a native `<dialog>` opened with `showModal` carries no `aria-modal`
 * attribute, and a dialog declared inside a shadow tree is not in what a document query returns.
 * Each leaves the page behind it reachable here.
 *
 * Inside a shadow tree it answers for the element's own facts, in an open root and a closed one
 * alike: the box, the focus order, `:disabled`, and `aria-disabled` are all the element's. The
 * `[inert]` ancestor is the one read that stops at the boundary, because `closest` never leaves the
 * element's own tree, so a host marked `[inert]` is invisible here. What the flat tree decides still
 * reaches the subject — a host the document does not lay out takes the element off the page and this
 * refuses it. Ask the host separately where an ancestor attribute is the subject.
 *
 * @example
 * ```ts
 * isReachable(requireValue(container.querySelector('button')))
 * ```
 */
export function isReachable(element: Element): boolean {
	if (!(element instanceof HTMLElement) && !(element instanceof SVGElement)) return false
	const chain: Element[] = [element]
	let root = element.getRootNode()
	while (root instanceof ShadowRoot) {
		chain.push(root.host)
		root = root.host.getRootNode()
	}
	const rectangle = element.getBoundingClientRect()
	return (
		element.isConnected &&
		element.checkVisibility({ checkOpacity: true, checkVisibilityCSS: true }) &&
		rectangle.width > 0 &&
		rectangle.height > 0 &&
		element.tabIndex >= 0 &&
		!element.matches(':disabled, [aria-disabled="true"]') &&
		element.closest('[inert]') === null &&
		[...element.ownerDocument.querySelectorAll('[aria-modal="true"]')].every(
			(dialog) => !isRendered(dialog) || chain.some((node) => dialog.contains(node)),
		)
	)
}

/**
 * Determines whether the accessibility tree presents one element at all.
 *
 * @param element - The element to judge.
 * @returns True if the element is presented to assistive technology and to sight; false otherwise.
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
 * Inside a shadow tree it answers for the element's own facts, in an open root and a closed one
 * alike. The `aria-hidden` ancestor is the one read that stops at the boundary, because `closest`
 * never leaves the element's own tree, so a host marked `aria-hidden="true"` is invisible here and
 * this reports `true` for a subject a reader is never told about. `checkVisibility` and the computed
 * `visibility` read the flat tree, so a host the document does not lay out still takes the element
 * off the page. Ask the host separately where an ancestor attribute is the subject.
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
 * Reads the topmost element at one element's bounding-box centre.
 *
 * @param element - The element whose bounding-box centre is the point to read.
 * @returns The element the owner document's hit test names at that point, or `undefined` where the
 * point lies outside that viewport or reaches nothing.
 *
 * @remarks
 * This reads one point and nothing else: the centre of the element's own bounding box, hit-tested
 * against `element.ownerDocument`. That point is where a thumb aimed at the middle of what it sees
 * lands, and the arrangements that take it away are the ones {@link isReachable} cannot see: a
 * sticky masthead covering a control that was scrolled to, and a wrapped inline target, whose
 * per-line rectangles leave a gap the single bounding box spans and whose centre falls in that gap
 * on the ancestor. `isReachable` reads `checkVisibility`, geometry, and the focus order, and each
 * arrangement passes all three while a click at that point misses.
 *
 * It does not predict where the installed driver clicks. `playwright-core@1.63.0` clips each
 * content quad to the viewport, drops every quad left without area, and takes the midpoint of the
 * first quad that survives — `_clickablePoint` at `playwright-core/lib/coreBundle.js:20084`,
 * reached from the locator `click` the Vitest provider delegates to. For the wrapped target the
 * first surviving quad is the first line box, so the driver aims inside the link while this centre
 * sits in the gap. Read a result as the answer for the point this names, and for no other.
 *
 * It returns the node rather than a verdict, because the node is the diagnosis: a caller narrows
 * the result, rules on `link.contains(hit)`, and names what came back — the list item rather than
 * the link, the masthead rather than the control.
 *
 * Pass {@link isRendered} and {@link isReachable} before reading, because neither answer means
 * anything on an element that failed them. An element the document does not render measures a zero
 * rectangle at the origin, and a zero-area element measures a point on its own edge; each is
 * hit-tested like any other point and names whatever paints there — the surrounding container for
 * a control clipped inside one, and the document body for a rectangle collapsed at the origin.
 * `contains` is then false, and a caller that skipped the gates reports a cover that is not there.
 *
 * A returned node carries silences of its own. A cover painted with `pointer-events: none` is
 * absent from the hit test, so the reading names the element underneath it and the caller reads
 * reachable for a cover a person can see. An element inside a shadow tree retargets, in an open
 * root and a closed one alike: the document-level hit test names the host, the inner element does
 * not contain the host, and the caller reads the element's own host as a cover. Ask
 * `element.getRootNode()` for its own `elementFromPoint` where the subject sits in a shadow tree.
 *
 * `undefined` carries one silence: a centre outside the viewport reads the same as a centre that
 * reaches nothing. {@link isOutsideViewport} does not separate them, because it asks whether the
 * whole rectangle misses the viewport while this asks where one point lands — a rectangle at
 * `left: -80` with `width: 100` has its right edge at 20, so that predicate reports false while the
 * centre at -30 reads `undefined` here. The two also measure different windows: the predicate reads
 * the global `window`, and this reads `element.ownerDocument`. Compare the centre against that
 * document's own viewport where the distinction is the subject.
 *
 * @example
 * ```ts
 * const link = requireValue(container.querySelector('a'))
 * const hit = readHit(link)
 * // False for a wrapped link whose centre sits between its line boxes.
 * hit !== undefined && link.contains(hit)
 * ```
 */
export function readHit(element: Element): Element | undefined {
	const rectangle = element.getBoundingClientRect()
	const hit = element.ownerDocument.elementFromPoint(
		rectangle.left + rectangle.width / 2,
		rectangle.top + rectangle.height / 2,
	)
	return hit ?? undefined
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
	await userEvent.click(resolveAccessibleWithin(region, role, name))
}

/**
 * Resolves one human-reachable control by role and accessible-name text inside a named region.
 *
 * @param region - The containing region's exact accessible name.
 * @param role - The control's exact ARIA role.
 * @param name - The rendered accessible-name text that identifies the control in that region.
 * @returns The one reachable element carrying that role and name inside the region.
 * @throws When the named control is absent, unreachable, or ambiguous inside the region.
 *
 * @remarks
 * The region's name is matched exactly and the control's name loosely, over a computed name that
 * includes hidden subtrees, so a glyph joins the text rather than displacing it. One pass answers
 * this: a control the region cannot reach is refused whether it is absent or hidden. This is the
 * resolver the region-scoped verbs share.
 *
 * @example
 * ```ts
 * resolveAccessibleWithin('Ledger', 'button', 'Monthly income')
 * ```
 */
export function resolveAccessibleWithin(region: string, role: string, name: string): HTMLElement {
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
	return target
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
 * Sends one DevTools protocol command through the browser provider.
 *
 * @param method - The protocol method name.
 * @param params - The protocol parameters.
 * @returns A promise resolving after the command completes, discarding its response.
 * @throws Thrown when the provider exposes no DevTools session, or the command fails.
 *
 * @example
 * ```ts
 * await sendProtocol('Emulation.setEmulatedMedia', { media: '', features: [] })
 * ```
 */
export async function sendProtocol(
	method: string,
	params: Readonly<Record<string, unknown>>,
): Promise<void> {
	let session: unknown
	let send: unknown
	try {
		session = cdp()
		send = readProperty<unknown>(session, 'send')
	} catch (cause) {
		throw new Error('Browser provider exposes no DevTools session', { cause })
	}
	if (typeof send !== 'function') {
		throw new Error('Browser provider exposes no DevTools session')
	}
	await invokeUnchecked<Promise<unknown>>(session, send, [method, params])
}

/**
 * Hovers one visible, focus-reachable control by its accessible name through the browser provider.
 *
 * @param name - The target's exact accessible name.
 * @returns A promise resolving after the pointer reaches the control.
 * @throws Thrown when the resolver refuses the target.
 *
 * @example
 * ```ts
 * await hoverAccessible('Apply')
 * ```
 */
export async function hoverAccessible(name: string): Promise<void>
/**
 * Hovers one visible, focus-reachable control by its exact ARIA role and accessible name.
 *
 * @param role - The control's exact ARIA role.
 * @param name - The target's exact accessible name.
 * @returns A promise resolving after the pointer reaches the control.
 * @throws Thrown when the resolver refuses the target.
 *
 * @example
 * ```ts
 * await hoverAccessible('tab', 'Drafts')
 * ```
 */
export async function hoverAccessible(role: string, name: string): Promise<void>
export async function hoverAccessible(first: string, second?: string): Promise<void> {
	await userEvent.hover(resolveRendered(first, second))
}

/**
 * Holds the primary pointer button on one visible, focus-reachable control by its accessible name.
 *
 * @param name - The target's exact accessible name.
 * @returns A promise resolving after the control enters its pressed state.
 * @throws Thrown when the resolver refuses the target, a pointer is already held, or the press
 * misses. A missed press that also fails to release carries the release rejection as its cause.
 *
 * @remarks
 * The centre maps through the tester iframe's painted scale into page coordinates. The `:active`
 * reading verifies delivery. A missed press releases before refusing; if that release also
 * rejects, the refusal carries it as its cause. Register {@link releasePointer} in teardown
 * before holding; release can produce a click on the pressed control. A rejected button-down send
 * leaves no hold marker. The hold itself is {@link driveHold}.
 *
 * @example
 * ```ts
 * await holdAccessible('Apply')
 * await releasePointer()
 * ```
 */
export async function holdAccessible(name: string): Promise<void>
/**
 * Holds the primary pointer button on one control by its exact ARIA role and accessible name.
 *
 * @param role - The control's exact ARIA role.
 * @param name - The target's exact accessible name.
 * @returns A promise resolving after the control enters its pressed state.
 * @throws Thrown when the resolver refuses the target, a pointer is already held, or the press
 * misses. A missed press that also fails to release carries the release rejection as its cause.
 *
 * @example
 * ```ts
 * await holdAccessible('tab', 'Drafts')
 * await releasePointer()
 * ```
 */
export async function holdAccessible(role: string, name: string): Promise<void>
export async function holdAccessible(first: string, second?: string): Promise<void> {
	await driveHold(
		() => (second === undefined ? resolveAccessible(first) : resolveAccessible(first, second)),
		second ?? first,
	)
}

/**
 * Holds the primary pointer button on one control by role and accessible-name text inside a named
 * region.
 *
 * @param region - The containing region's exact accessible name.
 * @param role - The control's exact ARIA role.
 * @param name - The rendered accessible-name text that identifies the control in that region.
 * @returns A promise resolving after the control enters its pressed state.
 * @throws Thrown when a pointer is already held, the region refuses the target, or the press
 * misses. A missed press that also fails to release carries the release rejection as its cause.
 *
 * @remarks
 * The resolution is {@link resolveAccessibleWithin} and the hold is {@link driveHold}, so a twin
 * of the same name in another region is left alone. Register {@link releasePointer} in teardown
 * before holding.
 *
 * @example
 * ```ts
 * await holdAccessibleWithin('Ledger', 'button', 'Apply')
 * await releasePointer()
 * ```
 */
export async function holdAccessibleWithin(
	region: string,
	role: string,
	name: string,
): Promise<void> {
	await driveHold(() => resolveAccessibleWithin(region, role, name), name)
}

/**
 * Holds the primary pointer button on the control a resolver returns, through the browser provider.
 *
 * @param resolve - The resolver that returns the target, called after the held-pointer refusal.
 * @param name - The target's name, as the refusals voice it.
 * @returns A promise resolving after the control enters its pressed state.
 * @throws Thrown when a pointer is already held, the resolver refuses, the target stays outside
 * the viewport after scrolling, the frame wait fails, the pressed-state read fails, or the press
 * misses. A frame wait or pressed-state read that fails releases the pointer before the refusal,
 * and a failure whose release also fails carries the release rejection as its cause.
 *
 * @remarks
 * This is the one pointer drive every hold verb shares: the held-marker refusal, a scroll that
 * brings a wholly off-viewport target into view and a refusal for one that stays outside, the
 * centre mapped through the tester iframe's painted scale into page coordinates, the trusted move
 * and press, the marker, and the frame wait and the `:active` read-back that both release before
 * refusing. The refusal precedes resolution, so a double hold is refused before an absent name is.
 *
 * @example
 * ```ts
 * await driveHold(() => resolveAccessible('Apply'), 'Apply')
 * await releasePointer()
 * ```
 */
export async function driveHold(resolve: () => HTMLElement, name: string): Promise<void> {
	const held = document.documentElement.getAttribute(POINTER_HOLD)
	if (held !== null) throw new Error(`Pointer is already held at ${held}`)
	const target = resolve()
	if (isOutsideViewport(target.getBoundingClientRect())) {
		target.scrollIntoView({ block: 'nearest', behavior: 'instant' })
	}
	const box = target.getBoundingClientRect()
	if (isOutsideViewport(box)) {
		throw new Error(`Interactive target "${name}" is unreachable after scrolling`)
	}
	const frame = window.frameElement?.getBoundingClientRect()
	const scale = frame === undefined ? 1 : frame.width / window.innerWidth
	const x = (frame?.left ?? 0) + (box.left + box.width / 2) * scale
	const y = (frame?.top ?? 0) + (box.top + box.height / 2) * scale
	await sendProtocol('Input.dispatchMouseEvent', { type: 'mouseMoved', x, y })
	await sendProtocol('Input.dispatchMouseEvent', {
		type: 'mousePressed',
		x,
		y,
		button: 'left',
		buttons: 1,
		clickCount: 1,
	})
	document.documentElement.setAttribute(POINTER_HOLD, `${String(x)}x${String(y)}`)
	try {
		await waitForFrame()
		if (!target.matches(':active'))
			throw new Error(`Interactive target "${name}" did not enter the pressed state`)
	} catch (error) {
		try {
			await releasePointer()
		} catch (cause) {
			throw new Error(error instanceof Error ? error.message : String(error), { cause })
		}
		throw error
	}
}

/**
 * Releases a held pointer and parks it at the page origin, clearing hover.
 *
 * @returns A promise resolving after the released pointer's frame paints.
 * @throws Thrown when the release or the park rejects. If both reject, the aggregate carries the
 * park rejection as its cause and the release rejection in its errors.
 *
 * @remarks
 * An idle pointer sends no button release. Calling this after an explicit release is safe in an
 * `afterEach` hook. A rejected release keeps the marker for a later retry. The pointer still moves
 * to the origin in cleanup, and a rejection there joins the aggregate described under `@throws`.
 * The provider must expose a DevTools session.
 *
 * @example
 * ```ts
 * await releasePointer()
 * ```
 */
export async function releasePointer(): Promise<void> {
	const held = document.documentElement.getAttribute(POINTER_HOLD)
	let released = held === null
	let rejection: unknown
	try {
		if (held !== null) {
			const [x, y] = held.split('x').map(Number)
			await sendProtocol('Input.dispatchMouseEvent', {
				type: 'mouseReleased',
				x,
				y,
				button: 'left',
				buttons: 0,
				clickCount: 1,
			})
			released = true
		}
	} catch (cause) {
		rejection = cause
	}
	if (released) document.documentElement.removeAttribute(POINTER_HOLD)
	try {
		await sendProtocol('Input.dispatchMouseEvent', { type: 'mouseMoved', x: 0, y: 0 })
		await waitForFrame()
	} catch (cause) {
		if (!released) {
			throw new AggregateError([rejection], isError(cause) ? cause.message : String(cause), {
				cause,
			})
		}
		throw cause
	}
	if (!released) throw rejection
}

/**
 * Replaces a named field's value through focus, select-all, deletion, and real keystrokes.
 *
 * @param name - The field's exact accessible name.
 * @param text - The text to type.
 * @returns A promise resolving after every keystroke completes.
 *
 * @remarks
 * The text is escaped against the provider's own key syntax, so a literal `{` or `[` is typed
 * rather than read as the start of a key sequence.
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
 * Sends a key sequence to whatever holds focus, and refuses to send it to nothing.
 *
 * @param keys - The sequence in the provider's own key syntax, such as `{Enter}` or `{Escape}`.
 * @returns A promise resolving after every keystroke completes.
 * @throws When the document body holds focus, or nothing does.
 *
 * @remarks
 * The refusal is the whole of what this adds over `userEvent.keyboard`. A key sent while focus sits
 * on the body reaches no control, and every assertion after it reads the surface the key never
 * touched — which is the false green a guarded keyboard step exists to catch. Bring focus about
 * first through {@link traverseAccessible}, {@link clickAccessible}, or {@link typeAccessible}, and
 * send the sequence here.
 *
 * Escaping is the caller's, because the sequence is the subject: `{` opens a key name and `[` opens
 * a code name. Reach for {@link typeAccessible} where the text is the subject and the syntax is in
 * the way.
 *
 * @example
 * ```ts
 * await traverseAccessible('Evaluate')
 * await pressKeys('{Enter}')
 * ```
 */
export async function pressKeys(keys: string): Promise<void> {
	const focused = document.activeElement
	if (focused === null || focused === document.body) {
		throw new Error(`Key sequence "${keys}" was sent with nothing focused`)
	}
	await userEvent.keyboard(keys)
}

/**
 * Reaches a named control only through natural forward Tab traversal from the current focus.
 *
 * @param name - The target's exact accessible name.
 * @returns The target after the browser moves focus to it.
 * @throws When one complete traversal cannot reach the target.
 *
 * @remarks
 * The loop is {@link driveTraversal} over {@link resolveRendered}.
 *
 * @example
 * ```ts
 * await traverseAccessible('Evaluate')
 * ```
 */
export async function traverseAccessible(name: string): Promise<HTMLElement> {
	return driveTraversal(() => resolveRendered(name), name)
}

/**
 * Reaches a control by role and accessible-name text inside a named region, only through natural
 * forward Tab traversal from the current focus.
 *
 * @param region - The containing region's exact accessible name.
 * @param role - The control's exact ARIA role.
 * @param name - The rendered accessible-name text that identifies the control in that region.
 * @returns The target after the browser moves focus to it.
 * @throws When the region refuses the target, or one complete traversal cannot reach it.
 *
 * @remarks
 * The resolution is {@link resolveAccessibleWithin} and the loop is {@link driveTraversal}, so a
 * twin of the same name earlier in the tab order is passed over rather than reached.
 *
 * @example
 * ```ts
 * await traverseAccessibleWithin('Ledger', 'button', 'Evaluate')
 * ```
 */
export async function traverseAccessibleWithin(
	region: string,
	role: string,
	name: string,
): Promise<HTMLElement> {
	return driveTraversal(() => resolveAccessibleWithin(region, role, name), name)
}

/**
 * Reaches the control a resolver returns, only through natural forward Tab traversal from the
 * current focus.
 *
 * @param resolve - The resolver that returns the target, called before the first step and again on
 * every step, because a framework may replace the node between resolution and focus arrival.
 * @param name - The target's name, as the refusal voices it.
 * @returns The target after the browser moves focus to it.
 * @throws When the resolver refuses, or one complete traversal cannot reach the target.
 *
 * @remarks
 * This is the one loop every traversal verb shares. A step counts only when focus lands on an
 * element, the traversal is over when focus revisits one, and the cap is counted off
 * {@link FOCUSABLE_SELECTOR}.
 *
 * @example
 * ```ts
 * await driveTraversal(() => resolveRendered('Evaluate'), 'Evaluate')
 * ```
 */
export async function driveTraversal(
	resolve: () => HTMLElement,
	name: string,
): Promise<HTMLElement> {
	resolve()
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
			current = resolve()
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
 * Reads the rendered text of the element that holds focus.
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
 * Reads the refusal one named target answers with, or nothing when it resolves.
 *
 * @param name - The target's exact accessible name.
 * @returns The refusal sentence {@link resolveRendered} raised, or `undefined` when it resolved.
 * @throws Whatever the resolver threw that is not an `Error`.
 *
 * @example
 * ```ts
 * readRefusal('Save changes') // undefined — the control resolves
 * readRefusal('Menu') // 'Interactive target "Menu" is not visible and focus-reachable'
 * ```
 */
export function readRefusal(name: string): string | undefined
/**
 * Reads the refusal one named target answers with under an exact role, or nothing when it resolves.
 *
 * @param role - The target's exact ARIA role.
 * @param name - The target's exact accessible name.
 * @returns The refusal sentence {@link resolveRendered} raised, or `undefined` when it resolved.
 * @throws Whatever the resolver threw that is not an `Error`.
 *
 * @remarks
 * Absent, present-but-gated, and ambiguous are different findings about an interface, and the
 * layer keeps their sentences distinct, so a journey asserting on the one it means needs the
 * sentence rather than a boolean. This fixes the resolver, translates the `unknown` a `catch` binds
 * into `string | undefined`, and rethrows anything that is not an `Error` — a value no resolver
 * raises, and one a caller reading a message would otherwise lose. `undefined` is rethrown with the
 * rest: a resolver that returned and a hostile getter that threw `undefined` are different findings,
 * which is why the `catch` is this function's own rather than a captured thrown value.
 *
 * It resolves rather than acts, so a target it reports `undefined` for is one an acting verb
 * reaches. Assert on the exact sentence: a comparison against a substring passes for a refusal
 * about a different condition.
 *
 * @example
 * ```ts
 * readRefusal('tab', 'Drafts') // undefined — the tab resolves under its role
 * ```
 */
export function readRefusal(role: string, name: string): string | undefined
export function readRefusal(first: string, second?: string): string | undefined {
	try {
		resolveRendered(first, second)
	} catch (thrown) {
		// The `catch` is local rather than routed through `captureError`, which returns the thrown
		// value and therefore reads a hostile `throw undefined` as a resolver that returned.
		if (isError(thrown)) return thrown.message
		throw thrown
	}
	return undefined
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
 * Waits until one named control announces a state, or stops announcing it.
 *
 * @param name - The control's exact accessible name.
 * @param state - The state, spelled as {@link readStates} reports it.
 * @param options - The time bounds, the abort signal, and the direction.
 * @returns The states the control announced when the wait resolved.
 * @throws The resolver's own refusal, the abort reason, or an `Error` when a bound is invalid or
 * the state is not reached within the budget.
 *
 * @example
 * ```ts
 * await clickAccessible('Pin note')
 * await waitForState('Pin note', 'pressed=true')
 * ```
 */
export function waitForState(
	name: string,
	state: string,
	options?: StateOptions,
): Promise<readonly string[]>
/**
 * Waits until one control of an exact role announces a state, or stops announcing it.
 *
 * @param role - The control's exact ARIA role.
 * @param name - The control's exact accessible name.
 * @param state - The state, spelled as {@link readStates} reports it.
 * @param options - The time bounds, the abort signal, and the direction.
 * @returns The states the control announced when the wait resolved.
 * @throws The resolver's own refusal, the abort reason, or an `Error` when a bound is invalid or
 * the state is not reached within the budget.
 *
 * @remarks
 * The control is resolved afresh on every reading, because a framework replaces the node between
 * one render and the next: the subject is the role and the name, never one element. That also means
 * the resolver's own voices reach the caller unchanged — a control that leaves the document
 * mid-wait refuses as absent rather than timing out as unannounced, which is the more useful
 * finding.
 *
 * {@link waitForCondition} owns the poll, so the bounds and the abort reason are that helper's.
 * Default budget: `1000` milliseconds. Default interval: `10` milliseconds. The exhaustion message
 * names the control and the state, and carries the last states read, so a wait that ran out says
 * what the control was announcing instead.
 *
 * This is the published replacement for a settle keyed to a framework's own class names. Where a
 * surface announces nothing, the finding is the surface's: give the control its `aria-expanded`,
 * `aria-pressed`, or `aria-busy` rather than reading the classes a stylesheet happens to use.
 *
 * @example
 * ```ts
 * await clickDisclosure('Advanced')
 * await waitForState('button', 'Advanced', 'collapsed', { absent: true })
 * ```
 */
export function waitForState(
	role: string,
	name: string,
	state: string,
	options?: StateOptions,
): Promise<readonly string[]>
export async function waitForState(
	first: string,
	second: string,
	third?: string | StateOptions,
	fourth?: StateOptions,
): Promise<readonly string[]> {
	const keyed = isString(third)
	const role = keyed ? first : undefined
	const name = keyed ? second : first
	const state = keyed ? third : second
	const options = keyed ? fourth : third
	const absent = options?.absent ?? false
	const description = `"${name}" to ${absent ? 'stop announcing' : 'announce'} "${state}"`
	let observed: readonly string[] = []
	let readings = 0
	let refused: { readonly thrown: unknown } | undefined
	try {
		await waitForCondition(
			description,
			() => {
				readings += 1
				try {
					observed = readStates(
						role === undefined ? resolveRendered(name) : resolveRendered(role, name),
					)
				} catch (thrown) {
					// The box records what the reading threw, so the `catch` beneath recognizes the
					// resolver's own finding by identity instead of by how another module worded it.
					refused = { thrown }
					throw thrown
				}
				return observed.includes(state) !== absent
			},
			options,
		)
	} catch (cause) {
		// Only the poll's own exhaustion has a last observation worth adding, and it is what remains
		// after the three values that are not it: the reading's own throw, recorded as it was raised;
		// the abort reason, which is the caller's value on the signal; and a refused bound, which is
		// raised before any reading. Each of those leaves by identity.
		if (refused !== undefined && cause === refused.thrown) throw cause
		if (cause === options?.signal?.reason) throw cause
		if (readings === 0) throw cause
		if (!isError(cause)) throw cause
		throw new Error(`${cause.message} (last states: ${JSON.stringify(observed)})`, { cause })
	}
	return observed
}

/**
 * Waits until every finite animation on one element and its subtree has stopped moving.
 *
 * @param element - The element whose own animations and descendants' animations to wait on.
 * @param options - The time bounds and the abort signal.
 * @returns A promise resolving once no finite animation is still running.
 * @throws An `Error` when the element is not in a document, when a bound is invalid, or when an
 * animation is still running at the budget; or the abort reason.
 *
 * @remarks
 * A reading taken while paint is moving reports an interpolated frame — a `background-color` at a
 * fraction of its alpha, a `color` part way between two values — that no state of the interface
 * ever paints. This waits for the paint a person sees, whichever state it settles in.
 *
 * It parks on each animation's own `finished` promise rather than re-reading on a timer, and reads
 * the list again after each completion or cancellation, so an animation a finishing one starts is
 * waited on too.
 *
 * Some animations are left out, and each exclusion is a decision rather than an oversight. An animation
 * whose effect declares infinite iterations never finishes, so a spinner that runs forever is a
 * finding about the reading rather than a wait to lengthen. A finished animation filling its target
 * stays in the list a browser reports and is already at rest. A paused animation is at rest too,
 * and nothing here resumes it.
 *
 * The bounds are the wait family's, validated the same way. Default budget: `1000` milliseconds.
 * The interval is validated for consistency with the family and is not used, because this parks on
 * the animations. A detached element is refused rather than reported settled, because an element in
 * no document runs no animation and would answer `true` to every wait.
 *
 * @example
 * ```ts
 * await clickAccessible('Dark')
 * await waitForAnimations(document.body)
 * ```
 */
export async function waitForAnimations(element: Element, options?: WaitOptions): Promise<void> {
	const budget = options?.budget ?? 1000
	const interval = options?.interval ?? 10
	checkBounds('Animation', budget, interval)
	if (!element.isConnected) throw new Error('Animation subject is not connected')
	const signal = options?.signal
	const label = readName(element)
	const subject = `${readRole(element) ?? element.localName}${label.length > 0 ? ` "${label}"` : ''}`
	const start = performance.now()
	let expired = false
	let aborted: Promise<void> | undefined
	let timer: ReturnType<typeof setTimeout> | undefined
	const expiry = new Promise<void>((resolve) => {
		timer = setTimeout(() => {
			expired = true
			resolve()
		}, budget)
	})
	try {
		while (true) {
			signal?.throwIfAborted()
			const running = element.getAnimations({ subtree: true }).filter((animation) => {
				const iterations = animation.effect?.getTiming().iterations ?? 1
				return animation.playState === 'running' && Number.isFinite(iterations)
			})
			if (running.length === 0) return
			const elapsed = performance.now() - start
			if (expired || elapsed >= budget) {
				const names = running.map((animation) => {
					if (animation instanceof CSSAnimation) return animation.animationName
					if (animation instanceof CSSTransition) return animation.transitionProperty
					return animation.id
				})
				throw new Error(
					`Animation "${subject}" did not settle within ${budget}ms (waited ${elapsed}ms): ${names.join(', ')}`,
				)
			}
			const pending: Array<Promise<unknown>> = running.map((animation) =>
				animation.finished.catch(() => undefined),
			)
			pending.push(expiry)
			if (signal !== undefined) {
				// Installed on the first park rather than up front, so a wait that finds nothing running
				// leaves no listener on a signal the caller still owns.
				aborted ??= waitForAbort(signal)
				pending.push(aborted)
			}
			await Promise.race(pending)
		}
	} finally {
		if (timer !== undefined) clearTimeout(timer)
	}
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
 * returns its fixture through it, and the {@link parseCSSColor} helper probes through
 * `mount(build('span'))`. A bare `append` call breaks each of those call sites.
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
 * Renders one fixture into the document from trusted markup.
 *
 * @param markup - The fixture markup to parse.
 * @returns The attached container holding the fixture's own nodes.
 *
 * @remarks
 * The class list is required in the tag form, which is what keeps the two forms apart: a
 * one-argument call is always markup.
 *
 * This form parses `markup` into a fresh container and returns that container, so the fixture's own
 * nodes are its children. It attaches to `document.body` and records nothing, so removal is the
 * caller's, exactly as it is for {@link mount}.
 *
 * @example
 * ```ts
 * const container = render('<button type="button">Save</button>')
 * container.remove()
 * ```
 */
export function render(markup: string): HTMLDivElement
/**
 * Renders one fixture into the document from a tag name and its class list.
 *
 * @param tag - The HTML tag name to create.
 * @param classes - The class list to place on the created element.
 * @returns The attached element itself, typed as exactly that tag.
 *
 * @remarks
 * The class list is required in the tag form, which is what keeps the two forms apart: a
 * one-argument call is always markup. A tag with no classes is `mount(build(tag))`.
 *
 * This form returns the element itself rather than a container. It attaches to `document.body` and
 * records nothing, so removal is the caller's, exactly as it is for {@link mount}.
 *
 * @example
 * ```ts
 * const panel = render('section', 'surface muted')
 * panel.remove()
 * ```
 */
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
 * Converts normalized encoded sRGB channels to the clipped paint scale.
 *
 * @param red - The encoded red channel, with `1` representing full intensity.
 * @param green - The encoded green channel.
 * @param blue - The encoded blue channel.
 * @param alpha - The opacity. Default: `1`.
 * @returns Frozen straight sRGB channels clipped to 0–255, with alpha clipped to 0–1.
 *
 * @example
 * ```ts
 * convertSRGB(1.2, -0.1, 0.5) // [255, 0, 127.5, 1]
 * ```
 */
export function convertSRGB(red: number, green: number, blue: number, alpha = 1): Color {
	return Object.freeze([
		Math.min(255, Math.max(0, red * 255)),
		Math.min(255, Math.max(0, green * 255)),
		Math.min(255, Math.max(0, blue * 255)),
		Math.min(1, Math.max(0, alpha)),
	])
}

/**
 * Converts linear sRGB channels to encoded, clipped paint channels.
 *
 * @param red - The linear red channel on the normalized scale.
 * @param green - The linear green channel.
 * @param blue - The linear blue channel.
 * @param alpha - The opacity. Default: `1`.
 * @returns Frozen straight sRGB channels clipped to 0–255, with alpha clipped to 0–1.
 *
 * @remarks
 * Applies the CSS Color 4 extended sRGB transfer function before clipping.
 *
 * @example
 * ```ts
 * convertLinearSRGB(0, 0, 0) // [0, 0, 0, 1]
 * ```
 */
export function convertLinearSRGB(red: number, green: number, blue: number, alpha = 1): Color {
	const [encodedRed = 0, encodedGreen = 0, encodedBlue = 0] = [red, green, blue].map((channel) =>
		Math.abs(channel) <= 0.0031308
			? 12.92 * channel
			: Math.sign(channel) * (1.055 * Math.abs(channel) ** (1 / 2.4) - 0.055),
	)
	return convertSRGB(encodedRed, encodedGreen, encodedBlue, alpha)
}

/**
 * Converts D65 XYZ coordinates to clipped sRGB paint channels.
 *
 * @param x - The normalized X coordinate.
 * @param y - The normalized Y coordinate.
 * @param z - The normalized Z coordinate.
 * @param alpha - The opacity. Default: `1`.
 * @returns Frozen straight sRGB channels clipped to 0–255, with alpha clipped to 0–1.
 *
 * @remarks
 * Uses the CSS Color 4 XYZ D65 to linear sRGB matrix, then the sRGB transfer function.
 *
 * @example
 * ```ts
 * convertXYZD65(0, 0, 0) // [0, 0, 0, 1]
 * ```
 */
export function convertXYZD65(x: number, y: number, z: number, alpha = 1): Color {
	return convertLinearSRGB(
		(12831 / 3959) * x - (329 / 214) * y - (1974 / 3959) * z,
		(-851781 / 878810) * x + (1648619 / 878810) * y + (36519 / 878810) * z,
		(705 / 12673) * x - (2585 / 12673) * y + (705 / 667) * z,
		alpha,
	)
}

/**
 * Converts D50 XYZ coordinates to clipped sRGB paint channels.
 *
 * @param x - The normalized X coordinate relative to D50.
 * @param y - The normalized Y coordinate relative to D50.
 * @param z - The normalized Z coordinate relative to D50.
 * @param alpha - The opacity. Default: `1`.
 * @returns Frozen straight sRGB channels clipped to 0–255, with alpha clipped to 0–1.
 *
 * @remarks
 * Applies the CSS Color 4 Bradford adaptation from D50 to D65 before converting to sRGB.
 *
 * @example
 * ```ts
 * convertXYZD50(0, 0, 0) // [0, 0, 0, 1]
 * ```
 */
export function convertXYZD50(x: number, y: number, z: number, alpha = 1): Color {
	return convertXYZD65(
		0.955473421488075 * x - 0.02309845494876471 * y + 0.06325924320057072 * z,
		-0.0283697093338637 * x + 1.0099953980813041 * y + 0.021041441191917323 * z,
		0.012314014864481998 * x - 0.020507649298898964 * y + 1.330365926242124 * z,
		alpha,
	)
}

/**
 * Converts OKLab coordinates to clipped sRGB paint channels.
 *
 * @param lightness - The OKLab lightness on the 0–1 scale.
 * @param a - The signed green-to-red axis.
 * @param b - The signed blue-to-yellow axis.
 * @param alpha - The opacity. Default: `1`.
 * @returns Frozen straight sRGB channels clipped to 0–255, with alpha clipped to 0–1.
 *
 * @remarks
 * Cubes the transformed cone responses before applying the linear sRGB matrix.
 *
 * @example
 * ```ts
 * convertOKLab(0, 0, 0) // [0, 0, 0, 1]
 * ```
 */
export function convertOKLab(lightness: number, a: number, b: number, alpha = 1): Color {
	const long = (lightness + 0.3963377773761749 * a + 0.2158037573099136 * b) ** 3
	const medium = (lightness - 0.1055613458156586 * a - 0.0638541728258133 * b) ** 3
	const short = (lightness - 0.0894841775298119 * a - 1.2914855480194092 * b) ** 3
	return convertLinearSRGB(
		4.076741661347994 * long - 3.307711590408193 * medium + 0.230969929060199 * short,
		-1.2684380040921763 * long + 2.6097574006633715 * medium - 0.3413193965711952 * short,
		-0.0041960865418371 * long - 0.7034186144594493 * medium + 1.7076147010012863 * short,
		alpha,
	)
}

/**
 * Converts CIE Lab coordinates relative to D50 to clipped sRGB paint channels.
 *
 * @param lightness - The CIE lightness on the 0–100 scale.
 * @param a - The signed green-to-red axis.
 * @param b - The signed blue-to-yellow axis.
 * @param alpha - The opacity. Default: `1`.
 * @returns Frozen straight sRGB channels clipped to 0–255, with alpha clipped to 0–1.
 *
 * @remarks
 * Resolves the CSS Color 4 Lab curve against the D50 white point before adapting to D65.
 *
 * @example
 * ```ts
 * convertLab(0, 0, 0) // [0, 0, 0, 1]
 * ```
 */
export function convertLab(lightness: number, a: number, b: number, alpha = 1): Color {
	const luminance = (lightness + 16) / 116
	const [x = 0, y = 0, z = 0] = [luminance + a / 500, luminance, luminance - b / 200].map(
		(channel) => (channel ** 3 > 216 / 24389 ? channel ** 3 : (116 * channel - 16) / (24389 / 27)),
	)
	return convertXYZD50(x * (0.3457 / 0.3585), y, z * ((1 - 0.3457 - 0.3585) / 0.3585), alpha)
}

/**
 * Converts encoded Display P3 channels to clipped sRGB paint channels.
 *
 * @param red - The normalized encoded red channel.
 * @param green - The normalized encoded green channel.
 * @param blue - The normalized encoded blue channel.
 * @param alpha - The opacity. Default: `1`.
 * @returns Frozen straight sRGB channels clipped to 0–255, with alpha clipped to 0–1.
 *
 * @remarks
 * Decodes the extended sRGB transfer curve and uses the CSS Color 4 P3 to XYZ D65 matrix.
 *
 * @example
 * ```ts
 * convertDisplayP3(0, 0, 0) // [0, 0, 0, 1]
 * ```
 */
export function convertDisplayP3(red: number, green: number, blue: number, alpha = 1): Color {
	const [r = 0, g = 0, b = 0] = [red, green, blue].map((channel) =>
		Math.abs(channel) <= 0.04045
			? channel / 12.92
			: Math.sign(channel) * ((Math.abs(channel) + 0.055) / 1.055) ** 2.4,
	)
	return convertXYZD65(
		(608311 / 1250200) * r + (189793 / 714400) * g + (198249 / 1000160) * b,
		(35783 / 156275) * r + (247089 / 357200) * g + (198249 / 2500400) * b,
		(32229 / 714400) * g + (5220557 / 5000800) * b,
		alpha,
	)
}

/**
 * Converts encoded A98 RGB channels to clipped sRGB paint channels.
 *
 * @param red - The normalized encoded red channel.
 * @param green - The normalized encoded green channel.
 * @param blue - The normalized encoded blue channel.
 * @param alpha - The opacity. Default: `1`.
 * @returns Frozen straight sRGB channels clipped to 0–255, with alpha clipped to 0–1.
 *
 * @remarks
 * Decodes the signed 563/256 power curve and uses the CSS Color 4 A98 RGB to XYZ D65 matrix.
 *
 * @example
 * ```ts
 * convertA98RGB(0, 0, 0) // [0, 0, 0, 1]
 * ```
 */
export function convertA98RGB(red: number, green: number, blue: number, alpha = 1): Color {
	const [r = 0, g = 0, b = 0] = [red, green, blue].map(
		(channel) => Math.sign(channel) * Math.abs(channel) ** (563 / 256),
	)
	return convertXYZD65(
		(573536 / 994567) * r + (263643 / 1420810) * g + (187206 / 994567) * b,
		(591459 / 1989134) * r + (6239551 / 9945670) * g + (374412 / 4972835) * b,
		(53769 / 1989134) * r + (351524 / 4972835) * g + (4929758 / 4972835) * b,
		alpha,
	)
}

/**
 * Converts encoded ProPhoto RGB channels to clipped sRGB paint channels.
 *
 * @param red - The normalized encoded red channel.
 * @param green - The normalized encoded green channel.
 * @param blue - The normalized encoded blue channel.
 * @param alpha - The opacity. Default: `1`.
 * @returns Frozen straight sRGB channels clipped to 0–255, with alpha clipped to 0–1.
 *
 * @remarks
 * Decodes the signed ProPhoto curve, converts to XYZ D50, and adapts to D65 before clipping.
 *
 * @example
 * ```ts
 * convertProPhotoRGB(0, 0, 0) // [0, 0, 0, 1]
 * ```
 */
export function convertProPhotoRGB(red: number, green: number, blue: number, alpha = 1): Color {
	const [r = 0, g = 0, b = 0] = [red, green, blue].map((channel) =>
		Math.abs(channel) <= 16 / 512 ? channel / 16 : Math.sign(channel) * Math.abs(channel) ** 1.8,
	)
	return convertXYZD50(
		0.7977666449006423 * r + 0.13518129740053308 * g + 0.0313477341283922 * b,
		0.2880748288194013 * r + 0.711835234241873 * g + 0.00008993693872564 * b,
		0.8251046025104602 * b,
		alpha,
	)
}

/**
 * Converts encoded Rec. 2020 channels to clipped sRGB paint channels.
 *
 * @param red - The normalized encoded red channel.
 * @param green - The normalized encoded green channel.
 * @param blue - The normalized encoded blue channel.
 * @param alpha - The opacity. Default: `1`.
 * @returns Frozen straight sRGB channels clipped to 0–255, with alpha clipped to 0–1.
 *
 * @remarks
 * Uses the piecewise Rec. 2020 transfer curve Chromium computes and the CSS Color 4 XYZ matrix.
 *
 * @example
 * ```ts
 * convertRec2020(0, 0, 0) // [0, 0, 0, 1]
 * ```
 */
export function convertRec2020(red: number, green: number, blue: number, alpha = 1): Color {
	const [r = 0, g = 0, b = 0] = [red, green, blue].map((channel) =>
		Math.abs(channel) < 0.018053968510807 * 4.5
			? channel / 4.5
			: Math.sign(channel) *
				((Math.abs(channel) + 1.09929682680944 - 1) / 1.09929682680944) ** (1 / 0.45),
	)
	return convertXYZD65(
		(63426534 / 99577255) * r + (20160776 / 139408157) * g + (47086771 / 278816314) * b,
		(26158966 / 99577255) * r + (472592308 / 697040785) * g + (8267143 / 139408157) * b,
		(19567812 / 697040785) * g + (295819943 / 278816314) * b,
		alpha,
	)
}

/**
 * Parses computed CSS Color 4 values into clipped straight sRGB channels.
 *
 * @param value - A computed `rgb()`, `rgba()`, `oklab()`, `oklch()`, `lab()`, `lch()`, or `color()` value.
 * @returns Frozen channels, or `undefined` for an unsupported syntax or non-finite channel.
 *
 * @remarks
 * Reads signed channels, scientific notation, percentage lightness, degree hues, and `none` as
 * zero. The `color()` spaces are `srgb`, `srgb-linear`, `display-p3`, `a98-rgb`, `prophoto-rgb`,
 * `rec2020`, `xyz`, `xyz-d50`, and `xyz-d65`. Conversion uses the CSS Color 4 matrices and white
 * point adaptation, then clips each encoded sRGB channel to 0–255 rather than gamut-mapping it.
 * Alpha is clipped to 0–1. Keywords, hex colors, unresolved expressions, and non-finite calculations
 * such as `color(srgb calc(infinity) 0 0)` remain unreadable; use {@link parseCSSColor} to resolve
 * ordinary authored expressions through the cascade.
 *
 * @example
 * ```ts
 * parseColor('rgba(255, 255, 255, 0.5)') // [255, 255, 255, 0.5]
 * parseColor('rebeccapurple') // undefined
 * ```
 */
export function parseColor(value: string): Color | undefined {
	const match = /^(?<syntax>rgba?|oklab|oklch|lab|lch|color)\((?<body>[^()]*)\)$/u.exec(value)
	if (match?.groups === undefined) return undefined
	const { syntax, body = '' } = match.groups
	const legacy = syntax === 'rgb' || syntax === 'rgba'
	const polar = syntax === 'oklch' || syntax === 'lch'
	const perceptual =
		syntax === 'oklab' || syntax === 'oklch' || syntax === 'lab' || syntax === 'lch'
	const tokens = body.trim().split(legacy && body.includes(',') ? /\s*,\s*/u : /\s*\/\s*|\s+/u)
	const space = syntax === 'color' ? tokens.shift() : syntax
	if (tokens.length !== 3 && tokens.length !== 4) return undefined
	if (!legacy && body.includes(',')) return undefined
	if (body.split('/').length > 2) return undefined
	if (body.includes('/') && (tokens.length !== 4 || !/\/\s*[^\s/]+\s*$/u.test(body)))
		return undefined
	if (!(legacy && body.includes(',')) && tokens.length === 4 && !body.includes('/'))
		return undefined
	const parts = tokens.map((token, index) => {
		if (token === 'none') return 0
		const part = /^(?<number>[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?)(?<unit>%|deg)?$/u.exec(
			token,
		)
		if (part?.groups === undefined) return Number.NaN
		const number = Number(part.groups.number)
		const unit = part.groups.unit
		if (unit === 'deg') return polar && index === 2 ? number : Number.NaN
		if (unit !== '%') return number
		if (index === 3 || syntax === 'color') return number / 100
		if (legacy) return (number * 255) / 100
		if (index === 0) return syntax === 'oklab' || syntax === 'oklch' ? number / 100 : number
		return Number.NaN
	})
	const [first, second, third, alpha = 1] = parts
	if (first === undefined || second === undefined || third === undefined) return undefined
	if (!parts.every((part) => Number.isFinite(part))) return undefined
	if (legacy) return convertSRGB(first / 255, second / 255, third / 255, alpha)
	if (perceptual) {
		const lightness = Math.max(
			0,
			Math.min(syntax === 'oklab' || syntax === 'oklch' ? 1 : 100, first),
		)
		const a = polar ? Math.max(0, second) * Math.cos((third * Math.PI) / 180) : second
		const b = polar ? Math.max(0, second) * Math.sin((third * Math.PI) / 180) : third
		return syntax === 'oklab' || syntax === 'oklch'
			? convertOKLab(lightness, a, b, alpha)
			: convertLab(lightness, a, b, alpha)
	}
	switch (space) {
		case 'srgb':
			return convertSRGB(first, second, third, alpha)
		case 'srgb-linear':
			return convertLinearSRGB(first, second, third, alpha)
		case 'display-p3':
			return convertDisplayP3(first, second, third, alpha)
		case 'a98-rgb':
			return convertA98RGB(first, second, third, alpha)
		case 'prophoto-rgb':
			return convertProPhotoRGB(first, second, third, alpha)
		case 'rec2020':
			return convertRec2020(first, second, third, alpha)
		case 'xyz':
		case 'xyz-d65':
			return convertXYZD65(first, second, third, alpha)
		case 'xyz-d50':
			return convertXYZD50(first, second, third, alpha)
		default:
			return undefined
	}
}

/**
 * Resolves any CSS color expression to straight sRGB channels, by asking the browser.
 *
 * @param value - Any value the `color` property accepts: a keyword, a hex triple, a `var()`
 * reference, a `color-mix()`, or a computed CSS Color 4 value.
 * @returns The resolved color's channels, or `undefined` when the CSSOM refuses the value or the
 * computed result names no color {@link parseColor} speaks.
 *
 * @remarks
 * This is the live half of the pair {@link parseColor} opens. `parseColor` reads text and speaks
 * only the computed syntaxes a cascade hands back; this stages a probe element, hands it to the real
 * cascade, and reads back what the engine computed — which is the only way a keyword, a hex triple,
 * or a `var()` reference becomes channels at all. The read itself goes through `parseColor`, so both
 * halves agree on what a computed value means.
 * Modern perceptual and predefined RGB/XYZ spaces resolve through that parser's conversions;
 * out-of-gamut sRGB channels are clipped to 0–255 after conversion.
 *
 * The probe is mounted, because an unmounted element inherits nothing and a `var()` reference to a
 * token declared on `:root` would resolve to the initial value instead. It is removed in a `finally`,
 * so a value that throws on the way through leaves no node behind.
 *
 * Refusal is the CSSOM's: an expression it will not parse leaves the probe's inline `color` empty
 * and this returns `undefined`. A `var()` naming an undeclared custom property is not refused,
 * because the cascade accepts it and computes the inherited color, so a test that means to catch a
 * missing token asserts on {@link readToken} rather than on this.
 *
 * @example
 * ```ts
 * parseCSSColor('rebeccapurple') // [102, 51, 153, 1]
 * parseCSSColor('not-a-color') // undefined
 * ```
 */
export function parseCSSColor(value: string): Color | undefined {
	const probe = mount(build('span'))
	try {
		probe.style.color = value
		if (probe.style.color === '') return undefined
		return parseColor(readStyle(probe, 'color'))
	} finally {
		probe.remove()
	}
}

/**
 * Determines whether two colors render the same, within the rounding a browser does.
 *
 * @param first - A CSS color expression or an already-parsed color.
 * @param second - A CSS color expression or an already-parsed color.
 * @returns True if every channel and the alpha agree within the tolerance; false otherwise,
 * including when either side names no readable color.
 *
 * @remarks
 * Each string side is resolved through {@link parseCSSColor}, so a keyword, a token reference, and the
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
 * matchesColor('rebeccapurple', 'rgb(102, 51, 153)') // true
 * matchesColor('red', [0, 0, 255, 1]) // false
 * ```
 */
export function matchesColor(first: string | Color, second: string | Color): boolean {
	const left = typeof first === 'string' ? parseCSSColor(first) : first
	const right = typeof second === 'string' ? parseCSSColor(second) : second
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
 * Collects readable background color layers and refuses an unreadable painted layer.
 *
 * @param element - The element to walk up from.
 * @returns Every layer the walk paints, the element's own first and the deepest last.
 * @throws Thrown when a painted background color is unreadable; the error names the element and
 * its computed value.
 *
 * @remarks
 * A surface token paints one ancestor while every element between it and the text paints nothing,
 * so a backdrop is found by walking up rather than by reading the element's own `background-color`,
 * which is almost always transparent. A fully transparent layer paints nothing and is left out, and
 * the walk stops at the first fully opaque layer, because nothing above that layer is visible.
 * Legacy and modern CSS Color 4 values resolve through {@link parseColor}, with sRGB channels
 * clipped after conversion. Non-finite calculations such as `color(srgb calc(infinity) 0 0)` are
 * deliberately unreadable. An unreadable value with an explicit zero alpha paints nothing and is
 * skipped. An empty detached-element reading paints nothing too. Background images remain outside
 * this color reader.
 *
 * The stack is what tells a resolved backdrop from an assumed one: the walk reached an opaque
 * surface exactly when its last layer's alpha is `1`. {@link readContrast} refuses on that reading,
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
		const computed = getComputedStyle(node).backgroundColor
		if (computed === '') continue
		const layer = parseColor(computed)
		if (layer === undefined) {
			if (/\/\s*(?:0(?:\.0*)?|none)\s*\)$/u.test(computed)) continue
			throw new Error(
				`Computed background color is unreadable on ${node.localName}${node.id === '' ? '' : `#${node.id}`}: ${computed}`,
			)
		}
		if (layer[3] === 0) continue
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
 * @throws Thrown when the backdrop contains an unreadable painted color layer.
 *
 * @remarks
 * The layers {@link readLayers} collects composite top-over-bottom onto the floor, so a 3% surface
 * tint reads as a tint over what shows through it rather than as a full-strength paint.
 * Those layers include the modern CSS Color 4 spaces, converted and clipped to sRGB by
 * {@link parseColor}; an unreadable painted layer refuses the entire reading.
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
 * — when the walk from the element upwards reaches no opaque layer. An unreadable painted
 * background layer throws even when a floor is supplied.
 *
 * @remarks
 * A transparent or translucent background resolves through the element's ancestors: every painted
 * layer from the element up to the first opaque one composites top-over-bottom onto that opaque
 * base, so a 3% surface tint reads as a tint over what shows through it rather than as a
 * full-strength paint. A translucent foreground then resolves against that effective background
 * before luminance is measured.
 * Text and background colors can use the modern CSS Color 4 spaces {@link parseColor} reads;
 * each is converted to sRGB and clipped before composition and luminance measurement.
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
 * readContrast(requireValue(container.firstElementChild)) // 21
 * readContrast(requireValue(container.firstElementChild), CANVAS_COLOR) // 21
 * ```
 */
export function readContrast(element: Element, floor?: Color): number {
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
 * @throws Thrown when the focused control's backdrop contains an unreadable painted color layer.
 *
 * @remarks
 * This reads and never acts. Focus arrives through the published verbs — `traverseAccessible`,
 * `userEvent.keyboard` from `vitest/browser`, a real click — and this measures what the browser
 * painted once it landed. A control that is not matching `:focus-visible` when the call is made
 * reports nothing, because no measurement taken then would be about focus.
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
 * Outline and shadow colors include `oklch()`, `oklab()`, `lab()`, `lch()`, and predefined
 * `color()` spaces. Each readable color converts to clipped sRGB through {@link parseColor}, and
 * the result remains a contrast ratio rather than a ring width.
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
	const shadow = parseColor(
		/(?:rgba?|color|oklab|oklch|lab|lch)\([^)]*\)/u.exec(declared.boxShadow)?.[0] ?? '',
	)
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
export function readCensus(root: ParentNode): CensusReading {
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
 * element resolves to: {@link readStyle} reads the winner, and a rule this finds may be overridden by
 * another. Assert on this where the subject is the stylesheet, and on `readStyle` where the subject is
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
 * Reads one resolved CSS property from a real browser element or a named pseudo-element.
 *
 * @param element - The element whose resolved style to inspect.
 * @param property - The CSS property name, registered or custom.
 * @param pseudo - The pseudo-element selector. Omit it to read the element itself.
 * @returns The browser's resolved property value, trimmed; an empty string when the element resolves
 * none.
 * @throws Thrown when the pseudo argument lacks the `::` prefix or the engine does not support it.
 *
 * @remarks
 * The value is trimmed, so what comes back is the value and never the whitespace around it. Internal
 * whitespace is kept: `--shadow: 0 0 2px` reads back with its spaces.
 *
 * @example
 * ```ts
 * readStyle(button, 'padding-left')
 * ```
 */
export function readStyle(element: Element, property: string, pseudo?: string): string {
	if (pseudo !== undefined) {
		if (!pseudo.startsWith('::')) {
			throw new Error(`Pseudo-element "${pseudo}" must start with "::"`)
		}
		if (!CSS.supports(`selector(${pseudo})`)) {
			throw new Error(`Pseudo-element "${pseudo}" is not one this engine exposes`)
		}
	}
	return getComputedStyle(element, pseudo).getPropertyValue(property).trim()
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
 * Reads one resolved CSS length as a number of pixels.
 *
 * @param element - The element whose resolved style to inspect.
 * @param property - The CSS property name, registered or custom.
 * @param pseudo - The pseudo-element selector. Omit it to read the element itself.
 * @returns The leading numeric part of the resolved value, and `0` when it carries none.
 * @throws Thrown when the pseudo argument lacks the `::` prefix or the engine does not support it.
 *
 * @remarks
 * A resolved length is text with a unit — `'12px'` — so this reads the number in front of the unit
 * and discards the rest. The unit is not checked: the resolved value of a length is in pixels in
 * every case a browser hands back, and a property that resolves to something else is the caller's
 * mistake rather than this reader's.
 *
 * An unparsable value reads as `0` rather than as absence, because every caller of this is measuring
 * and `'auto'`, `'none'`, and `''` each contribute no pixels to what a reader sees. Where the
 * distinction matters, read the text with {@link readStyle} instead.
 *
 * @example
 * ```ts
 * readPixels(button, 'padding-left') // 12
 * readPixels(button, 'width') // 0 when the width resolves to `auto`
 * ```
 */
export function readPixels(element: Element, property: string, pseudo?: string): number {
	const measured = Number.parseFloat(readStyle(element, property, pseudo))
	return Number.isFinite(measured) ? measured : 0
}

/**
 * Measures the row a clipping element cuts its content off at, in document coordinates.
 *
 * @param element - The element to read.
 * @returns The element's overflow clip edge in CSS pixels from the document's top, or the
 * `undefined` value for an element that clips nothing, as the {@link clipsOverflow} helper reports
 * it.
 *
 * @remarks
 * An `overflow-y` value of the `hidden` keyword, the `auto` keyword, or the `scroll` keyword stops
 * the content at the padding box, whatever the element's `overflow-clip-margin` value says. A
 * `clip` overflow and a paint containment over a `visible` overflow start the edge from the box the
 * computed `overflow-clip-margin` value names (the `border-box` keyword, the `padding-box` keyword,
 * or the `content-box` keyword, and the padding box where the value names none) and expand it by
 * the length the {@link readClipMargin} helper reads. So a bordered or padded frame whose clip
 * margin names no box ends at its padding box plus the margin, where the browser stops painting its
 * content, rather than at its border box plus the margin. The computed value drops the
 * `padding-box` keyword because it is the default, which is why a value carrying no keyword reads
 * from the padding box.
 *
 * The edge is the bottom one, because that is the edge a reading of the document's height meets.
 *
 * @example
 * ```ts
 * const edge = readClipEdge(frame)
 * if (edge !== undefined && edge < bottom) bottom = edge
 * ```
 */
export function readClipEdge(element: Element): number | undefined {
	if (!clipsOverflow(element)) return undefined
	const border = element.getBoundingClientRect().bottom + window.scrollY
	const padding = border - readPixels(element, 'border-bottom-width')
	const overflow = readStyle(element, 'overflow-y')
	if (overflow !== 'clip' && overflow !== 'visible') return padding
	const margin = readStyle(element, 'overflow-clip-margin')
	if (margin.includes('border-box')) return border + readClipMargin(element)
	if (margin.includes('content-box')) {
		return padding - readPixels(element, 'padding-bottom') + readClipMargin(element)
	}
	return padding + readClipMargin(element)
}

/**
 * Measures how far past its own box a clipping element lets its content show.
 *
 * @param element - The element to read.
 * @returns The computed `overflow-clip-margin` length in CSS pixels where the element's computed
 * `overflow-y` value is the `clip` keyword or its clip comes from paint containment alone, and zero
 * for every other element.
 *
 * @remarks
 * The `overflow-clip-margin` property expands the clip edge of a `clip` overflow and of a paint
 * containment over a `visible` overflow and has no effect on an `overflow-y` value of the `hidden`
 * keyword, the `auto` keyword, or the `scroll` keyword, whose content stops at the padding box
 * whatever the property says. The computed value can carry a visual-box keyword beside the length,
 * so the length is read wherever it sits in the value.
 *
 * @example
 * ```ts
 * readClipMargin(build('div', { attributes: { style: 'overflow: clip; overflow-clip-margin: 20px' } })) // 20
 * ```
 */
export function readClipMargin(element: Element): number {
	const overflow = readStyle(element, 'overflow-y')
	if (overflow !== 'clip' && !(overflow === 'visible' && clipsOverflow(element))) return 0
	const length = /(-?\d*\.?\d+)px/u.exec(readStyle(element, 'overflow-clip-margin'))
	return length === null ? 0 : Number.parseFloat(length[1] ?? '0')
}

/**
 * Reports whether an element clips its descendants' overflow.
 *
 * @param element - The element to read.
 * @returns True if the element's computed `overflow-y` value is other than the `visible` keyword or
 * its computed `contain` value carries paint containment (the `paint` keyword, the `content`
 * keyword, or the `strict` keyword); false otherwise.
 *
 * @remarks
 * A scroll container (the `auto` keyword or the `scroll` keyword) keeps what overflows inside its
 * own scrollable area, and a clipping one (the `hidden` keyword or the `clip` keyword) and a
 * paint-contained one discard it, so in every case the rows a descendant lays out past the
 * element's clip edge, which the {@link readClipEdge} helper measures, are no part of the
 * document's content edge. The vertical axis alone decides, because the `overflow-x` property and
 * the `overflow-y` property compute independently under the `clip` keyword, and a horizontal clip
 * ends nothing below the element.
 *
 * @example
 * ```ts
 * clipsOverflow(build('div', { attributes: { style: 'overflow: clip' } })) // true
 * clipsOverflow(build('div')) // false
 * ```
 */
export function clipsOverflow(element: Element): boolean {
	return (
		readStyle(element, 'overflow-y') !== 'visible' ||
		/\b(?:paint|content|strict)\b/u.test(readStyle(element, 'contain'))
	)
}

/**
 * Measures the row the document's own content ends on, in document coordinates.
 *
 * @returns The content edge, rounded up to a whole row.
 *
 * @remarks
 * The body's box is not the document's height: it is the larger of the content and the pane. A pane
 * taller than the document stretches it, and `document.body.getBoundingClientRect()`,
 * `body.scrollHeight`, `body.offsetHeight`, and `documentElement.scrollHeight` all read that pane
 * back rather than the content under it. So a caller that has staged a pane taller than the
 * document cannot find its way down again from any of them. This reading can, because it is taken
 * over the elements inside the body rather than over the box around them: a document of fixed
 * content answers the same number under a short pane and a tall one, and a document laid out
 * against the viewport answers what that viewport actually laid out.
 *
 * Each element contributes its client rectangle's bottom edge in document coordinates plus its own
 * bottom margin, which sits outside that rectangle, and the largest contribution wins. An ancestor
 * that clips its overflow caps the contribution at that ancestor's clip edge, which the
 * {@link readClipEdge} helper measures, because the rows a descendant lays out past a clipping
 * frame are cut, scrolled, or discarded rather than added to the document: a viewport-height
 * specimen inside a bounded frame ends, for this reading, where the frame ends, so a taller pane
 * does not read back as a taller document. The clip edge of a `clip` overflow, and of a paint
 * containment over a `visible` overflow, is read from the box the frame's `overflow-clip-margin`
 * value selects, the padding box by default, and expanded by that value's length; a hidden or
 * scrolling frame stops at its padding box. The frame's own contribution stays its border-box
 * bottom plus its bottom margin, so a bordered frame still ends the reading under its border.
 * Taking the largest is what handles a collapsed margin without asking whether it collapsed: a
 * child margin that collapses out through its parent is counted once, at the child, and one the
 * parent's padding holds in is counted once, at the parent. The body's and the root's own bottom
 * padding and margin sit under every child rather than beside them, so they are added after the
 * walk.
 *
 * The sum is rounded up because a box can end part way through a row and a frame cannot hold part
 * of one.
 *
 * @example
 * ```ts
 * const covered = measureContent()
 * ```
 */
export function measureContent(): number {
	let edge = 0
	for (const element of document.body.querySelectorAll('*')) {
		let bottom =
			element.getBoundingClientRect().bottom + window.scrollY + readPixels(element, 'margin-bottom')
		for (
			let frame = element.parentElement;
			frame !== null && frame !== document.body;
			frame = frame.parentElement
		) {
			const limit = readClipEdge(frame)
			if (limit !== undefined && limit < bottom) bottom = limit
		}
		if (bottom > edge) edge = bottom
	}
	return Math.ceil(
		edge +
			readPixels(document.body, 'padding-bottom') +
			readPixels(document.body, 'margin-bottom') +
			readPixels(document.documentElement, 'padding-bottom') +
			readPixels(document.documentElement, 'margin-bottom'),
	)
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
 * them reddens the size check that follows rather than writing a wrong frame.
 *
 * Hand the pane straight back with {@link releasePane}. A tester pinned at a viewport taller than
 * the window puts its lower half beyond what a pointer can reach, so an ordinary press then fails
 * as a control outside the viewport, in a test that took no picture at all.
 *
 * This is a capture's staging alone. A suite that resizes the tester for a journey — a breakpoint
 * to drive, a variant to act at — calls `page.viewport` from `vitest/browser` and leaves the tester
 * there. Staging and releasing as a pair resizes and then undoes the resize, so the journey step
 * after it runs at the size the file started at.
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
 * That hand-back is what makes {@link stagePane} and this pair a capture's staging rather than a
 * resize: the pair puts the tester back where it found it, so a suite that used it to reach a
 * breakpoint runs its next step at the old size. Call `page.viewport` from `vitest/browser` for a
 * journey's own size, and leave this pair to the capture.
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
 * Stages the tester's print medium, motion preference, and forced colours through the browser
 * provider.
 *
 * @param options - The media axes to override.
 * @returns A promise resolving after a bounded read-back for `print: true`, either `motion` value,
 * and either `forced` value. A `print: false` stage is sent and followed by a frame wait without a
 * read-back.
 * @throws Thrown when no axis is supplied or a staged query does not reach the tester.
 *
 * @remarks
 * If `print` is true, uses print; if false, uses screen. If `motion` is true, uses no preference;
 * if false, uses reduced motion. If `forced` is true, uses active forced colours; if false, uses
 * none. The print medium, reduced motion, colour scheme, and forced colours keep their effective
 * readings when omitted. Any other emulated feature the provider configured
 * is cleared. Each staged query waits up to 1000 milliseconds, polling every 10 milliseconds.
 * A refused read-back restores the carried pre-call readings before throwing and can take two
 * budgets. A restoration failure is attached as the refusal's cause. Register
 * {@link releaseMedia} in teardown; it restores the readings observed before the first stage.
 *
 * @example
 * ```ts
 * await stageMedia({ motion: false, print: true })
 * await releaseMedia()
 * ```
 */
export async function stageMedia(options: MediaOptions): Promise<void> {
	const print = options.print
	const motion = options.motion
	const forced = options.forced
	if (print === undefined && motion === undefined && forced === undefined) {
		throw new Error('Media emulation was staged with nothing to emulate')
	}
	const media = matchMedia('print').matches ? 'print' : 'screen'
	const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches
	const dark = matchMedia('(prefers-color-scheme: dark)').matches
	const active = matchMedia('(forced-colors: active)').matches
	if (!document.documentElement.hasAttribute(MEDIA_STAGE)) {
		document.documentElement.setAttribute(
			MEDIA_STAGE,
			[media === 'print', reduced, dark, active].map(Number).join(''),
		)
	}
	const features = [
		{
			name: 'prefers-color-scheme',
			value: dark ? 'dark' : 'light',
		},
		{
			name: 'forced-colors',
			value: active ? 'active' : 'none',
		},
		{
			name: 'prefers-reduced-motion',
			value: reduced ? 'reduce' : 'no-preference',
		},
	]
	const queries: string[] = []
	if (print === true) queries.push('print')
	if (motion !== undefined) {
		queries.push(`(prefers-reduced-motion: ${motion ? 'no-preference' : 'reduce'})`)
	}
	if (forced !== undefined) queries.push(`(forced-colors: ${forced ? 'active' : 'none'})`)
	await sendProtocol('Emulation.setEmulatedMedia', {
		media: print === undefined ? media : print ? 'print' : 'screen',
		features: features.map((feature) =>
			feature.name === 'prefers-reduced-motion' && motion !== undefined
				? { name: feature.name, value: motion ? 'no-preference' : 'reduce' }
				: feature.name === 'forced-colors' && forced !== undefined
					? { name: feature.name, value: forced ? 'active' : 'none' }
					: feature,
		),
	})
	await waitForFrame()
	for (const query of queries) {
		try {
			await waitForCondition(query, () => matchMedia(query).matches)
		} catch (cause) {
			try {
				await sendProtocol('Emulation.setEmulatedMedia', { media, features })
				await waitForCondition(
					'pre-call media readings restored',
					() =>
						matchMedia(media).matches &&
						features.every((feature) => matchMedia(`(${feature.name}: ${feature.value})`).matches),
				)
			} catch (restoration) {
				throw new Error(`Media emulation did not reach the tester: ${query}`, {
					cause: restoration,
				})
			}
			throw new Error(`Media emulation did not reach the tester: ${query}`, { cause })
		}
	}
}

/**
 * Restores the media readings observed before the first stage as explicit emulation. With nothing
 * staged, clears every override and waits for a stable reading, not a proved engine baseline. Checks
 * the budget between polls, so a frame that never paints is not bounded by it.
 *
 * @returns A promise resolving after the media readings settle.
 * @throws Thrown when a media read-back exhausts its 1000 millisecond budget between polls.
 *
 * @remarks
 * Restores print, reduced motion, colour scheme, and forced colours from {@link MEDIA_STAGE},
 * waits per axis for the recorded value, and removes the marker after every axis agrees. With no
 * marker, sends the empty reset and compares readings taken strictly after that send. Each poll
 * waits for a frame; the interval is 10 milliseconds. The provider must expose a DevTools session.
 *
 * @example
 * ```ts
 * await releaseMedia()
 * ```
 */
export async function releaseMedia(): Promise<void> {
	const queries = [
		'print',
		'(prefers-reduced-motion: reduce)',
		'(prefers-color-scheme: dark)',
		'(forced-colors: active)',
	]
	const staged = document.documentElement.getAttribute(MEDIA_STAGE)
	if (staged !== null) {
		const readings = staged.split('').map((value) => value === '1')
		await sendProtocol('Emulation.setEmulatedMedia', {
			media: readings[0] ? 'print' : 'screen',
			features: [
				{ name: 'prefers-reduced-motion', value: readings[1] ? 'reduce' : 'no-preference' },
				{ name: 'prefers-color-scheme', value: readings[2] ? 'dark' : 'light' },
				{ name: 'forced-colors', value: readings[3] ? 'active' : 'none' },
			],
		})
		try {
			await Promise.all(
				queries.map((query, index) =>
					waitForCondition(query, async () => {
						await waitForFrame()
						return matchMedia(query).matches === readings[index]
					}),
				),
			)
		} catch (cause) {
			throw new Error('Media emulation did not clear from the tester', { cause })
		}
		document.documentElement.removeAttribute(MEDIA_STAGE)
		return
	}
	await sendProtocol('Emulation.setEmulatedMedia', { media: '', features: [] })
	let previous = queries.map((query) => matchMedia(query).matches)
	try {
		await waitForCondition('media emulation cleared', async () => {
			await waitForFrame()
			const readings = queries.map((query) => matchMedia(query).matches)
			const stable = readings.every((reading, index) => reading === previous[index])
			previous = readings
			return stable
		})
	} catch (cause) {
		throw new Error('Media emulation did not clear from the tester', { cause })
	}
}

/**
 * Shoots one frame at one viewport size and proves the file on disk holds this run's bytes.
 *
 * @param options - The path to write, the viewport to shoot at, and the element to shoot.
 * @returns The absolute path of the written frame, after it has been read back and matched.
 * @throws Thrown when the pane cannot be staged, when the document's height never settles under
 * {@link CAPTURE_STAGINGS} restagings, when the provider wrote the frame somewhere else, and when
 * the bytes on disk are not the ones this shot produced.
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
 * than that, the pane is staged again at the height the document needs, for the shot alone.
 *
 * That height is {@link measureContent}, never less than `options.height`, because the declared
 * viewport is the smallest frame a variant asks for. The reading is the content's own edge rather
 * than the body's box: the box is the larger of the content and the pane, so it stretches with
 * every pane staged over it and a capture that staged too tall a pane could not read its way back
 * down. Rounding up is what covers a body ending part way through a row, which the box does and an
 * integer scroll height does not.
 *
 * The edge is read again after every staging, because a rule bound to the viewport height — a `vh`
 * length, a fixed footer, a full-height panel — lays the document out taller against the taller
 * pane, so a surface built out of those photographs as its scrolled-open self rather than as one
 * screen, and the reading taken before that staging is stale by exactly what the reflow added.
 * Restaging at the edge alone converges on such a document without arriving: each staging closes
 * the same fraction of what is left, so a rule keeping half the pane reads 1322, 1561, 1681, and
 * 1741 against a fixed point of 1800. Each staging therefore carries the growth the one before it
 * produced — the pane is the edge plus that growth — which lands on the fixed point rather than
 * creeping up to it. The first staging carries no growth, because nothing has grown yet, so a
 * document of fixed content is staged at its own edge and shot there rather than at a pane the
 * overshoot stretched.
 *
 * The re-reading stops when the pane and the edge agree, which is the pane the shot is taken at. A
 * rule that adds height with every pane never reaches that point, so the re-reading is bounded by
 * {@link CAPTURE_STAGINGS} and the shot is refused with
 * `Capture frame at <path> never settled after <n> restagings: <h> over a <h> pane` rather than
 * written at a height that is already wrong.
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
		let pane = options.height
		let covered = Math.max(measureContent(), options.height)
		let growth = 0
		for (let staging = 0; pane !== covered; staging += 1) {
			if (staging === CAPTURE_STAGINGS) {
				throw new Error(
					`Capture frame at ${options.path} never settled after ${String(CAPTURE_STAGINGS)} restagings: ${String(covered)} over a ${String(pane)} pane`,
				)
			}
			pane = covered + growth
			await stagePane(options.width, pane)
			const reading = Math.max(measureContent(), options.height)
			growth = Math.max(0, reading - covered)
			covered = reading
		}
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

/**
 * Builds the refusal a host withholding a storage operation raises.
 *
 * @param operation - The withheld operation, named as the `Storage` interface names it.
 * @param key - The storage key the operation addressed. Omit it for an operation that takes none.
 * @returns The refusal, unthrown.
 *
 * @remarks
 * A browser with site data blocked, a sandboxed frame, and a hardened privacy mode all raise a
 * `DOMException` named `SecurityError` from the storage object rather than answering, so this is
 * the voice rather than a message of this package's. {@link createStorage} raises it from every
 * operation the permission withholds; it is exported because a fixture implementing `Storage` some
 * other way needs the same voice rather than a second spelling of it.
 *
 * @example
 * ```ts
 * buildDenial('getItem', 'theme').message // 'Access is denied for getItem "theme"'
 * buildDenial('length').name // 'SecurityError'
 * ```
 */
export function buildDenial(operation: string, key?: string): DOMException {
	return new DOMException(
		`Access is denied for ${operation}${key === undefined ? '' : ` "${key}"`}`,
		'SecurityError',
	)
}

/**
 * Builds a detached translucent stack whose composited and flat contrast readings straddle one bar.
 *
 * @param bar - The contrast ratio `refused` and `accepted` must sit on opposite sides of.
 * @returns The opaque root carrying the tint, and the refused and accepted foregrounds under it.
 * @throws An `Error` when no grey foreground puts the two readings on opposite sides of the bar.
 *
 * @remarks
 * A contrast instrument that never composites still clears every fixture painting its own opaque
 * background, so this is the control that makes {@link readContrast}'s ancestor walk and alpha
 * blend the thing under test. The stack is an opaque floor, a translucent tint over it, and two
 * grey foregrounds inside the tint. `refused` reads under the bar composited and at or over it
 * flat, and `accepted` reads the other way about, so no single non-compositing reading satisfies
 * both.
 *
 * The greys are searched rather than written down, so the control follows the bar it was asked for.
 * A bar at or under `1` is refused because every contrast ratio reaches `1`, and a bar above what
 * the tinted surface can reach is refused because no foreground clears it — each refusal names the
 * bar rather than returning a stack that proves nothing.
 *
 * The nodes are detached, so nothing is mounted for you. Append `root` to the surface you are
 * reading, take both readings, and remove it: a computed color needs the document, and a fixture
 * left behind is the next test's resolver ambiguity.
 *
 * @example
 * ```ts
 * const control = buildContrast(4.5)
 * mount(control.root)
 * readContrast(control.refused) < 4.5 // true
 * readContrast(control.accepted) >= 4.5 // true
 * control.root.remove()
 * ```
 */
export function buildContrast(bar: number): ContrastFixture {
	const tint: Color = [0, 0, 0, 0.06]
	const backdrop = blendColor(tint, CANVAS_COLOR)
	const flattened: Color = [tint[0], tint[1], tint[2], 1]
	let refusedChannel: number | undefined
	let acceptedChannel: number | undefined
	for (let channel = 0; channel <= 255; channel += 1) {
		const front: Color = [channel, channel, channel, 1]
		const composited = measureContrast(front, backdrop)
		const flat = measureContrast(front, flattened)
		if (refusedChannel === undefined && composited < bar && flat >= bar) refusedChannel = channel
		if (acceptedChannel === undefined && composited >= bar && flat < bar) acceptedChannel = channel
	}
	if (refusedChannel === undefined || acceptedChannel === undefined) {
		throw new Error(`Contrast control cannot straddle the bar ${bar}`)
	}
	const root = build('div', {
		attributes: {
			style: `background-color: rgb(${CANVAS_COLOR[0]}, ${CANVAS_COLOR[1]}, ${CANVAS_COLOR[2]})`,
		},
	})
	const tinted = build('div', {
		attributes: {
			style: `background-color: rgba(${tint[0]}, ${tint[1]}, ${tint[2]}, ${tint[3]})`,
		},
	})
	const refused = build('p', {
		text: 'Composited contrast control',
		attributes: {
			style: `color: rgb(${refusedChannel}, ${refusedChannel}, ${refusedChannel})`,
		},
	})
	const accepted = build('p', {
		text: 'Composited contrast survivor',
		attributes: {
			style: `color: rgb(${acceptedChannel}, ${acceptedChannel}, ${acceptedChannel})`,
		},
	})
	tinted.append(refused, accepted)
	root.append(tinted)
	return Object.freeze({ root, refused, accepted })
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
