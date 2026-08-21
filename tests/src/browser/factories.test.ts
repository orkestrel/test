import type { CaptureVariant } from '@src/browser'
import { CAPTURE_PANE, createJournal, createPortfolio } from '@src/browser'
import { createRecorder, requireValue } from '@src/core'
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest'
import { commands, page, server } from 'vitest/browser'
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
		const expected = `${server.config.root}/tmp/capture/portfolio/start-empty--dark-390.png`
		expect(applied.count).toBe(1)
		expect(window.innerWidth).toBe(390)
		expect(window.innerHeight).toBe(844)
		expect(written).toBe(expected)
		expect((await commands.readFile(expected)).length).toBeGreaterThan(0)
		expect(portfolio.states).toStrictEqual(['start-empty'])
		expect(portfolio.paths).toStrictEqual([expected])
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
		expect(portfolio.paths).toStrictEqual([
			`${server.config.root}/tmp/capture/portfolio/answer-ideal--dark-390.png`,
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
		expect(element).toBe(`${server.config.root}/tmp/capture/portfolio/start-empty--light-1440.png`)
		const shot = await commands.readFile(requireValue(element), 'base64')
		expect(shot.length).toBeGreaterThan(0)
		expect(shot).not.toBe(await commands.readFile(requireValue(surface), 'base64'))
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
})
