import type { ElementOptions } from './types.js'
import { invokeUnchecked, readProperty } from '@src/core'
import { cdp } from 'vitest/browser'

/**
 * Sends one DevTools protocol command through the browser provider.
 *
 * @param method - The protocol method name.
 * @param params - The protocol parameters. Omit them for a command that takes none.
 * @returns A promise resolving to the browser's reply once the command completes.
 * @throws Thrown when the provider exposes no DevTools session, or the command fails.
 *
 * @remarks
 * The reply is typed `unknown`, because its shape is the command's and the provider's types stay out
 * of a browser file. Narrow it with guards before reading a field.
 *
 * @example
 * ```ts
 * await sendProtocol('Emulation.setEmulatedMedia', { media: '', features: [] })
 * ```
 */
export async function sendProtocol(
	method: string,
	params?: Readonly<Record<string, unknown>>,
): Promise<unknown> {
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
	const reply = await invokeUnchecked<Promise<unknown>>(session, send, [method, params])
	return reply
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
