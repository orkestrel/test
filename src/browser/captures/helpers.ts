import type { Color } from '../types.js'
import type {
	CaptureVariant,
	FrameOffset,
	FrameOptions,
	FrameReading,
	MediaOptions,
	StabilityOptions,
} from './types.js'
import { waitForCondition } from '@src/core'
import { commands, page } from 'vitest/browser'
import { readStyle, sendProtocol, waitForFrame } from '../helpers.js'
import { CAPTURE_PANE, CAPTURE_STAGINGS, MEDIA_STAGE } from './constants.js'

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
 * Measures the block size an element shows after every clipping ancestor cuts it.
 *
 * @param element - The element to read.
 * @returns The height in CSS pixels of the part of the element's box that lies inside the clip of
 * every ancestor that clips its overflow, and `0` where none of it does.
 * @throws Thrown when the element is not connected to a document.
 *
 * @remarks
 * The `getBoundingClientRect` method reports the whole box of a clipped element, so a bar taller
 * than its frame still reads its own height there; this reading is the height a person sees. An
 * ancestor clips where the {@link clipsOverflow} helper says so, and the {@link collectClippingAncestors}
 * helper finds it through the flat tree, so a wrapper in a shadow tree around the element or around
 * its slot counts. Its top edge is the top of its
 * padding box, and its bottom edge is the one the {@link readClipEdge} helper measures, so a paint
 * containment and an `overflow-clip-margin` length count. That edge comes in document coordinates
 * and is converted into the viewport coordinates the box is read in, so a scrolled page reads the
 * same height as an unscrolled one.
 *
 * @example
 * ```ts
 * readClippedBlock(bar) // the frame's height where the frame clips a taller bar
 * ```
 */
export function readClippedBlock(element: Element): number {
	const box = element.getBoundingClientRect()
	const frames = collectClippingAncestors(element)
	const top = Math.max(
		box.top,
		...frames.map((frame) => frame.getBoundingClientRect().top + frame.clientTop),
	)
	const bottom = Math.min(
		box.bottom,
		...frames.flatMap((frame) => {
			const edge = readClipEdge(frame)
			return edge === undefined ? [] : [edge - window.scrollY]
		}),
	)
	return Math.max(0, bottom - top)
}

/**
 * Collects the ancestors of an element that clip their descendants' overflow.
 *
 * @param element - The element whose ancestors to read.
 * @returns Every ancestor element for which the {@link clipsOverflow} helper reports true, nearest
 * first, and an empty list where the element has none.
 * @throws Thrown when the element is not connected to a document, because a disconnected element
 * resolves no style and its ancestors would all read as clipping.
 *
 * @remarks
 * The walk climbs the flat tree, the tree a browser paints. A step goes to the slot an element is
 * assigned to, else to its parent element, else to the host of the shadow root it stands in. So the
 * wrapper around a slot clips the child assigned to that slot, a shadow tree's wrappers clip what
 * stands in it and then what its host stands in, and the walk ends at the root element, which has
 * none of the three. The `assignedSlot` property reports no slot of a closed shadow root, so a
 * child assigned into one climbs through its light parent instead. The element itself is not one of
 * its own ancestors. Each step returns its own parent's frame, if it is one, ahead of the frames
 * above it, so the depth of the flat tree bounds the recursion.
 *
 * @example
 * ```ts
 * collectClippingAncestors(bar) // [frame] where a hidden-overflow frame wraps the bar
 * ```
 */
