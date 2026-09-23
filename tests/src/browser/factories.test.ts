import type { CaptureVariant } from '@src/browser'
import type { StateScenario } from '@src/core'
import {
	buildDenial,
	CAPTURE_PANE,
	clickAccessible,
	clickDisclosure,
	createChannel,
	createDragEvent,
	createHarness,
	createJournal,
	createPointerEvent,
	createPortfolio,
	createStorage,
	expandCaptures,
	readPerception,
	readStates,
} from '@src/browser'
import {
	buildRefusal,
	captureError,
	createRecorder,
	executeScenarios,
	requireValue,
	STATECHART_ATTRIBUTES,
	waitForDelay,
} from '@src/core'
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest'
import { commands, page, server } from 'vitest/browser'
import { rewriteWindowsAbsolutePath } from '../../setup.js'
import { buildFixture, resetFixtures, STATES, VARIANTS } from '../../setupBrowser.js'

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
		expect(portfolio.placements).toStrictEqual([])
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
		expect(portfolio.placements).toStrictEqual([])
	})

	it('applies the variant, hands the viewport back, writes the file, and records it', async () => {
		const applied = createRecorder<[]>()
		const portfolio = createPortfolio({
			states: STATES,
			variants: [{ name: 'dark-390', width: 390, height: 844, apply: applied.handler }],
			variant: 'dark-390',
			directory: DIRECTORY,
			enabled: true,
		})
		const before = portfolio.placements
		const written = await portfolio.place('start-empty')
		// The provider returns the written path in its host's own separator, and the runner reports
		// its root with forward slashes on every host, so each side is compared through
		// `rewriteWindowsAbsolutePath` and the comparison reads the file rather than the separator.
		const expected = rewriteWindowsAbsolutePath(
			`${server.config.root}/tmp/capture/portfolio/start-empty--dark-390.png`,
		)
		expect(applied.count).toBe(1)
		// `place` shoots at the variant's viewport and `captureFrame` hands the tester back, so the
		// reading after it is the viewport this file started at rather than the variant's.
		expect(window.innerWidth).toBe(width)
		expect(window.innerHeight).toBe(height)
		expect(rewriteWindowsAbsolutePath(requireValue(written))).toBe(expected)
		expect((await commands.readFile(expected)).length).toBeGreaterThan(0)
		expect(portfolio.placements).toStrictEqual(['start-empty'])
		expect(portfolio.paths.map(rewriteWindowsAbsolutePath)).toStrictEqual([expected])
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
		expect(portfolio.placements).toStrictEqual(['answer-ideal'])
		expect(portfolio.paths.map(rewriteWindowsAbsolutePath)).toStrictEqual([
			rewriteWindowsAbsolutePath(
				`${server.config.root}/tmp/capture/portfolio/answer-ideal--dark-390.png`,
			),
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
		expect(rewriteWindowsAbsolutePath(requireValue(element))).toBe(
			rewriteWindowsAbsolutePath(
				`${server.config.root}/tmp/capture/portfolio/start-empty--light-1440.png`,
			),
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
			const expected = rewriteWindowsAbsolutePath(
				`${server.config.root}/tmp/capture/states/start-empty--dark-390.png`,
			)
			expect(document.documentElement.getAttribute('data-theme')).toBe('dark')
			expect(rewriteWindowsAbsolutePath(requireValue(written))).toBe(expected)
			expect((await commands.readFile(expected)).length).toBeGreaterThan(0)
			expect(portfolio.placements).toStrictEqual(['start-empty'])

			// A run that omits `enabled` returns undefined here, resizes nothing, and records nothing.
			// The placement above handed the viewport back and left the theme at what `dark-390`
			// selects, so a viewport and a theme that variant does not produce are staged before the
			// disabled call. The readings after it then answer for that call rather than for the one
			// before it.
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
			expect(ordinary.placements).toStrictEqual([])
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

describe('createStorage', () => {
	it('reads back its seed and accepts every operation by default', () => {
		const storage = createStorage({ values: { theme: 'dark', scale: '2' } })

		expect(storage.length).toBe(2)
		expect(storage.getItem('theme')).toBe('dark')
		expect(storage.getItem('absent')).toBeNull()
		expect(storage.key(0)).toBe('theme')
		expect(storage.key(9)).toBeNull()

		storage.setItem('theme', 'light')
		expect(storage.getItem('theme')).toBe('light')

		storage.removeItem('scale')
		expect(storage.length).toBe(1)

		storage.clear()
		expect(storage.length).toBe(0)
	})

	it('refuses every withheld operation in the voice a denied origin raises', () => {
		const storage = createStorage({ values: { theme: 'dark' }, reads: false, writes: false })

		const denied = captureError(() => storage.getItem('theme'))
		expect(denied).toBeInstanceOf(DOMException)
		const refusal = requireValue(denied instanceof DOMException ? denied : undefined)
		expect(refusal.name).toBe('SecurityError')
		expect(refusal.message).toBe('Access is denied for getItem "theme"')

		expect(() => storage.length).toThrow('Access is denied for length')
		expect(() => storage.key(0)).toThrow('Access is denied for key')
		expect(() => storage.clear()).toThrow('Access is denied for clear')
		expect(() => storage.removeItem('theme')).toThrow('Access is denied for removeItem "theme"')
		expect(() => storage.setItem('theme', 'light')).toThrow('Access is denied for setItem "theme"')
	})

	// Reads answer from what the store actually accepted, so a journey reads what the application
	// kept while the host was refusing.
	it('grants both permissions at once and answers from what the store kept', () => {
		const storage = createStorage({ values: { theme: 'dark' }, reads: false, writes: false })

		storage.permit()

		expect(storage.getItem('theme')).toBe('dark')
		storage.setItem('scale', '2')
		expect(storage.length).toBe(2)
	})

	it('spends its quota on accepted writes alone', () => {
		const storage = createStorage({ quota: 2 })

		storage.setItem('first', '1')
		storage.removeItem('first')
		storage.setItem('second', '2')

		const full = captureError(() => storage.setItem('third', '3'))
		expect(full).toBeInstanceOf(DOMException)
		const refusal = requireValue(full instanceof DOMException ? full : undefined)
		expect(refusal.name).toBe('QuotaExceededError')
		expect(refusal.message).toBe('No room is left for third')
		expect(storage.getItem('second')).toBe('2')
		expect(storage.getItem('third')).toBeNull()
	})

	// The control for the two refusals being different: granting the permission leaves the origin as
	// full as it was, so a store that replenished on `permit` would accept this write.
	it('replenishes no room when the permission is granted', () => {
		const storage = createStorage({ quota: 1, writes: false })

		expect(() => storage.setItem('first', '1')).toThrow('Access is denied for setItem "first"')

		storage.permit()
		storage.setItem('first', '1')

		expect(() => storage.setItem('second', '2')).toThrow('No room is left for second')

		// Spending the room before the grant is what separates the two refusals: a store that handed
		// the room back with the permission would accept the second write here.
		const spent = createStorage({ quota: 1 })
		spent.setItem('only', '1')
		spent.permit()

		expect(() => spent.setItem('another', '2')).toThrow('No room is left for another')
	})

	// T3-C5. A quota above `Number.MAX_SAFE_INTEGER` is refused in the same sentence, because a
	// counter that cannot decrement past that point bounds nothing: the largest safe integer is the
	// largest cap a spend can still reach the end of.
	it('refuses a quota that is not a non-negative integer', () => {
		for (const quota of [
			-1,
			1.5,
			Number.NaN,
			Number.POSITIVE_INFINITY,
			Number.MAX_SAFE_INTEGER + 1,
		]) {
			expect(captureError(() => createStorage({ quota }))).toStrictEqual(
				new Error('Storage quota must be a non-negative integer'),
			)
		}
		expect(createStorage({ quota: 0 }).length).toBe(0)
		expect(createStorage({ quota: Number.MAX_SAFE_INTEGER }).length).toBe(0)
	})

	// T3-C4. The bound the doc block and the guide state: the store answers through its methods and
	// intercepts no named-property access. `Storage` declares an index signature, so the property
	// read typechecks, reads `undefined` while `getItem` answers, and the property write lands on the
	// object rather than in the store — consuming no quota and meeting no refusal. A `Proxy` that
	// intercepted these would redden this case and that sentence together.
	it('answers through its methods and intercepts no named-property access', () => {
		const storage = createStorage({ values: { theme: 'dark' }, writes: false, quota: 0 })

		const read: unknown = storage.theme
		expect(read).toBeUndefined()
		expect(storage.getItem('theme')).toBe('dark')

		storage.theme = 'light'

		expect(storage.getItem('theme')).toBe('dark')
		expect(storage.length).toBe(1)
		// The withheld write is still withheld through the method the store publishes, so the property
		// write went past the permission rather than being granted by it.
		expect(() => storage.setItem('theme', 'light')).toThrow('Access is denied for setItem "theme"')
	})

	// The control for the inertness claim: a store this package hands out is not the browser's own,
	// so a write here leaves `localStorage` exactly as it was.
	it('patches nothing the document already holds', () => {
		localStorage.setItem('journey-real', 'kept')
		try {
			const storage = createStorage()
			storage.setItem('journey-real', 'replaced')

			expect(localStorage.getItem('journey-real')).toBe('kept')
			expect(storage.getItem('journey-real')).toBe('replaced')
		} finally {
			localStorage.removeItem('journey-real')
		}
	})

	// guides/test.md → Patterns → "Withhold a store the way a host does". A browser fence carries in
	// this directory because the guides project runs with the browser disabled.
	it('withholds a read, grants it, and then runs out of room', () => {
		const storage = createStorage({ values: { theme: 'dark' }, reads: false, quota: 1 })

		expect(() => storage.getItem('theme')).toThrow('Access is denied for getItem "theme"')

		storage.permit()
		expect(storage.getItem('theme')).toBe('dark')

		storage.setItem('theme', 'light')
		expect(() => storage.setItem('scale', '2')).toThrow('No room is left for scale')

		expect(buildDenial('length').name).toBe('SecurityError')
	})
})

// The worked statechart table `guides/test.md` § Patterns → "Drive a statechart table" carries. The
// entity is a native disclosure with a second door: the summary toggles it, and a Dismiss button
// closes it and does nothing when it is already closed. That second door is what gives the table a
// row whose event leaves the state unchanged, which a lone `<details>` cannot have.
type DisclosureState = 'closed' | 'open'

type DisclosureEvent = 'toggle' | 'dismiss'

interface DisclosureContext {
	readonly summary: HTMLElement
}

// The fixture the row before this one left on the page. A journey verb resolves its own target by
// accessible name, so two mounted disclosures called "Advanced" are an ambiguity rather than a
// second fixture: each build takes the previous one back out before rendering its own.
let mounted: HTMLElement | undefined

function buildDisclosure(): DisclosureContext {
	mounted?.remove()
	const container = buildFixture(
		'<details><summary>Advanced</summary><p>Every setting.</p></details><button type="button">Dismiss</button>',
	)
	const details = requireValue(container.querySelector('details'))
	requireValue(container.querySelector('button')).addEventListener('click', () => {
		details.open = false
	})
	mounted = container
	return { summary: requireValue(container.querySelector('summary')) }
}

function readDisclosure(context: DisclosureContext): DisclosureState {
	return readStates(context.summary).includes('expanded') ? 'open' : 'closed'
}

async function arrangeDisclosure(
	context: DisclosureContext,
	state: DisclosureState,
): Promise<void> {
	if (readDisclosure(context) !== state) await clickDisclosure('Advanced')
}

// The context is unused because a journey verb resolves its own target: the summary and the button
// are found by what a person reads, not by a node this row was handed.
async function actOnDisclosure(_context: DisclosureContext, event: DisclosureEvent): Promise<void> {
	if (event === 'toggle') await clickDisclosure('Advanced')
	else await clickAccessible('Dismiss')
}

function assertDisclosure(context: DisclosureContext, state: DisclosureState): void {
	expect(readDisclosure(context)).toBe(state)
}

const DISCLOSURE_SCENARIOS: ReadonlyArray<
	StateScenario<DisclosureState, DisclosureEvent, DisclosureContext>
> = [
	{
		transition: {
			name: 'closed opens through the summary',
			from: 'closed',
			event: 'toggle',
			to: 'open',
		},
		arrange: arrangeDisclosure,
		act: actOnDisclosure,
		assert: assertDisclosure,
	},
	{
		transition: {
			name: 'open closes through the summary',
			from: 'open',
			event: 'toggle',
			to: 'closed',
		},
		arrange: arrangeDisclosure,
		act: actOnDisclosure,
		assert: assertDisclosure,
	},
	{
		transition: {
			name: 'open closes through the button',
			from: 'open',
			event: 'dismiss',
			to: 'closed',
		},
		arrange: arrangeDisclosure,
		act: actOnDisclosure,
		assert: assertDisclosure,
	},
	{
		transition: {
			name: 'closed stays closed through the button',
			from: 'closed',
			event: 'dismiss',
			to: 'closed',
		},
		arrange: arrangeDisclosure,
		act: actOnDisclosure,
		assert: assertDisclosure,
	},
]

// One row whose `to` state the event cannot reach. Nothing about the row is malformed: the summary
// really does open the disclosure, so only `assert` can catch it.
const MISMATCHED_SCENARIOS: ReadonlyArray<
	StateScenario<DisclosureState, DisclosureEvent, DisclosureContext>
> = [
	{
		transition: {
			name: 'the summary leaves it closed',
			from: 'closed',
			event: 'toggle',
			to: 'closed',
		},
		arrange: arrangeDisclosure,
		act: actOnDisclosure,
		assert: assertDisclosure,
	},
]

// The same table with the mismatched row second, so the rows after a failing row are observable.
const MIXED_SCENARIOS: ReadonlyArray<
	StateScenario<DisclosureState, DisclosureEvent, DisclosureContext>
> = [
	requireValue(DISCLOSURE_SCENARIOS[0]),
	requireValue(MISMATCHED_SCENARIOS[0]),
	requireValue(DISCLOSURE_SCENARIOS[2]),
	requireValue(DISCLOSURE_SCENARIOS[3]),
]

describe('createHarness', () => {
	// A harness mounts itself and records nothing, exactly as `mount` does, so a harness a failing
	// assertion left behind is the next test's ambiguity. This takes back whatever is still there.
	afterEach(() => {
		for (const root of [...document.querySelectorAll(`[${STATECHART_ATTRIBUTES.status}]`)]) {
			root.remove()
		}
		mounted = undefined
	})

	// T2-C1.
	it('refuses a table with no transition in it and mounts nothing', () => {
		const before = document.body.childElementCount

		expect(
			captureError(() =>
				createHarness({
					scenarios: [],
					build: buildDisclosure,
					state: readDisclosure,
				}),
			),
		).toStrictEqual(new Error('Statechart harness mounted no transition'))

		expect(document.body.childElementCount).toBe(before)
		expect(document.querySelector(`[${STATECHART_ATTRIBUTES.status}]`)).toBeNull()
		expect(document.querySelector(`[${STATECHART_ATTRIBUTES.scenario}]`)).toBeNull()
	})

	// T2-C4, rewritten for T3-C13. The transient value is written and replaced inside one synchronous
	// call, so the proof is what the document recorded rather than what a reading after the call can
	// see. The observer is armed on `document.body` before construction and its queue is read back
	// with `takeRecords()`, which is the only reading that survives the call.
	//
	// What the case asserts is the order of the two attribute writes against the row mounts: every
	// declared row is in the document before the count is written, and the count is written before
	// the status leaves `pending`. How many `childList` records the browser grouped those mounts into
	// is the browser's own batching and is not part of the claim, so each record is read for the rows
	// it added rather than compared against a fixed sequence.
	it('mounts every row while it reads pending and writes idle only after the count', () => {
		const observer = new MutationObserver(() => {})
		observer.observe(document.body, {
			subtree: true,
			childList: true,
			attributes: true,
			attributeOldValue: true,
			attributeFilter: [STATECHART_ATTRIBUTES.status, STATECHART_ATTRIBUTES.total],
		})

		const harness = createHarness({
			scenarios: DISCLOSURE_SCENARIOS,
			build: buildDisclosure,
			state: readDisclosure,
		})
		const records = observer.takeRecords()
		observer.disconnect()

		let mountedRows = 0
		let lastRow = -1
		let total = -1
		let status = -1
		let narration = -1
		for (const [index, record] of records.entries()) {
			if (record.type === 'attributes') {
				if (record.attributeName === STATECHART_ATTRIBUTES.total) total = index
				if (
					record.attributeName === STATECHART_ATTRIBUTES.status &&
					record.oldValue === 'pending'
				) {
					status = index
				}
				continue
			}
			for (const node of record.addedNodes) {
				if (node instanceof Element && node.localName === 'li') {
					mountedRows += 1
					lastRow = index
				}
				if (node instanceof Text) narration = index
			}
		}

		// Every declared row mounted, and each write the claim orders was recorded.
		expect(mountedRows).toBe(DISCLOSURE_SCENARIOS.length)
		expect(lastRow).toBeGreaterThanOrEqual(0)
		// The count is written after the last row mounts, and the status leaves `pending` after the
		// count — so a gate that reads `pending` has found a harness whose rows never mounted, and a
		// gate that reads `idle` can read the count beside it.
		expect(total).toBeGreaterThan(lastRow)
		expect(status).toBeGreaterThan(total)
		// The announcer's sentence lands after both, because a gate settles on the attribute and a
		// reader hears the prose: the contract the gate reads is written before it is narrated.
		expect(narration).toBeGreaterThan(status)
		expect(harness.status).toBe('idle')
		expect(harness.total).toBe(4)
		expect(harness.passed).toBe(0)
		expect(harness.failed).toBe(0)
		expect(harness.failures).toStrictEqual([])
		// Nothing renders a state yet: a state is read from an entity, and no row has built one.
		expect(harness.root.querySelector(`[${STATECHART_ATTRIBUTES.state}]`)).toBeNull()

		harness.destroy()
	})

	// T2-C4. A row parked on a deferred the test resolves is what makes the middle status readable:
	// the run is in flight for as long as the test keeps it there.
	it('reads running from the call until the parked row is let go', async () => {
		const gate = Promise.withResolvers<void>()
		const harness = createHarness({
			scenarios: [
				{
					transition: requireValue(DISCLOSURE_SCENARIOS[0]).transition,
					arrange: arrangeDisclosure,
					async act(context, event) {
						await gate.promise
						await actOnDisclosure(context, event)
					},
					assert: assertDisclosure,
				},
			],
			build: buildDisclosure,
			state: readDisclosure,
		})
		expect(harness.status).toBe('idle')

		const run = harness.execute()
		expect(harness.status).toBe('running')
		expect(harness.root.getAttribute(STATECHART_ATTRIBUTES.status)).toBe('running')

		await waitForDelay(20)
		expect(harness.status).toBe('running')

		gate.resolve()
		await run

		expect(harness.status).toBe('passed')
		harness.destroy()
	})

	// T2-C2. guides/test.md → Patterns → "Drive a statechart table". A browser fence carries in this
	// directory because the guides project runs with the browser disabled.
	it('drives every row of the worked table and publishes the tally on its own markup', async () => {
		const harness = createHarness({
			scenarios: DISCLOSURE_SCENARIOS,
			build: buildDisclosure,
			state: readDisclosure,
		})

		await harness.execute()

		expect(harness.status).toBe('passed')
		expect(harness.total).toBe(4)
		expect(harness.passed).toBe(4)
		expect(harness.failed).toBe(0)
		expect(harness.failures).toStrictEqual([])

		// The object reads the markup, so the two cannot disagree. Read the markup the way a gate
		// outside the page reads it and compare.
		const root = harness.root
		expect(root.getAttribute(STATECHART_ATTRIBUTES.status)).toBe(String(harness.status))
		expect(root.getAttribute(STATECHART_ATTRIBUTES.total)).toBe(String(harness.total))
		expect(root.getAttribute(STATECHART_ATTRIBUTES.passed)).toBe(String(harness.passed))
		expect(root.getAttribute(STATECHART_ATTRIBUTES.failed)).toBe(String(harness.failed))

		const rows = [...root.querySelectorAll(`[${STATECHART_ATTRIBUTES.scenario}]`)]
		expect(rows.map((row) => row.getAttribute(STATECHART_ATTRIBUTES.scenario))).toStrictEqual(
			DISCLOSURE_SCENARIOS.map((scenario) => scenario.transition.name),
		)
		expect(rows.map((row) => row.getAttribute(STATECHART_ATTRIBUTES.result))).toStrictEqual([
			'passed',
			'passed',
			'passed',
			'passed',
		])
		expect(requireValue(rows[0]).textContent).toBe(
			'closed opens through the summary: closed on toggle becomes open',
		)

		// The last row leaves the disclosure closed, and the state element renders what the entity's
		// own reader reported rather than what the row asked for.
		expect(
			requireValue(root.querySelector(`[${STATECHART_ATTRIBUTES.state}]`)).getAttribute(
				STATECHART_ATTRIBUTES.state,
			),
		).toBe('closed')
		expect(requireValue(root.querySelector('[role="status"]')).textContent).toBe(
			'Statechart harness passed, 4 passed and 0 failed of 4.',
		)

		harness.destroy()
	})

	// T2-C3.
	it('carries on past a failing row and names it in the failures', async () => {
		const harness = createHarness({
			scenarios: MIXED_SCENARIOS,
			build: buildDisclosure,
			state: readDisclosure,
		})

		await harness.execute()

		expect(harness.status).toBe('failed')
		expect(harness.failed).toBe(1)
		expect(harness.passed).toBe(3)
		expect(harness.failures).toStrictEqual(['the summary leaves it closed'])

		const rows = [...harness.root.querySelectorAll(`[${STATECHART_ATTRIBUTES.scenario}]`)]
		expect(rows.map((row) => row.getAttribute(STATECHART_ATTRIBUTES.result))).toStrictEqual([
			'passed',
			'failed',
			'passed',
			'passed',
		])
		expect(requireValue(harness.root.querySelector('[role="status"]')).textContent).toBe(
			'Statechart harness failed, 3 passed and 1 failed of 4.',
		)

		harness.destroy()
	})

	// T2-C3. A builder that refuses fails its own row under the name `executeScenarios` gives it, and
	// the rows after it still run — which is where a harness parts company with the bare runner.
	//
	// T3-C12. The per-row announcement is `buildRefusal`'s own sentence, which is the one the runner
	// raises, so a respelling in either place moves both readings together. It is read inside the
	// next row's build, because the run's terminal sentence replaces it before `execute` returns.
	it('fails the row whose builder refused and runs the rows after it', async () => {
		const refusal = new Error('no fixture')
		let refusals = 0
		let announced: string | undefined
		const harness = createHarness({
			scenarios: MIXED_SCENARIOS,
			build(scenario) {
				if (refusals === 1 && announced === undefined) {
					announced = announcer.textContent ?? undefined
				}
				if (scenario.transition.name !== 'the summary leaves it closed') return buildDisclosure()
				refusals += 1
				throw refusal
			},
			state: readDisclosure,
		})
		// The builder first runs inside `execute`, which is after this reading is in hand.
		const announcer = requireValue(harness.root.querySelector('[role="status"]'))

		await harness.execute()

		expect(refusals).toBe(1)
		expect(announced).toBe(buildRefusal('the summary leaves it closed', refusal).message)
		expect(harness.status).toBe('failed')
		expect(harness.passed).toBe(3)
		expect(harness.failures).toStrictEqual(['the summary leaves it closed'])
		expect(requireValue(harness.root.querySelector('[role="status"]')).textContent).toBe(
			'Statechart harness failed, 3 passed and 1 failed of 4.',
		)

		harness.destroy()
	})

	// T3-C1. A row whose builder returns `undefined` runs every phase, because what decides is
	// whether the builder returned rather than what it returned. The assertion throws, so the row is
	// counted failed and carries the assertion's own message under its row name.
	it('drives every phase of a row whose context is undefined', async () => {
		const trail: string[] = []
		const harness = createHarness<'closed', 'toggle', undefined>({
			scenarios: [
				{
					transition: {
						name: 'the absent context',
						from: 'closed',
						event: 'toggle',
						to: 'closed',
					},
					arrange() {
						trail.push('arrange')
					},
					act() {
						trail.push('act')
					},
					assert() {
						trail.push('assert')
						throw new Error('the assertion that must fail')
					},
				},
			],
			build: () => undefined,
			state: () => 'closed',
		})

		await harness.execute()

		expect(trail).toStrictEqual(['arrange', 'act', 'assert'])
		expect(harness.status).toBe('failed')
		expect(harness.passed).toBe(0)
		expect(harness.failed).toBe(1)
		expect(harness.failures).toStrictEqual(['the absent context'])
		expect(requireValue(harness.root.querySelector('[role="status"]')).textContent).toBe(
			'Statechart harness failed, 0 passed and 1 failed of 1.',
		)
		// The row produced a context, so its state was read and rendered like any other row's.
		expect(
			requireValue(harness.root.querySelector(`[${STATECHART_ATTRIBUTES.state}]`)).getAttribute(
				STATECHART_ATTRIBUTES.state,
			),
		).toBe('closed')

		harness.destroy()
	})

	// T3-C3. A re-run clears the rendered state as well as the tally, because a state is read from an
	// entity and no entity exists until a row builds one — which is as true at the start of a second
	// run as at construction. The reading is taken inside the second run's own `build`, the one
	// moment in that run before any row has produced a context.
	it('clears the rendered state at the start of a re-run', async () => {
		let runs = 0
		let observed: { readonly attribute: string | null; readonly text: string } | undefined
		const harness = createHarness({
			scenarios: [requireValue(DISCLOSURE_SCENARIOS[0])],
			build() {
				runs += 1
				// The element the first run rendered into, read on the second run before any row of
				// that run has produced a context. The builder first runs inside `execute`, which is
				// after the reading below is in hand.
				if (runs === 2) {
					observed = {
						attribute: rendered.getAttribute(STATECHART_ATTRIBUTES.state),
						text: rendered.textContent ?? '',
					}
				}
				return buildDisclosure()
			},
			state: readDisclosure,
		})

		await harness.execute()

		const rendered = requireValue(harness.root.querySelector(`[${STATECHART_ATTRIBUTES.state}]`))
		expect(rendered.getAttribute(STATECHART_ATTRIBUTES.state)).toBe('open')
		expect(rendered.textContent).toBe('open')

		await harness.execute()

		expect(requireValue(observed).attribute).toBeNull()
		expect(requireValue(observed).text).toBe('')
		// The reading was taken, so an absent one cannot pass for a cleared one.
		expect(runs).toBe(2)
		// The run put it back, so the clearing is the reset the tally gets rather than a removal.
		expect(rendered.getAttribute(STATECHART_ATTRIBUTES.state)).toBe('open')
		expect(rendered.textContent).toBe('open')

		harness.destroy()
	})

	// T2-C5.
	it('re-runs from a fresh tally and hands the root back on destroy', async () => {
		const harness = createHarness({
			scenarios: MIXED_SCENARIOS,
			build: buildDisclosure,
			state: readDisclosure,
		})

		await harness.execute()
		expect(harness.passed).toBe(3)
		expect(harness.failed).toBe(1)

		const reported = harness.failures
		const second = harness.execute()

		// The list handed out before the run stays what it was, because each reading is its own array.
		expect(reported).toStrictEqual(['the summary leaves it closed'])
		// The reset is readable while the run is in flight: no row carries a result from the run
		// before it, and the tally is back at zero rather than counting on from where it stopped.
		expect(harness.status).toBe('running')
		expect(harness.passed).toBe(0)
		expect(harness.failed).toBe(0)
		expect(harness.failures).toStrictEqual([])
		expect(harness.root.querySelectorAll(`[${STATECHART_ATTRIBUTES.result}]`).length).toBe(0)

		await second
		expect(harness.passed).toBe(3)
		expect(harness.failed).toBe(1)
		expect(harness.failures).toStrictEqual(['the summary leaves it closed'])

		harness.destroy()
		expect(harness.root.isConnected).toBe(false)

		const remaining = document.body.childElementCount
		expect(captureError(() => harness.destroy())).toBeUndefined()
		expect(document.body.childElementCount).toBe(remaining)
		expect(harness.root.isConnected).toBe(false)
		expect(harness.status).toBe('failed')
	})

	// The delay sits between rows rather than around them. Measuring the whole run cannot show that:
	// driving a real disclosure costs more than any pause worth declaring, so the total is the same
	// number whether or not the harness waited at all. Each row marks its own build and its own
	// reading instead, and the reading of one row to the build of the next is the pause and nothing
	// else — the writes between them are synchronous.
	//
	// T3-C13. Every number here is the declared pause rather than a literal repeated beside it, so
	// the case asserts the relationship the harness owes — each between-row gap reaches the pause,
	// and the tail after the last row does not — rather than a duration this host happened to take.
	it('waits the declared pause between rows and not after the last one', async () => {
		const pause = 40
		const marks: number[] = []
		const harness = createHarness({
			scenarios: DISCLOSURE_SCENARIOS,
			build() {
				marks.push(performance.now())
				return buildDisclosure()
			},
			state(context) {
				marks.push(performance.now())
				return readDisclosure(context)
			},
			pause,
		})

		await harness.execute()
		const finished = performance.now()

		expect(harness.status).toBe('passed')
		// One build mark and one reading mark per row, in that order.
		expect(marks.length).toBe(DISCLOSURE_SCENARIOS.length * 2)
		for (let row = 0; row < DISCLOSURE_SCENARIOS.length - 1; row += 1) {
			const reading = requireValue(marks[row * 2 + 1])
			const next = requireValue(marks[row * 2 + 2])
			expect(next - reading).toBeGreaterThanOrEqual(pause)
		}
		// Nothing waits after the last row: the run returns as soon as that row's reading is in.
		expect(finished - requireValue(marks[marks.length - 1])).toBeLessThan(pause)

		harness.destroy()
	})

	// T3-C2. The state reader is a reader rather than a phase, so its throw is not a row failing: it
	// leaves the run by identity and the row is not counted. The root still publishes a terminal
	// reading first, because the gate polling that markup has no rejection channel to read.
	it('writes failed and rejects by identity when the state reader throws', async () => {
		const unreadable = new Error('unreadable entity')
		const harness = createHarness({
			scenarios: [requireValue(DISCLOSURE_SCENARIOS[0])],
			build: buildDisclosure,
			state() {
				throw unreadable
			},
		})

		const thrown = await harness.execute().catch((error: unknown) => error)

		expect(thrown === unreadable).toBe(true)
		expect(harness.status).toBe('failed')
		expect(harness.root.getAttribute(STATECHART_ATTRIBUTES.status)).toBe('failed')
		expect(requireValue(harness.root.querySelector('[role="status"]')).textContent).toBe(
			'Statechart harness failed, 0 passed and 0 failed of 1.',
		)
		// A reader's defect is not the entity's, so no row carries a result and the tally stays at zero.
		expect(harness.passed).toBe(0)
		expect(harness.failed).toBe(0)
		expect(harness.failures).toStrictEqual([])
		expect(harness.root.querySelectorAll(`[${STATECHART_ATTRIBUTES.result}]`).length).toBe(0)

		harness.destroy()
	})

	// T3-C2. The same exit for a value that is not an `Error`: the harness writes the terminal
	// reading and the value leaves unnamed and unwrapped. This is the door the harness's own rethrow
	// answers, because `executeScenario` names every phase throw as an `Error` before it gets here.
	it('writes failed and rethrows a non-Error reader throw by identity', async () => {
		const harness = createHarness({
			scenarios: [requireValue(DISCLOSURE_SCENARIOS[0])],
			build: buildDisclosure,
			state() {
				throw 'the host refused the reading'
			},
		})

		const thrown = await harness.execute().catch((error: unknown) => error)

		expect(thrown).toBe('the host refused the reading')
		expect(harness.status).toBe('failed')
		expect(harness.failed).toBe(0)

		harness.destroy()
	})

	// T3-C2. A phase that throws a string is the row failing rather than an exceptional exit:
	// `executeScenario` names a non-`Error` throw by its type and raises an `Error` carrying the
	// value as the cause, so the harness counts the row and finishes the table.
	it('counts a phase that throws a string as its row failing', async () => {
		const harness = createHarness<'closed', 'toggle', { readonly flag: boolean }>({
			scenarios: [
				{
					transition: { name: 'the string throw', from: 'closed', event: 'toggle', to: 'closed' },
					arrange() {},
					act() {},
					assert() {
						throw 'refused'
					},
				},
			],
			build: () => ({ flag: true }),
			state: () => 'closed',
		})

		await harness.execute()

		expect(harness.status).toBe('failed')
		expect(harness.failed).toBe(1)
		expect(harness.failures).toStrictEqual(['the string throw'])
		expect(requireValue(harness.root.querySelector('[role="status"]')).textContent).toBe(
			'Statechart harness failed, 0 passed and 1 failed of 1.',
		)

		harness.destroy()
	})

	// guides/test.md → Patterns → "Drive a statechart table". The same table under the bare runner:
	// `executeScenarios` stops at the first failing row, and the row's name opens the message.
	//
	// T3-C8. `MISMATCHED_SCENARIOS` is the fence's own declaration, phases and all, so the sentence
	// asserted here is the sentence that fence's comment claims for the exact rows it declares. A
	// row whose phases the fence elided would refuse with `scenario.arrange is not a function`
	// instead, which is why the phase readings sit beside the message.
	it('stops the bare runner at the first failing row and names that row', async () => {
		await executeScenarios(DISCLOSURE_SCENARIOS, buildDisclosure)

		const mismatched = requireValue(MISMATCHED_SCENARIOS[0])
		expect(mismatched.arrange).toBeTypeOf('function')
		expect(mismatched.act).toBeTypeOf('function')
		expect(mismatched.assert).toBeTypeOf('function')

		const thrown = await executeScenarios(MISMATCHED_SCENARIOS, buildDisclosure).catch(
			(error: unknown) => error,
		)
		const failure = requireValue(thrown instanceof Error ? thrown : undefined)
		expect(
			failure.message.startsWith("the summary leaves it closed: expected 'open' to be 'closed'"),
		).toBe(true)
		expect(failure.cause).toBeInstanceOf(Error)

		const refusal = new Error('no fixture')
		const refused = await executeScenarios(MISMATCHED_SCENARIOS, () => {
			throw refusal
		}).catch((error: unknown) => error)
		const named = requireValue(refused instanceof Error ? refused : undefined)
		expect(named.message).toBe(buildRefusal('the summary leaves it closed', refusal).message)
		expect(named.cause === refusal).toBe(true)
	})
})
