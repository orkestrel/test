import type { CaptureVariant } from '@src/browser'
import type { JourneyVariant } from '@src/core'
import {
	build,
	expandCaptures,
	mount,
	readPixels,
	readStyle,
	render,
	resolveAccessible,
	sendProtocol,
	waitForFrame,
} from '@src/browser'
import { createTeardown, requireValue } from '@src/core'
import { afterEach, describe, expect, it } from 'vitest'
import { buildFixture, buildStylesheet, resetFixtures } from '../../setupBrowser.js'

afterEach(resetFixtures)

describe('waitForFrame', () => {
	it('resolves after the frame callbacks already queued have run', async () => {
		let painted = false
		requestAnimationFrame(() => {
			painted = true
		})
		await waitForFrame()
		expect(painted).toBe(true)
	})
})

describe('sendProtocol', () => {
	it('resolves the reply the browser gave the command', async () => {
		const reply = await sendProtocol('Runtime.evaluate', { expression: '1 + 1' })
		expect(reply).toMatchObject({ result: { type: 'number', value: 2 } })
	})

	it('sends a command that takes no parameters', async () => {
		const reply = await sendProtocol('Runtime.getIsolateId')
		expect(reply).toMatchObject({ id: expect.any(String) })
	})

	// The control: a reply the page cannot have produced by accident. The same call over a different
	// expression replies differently, so the 2 above is this command's own answer and not a stale one.
	it('replies to each command with its own answer', async () => {
		const reply = await sendProtocol('Runtime.evaluate', { expression: '"a" + "b"' })
		expect(reply).toMatchObject({ result: { type: 'string', value: 'ab' } })
	})

	it('rejects a command the browser does not know', async () => {
		await expect(sendProtocol('Nowhere.missing', {})).rejects.toThrow('Nowhere.missing')
	})
})

describe('build', () => {
	it('builds the element the tag names, wearing its classes, text, and attributes', () => {
		const element = build('button', {
			classes: 'primary wide',
			text: 'Save',
			attributes: { type: 'button', 'data-row': '3' },
		})
		expect(element.tagName).toBe('BUTTON')
		expect(element.className).toBe('primary wide')
		expect(element.textContent).toBe('Save')
		expect(element.type).toBe('button')
		expect(element.getAttribute('data-row')).toBe('3')
	})

	it('leaves the built element out of the document', () => {
		const element = build('div', { text: 'Ready' })
		expect(element.isConnected).toBe(false)
		expect(element.parentElement).toBeNull()
		expect(document.body.contains(element)).toBe(false)
	})

	it('builds a bare element when no options are given', () => {
		const element = build('span')
		expect(element.tagName).toBe('SPAN')
		expect(element.className).toBe('')
		expect(element.textContent).toBe('')
		expect(element.attributes).toHaveLength(0)
	})

	it('sets the text as text rather than parsing it as markup', () => {
		const element = build('p', { text: '<em>Save</em>' })
		expect(element.textContent).toBe('<em>Save</em>')
		expect(element.querySelector('em')).toBeNull()
	})
})

