import type { CaptureVariant } from '@src/browser'
import {
	CAPTURE_PANE,
	clickAccessible,
	createChannel,
	createDragEvent,
	createJournal,
	createPointerEvent,
	createPortfolio,
	expandCaptures,
	readPerception,
} from '@src/browser'
import { createRecorder, requireValue } from '@src/core'
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest'
import { commands, page, server } from 'vitest/browser'
import { normalizePath } from '../../setup.js'
import { buildFixture, resetFixtures } from '../../setupBrowser.js'

const STATES: readonly string[] = ['start-empty', 'answer-ideal']

const VARIANTS: readonly CaptureVariant[] = [
	{ name: 'light-1440', width: 1440, height: 1000 },
	{ name: 'dark-390', width: 390, height: 844 },
]

// Relative to this test file, which is where the provider resolves a screenshot path from. `tmp` is
// ignored by git, so a written portfolio never reaches a commit.
const DIRECTORY = '../../../tmp/capture/portfolio'

let width = 0
let height = 0

beforeAll(() => {
	width = window.innerWidth
	height = window.innerHeight
})

afterAll(async () => {
	await page.viewport(width, height)
})

afterEach(resetFixtures)

describe('createPointerEvent', () => {
	it('builds a real pointer event of the type asked for', () => {
		const event = createPointerEvent('pointerdown')
		expect(event).toBeInstanceOf(PointerEvent)
		expect(event.type).toBe('pointerdown')
	})

	it('carries the defaults a hand-built event lacks', () => {
		const event = createPointerEvent('pointerdown')
		expect(event.bubbles).toBe(true)
		expect(event.cancelable).toBe(true)
		expect(event.pointerId).toBe(1)
		expect(event.pointerType).toBe('mouse')
		expect(event.isPrimary).toBe(true)
	})

	it('takes an override without restating the rest', () => {
		const event = createPointerEvent('pointerdown', { pointerType: 'touch', clientX: 10 })
		expect(event.pointerType).toBe('touch')
		expect(event.clientX).toBe(10)
		expect(event.bubbles).toBe(true)
		expect(event.isPrimary).toBe(true)
	})

	it('overrides a bubbling default when the caller names it', () => {
		const event = createPointerEvent('pointerdown', { bubbles: false, cancelable: false })
		expect(event.bubbles).toBe(false)
		expect(event.cancelable).toBe(false)
	})

	it('bubbles to an ancestor and can be prevented', () => {
		const container = buildFixture('<div><button type="button">Save</button></div>')
		const heard = createRecorder<[string]>()
		container.addEventListener('pointerdown', (event) => heard.handler(event.type))
		const event = createPointerEvent('pointerdown')
		const proceeded = requireValue(container.querySelector('button')).dispatchEvent(event)
		expect(heard.calls).toStrictEqual([['pointerdown']])
		expect(proceeded).toBe(true)
		event.preventDefault()
		expect(event.defaultPrevented).toBe(true)
	})
})

describe('createDragEvent', () => {
	it('builds a real drag event of the type asked for', () => {
		const event = createDragEvent('dragstart')
		expect(event).toBeInstanceOf(DragEvent)
		expect(event.type).toBe('dragstart')
		expect(event.bubbles).toBe(true)
		expect(event.cancelable).toBe(true)
	})

	it('allocates a live data transfer this environment can carry a payload in', () => {
		const event = createDragEvent('dragstart')
		const transfer = requireValue(event.dataTransfer)
		transfer.setData('text/plain', 'row-3')
		expect(transfer.getData('text/plain')).toBe('row-3')
	})

	it('takes a seeded data transfer in place of the allocated one', () => {
		const seeded = new DataTransfer()
		seeded.setData('text/plain', 'row-7')
		const event = createDragEvent('drop', { dataTransfer: seeded })
		expect(event.dataTransfer).toBe(seeded)
		expect(requireValue(event.dataTransfer).getData('text/plain')).toBe('row-7')
	})

	it('carries its payload to a drop handler on an ancestor', () => {
		const container = buildFixture('<div><span data-slot="target">Drop</span></div>')
		const carried = createRecorder<[string]>()
		container.addEventListener('drop', (event) =>
			carried.handler(requireValue(event.dataTransfer).getData('text/plain')),
		)
		const event = createDragEvent('drop')
		requireValue(event.dataTransfer).setData('text/plain', 'row-9')
		requireValue(container.querySelector('span')).dispatchEvent(event)
		expect(carried.calls).toStrictEqual([['row-9']])
	})
})

