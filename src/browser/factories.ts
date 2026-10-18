/**
 * Creates one real pointer event, ready to dispatch.
 *
 * @param name - The event type, such as `pointerdown`.
 * @param options - Any `PointerEventInit` member, each one overriding the default beneath it.
 * @returns A real `PointerEvent` of that type.
 *
 * @remarks
 * The defaults are what a browser's own pointer event carries and a hand-built one does not:
 * `bubbles` and `cancelable` are set, so a delegated listener hears it and a handler can prevent it,
 * and `pointerId`, `pointerType`, and `isPrimary` describe a single primary mouse, so a component
 * that branches on the pointer kind takes the branch a mouse takes. Override any of them by naming
 * it; a touch is `{ pointerType: 'touch' }` and nothing else has to be restated.
 *
 * The event is real rather than a shaped object, so `instanceof PointerEvent` holds and the
 * coordinate and modifier members a handler reads are the ones the platform defines.
 *
 * @example
 * ```ts
 * element.dispatchEvent(createPointerEvent('pointerdown', { clientX: 10, clientY: 20 }))
 * ```
 */
export function createPointerEvent(name: string, options?: PointerEventInit): PointerEvent {
	return new PointerEvent(name, {
		bubbles: true,
		cancelable: true,
		pointerId: 1,
		pointerType: 'mouse',
		isPrimary: true,
		...options,
	})
}

/**
 * Creates one real drag event carrying a live data transfer, ready to dispatch.
 *
 * @param name - The event type, such as `dragstart`.
 * @param options - Any `DragEventInit` member, each one overriding the default beneath it.
 * @returns A real `DragEvent` of that type.
 *
 * @remarks
 * A drag event with no `dataTransfer` is the shape that makes a drop handler fail in a test and work
 * in a browser, so one is allocated. Pass your own to seed it: a `dataTransfer` given in `options`
 * replaces the allocated one, which is how a drop is driven with the payload the drag was supposed
 * to carry.
 *
 * The platform declares the `dataTransfer` member on the constructed event as nullable, so calling
 * code still narrows it even though this always supplies one.
 *
 * `bubbles` and `cancelable` are set, because a drop handler that never prevents the default event
 * is a drop the browser handles itself.
 *
 * @example
 * ```ts
 * const started = createDragEvent('dragstart')
 * started.dataTransfer?.setData('text/plain', 'row-3')
 * element.dispatchEvent(started)
 * ```
 */
export function createDragEvent(name: string, options?: DragEventInit): DragEvent {
	return new DragEvent(name, {
		bubbles: true,
		cancelable: true,
		dataTransfer: new DataTransfer(),
		...options,
	})
}

/**
 * Creates one real keyboard event, ready to dispatch.
 *
 * @param name - The event type, such as `keydown`.
 * @param options - Any `KeyboardEventInit` member, each one overriding the default beneath it.
 * @returns A real `KeyboardEvent` of that type.
 *
 * @remarks
 * A bare `new KeyboardEvent('keydown')` neither bubbles nor can be cancelled, so a delegated listener
 * never hears it and `preventDefault` does nothing, which is the shape that passes in a test and
 * fails in a browser. `bubbles` and `cancelable` are set, as a browser's own key event carries them.
 * Override either by naming it; every other member, such as `key`, `code`, and the modifiers, is the
 * platform's own and is named in `options`.
 *
 * The event is real rather than a shaped object, so `instanceof KeyboardEvent` holds and the members
 * a handler reads are the ones the platform defines.
 *
 * @example
 * ```ts
 * element.dispatchEvent(createKeyboardEvent('keydown', { key: 'Escape' }))
 * ```
 */
export function createKeyboardEvent(name: string, options?: KeyboardEventInit): KeyboardEvent {
	return new KeyboardEvent(name, { bubbles: true, cancelable: true, ...options })
}