describe('mount', () => {
	it('attaches the element and hands the same one back', () => {
		const built = build('div', { classes: 'surface' })
		const mounted = mount(built)
		try {
			expect(mounted).toBe(built)
			expect(mounted.parentElement).toBe(document.body)
			expect(mounted.isConnected).toBe(true)
		} finally {
			built.remove()
		}
	})

	it('is what makes the element resolve against the cascade and lay out a box', () => {
		buildStylesheet(
			'.journey-mounted { box-sizing: border-box; display: block; padding-left: 12px; width: 40px }',
		)
		const built = build('div', { classes: 'journey-mounted' })
		// Unmounted, the element resolves the initial value for every property and has no box. This
		// pair is the whole contract: the append is what changes both answers.
		expect(readStyle(built, 'padding-left')).toBe('')
		expect(built.getBoundingClientRect().width).toBe(0)
		const mounted = mount(built)
		try {
			expect(readStyle(mounted, 'padding-left')).toBe('12px')
			expect(mounted.getBoundingClientRect().width).toBe(40)
		} finally {
			mounted.remove()
		}
	})

	// guides/test.md → Patterns → "Build and mount a fixture". A browser fence carries in this
	// directory because the guides project runs with the browser disabled.
	it('mounts a built fixture and takes every one back out on one hook', async () => {
		buildStylesheet('.primary { padding-left: 12px }')
		const teardown = createTeardown()
		const panel = mount(
			build('section', { classes: 'surface', attributes: { 'aria-label': 'Ledger' } }),
		)
		teardown.add(() => panel.remove())
		expect(panel.tagName).toBe('SECTION')
		expect(panel.className).toBe('surface')
		expect(panel.getAttribute('aria-label')).toBe('Ledger')
		expect(panel.isConnected).toBe(true)

		// Built and appended inside the mounted panel, so it resolves against the cascade: the
		// declared padding is what an unmounted element would have read as the initial value.
		panel.append(
			build('button', { classes: 'primary', text: 'Save', attributes: { type: 'button' } }),
		)
		const save = requireValue(panel.querySelector('button'))
		expect(save.textContent).toBe('Save')
		expect(save.getAttribute('type')).toBe('button')
		expect(readPixels(save, 'padding-left')).toBe(12)

		const markup = render('<button type="button">Save</button>')
		const heading = render('h2', 'title')
		teardown.add(() => markup.remove())
		teardown.add(() => heading.remove())
		// `render` hands back the attached container for markup and the attached element itself for a
		// tag, which is the pair the fence's two comments claim.
		expect(markup.tagName).toBe('DIV')
		expect(requireValue(markup.querySelector('button')).textContent).toBe('Save')
		expect(heading).toBeInstanceOf(HTMLHeadingElement)
		expect(heading.className).toBe('title')

		// The fence registers each removal as it goes, so one hook takes every fixture back out and
		// leaves the next test no resolver ambiguity.
		await teardown.destroy()
		expect(panel.isConnected).toBe(false)
		expect(markup.isConnected).toBe(false)
		expect(heading.isConnected).toBe(false)
	})
})

describe('render', () => {
	it('attaches parsed fixture markup to the document', () => {
		const container = render('<button type="button">Save</button>')
		try {
			expect(container.parentElement).toBe(document.body)
			expect(container.tagName).toBe('DIV')
			expect(requireValue(container.querySelector('button')).textContent).toBe('Save')
		} finally {
			container.remove()
		}
	})

	it('attaches the element itself for a tag and its classes', () => {
		const panel = render('section', 'surface muted')
		try {
			expect(panel.tagName).toBe('SECTION')
			expect(panel.className).toBe('surface muted')
			expect(panel.parentElement).toBe(document.body)
			expect(panel.isConnected).toBe(true)
		} finally {
			panel.remove()
		}
	})

	it('reads a lone argument as markup even when it spells a tag name', () => {
		const container = render('section')
		try {
			expect(container.tagName).toBe('DIV')
			expect(container.childElementCount).toBe(0)
			expect(container.textContent).toBe('section')
		} finally {
			container.remove()
		}
	})
})