describe('createPortfolio', () => {
	it('refuses a variant name the matrix does not carry', () => {
		expect(() =>
			createPortfolio({
				states: STATES,
				variants: VARIANTS,
				variant: 'dark-1440',
				directory: DIRECTORY,
			}),
		).toThrow('Capture variant "dark-1440" is not registered')
	})

	it('expands the registry across every variant whether or not the run writes', () => {
		const portfolio = createPortfolio({
			states: STATES,
			variants: VARIANTS,
			variant: 'dark-390',
			directory: DIRECTORY,
		})
		expect(portfolio.variant).toBe('dark-390')
		expect(portfolio.files).toStrictEqual([
			'start-empty--light-1440.png',
			'start-empty--dark-390.png',
			'answer-ideal--light-1440.png',
			'answer-ideal--dark-390.png',
		])
	})

	it('places nothing at all when the run is not enabled', async () => {
		const applied = createRecorder<[]>()
		const portfolio = createPortfolio({
			states: STATES,
			variants: [{ name: 'dark-390', width: 390, height: 844, apply: applied.handler }],
			variant: 'dark-390',
			directory: DIRECTORY,
		})
		await expect(portfolio.place('start-empty')).resolves.toBeUndefined()
		expect(applied.count).toBe(0)
		expect(portfolio.states).toStrictEqual([])
		expect(portfolio.paths).toStrictEqual([])
	})

	it('refuses a state the registry does not carry', async () => {
		const portfolio = createPortfolio({
			states: STATES,
			variants: VARIANTS,
			variant: 'dark-390',
			directory: DIRECTORY,
			enabled: true,
		})
		await expect(portfolio.place('answer-partial')).rejects.toThrow(
			'Capture state "answer-partial" is not registered',
		)
		expect(portfolio.states).toStrictEqual([])
	})

	it('applies the variant, resizes the viewport, writes the file, and records it', async () => {
		const applied = createRecorder<[]>()
		const portfolio = createPortfolio({
			states: STATES,
			variants: [{ name: 'dark-390', width: 390, height: 844, apply: applied.handler }],
			variant: 'dark-390',
			directory: DIRECTORY,
			enabled: true,
		})
		const before = portfolio.states
		const written = await portfolio.place('start-empty')
		// The provider returns the written path in its host's own separator, and the runner reports
		// its root with forward slashes on every host, so each side is compared through
		// `normalizePath` and the comparison reads the file rather than the separator.
		const expected = normalizePath(
			`${server.config.root}/tmp/capture/portfolio/start-empty--dark-390.png`,
		)
		expect(applied.count).toBe(1)
		expect(window.innerWidth).toBe(390)
		expect(window.innerHeight).toBe(844)
		expect(normalizePath(requireValue(written))).toBe(expected)
		expect((await commands.readFile(expected)).length).toBeGreaterThan(0)
		expect(portfolio.states).toStrictEqual(['start-empty'])
		expect(portfolio.paths.map(normalizePath)).toStrictEqual([expected])
		// The readers hand out snapshots, so a list read before a placement stays what it was.
		expect(before).toStrictEqual([])
	})

	it('refuses a second placement of one state', async () => {
		const portfolio = createPortfolio({
			states: STATES,
			variants: VARIANTS,
			variant: 'dark-390',
			directory: DIRECTORY,
			enabled: true,
		})
		await portfolio.place('answer-ideal')
		await expect(portfolio.place('answer-ideal')).rejects.toThrow(
			'Capture state "answer-ideal" is already placed',
		)
		expect(portfolio.states).toStrictEqual(['answer-ideal'])
		expect(portfolio.paths.map(normalizePath)).toStrictEqual([
			normalizePath(`${server.config.root}/tmp/capture/portfolio/answer-ideal--dark-390.png`),
		])
	})

	it('places one element rather than the page, and hands the staged pane back', async () => {
		const container = buildFixture(
			'<div style="background: #000; width: 40px; height: 40px">.</div>',
		)
		const pane = requireValue(window.frameElement?.parentElement)
		const whole = createPortfolio({
			states: STATES,
			variants: VARIANTS,
			variant: 'dark-390',
			directory: DIRECTORY,
			enabled: true,
		})
		const part = createPortfolio({
			states: STATES,
			variants: VARIANTS,
			variant: 'light-1440',
			directory: DIRECTORY,
			enabled: true,
		})
		const surface = await whole.place('start-empty')
		const element = await part.place('start-empty', requireValue(container.firstElementChild))
		expect(pane.hasAttribute(CAPTURE_PANE)).toBe(false)
		expect(normalizePath(requireValue(element))).toBe(
			normalizePath(`${server.config.root}/tmp/capture/portfolio/start-empty--light-1440.png`),
		)
		const shot = await commands.readFile(requireValue(element), 'base64')
		expect(shot.length).toBeGreaterThan(0)
		expect(shot).not.toBe(await commands.readFile(requireValue(surface), 'base64'))
	})

	// guides/test.md → Patterns → "Place a capture portfolio". A browser fence carries in this
	// directory because the guides project runs with the browser disabled.
	it('answers what a full portfolio holds and what this run placed', async () => {
		const states: readonly string[] = ['start-empty', 'answer-ideal']
		const variants: readonly CaptureVariant[] = [
			{ name: 'light-1440', width: 1440, height: 1000 },
			{
				name: 'dark-390',
				width: 390,
				height: 844,
				apply: () => document.documentElement.setAttribute('data-theme', 'dark'),
			},
		]
		const portfolio = createPortfolio({
			states,
			variants,
			variant: 'dark-390',
			directory: '../../../tmp/capture/states',
			// This example is an enabled capture run. A real suite supplies its own gate here.
			enabled: true,
		})
		try {
			// The registry times the variants, and the portfolio's own list is that same expansion, so
			// one declaration answers what a full portfolio holds and what this run placed alike.
			expect(expandCaptures(states, variants)).toHaveLength(4)
			expect(portfolio.files).toStrictEqual([
				'start-empty--light-1440.png',
				'start-empty--dark-390.png',
				'answer-ideal--light-1440.png',
				'answer-ideal--dark-390.png',
			])
			expect(portfolio.files).toStrictEqual(expandCaptures(states, variants))

			const written = await portfolio.place('start-empty')
			const expected = normalizePath(
				`${server.config.root}/tmp/capture/states/start-empty--dark-390.png`,
			)
			expect(document.documentElement.getAttribute('data-theme')).toBe('dark')
			expect(normalizePath(requireValue(written))).toBe(expected)
			expect((await commands.readFile(expected)).length).toBeGreaterThan(0)
			expect(portfolio.states).toStrictEqual(['start-empty'])

			// A run that omits `enabled` returns undefined here, resizes nothing, and records nothing.
			// The placement above left the viewport and the theme at what `dark-390` selects, so a
			// viewport and a theme that variant does not produce are staged before the disabled call.
			// The readings after it then answer for that call rather than for the one before it.
			await page.viewport(320, 480)
			document.documentElement.removeAttribute('data-theme')
			expect(window.innerWidth).toBe(320)
			expect(window.innerHeight).toBe(480)

			const ordinary = createPortfolio({
				states,
				variants,
				variant: 'dark-390',
				directory: '../../../tmp/capture/states',
			})
			await expect(ordinary.place('answer-ideal')).resolves.toBeUndefined()
			expect(window.innerWidth).toBe(320)
			expect(window.innerHeight).toBe(480)
			expect(document.documentElement.getAttribute('data-theme')).toBeNull()
			expect(ordinary.states).toStrictEqual([])
			expect(ordinary.paths).toStrictEqual([])

			await expect(portfolio.place('answer-partial')).rejects.toThrow(
				'Capture state "answer-partial" is not registered',
			)
		} finally {
			document.documentElement.removeAttribute('data-theme')
		}
	})
})