export function collectClippingAncestors(element: Element): readonly Element[] {
	if (!element.isConnected) {
		throw new Error(
			'The element is not connected to a document, so it has no clipping ancestors to read',
		)
	}
	const realm = element.ownerDocument.defaultView
	const scope = element.getRootNode()
	const parent =
		element.assignedSlot ??
		element.parentElement ??
		(realm !== null && scope instanceof realm.ShadowRoot ? scope.host : null)
	if (parent === null) return []
	return [...(clipsOverflow(parent) ? [parent] : []), ...collectClippingAncestors(parent)]
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
 * that clips its overflow, which the {@link collectClippingAncestors} helper finds through the flat
 * tree and so reaches a shadow wrapper around a slot, caps the contribution at that ancestor's clip
 * edge, which the {@link readClipEdge} helper measures, because the rows a descendant lays out past a clipping
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
		const limits = collectClippingAncestors(element)
			.filter((frame) => frame !== document.body && frame !== document.documentElement)
			.flatMap((frame) => {
				const limit = readClipEdge(frame)
				return limit === undefined ? [] : [limit]
			})
		const bottom = Math.min(
			element.getBoundingClientRect().bottom +
				window.scrollY +
				readPixels(element, 'margin-bottom'),
			...limits,
		)
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
 * Computes how far an element frame moves the tester frame so the element is shot inside the
 * runner's window.
 *
 * @param box - The element's box in the runner window's coordinates, with the tester frame at the
 * window's origin.
 * @param width - The runner window's width in CSS pixels.
 * @param height - The runner window's height in CSS pixels.
 * @returns The frame's move: zero on both axes where the frame stays at the origin.
 *
 * @remarks
 * The provider paints an element that fits the window only where the window shows it, so an element
 * that fits and lies past the window's bottom or right edge moves up or left only as far as brings
 * it inside. Each edge is rounded up to the next whole row or column first, because the shot is
 * clipped to whole rows and columns, and the move is bounded so the element's opposite edge never
 * passes the window's start: an element starting half a row down moves by no more than that half
 * row. An axis whose far edge already lies inside the window, a fractional window edge included,
 * does not move. An element too large for the window is shot beyond the viewport, so it is not
 * moved either.
 *
 * @example
 * ```ts
 * computeOffset(new DOMRectReadOnly(0, 744, 390, 100), 800, 513)
 * // { top: -331, left: 0 }
 * ```
 */
export function computeOffset(box: DOMRectReadOnly, width: number, height: number): FrameOffset {
	const fits = box.width <= width && box.height <= height
	return {
		top: fits && box.bottom > height ? Math.max(height - Math.ceil(box.bottom), -box.top) : 0,
		left: fits && box.right > width ? Math.max(width - Math.ceil(box.right), -box.left) : 0,
	}
}

/**
 * Stages the tester's print medium, motion preference, forced colours, and pointer precision through
 * the browser provider.
 *
 * @param options - The media axes to override.
 * @returns A promise resolving after a bounded read-back for `print: true`, either `motion` value,
 * either `forced` value, and either `pointer` value. A `print: false` stage is sent and followed by
 * a frame wait without a read-back.
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
 * A coarse pointer enables single-point touch emulation; a fine pointer disables it. Chromium also
 * changes `any-pointer` and the hover queries. An omitted pointer never sends a touch-emulation
 * command. The first pointer stage appends its pre-call coarse reading to the media marker.
 * {@link releaseTouch} disables a staged coarse pointer without changing that marker. Stage the
 * pointer again after touch cleanup when later steps need coarse precision.
 * A first pointer stage while {@link tapTouch} emulation is live records coarse. In teardown,
 * call {@link releaseMedia} before {@link releaseTouch}; reversing the order ends coarse.
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
	const pointer = options.pointer
	if (
		print === undefined &&
		motion === undefined &&
		forced === undefined &&
		pointer === undefined
	) {
		throw new Error('Media emulation was staged with nothing to emulate')
	}
	const media = matchMedia('print').matches ? 'print' : 'screen'
	const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches
	const dark = matchMedia('(prefers-color-scheme: dark)').matches
	const active = matchMedia('(forced-colors: active)').matches
	const coarse = matchMedia('(pointer: coarse)').matches
	if (!document.documentElement.hasAttribute(MEDIA_STAGE)) {
		document.documentElement.setAttribute(
			MEDIA_STAGE,
			[media === 'print', reduced, dark, active].map(Number).join(''),
		)
	}
	const staged = document.documentElement.getAttribute(MEDIA_STAGE)
	if (pointer !== undefined && staged?.length === 4) {
		document.documentElement.setAttribute(MEDIA_STAGE, `${staged}${Number(coarse)}`)
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
	if (pointer !== undefined) queries.push(`(pointer: ${pointer})`)
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
	if (pointer !== undefined) {
		await sendProtocol('Emulation.setTouchEmulationEnabled', {
			enabled: pointer === 'coarse',
			maxTouchPoints: 1,
		})
	}
	await waitForFrame()
	for (const query of queries) {
		try {
			await waitForCondition(query, () => matchMedia(query).matches)
		} catch (cause) {
			try {
				await sendProtocol('Emulation.setEmulatedMedia', { media, features })
				if (pointer !== undefined) {
					await sendProtocol('Emulation.setTouchEmulationEnabled', {
						enabled: coarse,
						maxTouchPoints: 1,
					})
				}
				await waitForCondition(
					'pre-call media readings restored',
					() =>
						matchMedia(media).matches &&
						(pointer === undefined ||
							matchMedia(`(pointer: ${coarse ? 'coarse' : 'fine'})`).matches) &&
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
 * Waits for a reading to hold across its last `frames + 1` reads, each later read taken after a
 * painted frame, with the interval slept between polls. Checks the budget between reads, so a frame
 * that never paints is not bounded by it.
 *
 * @param description - The wait described in a timeout error.
 * @param read - The reading to compare from read to read, such as a scroll position or a box.
 * @param options - The frame count, the time bounds, and the abort signal.
 * @returns A promise resolving after the last `frames + 1` reads agree.
 * @throws Thrown when the frame count is not a positive integer, when `read` throws, or when the
 * reading keeps changing until the budget runs out. The timeout error names the description.
 *
 * @remarks
 * The first read is immediate. Each later read follows one painted frame, and every later read but
 * the first also follows the interval, which `waitForCondition` sleeps between polls. The reads are
 * therefore not on consecutive frames: an interval longer than a frame skips the frames in between.
 * The wait ends when the last `frames + 1` reads agree, so a reading that settles on read `n`
 * resolves on read `n + frames`.
 *
 * The abort signal is checked between reads too, so neither the budget nor the signal ends a wait
 * parked on a frame that never paints. Default frames: `4`. Default budget: `1000` milliseconds.
 * Default interval: `10` milliseconds.
 *
 * @example
 * ```ts
 * await waitForStability('the panel holds its box', () =>
 *   JSON.stringify(panel.getBoundingClientRect().toJSON()),
 * )
 * ```
 */
export async function waitForStability(
	description: string,
	read: () => string,
	options?: StabilityOptions,
): Promise<void> {
	const frames = options?.frames ?? 4
	if (!Number.isInteger(frames) || frames < 1) {
		throw new Error('Stability frames must be a positive integer')
	}
	const readings = [read()]
	await waitForCondition(
		description,
		async () => {
			await waitForFrame()
			readings.push(read())
			const tail = readings.slice(-(frames + 1))
			return tail.length > frames && tail.every((reading) => reading === tail[0])
		},
		options,
	)
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
 * A fifth marker bit restores pointer precision through touch emulation. A four-bit marker or an
 * unstaged release leaves touch emulation alone. Restoring coarse precision uses one touch point;
 * the marker does not preserve a provider's earlier maximum touch-point count.
 * {@link releaseTouch} leaves this marker intact even when it disables a staged coarse pointer,
 * so media release still restores the reading recorded before the first pointer stage.
 * A first pointer stage while {@link tapTouch} emulation is live records coarse. In teardown,
 * call this release before {@link releaseTouch}; reversing the order restores coarse emulation
 * after touch cleanup.
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
		if (staged.length === 5) queries.push('(pointer: coarse)')
		await sendProtocol('Emulation.setEmulatedMedia', {
			media: readings[0] ? 'print' : 'screen',
			features: [
				{ name: 'prefers-reduced-motion', value: readings[1] ? 'reduce' : 'no-preference' },
				{ name: 'prefers-color-scheme', value: readings[2] ? 'dark' : 'light' },
				{ name: 'forced-colors', value: readings[3] ? 'active' : 'none' },
			],
		})
		if (staged.length === 5) {
			await sendProtocol('Emulation.setTouchEmulationEnabled', {
				enabled: readings[4],
				maxTouchPoints: 1,
			})
		}
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
	try {
		await waitForStability(
			'media emulation cleared',
			() => queries.map((query) => matchMedia(query).matches).join(),
			{ frames: 1 },
		)
	} catch (cause) {
		throw new Error('Media emulation did not clear from the tester', { cause })
	}
}

/**
 * Shoots one frame at one viewport size and proves the file on disk holds this run's bytes.
 *
 * @param options - The path to write, the viewport to shoot at, and the element to shoot.
 * @returns The absolute path of the written frame, after it has been read back and matched.
 * @throws Thrown when the pane cannot be staged, when the document's height or an element frame's
 * element height never settles under {@link CAPTURE_STAGINGS} restagings, when the provider wrote
 * the frame somewhere else, and when the bytes on disk are not the ones this shot produced.
 *
 * @remarks
 * The path a screenshot call returns is the path it meant to write, so it is not evidence a file
 * exists. The file is read back through the runner's built-in `readFile` command and compared with
 * the shot itself, which is what separates a frame this run wrote from one an earlier run left
 * behind. The provider resolves `options.path` against the calling test file and returns an absolute
 * path, so the two are compared by the segments that survive resolving `.` and `..` lexically — the
 * refusal is what a provider resolving that path against a different base would trip.
 *
 * A page frame covers the whole document at the declared width, whatever the declared height is. The
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
 * Omit the `element` option to shoot the whole page. An element that fits with its native scroll
 * clearance is shot in the declared pane, as is a short fixed panel that native alignment cannot
 * move. A sticky subject with a vertical start inset also keeps that pane when native end alignment
 * fits its box inside it; adding the start clearance would instead grow its viewport constraint.
 * These subjects' viewport lengths resolve against the declared viewport. Otherwise native start
 * alignment resolves the document's scroll clearance before the re-reading takes the element's
 * height plus the space above its aligned top. This includes an element shorter than the declared
 * pane whose height plus clearance exceeds it. The pane reserves room below authored scroll
 * padding and target scroll margins without interpreting CSS lengths or hiding overlays.
 * Clearance that changes with the viewport participates in the same bounded settling loop; a
 * frame that has not settled within that bound is refused with the same text.
 *
 * Where the element's box lies outside the pane, the tester's document is scrolled by the nearest
 * distance that would bring it inside, and the box is read again. A fixed element past the pane can
 * take a scroll that does not move it, and that scroll is handed back with the rest. Other short
 * elements keep their nearest native alignment when they need no additional room.
 *
 * The provider paints an element that fits the runner's window only where that window shows it.
 * Where such an element lies past the window, the calling tester frame is offset up or left only as
 * far as brings the element inside, and composited, which keeps a fixed element that starts past the
 * window's height from being culled. The {@link computeOffset} function computes that move. The
 * offset is written on that frame's own `style` attribute, where it outranks the placement the
 * {@link stagePane} function makes, and it depends on that placement's fixed position. The attribute
 * is restored as soon as the screenshot settles. An element inside the window, or too large for it,
 * is not offset.
 *
 * The capture sends no pointer input. The staging lifts the tester to the window's origin, a scroll
 * brings an element outside the pane into it, and an offset brings an element past the window
 * inside; each moves content under a pointer resting on the page. A pointer the case placed on the
 * element, with the pane already staged at the frame's size, keeps its hover in the frame where the
 * element lies inside both the pane and the runner window, because the capture then moves nothing.
 * No hover is promised after the pane is released.
 *
 * The pane is staged for the frame and released before this returns, on the failing path as well as
 * the passing one, which hands the tester back the viewport it had before the first staging. The
 * tester's scroll position is restored after that release, on every path, a rejected release
 * included.
 *
 * @example
 * ```ts
 * await captureFrame({ path: '../../tmp/capture/start.png', width: 390, height: 844 })
 * ```
 */
export async function captureFrame(options: FrameOptions): Promise<string> {
	const element = options.element
	const scroll = { left: window.scrollX, top: window.scrollY }
	try {
		await stagePane(options.width, options.height)
		let pane = options.height
		let covered: number | undefined
		let growth = 0
		for (let staging = 0; ; staging += 1) {
			let height = element?.getBoundingClientRect().height
			if (element !== undefined && height !== undefined && height > options.height) {
				// Native alignment resolves the document's scroll clearance, including computed
				// lengths, before the pane reserves room for the whole tall element below it.
				element.scrollIntoView({ block: 'start', inline: 'nearest', behavior: 'instant' })
				const aligned = element.getBoundingClientRect()
				height = aligned.height + Math.max(0, aligned.top)
			} else if (element !== undefined && height !== undefined) {
				const padding = readStyle(document.documentElement, 'scroll-padding-top')
				const margin = readStyle(element, 'scroll-margin-top')
				if ((padding !== 'auto' && padding !== '0px') || margin !== '0px') {
					element.scrollIntoView({ block: 'nearest', inline: 'nearest', behavior: 'instant' })
					if (element.getBoundingClientRect().bottom >= options.height) {
						let placement = { left: window.scrollX, top: window.scrollY }
						element.scrollIntoView({ block: 'start', inline: 'nearest', behavior: 'instant' })
						const aligned = element.getBoundingClientRect()
						if (aligned.bottom > options.height) {
							// A fixed panel that native alignment cannot move retains its declared
							// viewport. A movable element needs room for its start clearance too.
							element.scrollIntoView({ block: 'end', inline: 'nearest', behavior: 'instant' })
							const end = element.getBoundingClientRect()
							// A sticky subject can fit at its own inset while start clearance moves
							// it past the fold. Keep the fitted placement rather than growing a
							// viewport constraint. In-flow subjects retain their clearance below.
							const sticky =
								readStyle(element, 'position') === 'sticky' &&
								readStyle(element, 'top') !== 'auto' &&
								end.top >= 0 &&
								end.bottom <= pane
							if (sticky) placement = { left: window.scrollX, top: window.scrollY }
							if (!sticky && (pane > options.height || end.top !== aligned.top)) {
								height = aligned.height + Math.max(0, aligned.top)
								element.scrollIntoView({ block: 'start', inline: 'nearest', behavior: 'instant' })
							}
						}
						if (height <= options.height) window.scrollTo({ ...placement, behavior: 'instant' })
					}
				}
			}
			const reading = Math.max(
				height === undefined ? measureContent() : Math.ceil(height),
				options.height,
			)
			if (covered !== undefined) growth = Math.max(0, reading - covered)
			covered = reading
			if (pane === covered) break
			if (staging === CAPTURE_STAGINGS) {
				throw new Error(
					`Capture frame at ${options.path} never settled after ${String(CAPTURE_STAGINGS)} restagings: ${String(covered)} over a ${String(pane)} pane`,
				)
			}
			pane = covered + growth
			await stagePane(options.width, pane)
		}
		let shot: { readonly path: string; readonly base64: string }
		if (element === undefined) {
			shot = await page.screenshot({ path: options.path, base64: true })
		} else {
			const box = element.getBoundingClientRect()
			const down = box.top < 0 ? box.top : Math.max(0, box.bottom - window.innerHeight)
			const across = box.left < 0 ? box.left : Math.max(0, box.right - window.innerWidth)
			if (down !== 0 || across !== 0) {
				window.scrollBy({ top: down, left: across, behavior: 'instant' })
			}
			// The offset outranks the fixed placement the `stagePane` function writes, because an
			// inline declaration wins over a stylesheet one of equal importance, and it moves the frame
			// only because that placement is fixed at the window's origin.
			const frame = window.frameElement
			const view = window.top
			const placed = element.getBoundingClientRect()
			const move =
				view === null
					? { top: 0, left: 0 }
					: computeOffset(placed, view.innerWidth, view.innerHeight)
			const style = frame?.getAttribute('style') ?? null
			const offset = frame !== null && (move.top !== 0 || move.left !== 0)
			try {
				if (offset) {
					frame.setAttribute(
						'style',
						`${style ?? ''};top:${String(move.top)}px !important;left:${String(move.left)}px !important;will-change:transform`,
					)
					await waitForFrame()
					await waitForFrame()
				}
				shot = await page.screenshot({ element, path: options.path, base64: true })
			} finally {
				if (offset && style === null) frame.removeAttribute('style')
				else if (offset && style !== null) frame.setAttribute('style', style)
			}
		}
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
		try {
			await releasePane()
		} finally {
			window.scrollTo({ left: scroll.left, top: scroll.top, behavior: 'instant' })
		}
	}
}

/**
 * Decodes a base64 PNG and paints it, unscaled, onto a fresh offscreen 2D canvas.
 *
 * @param encoded - The image's bytes as base64 text, without a data-URL prefix.
 * @returns The canvas's 2D context, whose `canvas` holds the image's size in device pixels, or
 * `undefined` when the browser hands out no 2D context.
 * @throws The decode failure, as the rejection of the image's own `decode` call, when the bytes are
 * not an image this browser decodes.
 *
 * @remarks
 * This is the decode and the draw that {@link readFrame} and {@link readShotPixel} share, which
 * leaves each of them its own words for a refusal: a frame names the path it was read from and the
 * size its header declares, and a shot names neither. The decode failure is handed on unchanged so
 * the caller can read the bytes it rejected, and the missing context is a value rather than a throw
 * for the same reason. The image is drawn at its natural size, so the canvas holds one canvas pixel
 * for each device pixel of the image.
 *
 * @example
 * ```ts
 * const context = await paintImage(encoded)
 * const [red, green, blue] = context?.getImageData(0, 0, 1, 1).data ?? []
 * ```
 */
export async function paintImage(
	encoded: string,
): Promise<OffscreenCanvasRenderingContext2D | undefined> {
	const image = new Image()
	image.src = `data:image/png;base64,${encoded}`
	await image.decode()
	const context = new OffscreenCanvas(image.width, image.height).getContext('2d')
	context?.drawImage(image, 0, 0)
	return context ?? undefined
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
 * A file that opens with a PNG header and still does not decode is refused with the size that header
 * declares, in device pixels:
 * `Capture frame at <path> is not an image this browser decodes: <w>x<h> device pixels`.
 * A file with no PNG header is refused without a size.
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
	const context = await paintImage(encoded).catch((cause: unknown) => {
		// The PNG signature and the IHDR chunk's type fill the first 16 bytes, and the chunk opens
		// with the width and the height as big-endian 32-bit integers.
		const header = atob(encoded.slice(0, 32))
		if (header.startsWith('\x89PNG\r\n\x1A\n') && header.slice(12, 16) === 'IHDR') {
			const view = new DataView(Uint8Array.from(header, (byte) => byte.charCodeAt(0)).buffer)
			if (view.byteLength >= 24) {
				throw new Error(
					`Capture frame at ${path} is not an image this browser decodes: ${String(view.getUint32(16))}x${String(view.getUint32(20))} device pixels`,
					{ cause },
				)
			}
		}
		throw new Error(`Capture frame at ${path} is not an image this browser decodes`, { cause })
	})
	if (context === undefined) {
		throw new Error(`Capture frame at ${path} cannot be measured without a 2D canvas`)
	}
	const { width, height } = context.canvas
	const row = context.getImageData(0, height - 1, width, 1).data
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
		width,
		height,
		floor: single ? `rgb(${String(red)}, ${String(green)}, ${String(blue)})` : undefined,
	}
}

