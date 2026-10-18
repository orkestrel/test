import { chooseFiles } from '@src/server'
import { createRecorder } from '@src/core'
import { createChooserFixture, readChooserListeners } from '../../setupServer.js'
import { describe, expect, it } from 'vitest'

describe('chooseFiles', () => {
	it('observes a real chooser on each selection and removes its observers', async () => {
		const fixture = await createChooserFixture()
		try {
			const choosers = createRecorder()
			fixture.page.on('filechooser', choosers.handler)
			const listeners = readChooserListeners(fixture.page, 'filechooser')
			const closing = readChooserListeners(fixture.page, 'close')
			const request = { selector: fixture.duplicate, files: [] }
			await expect(chooseFiles(fixture, request)).rejects.toThrow('strict mode violation')
			expect(readChooserListeners(fixture.page, 'filechooser')).toBe(listeners)
			for (const files of [[{ name: 'a.txt', mime: 'text/plain', bytes: [65] }], []]) {
				await chooseFiles(fixture, { selector: fixture.selector, files })
				expect(readChooserListeners(fixture.page, 'filechooser')).toBe(listeners)
				expect(readChooserListeners(fixture.page, 'close')).toBe(closing)
			}
			expect(choosers.count).toBe(2)
		} finally {
			await fixture.browser.close()
		}
	})

	it('releases observers after a missing chooser, a wrong chooser, and a blocked native click', async () => {
		const fixture = await createChooserFixture()
		try {
			const input = fixture.iframe.getByLabel('Attachments')
			const listeners = readChooserListeners(fixture.page, 'filechooser')
			const closing = readChooserListeners(fixture.page, 'close')
			await input.evaluate((element) =>
				element.addEventListener('click', (event) => event.preventDefault(), { once: true }),
			)
			await expect(
				chooseFiles(fixture, { selector: fixture.selector, files: [], budget: 150 }),
			).rejects.toThrow('was not delivered')
			expect(readChooserListeners(fixture.page, 'filechooser')).toBe(listeners)
			expect(readChooserListeners(fixture.page, 'close')).toBe(closing)
			await input.evaluate((element) =>
				element.addEventListener(
					'click',
					(event) => {
						event.preventDefault()
						const other = element.ownerDocument.querySelectorAll('input')[1]
						if (other === undefined) throw new Error('Missing other input')
						other.showPicker()
					},
					{ once: true },
				),
			)
			await expect(chooseFiles(fixture, { selector: fixture.selector, files: [] })).rejects.toThrow(
				'belongs to a different input',
			)
			expect(readChooserListeners(fixture.page, 'filechooser')).toBe(listeners)
			expect(readChooserListeners(fixture.page, 'close')).toBe(closing)
			await input.evaluate((element) => element.setAttribute('disabled', ''))
			await expect(
				chooseFiles(fixture, { selector: fixture.selector, files: [], budget: 150 }),
			).rejects.toThrow(/Timeout|was not delivered/u)
			expect(readChooserListeners(fixture.page, 'filechooser')).toBe(listeners)
			expect(readChooserListeners(fixture.page, 'close')).toBe(closing)
		} finally {
			await fixture.browser.close()
		}
	})

	it('releases pending observers when the page is destroyed', async () => {
		const fixture = await createChooserFixture()
		try {
			const input = fixture.iframe.getByLabel('Attachments')
			const listeners = readChooserListeners(fixture.page, 'filechooser')
			await input.evaluate((element) =>
				element.addEventListener('click', (event) => {
					event.preventDefault()
					console.log('chooser-clicked')
				}),
			)
			const clicked = fixture.page.waitForEvent('console', {
				predicate: (message) => message.text() === 'chooser-clicked',
				timeout: 1000,
			})
			const choice = chooseFiles(fixture, { selector: fixture.selector, files: [] })
			const rejected = choice.catch((error: unknown) => error)
			await clicked
			await fixture.page.close()
			expect(await rejected).toMatchObject({
				message: 'Page closed before the native file chooser opened',
			})
			expect(readChooserListeners(fixture.page, 'filechooser')).toBe(listeners)
		} finally {
			await fixture.browser.close()
		}
	})

	it('refuses invalid bytes and an unbounded provider wait before activation', async () => {
		const fixture = await createChooserFixture()
		try {
			const events = createRecorder()
			fixture.page.on('filechooser', events.handler)
			await expect(
				chooseFiles(fixture, {
					selector: fixture.selector,
					files: [{ name: 'bad', mime: '', bytes: [256] }],
				}),
			).rejects.toThrow('Fixture file bytes')
			await expect(
				chooseFiles(fixture, { selector: fixture.selector, files: [], budget: 0 }),
			).rejects.toThrow('budget must be positive')
			await expect(
				chooseFiles(fixture, { selector: fixture.selector, files: [], keyboard: true }),
			).rejects.toThrow('lost keyboard focus')
			expect(events.count).toBe(0)
			expect(fixture.page.isClosed()).toBe(false)
		} finally {
			await fixture.browser.close()
		}
	})
})
