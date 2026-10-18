import type { ChooserRequest } from '@src/core'
import type { FileChooser, Page } from 'playwright'
import type { ChooserContext } from './types.js'
import { Buffer } from 'node:buffer'
import { checkBounds, waitForEvent } from '@src/core'

/**
 * Observes a native chooser before activating its input and supplies the verified chooser's fixture bytes.
 *
 * @param context - The real Playwright page and tester frame supplied by Vitest.
 * @param request - The resolved input selector, fixture selection, activation method, and wait budget.
 * @returns A promise resolving after the expected chooser receives the files and its observer is released.
 * @throws When activation fails, no chooser opens, another input opens it, the page closes, or fixture bytes are invalid.
 * @remarks Register this function as `chooseFiles` in Vitest's `test.browser.commands`. It never falls back to direct file assignment.
 * @example
 * ```ts
 * const browser = { commands: { chooseFiles } }
 * ```
 */
export async function chooseFiles(context: ChooserContext, request: ChooserRequest): Promise<void> {
	const budget = request.budget ?? 1000
	checkBounds('File chooser', budget, 0)
	if (budget === 0) throw new Error('File chooser budget must be positive')
	const files = request.files.map((file) => {
		if (file.bytes.some((byte) => !Number.isInteger(byte) || byte < 0 || byte > 255))
			throw new Error('Fixture file bytes must be integers from 0 to 255')
		return { name: file.name, mimeType: file.mime, buffer: Buffer.from(file.bytes) }
	})
	const target = await context.iframe.locator(request.selector).elementHandle({ timeout: budget })
	if (target === null) throw new Error('Native file input disappeared before activation')
	const controller = new AbortController()
	let chooser: FileChooser | undefined
	try {
		if (
			!(await target.evaluate(
				(element) =>
					element.nodeName === 'INPUT' && element.getAttribute('type')?.toLowerCase() === 'file',
			))
		)
			throw new Error('Resolved target is not a native file input')
		if (
			request.keyboard &&
			!(await target.evaluate((element) => element === element.ownerDocument.activeElement))
		)
			throw new Error('Native file input lost keyboard focus before activation')
		const observed = waitForEvent<readonly [event: FileChooser | Page]>(
			(listener) => {
				context.page.on('filechooser', listener)
				context.page.on('close', listener)
				return () => {
					context.page.off('filechooser', listener)
					context.page.off('close', listener)
				}
			},
			'native file chooser',
			{ budget, signal: controller.signal },
		)
		const activated = request.keyboard
			? target.press('Enter', { timeout: budget })
			: target.click({ timeout: budget })
		try {
			await Promise.all([observed, activated])
		} finally {
			controller.abort()
			const [result] = await Promise.allSettled([observed, activated])
			if (result.status === 'fulfilled') {
				const [event] = result.value
				if ('element' in event) chooser = event
			}
		}
		if (chooser === undefined) throw new Error('Page closed before the native file chooser opened')
		if (!(await chooser.element().evaluate((element, expected) => element === expected, target)))
			throw new Error('Native file chooser belongs to a different input')
		await chooser.setFiles(files, { timeout: budget })
	} finally {
		controller.abort()
		await Promise.all([chooser?.element().dispose(), target.dispose()])
	}
}
