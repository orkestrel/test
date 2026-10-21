import type { ChoiceOptions, ChooserRequest, FixtureFile, WaitOptions } from '@src/core'
import type { StabilityOptions } from '../captures/types.js'
import type {
	AccessibilityNode,
	AnimationReading,
	ProtocolPoint,
	SettleOptions,
	StateOptions,
} from './types.js'
import { isArray, isError, isNumber, isRecord, isString, resolveField } from '@orkestrel/contract'
import {
	checkBounds,
	invokeUnchecked,
	readProperty,
	waitForAbort,
	waitForCondition,
} from '@src/core'
import { commands, page, server, userEvent } from 'vitest/browser'
import { waitForStability } from '../captures/helpers.js'
import { build, mount, sendProtocol, waitForFrame } from '../helpers.js'
import {
	ACCESSIBLE_ROLES,
	CONTENT_ROLES,
	FIELD_ROLES,
	FOCUSABLE_SELECTOR,
	FOCUS_SEGMENT_LIMIT,
	HEADER_ROLES,
	IMPLICIT_ROLES,
	POINTER_HOLD,
	SEGMENTED_INPUT_TYPES,
} from './constants.js'

/**
 * Sends one emulated touch event through the browser protocol.
 *
 * @param type - The Chrome DevTools Protocol touch event type.
 * @param element - The connected element locating the touch; omit it to end or cancel every point.
 * @param point - The offset from the element's top-left corner. Default: `{ x: 20, y: 20 }`.
 * @returns A promise resolving after the browser accepts the event.
 * @throws Thrown when the element is disconnected, the provider exposes no DevTools session, or the
 * browser refuses the touch sequence.
 *
 * @example
 * ```ts
 * await sendTouch('touchStart', target)
 * await sendTouch('touchEnd')
 * ```
 */
export async function sendTouch(
	type: 'touchStart' | 'touchMove' | 'touchEnd' | 'touchCancel',
	element?: Element,
	point: ProtocolPoint = { x: 20, y: 20 },
): Promise<void> {
	await sendProtocol('Input.dispatchTouchEvent', {
		type,
		touchPoints: element === undefined ? [] : [readProtocolPoint(element, point)],
	})
}

/**
 * Taps an element's centre with emulated touch after its box settles.
 *
 * @param element - The connected element locating the tap.
 * @param options - The stability frame count, time bounds, and abort signal.
 * @returns A promise resolving after the browser accepts the touch end.
 * @throws Thrown when stability fails, the element is disconnected, or a protocol command fails.
 *
 * @remarks
 * Uses one touch point and leaves touch emulation enabled until {@link releaseTouch}.
 * That cleanup disables even a coarse pointer staged by {@link stageMedia}; stage it again after
 * cleanup when later steps need coarse precision.
 * A first pointer stage while tap emulation is live records coarse as its pre-call reading.
 * In teardown, call {@link releaseMedia} before {@link releaseTouch}; reversing that order restores
 * coarse emulation after touch cleanup.
 * The wait uses {@link waitForStability}; an unsettled scroller can consume a tap to stop momentum
 * without producing a click. No scrolling or focus-reachability check is performed.
 *
 * @example
 * ```ts
 * await tapTouch(target, { budget: 2000 })
 * await releaseTouch()
 * ```
 */