describe('readStyle', () => {
	// guides/test.md → Patterns → "Read a pseudo-element's paint"
	it('distinguishes pseudo-element paint from its originating element', () => {
		buildStylesheet(
			'.journey-marked { padding-top: 0 } .journey-marked::after { content: ""; padding-top: 7px }',
		)
		buildFixture('<button class="journey-marked">Marked</button>')
		const button = resolveAccessible('Marked')
		expect(readStyle(button, 'padding-top', '::after')).toBe('7px')
		expect(readPixels(button, 'padding-top', '::after')).toBe(7)
		expect(readStyle(button, 'padding-top')).toBe('0px')
		expect(readStyle(button, '--journey-absent', '::after')).toBe('')
	})

	it('reads the modal backdrop and the open details content', () => {
		buildStylesheet(
			'.journey-dialog::backdrop { background-color: rgb(1, 2, 3) } .journey-details::details-content { padding-top: 9px }',
		)
		const fixture = buildFixture(
			'<dialog class="journey-dialog">Modal</dialog><details class="journey-details" open><summary>Details</summary>Content</details>',
		)
		const dialog = requireValue(fixture.querySelector('dialog'))
		const details = requireValue(fixture.querySelector('details'))
		dialog.showModal()
		expect(readStyle(dialog, 'background-color', '::backdrop')).toBe('rgb(1, 2, 3)')
		expect(readStyle(dialog, 'background-color')).not.toBe('rgb(1, 2, 3)')
		expect(readPixels(details, 'padding-top', '::details-content')).toBe(9)
		expect(readPixels(details, 'padding-top')).toBe(0)
		dialog.close()
	})

	it('refuses a pseudo-class before the engine support check and refuses an unknown pseudo-element', () => {
		buildFixture('<button>Subject</button>')
		const button = resolveAccessible('Subject')
		expect(CSS.supports('selector(:hover)')).toBe(true)
		expect(() => readStyle(button, 'padding-top', ':hover')).toThrow(
			'Pseudo-element ":hover" must start with "::"',
		)
		expect(() => readPixels(button, 'padding-top', '::journey-absent')).toThrow(
			'Pseudo-element "::journey-absent" is not one this engine exposes',
		)
	})

	it('reads the browser resolved value of one property', () => {
		const container = buildFixture('<p style="padding-left: 12px">Ready</p>')
		expect(readStyle(requireValue(container.querySelector('p')), 'padding-left')).toBe('12px')
	})

	it('returns a custom property with no surrounding whitespace, however it was declared', () => {
		buildStylesheet(
			'.journey-gapped { --journey-base: 8px; --journey-padded:   8px  ;' +
				' --journey-substituted: var(--journey-base);' +
				' --journey-fallback: var(--journey-missing, 8px) }',
		)
		const container = buildFixture(
			'<p class="journey-gapped" style="--journey-inline:  8px  ">Ready</p>',
		)
		const subject = requireValue(container.querySelector('p'))
		expect(readStyle(subject, '--journey-padded')).toBe('8px')
		expect(readStyle(subject, '--journey-substituted')).toBe('8px')
		expect(readStyle(subject, '--journey-fallback')).toBe('8px')
		expect(readStyle(subject, '--journey-inline')).toBe('8px')
		// This assertion does not discriminate the trim on the engine the suite runs against. Chromium
		// 1194 returns every one of these already trimmed — a padded declaration, a `var()`
		// substitution, a fallback, and an inline style alike — so the same values come back with the
		// trim removed. What is proven here is the contract: the value carries no surrounding
		// whitespace. What is unproven is that the trim is ever reached, because a custom property's
		// computed value is its declaration's token stream and nothing requires an engine to trim it.
		// A build that returns ' 8px' would redden the assertions above and prove the rest.
		expect(getComputedStyle(subject).getPropertyValue('--journey-padded')).toBe('8px')
	})

	it('keeps the whitespace inside a value', () => {
		const container = buildFixture('<p style="--journey-shadow: 0 0 2px">Ready</p>')
		expect(readStyle(requireValue(container.querySelector('p')), '--journey-shadow')).toBe(
			'0 0 2px',
		)
	})

	it('reads a property the element resolves none of as an empty string', () => {
		const container = buildFixture('<p>Ready</p>')
		expect(readStyle(requireValue(container.querySelector('p')), '--journey-absent')).toBe('')
	})
})

describe('the browser barrel', () => {
	it('resolves every published journey name from the specifier a consumer imports', async () => {
		const browser = await import('@orkestrel/test/browser')
		const core = await import('@orkestrel/test')

		for (const published of [
			browser.pressKeys,
			browser.waitForState,
			browser.waitForAnimations,
			browser.readRefusal,
			browser.readCensus,
			browser.buildDenial,
			browser.buildContrast,
			browser.buildEscapes,
			browser.buildCensus,
			browser.createStorage,
		]) {
			expect(published).toBeTypeOf('function')
		}
		expect(core.waitForText).toBeTypeOf('function')
	})

	it('takes a bare journey variant wherever a capture variant is asked for', () => {
		const declared: JourneyVariant = { name: 'dark-390', width: 390, height: 844 }
		const variants: readonly CaptureVariant[] = [declared]

		expect(expandCaptures(['start'], variants)).toStrictEqual(['start--dark-390.png'])
	})
})