describe('createChannel', () => {
	it('records one prefixed line and forwards the same arguments', () => {
		const forwarded = createRecorder<[unknown]>()
		const output: string[] = []
		const channel = createChannel('warn', output, forwarded.handler)
		channel('low disk')
		expect(output).toStrictEqual(['warn: low disk'])
		expect(forwarded.calls).toStrictEqual([['low disk']])
	})

	it('joins every argument of one call into a single line through String', () => {
		const forwarded = createRecorder<[unknown, unknown, unknown]>()
		const output: string[] = []
		const channel = createChannel('log', output, forwarded.handler)
		channel('read', 3, { one: 1 })
		expect(output).toStrictEqual(['log: read 3 [object Object]'])
		expect(forwarded.count).toBe(1)
	})

	it('records a call carrying no arguments as its bare prefix', () => {
		const forwarded = createRecorder<[]>()
		const output: string[] = []
		createChannel('debug', output, forwarded.handler)()
		expect(output).toStrictEqual(['debug: '])
	})

	it('appends to the caller list, so two channels share one record in call order', () => {
		const forwarded = createRecorder<[unknown]>()
		const output: string[] = ['before']
		createChannel('info', output, forwarded.handler)('first')
		createChannel('error', output, forwarded.handler)('second')
		expect(output).toStrictEqual(['before', 'info: first', 'error: second'])
	})

	it('records before it forwards, so a throwing target leaves the line recorded', () => {
		const output: string[] = []
		const channel = createChannel('error', output, () => {
			throw new Error('Console is gone')
		})
		expect(() => channel('boom')).toThrow('Console is gone')
		expect(output).toStrictEqual(['error: boom'])
	})
})