export async function tapTouch(element: Element, options?: StabilityOptions): Promise<void> {
	await sendProtocol('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 1 })
	await waitForStability(
		'the tap target holds still',
		() => {
			const { x, y, width, height } = element.getBoundingClientRect()
			return `${x}:${y}:${width}:${height}`
		},
		options,
	)
	const box = element.getBoundingClientRect()
	await sendTouch('touchStart', element, { x: box.width / 2, y: box.height / 2 })
	await sendTouch('touchEnd')
}

/**
 * Cancels emulated touch input, disables touch emulation, and parks the pointer.
 *
 * @returns A promise resolving after touch cleanup and the parked pointer's frame.
 * @throws Thrown when a protocol command fails, apart from Chromium's idle touch cancellation refusal.
 *
 * @remarks
 * Safe after a completed tap, a held touch, or an idle release. This sends no mouse button release.
 * A native drag that also holds the mouse requires its own `mouseReleased` protocol command before
 * parking. {@link releasePointer} releases only a press recorded by the package's hold verbs.
 * Parking after touch input does not prove that Chromium cleared sticky touch hover.
 * Disables even a coarse pointer staged by {@link stageMedia}, leaving its restoration marker
 * unchanged. Stage the coarse pointer again when later steps need it; {@link releaseMedia} still
 * restores the pointer reading recorded before the first pointer stage.
 * If that stage ran while {@link tapTouch} emulation was live, it recorded coarse. In teardown,
 * call {@link releaseMedia} before this cleanup; reversing the order ends with coarse emulation.
 *
 * @example
 * ```ts
 * await releaseTouch()
 * ```
 */
export async function releaseTouch(): Promise<void> {
	try {
		await sendTouch('touchCancel')
	} catch (error) {
		const message = readProperty<unknown>(error, 'message')
		if (!isString(message) || !message.includes('Must send a TouchStart first')) throw error
	}
	await sendProtocol('Emulation.setTouchEmulationEnabled', { enabled: false })
	await parkPointer()
}

/**
 * Carries files from outside the page over a rendered target named by role and accessible name.
 *
 * @param type - The protocol drag event; cancellation leaves the target before ending the drag.
 * @param role - The target's accessible role.
 * @param name - The target's exact accessible name.
 * @param names - The file names to write under the provider root's `tmp/drag` directory.
 * @returns A promise resolving after the browser accepts the event.
 * @throws Thrown when the target is absent, ambiguous, or outside the viewport after scrolling,
 * a file name contains a path, or the provider refuses a file write or protocol command.
 *
 * @remarks
 * Resolves rendered elements through {@link isRendered}, without focus reachability. A status or
 * region can receive a drag without being a Tab stop. Events are trusted and carry the `Files`
 * type. No drop is sent. Chromium raises no `dragleave` for protocol cancellation alone, so
 * cancellation first moves the drag outside the page.
 *
 * @example
 * ```ts
 * await sendFileDrag('dragEnter', 'status', 'Drop status', ['note.txt'])
 * await sendFileDrag('dragCancel', 'status', 'Drop status', ['note.txt'])
 * ```
 */
export async function sendFileDrag(
	type: 'dragEnter' | 'dragOver' | 'dragCancel',
	role: string,
	name: string,
	names: readonly string[],
): Promise<void> {
	const matches = page.getByRole(role, { name, exact: true }).elements().filter(isRendered)
	if (matches.length > 1) {
		throw new Error(`Drag target "${name}" is ambiguous across ${matches.length} elements`)
	}
	const [target] = matches
	if (target === undefined) throw new Error(`Drag target "${name}" is not rendered`)
	if (names.some((file) => file === '' || file === '.' || file === '..' || /[/\\:]/u.test(file))) {
		throw new Error('Dragged file names must name files without a path')
	}
	target.scrollIntoView({ block: 'center', inline: 'center', behavior: 'instant' })
	await waitForFrame()
	const box = target.getBoundingClientRect()
	const center = { x: box.width / 2, y: box.height / 2 }
	if (
		box.left + center.x < 0 ||
		box.top + center.y < 0 ||
		box.left + center.x > innerWidth ||
		box.top + center.y > innerHeight
	)
		throw new Error(`Drag target "${name}" lies outside the viewport`)
	const files: string[] = []
	for (const file of names) {
		await commands.writeFile(`tmp/drag/${file}`, file)
		files.push(`${server.config.root}/tmp/drag/${file}`)
	}
	const data = { items: [], files, dragOperationsMask: 1 }
	if (type === 'dragCancel') {
		await sendProtocol('Input.dispatchDragEvent', { type: 'dragOver', x: -1, y: -1, data })
	}
	await sendProtocol('Input.dispatchDragEvent', {
		type,
		...readProtocolPoint(target, center),
		data,
	})
}

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
 * Resolves one visible, enabled, focus-reachable native file input by its exact label.
 *
 * @param name - The input's accessible label.
 * @returns The unique reachable native file input.
 * @throws When the label is absent, ambiguous, hidden, disabled, or outside the active modal.
 * @example
 * ```ts
 * resolveFileInput('Attachments')
 * ```
 */
export function resolveFileInput(name: string): HTMLInputElement {
	const matches = page
		.getByLabelText(name, { exact: true })
		.elements()
		.filter(
			(element): element is HTMLInputElement =>
				element instanceof HTMLInputElement && element.type === 'file',
		)
	if (matches.length === 0)
		throw new Error(`No native file input has the accessible name "${name}"`)
	const reachable = matches.filter((element) => isRendered(element) && isReachable(element))
	if (reachable.length === 0)
		throw new Error(`Native file target "${name}" is not visible and focus-reachable`)
	if (reachable.length > 1)
		throw new Error(`Native file target "${name}" is ambiguous across ${reachable.length} elements`)
	const [target] = reachable
	if (target === undefined) throw new Error(`Native file target "${name}" could not be resolved`)
	return target
}

/**
 * Activates a labeled native file input and fulfills its observed chooser with fixture bytes.
 *
 * @param name - The input's exact accessible label.
 * @param files - The fixture selection; an empty collection clears the selection, not an OS Cancel gesture.
 * @param options - The activation method and provider wait budget.
 * @returns A promise resolving after the correct native chooser receives the fixture selection.
 * @throws When the input is refused, the provider command is unregistered, or the expected chooser does not open.
 * @remarks Register the server entry's `chooseFiles` function as the `chooseFiles` command in the workspace's
 * `configs/commands.ts`, which the root configuration passes to every browser project.
 * @example
 * ```ts
 * await chooseAccessible('Attachments', [{ name: 'note.txt', mime: 'text/plain', bytes: [72, 105] }])
 * ```
 */
export async function chooseAccessible(
	name: string,
	files: readonly FixtureFile[],
	options?: ChoiceOptions,
): Promise<void> {
	if (options?.keyboard) await driveTraversal(() => resolveFileInput(name), name)
	const target = resolveFileInput(name)
	const command = readProperty<unknown>(commands, 'chooseFiles')
	if (typeof command !== 'function')
		throw new Error('Register the chooseFiles browser command before choosing files')
	const request: ChooserRequest = {
		selector: page.elementLocator(target).selector,
		files,
		...options,
	}
	await invokeUnchecked<Promise<void>>(commands, command, [request])
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
 * centre projected through every frame into page coordinates by {@link readProtocolPoint}, the
 * trusted move and press, the marker, and the frame wait and the `:active` read-back that both
 * release before refusing. The refusal precedes resolution, so a double hold is refused before an
 * absent name is.
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
	const { x, y } = readProtocolPoint(target)
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
 * Parks the pointer outside the page and waits for the parked pointer's frame to paint.
 *
 * @returns A promise resolving after the pointer has moved to its park point and one frame has painted.
 * @throws Thrown when the provider exposes no DevTools session, or the move rejects.
 *
 * @remarks
 * The park point is (-1, -1) in the runner page's coordinates, one pixel above and to the left of
 * that page's viewport. The browser hit-tests nothing outside the viewport, so no element keeps its
 * hover paint from the parked pointer. This sends no button release: a press that the
 * `holdAccessible` verb holds stays recorded as held and its button-up is still owed, so a later
 * `releasePointer` call sends it. The control a held press was on loses its `:active` paint when the
 * pointer leaves it. Use this verb to clear hover without ending a held press, and
 * `releasePointer` for teardown.
 *
 * @example
 * ```ts
 * await parkPointer()
 * ```
 */
export async function parkPointer(): Promise<void> {
	await sendProtocol('Input.dispatchMouseEvent', { type: 'mouseMoved', x: -1, y: -1 })
	await waitForFrame()
}

/**
 * Releases a held pointer and parks it outside the page, clearing hover.
 *
 * @returns A promise resolving after the released pointer's frame paints.
 * @throws Thrown when the release or the park rejects. If both reject, the aggregate carries the
 * park rejection as its cause and the release rejection in its errors.
 *
 * @remarks
 * An idle pointer sends no button release. Calling this after an explicit release is safe in an
 * `afterEach` hook. A rejected release keeps the marker for a later retry. The pointer still moves
 * to its park point in cleanup, and a rejection there joins the aggregate described under `@throws`.
 * The provider must expose a DevTools session.
 *
 * The pointer parks through the `parkPointer` verb, which sends no release of its own. The park
 * point is (-1, -1) in the runner page's coordinates, one pixel above and to the left of that
 * page's viewport. The browser hit-tests nothing outside the viewport, so no element takes a
 * `mouseover` event or hover paint from the parked pointer until the next pointer verb. This holds
 * even where a staging, scroll, or offset lays content over the park point.
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
		await parkPointer()
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
 * Projects a point of one element through every frame that holds it into the browser's top-level
 * viewport.
 *
 * @param element - The connected element the point is relative to.
 * @param offset - The offset from the element's top-left corner, in the element's own pixels.
 * Default: the centre of its box.
 * @returns The point in the top-level viewport's coordinates, which is where a DevTools input
 * command addresses.
 * @throws Thrown when the element is not connected to a document, or a frame on the way up is not an
 * HTML element of a document a window holds.
 *
 * @remarks
 * Each frame on the way up adds its border and its padding, which is where its content starts,
 * scales the point by the ratio of its painted width to its layout width, and adds its own position,
 * so a tester iframe the runner scales or offsets is accounted for, and so is an iframe the page
 * itself nests, bordered, padded, or neither. The reading is of the layout at the call: a box that moves
 * afterwards moves the point it names. An element in a document no frame holds reads its own client
 * point. A disconnected element has no layout, and its window still names the tester frame, so it is
 * refused rather than read as that frame's corner.
 *
 * @example
 * ```ts
 * const point = readProtocolPoint(button)
 * await sendProtocol('Input.dispatchMouseEvent', { type: 'mouseMoved', ...point })
 * ```
 */
export function readProtocolPoint(element: Element, offset?: ProtocolPoint): ProtocolPoint {
	if (!element.isConnected) {
		throw new Error('The element is not connected to a document, so it has no point to read')
	}
	const box = element.getBoundingClientRect()
	const x = box.x + (offset?.x ?? box.width / 2)
	const y = box.y + (offset?.y ?? box.height / 2)
	const frame = element.ownerDocument.defaultView?.frameElement
	if (frame === null || frame === undefined) return { x, y }
	// The frame belongs to the parent document's realm, so the check reads that realm's constructor.
	// A frame of a document no window holds is not a layout the point can be projected through.
	const realm = frame.ownerDocument.defaultView
	if (realm === null || !(frame instanceof realm.HTMLElement)) {
		throw new Error('The frame holding the element is not an HTML element of a live document')
	}
	// The point is in the frame's content viewport. The border and the padding sit between that
	// viewport and the frame's corner, so the offset from the corner adds both. Scaling by how much
	// wider the frame paints than it lays out turns that offset into the one the frame itself is read
	// at.
	const bounds = frame.getBoundingClientRect()
	const style = realm.getComputedStyle(frame)
	return readProtocolPoint(frame, {
		x:
			((frame.clientLeft + Number.parseFloat(style.paddingLeft) + x) * bounds.width) /
			frame.offsetWidth,
		y:
			((frame.clientTop + Number.parseFloat(style.paddingTop) + y) * bounds.height) /
			frame.offsetHeight,
	})
}

/**
 * Resolves one element to the node the browser's DOM tree holds for it.
 *
 * @param element - The element to find.
 * @returns A promise resolving to the DevTools node id of the element.
 * @throws Thrown when the provider exposes no DevTools session, a command fails, or the element is
 * not the one connected element its marker finds.
 *
 * @remarks
 * The browser's DOM domain cannot be handed an element, so the element wears a marker attribute while
 * the browser searches the document, shadow roots included, for it. The search is discarded and the
 * marker is put back before this resolves: an attribute the element already carried under that name
 * keeps its value, and an absent one is removed again, on a refusal as much as on success.
 *
 * Use the id before calling again, because each call asks the browser for the document afresh. A
 * twin of the element, left unmarked, is never the node returned.
 *
 * @example
 * ```ts
 * const nodeId = await readProtocolNode(button)
 * const described = await sendProtocol('DOM.describeNode', { nodeId })
 * ```
 */
export async function readProtocolNode(element: Element): Promise<number> {
	const marker = 'data-protocol-node'
	const key = crypto.randomUUID()
	const previous = element.getAttribute(marker)
	element.setAttribute(marker, key)
	try {
		await sendProtocol('DOM.getDocument', { depth: -1, pierce: true })
		const search = await sendProtocol('DOM.performSearch', {
			query: `[${marker}="${key}"]`,
			includeUserAgentShadowDOM: true,
		})
		const searchId = isRecord(search) ? resolveField(search, 'searchId') : undefined
		if (!isString(searchId)) throw new Error('Protocol search returned no search id')
		try {
			const count = isRecord(search) ? resolveField(search, 'resultCount') : undefined
			if (count !== 1) {
				throw new Error(`Protocol search found ${String(count)} elements where one is required`)
			}
			const results = await sendProtocol('DOM.getSearchResults', {
				searchId,
				fromIndex: 0,
				toIndex: 1,
			})
			const ids = isRecord(results) ? resolveField(results, 'nodeIds') : undefined
			const [nodeId] = isArray(ids) ? ids : []
			if (!isNumber(nodeId)) throw new Error('Protocol search returned no node id')
			return nodeId
		} finally {
			await sendProtocol('DOM.discardSearchResults', { searchId })
		}
	} finally {
		if (previous === null) element.removeAttribute(marker)
		else element.setAttribute(marker, previous)
	}
}

/**
 * Reads the accessibility node the browser computed for one element.
 *
 * @param element - The connected element to read.
 * @returns A promise resolving to the node's role, name, and properties.
 * @throws Thrown when the provider exposes no DevTools session, a command fails, or the element is
 * not the one connected element {@link readProtocolNode} finds.
 *
 * @remarks
 * This is the browser's own computation, which complements the DOM-based `readRole`, `readName`, and
 * `readStates`: those apply this package's mapping to the markup, and this asks the browser what it
 * published. A property whose value names other nodes reads as the list of their ids, and a value the
 * browser states plainly reads as that value.
 *
 * @example
 * ```ts
 * const node = await readAccessibilityNode(input)
 * node.name // 'Port'
 * ```
 */
export async function readAccessibilityNode(element: Element): Promise<AccessibilityNode> {
	const nodeId = await readProtocolNode(element)
	const tree = await sendProtocol('Accessibility.getPartialAXTree', {
		nodeId,
		fetchRelatives: false,
	})
	const list = isRecord(tree) ? resolveField(tree, 'nodes') : undefined
	const [node] = isArray(list) ? list : []
	const entries = isRecord(node) ? resolveField(node, 'properties') : undefined
	const role = isRecord(node) ? resolveField(node, ['role', 'value']) : undefined
	const name = isRecord(node) ? resolveField(node, ['name', 'value']) : undefined
	return Object.freeze({
		role: isString(role) ? role : undefined,
		name: isString(name) ? name : undefined,
		properties: Object.freeze(
			Object.fromEntries(
				(isArray(entries) ? entries : []).filter(isRecord).flatMap((entry) => {
					const property = resolveField(entry, 'name')
					const related = resolveField(entry, ['value', 'relatedNodes'])
					return isString(property)
						? [
								[
									property,
									isArray(related)
										? related.map((reference) =>
												isRecord(reference) ? resolveField(reference, 'idref') : undefined,
											)
										: resolveField(entry, ['value', 'value']),
								] as const,
							]
						: []
				}),
			),
		),
	})
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
 * The loop is {@link driveTraversal} over {@link resolveRendered}. Consecutive landings inside a
 * native segmented input continue through its segments up to {@link FOCUS_SEGMENT_LIMIT} landings.
 * A longer run or any other revisit ends the traversal.
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
 * Reads the HTML element that holds focus, following it into open shadow roots and same-origin
 * frames.
 *
 * @param root - The document or open shadow root to read from. Default: the page's document.
 * @returns The innermost focused element when it is an HTML element of its own window, or
 * `undefined` when only a body, a non-HTML element, or nothing holds focus.
 * @throws Thrown when focus sits in a frame from another origin, whose document the page cannot
 * reach.
 *
 * @remarks
 * `document.activeElement` stops at the first boundary: it names the host of a shadow root or the
 * element of a frame, never the control focused inside. This follows `shadowRoot.activeElement` and
 * a frame's `contentDocument.activeElement` until neither names a deeper element, so a host or a
 * frame holding focus with nothing focused inside is itself the answer. A closed shadow root cannot
 * be followed, so its host is the answer there. When the innermost focused element is not HTML, as
 * an SVG element focused inside an open shadow root, the answer is `undefined`: the host that holds
 * it is not where focus is.
 *
 * A frame from another origin is refused rather than answered with its element, because the answer
 * would name a frame while focus sat on a control the page cannot see. The element comes back typed
 * for its own window, so a control inside a frame passes the frame's `HTMLElement` check and not
 * this window's.
 *
 * @example
 * ```ts
 * readActiveElement()?.textContent
 * ```
 */
export function readActiveElement(root: Document | ShadowRoot = document): HTMLElement | undefined {
	const active = root.activeElement
	if (active === null || active === active.ownerDocument.body) return undefined
	const realm = active.ownerDocument.defaultView
	if (realm === null) return undefined
	const framed = active instanceof realm.HTMLIFrameElement
	if (framed && active.contentDocument === null) {
		throw new Error('Focus sits in a frame from another origin, which cannot be read')
	}
	const scope = framed ? active.contentDocument : active.shadowRoot
	const inside = scope?.activeElement ?? null
	// Where something inside holds focus, the innermost element is the answer, HTML or not: a
	// non-HTML control must not fall back to the host that holds it.
	if (scope !== null && inside !== null && inside !== inside.ownerDocument.body) {
		return readActiveElement(scope)
	}
	return active instanceof realm.HTMLElement ? active : undefined
}

/**
 * Counts the elements a tree holds, descending into open shadow roots and same-origin frames.
 *
 * @param root - The document or open shadow root to count. Default: the page's document.
 * @returns How many elements the tree holds, each host and frame element included.
 *
 * @remarks
 * `querySelectorAll('*')` stops at the first boundary, so it undercounts a page built from shadow
 * roots. A frame from another origin and a closed shadow root hold nothing the page can count, so
 * each counts as its own element only. The number bounds a walk that visits each element once, which
 * is how {@link walkFocus} knows a Tab order that never ends.
 *
 * @example
 * ```ts
 * countElements(host.shadowRoot)
 * ```
 */
export function countElements(root: Document | ShadowRoot = document): number {
	return [...root.querySelectorAll('*')].reduce((total, element) => {
		const realm = element.ownerDocument.defaultView
		const inner =
			realm !== null && element instanceof realm.HTMLIFrameElement
				? element.contentDocument
				: element.shadowRoot
		return total + 1 + (inner === null ? 0 : countElements(inner))
	}, 0)
}

/**
 * Determines whether a node sits inside a root, through open shadow roots and frames.
 *
 * @param root - The node that bounds the region.
 * @param node - The node to place.
 * @returns `true` when `node` is `root` or a descendant of it, counting a shadow root's content as
 * its host's and a frame's content as its frame element's.
 *
 * @remarks
 * `contains` stops at a shadow root and at a frame, so a control inside a component reads as outside
 * the region that holds the component. This climbs from the node to its host or its frame element
 * until `contains` answers or the page's top is reached.
 *
 * @example
 * ```ts
 * containsNode(region, readActiveElement() ?? region)
 * ```
 */
export function containsNode(root: Node, node: Node): boolean {
	if (root.contains(node)) return true
	const owner = node.ownerDocument
	if (owner === null) return false
	const realm = owner.defaultView
	if (realm === null) return false
	const scope = node.getRootNode()
	if (scope === owner) return realm.frameElement !== null && containsNode(root, realm.frameElement)
	return scope instanceof realm.ShadowRoot && containsNode(root, scope.host)
}

/**
 * Presses Tab and yields the element focus lands on, once per press, up to a limit.
 *
 * @param limit - The most presses to make.
 * @returns An async generator of the element each press landed on, `undefined` where only a body, a
 * non-HTML element, or nothing took focus.
 * @throws Thrown when a press rejects, or focus lands in a frame from another origin.
 *
 * @remarks
 * This is the one Tab loop {@link driveTraversal} and {@link walkFocus} share. It makes a real press
 * through the provider, reads the landing with {@link readActiveElement}, and leaves every decision
 * to the caller: what counts as an end, a revisit, or a stop is the consumer's, because the two
 * consumers disagree. The press is the next one only after the consumer asks for the next landing, so
 * a consumer that stops reading stops pressing. A native segmented input can yield the same element
 * for successive segment landings. This generator preserves each landing; its consumers count that
 * control once while continuing through its segments, and end a run beyond {@link FOCUS_SEGMENT_LIMIT}.
 *
 * @example
 * ```ts
 * for await (const focused of stepFocus(10)) {
 * 	if (focused?.id === 'save') break
 * }
 * ```
 */
export async function* stepFocus(
	limit: number,
): AsyncGenerator<HTMLElement | undefined, void, undefined> {
	for (const _ of Array.from({ length: limit })) {
		await userEvent.tab()
		yield readActiveElement()
	}
}

/**
 * Determines whether a native input exposes separately editable segments under one focused element.
 *
 * @param element - The element whose native input type is read in its own document's realm.
 * @returns True if the element is an input with a type in {@link SEGMENTED_INPUT_TYPES}, checked
 * against its own document's `HTMLInputElement`; false otherwise, including a document with no window.
 *
 * @example
 * ```ts
 * supportsSegmentedFocus(document.createElement('button')) // false
 * ```
 */
export function supportsSegmentedFocus(element: Element): boolean {
	const realm = element.ownerDocument.defaultView
	return (
		realm !== null &&
		element instanceof realm.HTMLInputElement &&
		SEGMENTED_INPUT_TYPES.includes(element.type)
	)
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
 * This is the one loop every traversal verb shares, over {@link stepFocus}. A step counts only when
 * focus lands on an element. Consecutive landings on the same native segmented input continue
 * through its segments up to {@link FOCUS_SEGMENT_LIMIT} landings and count that control once.
 * A longer run or any other revisit ends the traversal. Any different landing starts a separate run.
 * The press cap is {@link FOCUS_SEGMENT_LIMIT} times the {@link FOCUSABLE_SELECTOR} candidate count
 * plus ten, so a page of segmented inputs has a budget for their segments and picker indicators.
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
	// A Tab pressed before the page has real input focus moves nothing, so a step counts only when
	// focus actually lands somewhere. The traversal is over when focus revisits an element, which is
	// one full cycle of the tab order, except a segmented input's next segment within its budget.
	// The target is re-resolved on every step, because a framework may replace the node between
	// resolution and focus arrival: the person's target is the role and name, never one node.
	const cap =
		document.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR).length * FOCUS_SEGMENT_LIMIT + 10
	const visited = new Set<Element>()
	const landings: Array<HTMLElement | undefined> = []
	for await (const focused of stepFocus(cap)) {
		const previous = landings.at(-1)
		landings.push(focused)
		if (focused === undefined) continue
		try {
			const current = resolve()
			if (focused === current) return current
		} catch {
			continue
		}
		if (
			focused === previous &&
			supportsSegmentedFocus(focused) &&
			landings.length - landings.findLastIndex((landing) => landing !== focused) - 1 <=
				FOCUS_SEGMENT_LIMIT
		)
			continue
		if (visited.has(focused)) break
		visited.add(focused)
	}
	const trail = [...new Set(landings)]
		.filter((focused) => focused !== undefined)
		.filter((focused) => visited.has(focused))
		.map((focused) => `${focused.tagName}:${focused.innerText.slice(0, 20)}`)
	throw new Error(
		`Interactive target "${name}" is not reachable through forward Tab traversal: ${trail.join(' > ')}`,
	)
}

/**
 * Walks forward by real Tab presses from the focused element until a predicate accepts a stop or
 * the Tab order ends.
 *
 * @param stop - Accepts the destination. Omit it to census the remaining document.
 * @returns Every element focus reached, in order and each once, the accepted stop last.
 * @throws Thrown when the walk exceeds its press cap, a key press rejects, or focus lands in a
 * frame from another origin.
 *
 * @remarks
 * The walk records the focused element and then presses Tab through {@link stepFocus}, so it reaches
 * what the browser's own sequential navigation reaches, including a scroll container Chromium
 * focuses without a `tabindex`. The static {@link describeFocus} sort does not. Each stop is the
 * innermost focused element {@link readActiveElement} reads, so a control inside an open shadow root
 * or a same-origin frame is a stop of its own, and its host or frame element is not. The walk ends
 * with an empty list when only the body holds focus, and where focus revisits a stop or returns to
 * the body. Consecutive landings on the same native segmented input continue through its segments
 * up to {@link FOCUS_SEGMENT_LIMIT} landings, including the initial focused element, and count that
 * control once. A longer run or any other revisit, including a repeated button in a focus trap,
 * ends the walk. Any different landing starts a separate run.
 * The press cap is {@link FOCUS_SEGMENT_LIMIT} times {@link countElements}, including
 * open shadow roots and same-origin frames. It applies no rule about which stop counts: the
 * predicate sees each one and decides, so a consumer that refuses a hidden stop throws from its own
 * predicate.
 *
 * A closed shadow root cannot be entered, so its host stands for everything inside it, and a frame
 * from another origin is refused because its controls cannot be named.
 *
 * @example
 * ```ts
 * const stops = await walkFocus((focused) => focused.id === 'save')
 * ```
 */
export async function walkFocus(
	stop?: (element: HTMLElement) => boolean,
): Promise<readonly HTMLElement[]> {
	const first = readActiveElement()
	if (first === undefined) return []
	const reached: HTMLElement[] = [first]
	const landings: HTMLElement[] = [first]
	if (stop?.(first) === true) return reached
	for await (const focused of stepFocus(countElements() * FOCUS_SEGMENT_LIMIT)) {
		if (focused === undefined) return reached
		const previous = landings.at(-1)
		landings.push(focused)
		if (
			focused === previous &&
			supportsSegmentedFocus(focused) &&
			landings.length - landings.findLastIndex((landing) => landing !== focused) - 1 <=
				FOCUS_SEGMENT_LIMIT
		)
			continue
		if (reached.includes(focused)) return reached
		reached.push(focused)
		if (stop?.(focused) === true) return reached
	}
	throw new Error('Focus traversal did not end')
}

/**
 * Collects the elements of a region that a forward Tab walk reaches from a starting element.
 *
 * @param root - The region whose stops are collected; the walk ends where focus leaves it.
 * @param start - The element that takes focus first. It is not a stop, and it need not sit in
 * the region.
 * @returns The region's Tab stops in order, including a scroll container Chromium focuses
 * automatically.
 * @throws Thrown when `start` cannot take focus, and whatever {@link walkFocus} throws.
 *
 * @remarks
 * The walk is {@link walkFocus} from `start` with the region's edge as its stop, so a stop outside
 * `root` ends the walk and is left out of the result. A stop belongs to the region by
 * {@link containsNode}, so a control inside an open shadow root or a same-origin frame that `root`
 * holds is in the region, and `start` may sit inside one. A `start` that sits outside the region,
 * as the control immediately before it, is the walk's origin and never its end, so the first Tab into the
 * region reaches its first stop. A native segmented input contributes one stop while consecutive
 * landings pass through its segments up to {@link FOCUS_SEGMENT_LIMIT} landings. A longer run or
 * any other revisit ends the walk.
 *
 * @example
 * ```ts
 * const stops = await collectTabStops(screen, heading)
 * ```
 */
export async function collectTabStops(
	root: Element,
	start: HTMLElement,
): Promise<readonly HTMLElement[]> {
	start.focus()
	if (readActiveElement() !== start) throw new Error('The start element cannot take focus')
	const reached = await walkFocus((focused) => focused !== start && !containsNode(root, focused))
	return reached.filter((stop) => stop !== start && containsNode(root, stop))
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
 * `undefined` when focus rests on a non-HTML element, inside a shadow root or not. When nothing holds
 * focus, the browser reports the document body as active, so the whole page's rendered text returns.
 * @throws Thrown when focus sits in a frame from another origin, as {@link readActiveElement} refuses.
 *
 * @remarks
 * The focused element is read through {@link readActiveElement}, so a control focused inside an open
 * shadow root or a same-origin frame answers, not its host or its frame. The page text returns only
 * when the document's active element is its body, and never as a fallback for a focused element
 * that {@link readActiveElement} declines.
 *
 * @example
 * ```ts
 * await traverseAccessible('Evaluate')
 * readFocus() // 'Evaluate'
 * ```
 */
export function readFocus(): string | undefined {
	const deep = readActiveElement()
	if (deep !== undefined) return deep.innerText.trim()
	return document.activeElement === document.body ? document.body.innerText.trim() : undefined
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
 * rest: a resolver that returned and an untrusted getter that threw `undefined` are different findings,
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
		// value and therefore reads an untrusted `throw undefined` as a resolver that returned.
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
 * offers several rows at once, a `section` is a region only after something names it, and a `th`
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
 * @returns A promise resolving after every finite animation has stopped running.
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
			const running = readAnimations(element).finite
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
 * Reads the animations running on one element and its subtree, split by whether each one ends.
 *
 * @param element - The element whose own animations and descendants' animations to read.
 * @returns The running animations that end, and the running animations whose effect declares
 * infinite iterations.
 *
 * @remarks
 * The split is the one {@link waitForAnimations} waits by: it waits on `finite` and leaves
 * `endless` running. A paused, an idle, and a finished animation are at rest, so neither
 * list holds one. A detached element runs no animation and reads as two empty lists.
 *
 * @example
 * ```ts
 * readAnimations(document.documentElement).finite.length // 0 once every transition has settled
 * ```
 */
export function readAnimations(element: Element): AnimationReading {
	const running = element
		.getAnimations({ subtree: true })
		.filter((animation) => animation.playState === 'running')
	return {
		finite: running.filter((animation) =>
			Number.isFinite(animation.effect?.getTiming().iterations ?? 1),
		),
		endless: running.filter(
			(animation) => !Number.isFinite(animation.effect?.getTiming().iterations ?? 1),
		),
	}
}

/**
 * Settles the page for one capture: parks the pointer, waits out every finite animation, and holds
 * each endless animation at its first frame.
 *
 * @param options - The time bounds of the wait, its abort signal, and whether the pointer parks.
 * @returns A promise resolving, after one more frame has painted, to the resume: a function that
 * sets every held animation running again.
 * @throws Thrown when the pointer cannot park, as {@link parkPointer} raises it, and when a finite
 * animation is still running at the budget, as {@link waitForAnimations} raises it. An aborted wait
 * rejects with the signal's reason.
 *
 * @remarks
 * A pointer left over a control paints that control's hover, and a transition still running paints
 * a fill between two states, so neither is a state the interface rests in. An endless animation, a
 * spinner or a placeholder shimmer, stands at a different phase in every frame unless it is held at
 * the same one, so each is paused at its first frame. Call the resume after the frame is shot; a
 * capture that throws still owes it, so call it from a `finally` block.
 *
 * The subject is the whole document, its root element included. The pointer parks through
 * {@link parkPointer}, which sends no button release, so a held press stays held either way. Pass
 * `pointer: false` only where the pointer is part of the state, such as a drag in flight: the
 * control under it then keeps its hover and its pressed paint. Default budget: `1000` milliseconds.
 *
 * @example
 * ```ts
 * const resume = await settleCapture()
 * try {
 * 	await portfolio.place('start-empty')
 * } finally {
 * 	resume()
 * }
 * ```
 */
export async function settleCapture(options?: SettleOptions): Promise<() => void> {
	if (options?.pointer ?? true) await parkPointer()
	await waitForFrame()
	await waitForAnimations(document.documentElement, options)
	const held = readAnimations(document.documentElement).endless
	for (const animation of held) {
		animation.pause()
		animation.currentTime = 0
	}
	await waitForFrame()
	return () => {
		for (const animation of held) animation.play()
	}
}

/**
 * Collects the rendered boxes a person can scroll.
 *
 * @param root - The element whose subtree is searched, the root included.
 * @param axis - The scroll axis to keep: `'inline'` for boxes that scroll across, `'block'` for
 * boxes that scroll down. Omit it to keep both.
 * @returns Each rendered element, in document order, whose resolved overflow scrolls on a searched
 * axis where its content is larger than its box.
 *
 * @remarks
 * A screenshot shows no scrollbar where the browser overlays them, so a frame alone never tells
 * that a pane scrolls or how far. A box counts when its `overflow-x` or `overflow-y` value is the
 * `auto` keyword or the `scroll` keyword and its content overflows on that axis; a `hidden` or
 * `clip` box cuts its content without letting anyone scroll it, and a box whose content fits has
 * nowhere to go. An element that {@link isRendered} reports false for is left out, because a person
 * cannot scroll a box the page does not show.
 *
 * @example
 * ```ts
 * collectScrollRegions(document.documentElement).map((region) => region.id)
 * collectScrollRegions(document.documentElement, 'inline').map((region) => region.id)
 * ```
 */
export function collectScrollRegions(
	root: Element,
	axis?: 'inline' | 'block',
): readonly HTMLElement[] {
	return [root, ...root.querySelectorAll('*')].filter((element): element is HTMLElement => {
		if (!(element instanceof HTMLElement) || !isRendered(element)) return false
		const style = getComputedStyle(element)
		const inline =
			['auto', 'scroll'].includes(style.overflowX) && element.scrollWidth > element.clientWidth
		const block =
			['auto', 'scroll'].includes(style.overflowY) && element.scrollHeight > element.clientHeight
		return (axis !== 'block' && inline) || (axis !== 'inline' && block)
	})
}

/**
 * Describes the window's scroll position and each scroll region's offsets and extents.
 *
 * @param regions - The regions to describe, as {@link collectScrollRegions} returns them.
 * @returns One line for the window, then one line per region with each offset beside the largest
 * offset that region reaches, or a line saying no region overflows.
 *
 * @remarks
 * The window line reads `window <w>x<h> scroll <x>,<y> of <x>,<y>`. Each region line reads
 * `scroll <tag>#<id> "<name>": left <x>/<x> top <y>/<y> box <w>x<h> content <w>x<h>`, where the id
 * and the accessible name appear only when the region carries them and the name is cut to 40
 * characters. Record it beside a frame, so the journey's output says which panes scroll and where
 * each one stood when the picture was taken.
 *
 * @example
 * ```ts
 * describeScrollRegions(collectScrollRegions(document.documentElement))
 * ```
 */
export function describeScrollRegions(regions: readonly HTMLElement[]): string {
	const root = document.documentElement
	return [
		`window ${String(innerWidth)}x${String(innerHeight)} scroll ${String(scrollX)},${String(scrollY)} of ${String(root.scrollWidth - innerWidth)},${String(root.scrollHeight - innerHeight)}`,
		...(regions.length === 0
			? ['no scroll region overflows']
			: regions.map((region) => {
					const name = readName(region).slice(0, 40)
					return `scroll ${region.localName}${region.id === '' ? '' : `#${region.id}`}${name === '' ? '' : ` "${name}"`}: left ${String(region.scrollLeft)}/${String(region.scrollWidth - region.clientWidth)} top ${String(region.scrollTop)}/${String(region.scrollHeight - region.clientHeight)} box ${String(region.clientWidth)}x${String(region.clientHeight)} content ${String(region.scrollWidth)}x${String(region.scrollHeight)}`
				})),
	].join('\n')
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