/**
 * Reads one painted pixel of an element's screenshot.
 *
 * @param element - The rendered element to shoot.
 * @param x - The pixel's horizontal position as a fraction of the shot's width, from `0` to `1`.
 * @param y - The pixel's vertical position as a fraction of the shot's height, from `0` to `1`.
 * @returns The pixel's frozen color: its channels from 0 to 255 and its alpha from 0 to 1.
 * @throws Thrown when either position is not a finite fraction from `0` to `1`, when the provider
 * cannot shoot the element, when the shot is not an image this browser decodes, and when the browser
 * hands out no 2D canvas to measure it on.
 *
 * @remarks
 * The runner scales the tester to fit its window, so a shot's size in device pixels is not the
 * element's size in CSS pixels. The position is therefore a fraction of the shot rather than an
 * offset, and a fraction of `1` reads the last row or column rather than one past it. A position
 * that is `NaN`, infinite, or outside `0` to `1` is refused before the shot is taken, because it
 * would read outside the shot as a transparent black nothing painted, or coerce to an edge. The
 * decode and the canvas come from {@link paintImage}, which {@link readFrame} reads through as well.
 * The shot is not saved. The reading is what the provider painted, so it answers for compositing, stacking, and
 * clipping that a computed style cannot see; it composes with `matchesColor` and `measureContrast`.
 *
 * @example
 * ```ts
 * const [red, green, blue] = await readShotPixel(figure, 0.5, 0.5)
 * ```
 */
export async function readShotPixel(element: Element, x: number, y: number): Promise<Color> {
	if (!(x >= 0 && x <= 1 && y >= 0 && y <= 1)) {
		throw new Error('Shot pixel position must be a fraction from 0 to 1')
	}
	const encoded = await page.screenshot({ element, save: false })
	const context = await paintImage(encoded).catch((cause: unknown) => {
		throw new Error('Shot is not an image this browser decodes', { cause })
	})
	if (context === undefined) throw new Error('Shot cannot be measured without a 2D canvas')
	const { width, height } = context.canvas
	const [red = 0, green = 0, blue = 0, alpha = 0] = context.getImageData(
		Math.min(width - 1, Math.floor(width * x)),
		Math.min(height - 1, Math.floor(height * y)),
		1,
		1,
	).data
	return Object.freeze([red, green, blue, alpha / 255])
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