describe('createJournal', () => {
	it('records a step only while it is started', () => {
		const journal = createJournal()
		journal.record('click', 'Before', 'ignored')
		journal.start()
		journal.record('click', 'Evaluate', 'alerts=0')
		journal.stop()
		journal.record('click', 'After', 'ignored')
		expect(journal.steps).toStrictEqual([
			{ action: 'click', trigger: 'Evaluate', result: 'alerts=0' },
		])
	})

	it('forwards every console channel to what was there and swallows nothing', () => {
		const journal = createJournal()
		const printed = createRecorder<[unknown]>()
		const channels = {
			debug: console.debug,
			error: console.error,
			info: console.info,
			log: console.log,
			warn: console.warn,
		}
		console.debug = printed.handler
		console.error = printed.handler
		console.info = printed.handler
		console.log = printed.handler
		console.warn = printed.handler
		try {
			journal.start()
			console.debug('one')
			console.error('two')
			console.info('three')
			console.log('four')
			console.warn('five')
			journal.stop()
		} finally {
			Object.assign(console, channels)
		}
		expect(printed.calls).toStrictEqual([['one'], ['two'], ['three'], ['four'], ['five']])
		expect(journal.output).toStrictEqual([
			'debug: one',
			'error: two',
			'info: three',
			'log: four',
			'warn: five',
		])
	})

	it('joins every argument of one call into a single recorded line', () => {
		const journal = createJournal()
		const printed = createRecorder<[unknown, unknown, unknown]>()
		const original = console.log
		console.log = printed.handler
		try {
			journal.start()
			console.log('read', 3, { one: 1 })
			journal.stop()
		} finally {
			console.log = original
		}
		expect(printed.count).toBe(1)
		expect(journal.output).toStrictEqual(['log: read 3 [object Object]'])
	})

	it('records an uncaught error and an unhandled rejection while it is started', () => {
		const journal = createJournal()
		// The runner reports a page failure through the console as well, and the journal is standing
		// in front of that console while it is armed. The recorder holds those reports so they do not
		// reach the terminal, which is why the two lines below are asserted by membership.
		const printed = createRecorder<[unknown]>()
		const channels = { error: console.error, warn: console.warn }
		console.error = printed.handler
		console.warn = printed.handler
		let recorded: readonly string[] = []
		try {
			journal.start()
			window.dispatchEvent(new ErrorEvent('error', { message: 'Boom' }))
			window.dispatchEvent(
				new PromiseRejectionEvent('unhandledrejection', {
					promise: Promise.resolve(),
					reason: 'Refused',
				}),
			)
			journal.stop()
			recorded = journal.output
			window.dispatchEvent(new ErrorEvent('error', { message: 'Ignored' }))
		} finally {
			Object.assign(console, channels)
		}
		expect(recorded).toContain('error: Boom')
		expect(recorded).toContain('rejection: Refused')
		// The listeners go with the console, so a failure after the journal stopped reaches neither.
		expect(journal.output).toStrictEqual(recorded)
	})

	it('hands every console channel back by identity, and stops again as a no-op', () => {
		const journal = createJournal()
		const original = console.log
		journal.start()
		expect(console.log).not.toBe(original)
		journal.stop()
		expect(console.log).toBe(original)
		const replaced = createRecorder<[unknown]>()
		console.log = replaced.handler
		try {
			journal.stop()
			expect(console.log).toBe(replaced.handler)
		} finally {
			console.log = original
		}
	})

	it('clears both lists on a restart without wrapping its own wrappers', () => {
		const journal = createJournal()
		const printed = createRecorder<[unknown]>()
		const original = console.log
		console.log = printed.handler
		let armed: unknown
		let rearmed: unknown
		let restored: unknown
		try {
			journal.start()
			armed = console.log
			journal.record('click', 'First', 'alerts=0')
			console.log('first')
			journal.start()
			rearmed = console.log
			journal.record('click', 'Second', 'alerts=1')
			journal.stop()
			restored = console.log
		} finally {
			console.log = original
		}
		// A restart that re-captured the console would stack its second wrapper on the first, and
		// `stop` would then hand back a wrapper instead of the recorder that was there.
		expect(rearmed).toBe(armed)
		expect(restored).toBe(printed.handler)
		expect(printed.calls).toStrictEqual([['first']])
		expect(journal.steps).toStrictEqual([
			{ action: 'click', trigger: 'Second', result: 'alerts=1' },
		])
		expect(journal.output).toStrictEqual([])
	})

	it('hands out snapshots, so a list read before a step stays what it was', () => {
		const journal = createJournal()
		journal.start()
		const steps = journal.steps
		const output = journal.output
		journal.record('click', 'Evaluate', 'alerts=0')
		journal.stop()
		expect(steps).toStrictEqual([])
		expect(output).toStrictEqual([])
		expect(journal.steps).toHaveLength(1)
	})

	it('keeps one journal recording out of another', () => {
		const first = createJournal()
		const second = createJournal()
		first.start()
		first.record('click', 'Evaluate', 'alerts=0')
		first.stop()
		second.start()
		second.stop()
		expect(first.steps).toHaveLength(1)
		expect(second.steps).toStrictEqual([])
	})

	// guides/test.md → Patterns → "Record a browser journal", the `createJournal` fence. A browser
	// fence carries in this directory because the guides project runs with the browser disabled.
	it('records what a real click did against a quiet page, and stops through the finally', async () => {
		const surface = buildFixture(
			'<button type="button">Evaluate</button>' +
				'<section aria-label="Run"><p>Not run</p></section>',
		)
		const report = requireValue(surface.querySelector('section p'))
		requireValue(surface.querySelector('button')).addEventListener('click', () => {
			report.textContent = 'Scored 3 of 3'
		})
		const idle = readPerception('Run')
		const journal = createJournal()
		const original = console.log
		let refused = ''
		try {
			journal.start()
			try {
				await clickAccessible('button', 'Evaluate')
				const perceived = readPerception('Run')
				journal.record('click', 'Evaluate', perceived)

				// The page's own wording is scene. What the fence claims is that the step the journal
				// hands back is the one the scenario recorded, carrying the page's state after the
				// click rather than the state it was in before.
				expect(perceived).not.toBe(idle)
				expect(journal.steps).toStrictEqual([
					{ action: 'click', trigger: 'Evaluate', result: perceived },
				])
				expect(journal.output).toStrictEqual([])

				// The scenario ends by throwing, which is what the guarded `stop` is for: an unguarded
				// one would leave this journal's console wrappers standing for every later test here.
				throw new Error('Draft refused')
			} finally {
				journal.stop()
			}
		} catch (error) {
			refused = error instanceof Error ? error.message : 'no error'
		}
		expect(refused).toBe('Draft refused')
		expect(console.log).toBe(original)
	})
})
