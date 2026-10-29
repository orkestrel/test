import {
	buildDenial,
	clickAccessible,
	createChannel,
	createDragEvent,
	createHarness,
	createJournal,
	createKeyboardEvent,
	createPointerEvent,
	createStorage,
	readPerception,
} from '@src/browser'
import {
	buildRefusal,
	captureError,
	captureProduction,
	TIMER_LEAD,
	createRecorder,
	executeScenarios,
	requireValue,
	STATECHART_ATTRIBUTES,
	waitForDelay,
} from '@src/core'
import { afterEach, describe, expect, it } from 'vitest'
import { TestCounter, TestValue } from '../../../setup.js'
import {
	arrangeDisclosure,
	actOnDisclosure,
	assertDisclosure,
	readDisclosure,
	buildDisclosure,
	DISCLOSURE_SCENARIOS,
	MISMATCHED_SCENARIOS,
	MIXED_SCENARIOS,
	mounted,
	buildFixture,
	dispatchFromShadow,
	resetFixtures,
} from '../../../setupBrowser.js'

afterEach(resetFixtures)

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
		// reach the terminal, which is why the two following lines are asserted by membership.
		const printed = createRecorder<[unknown]>()
		const channels = { error: console.error, warn: console.warn }
		console.error = printed.handler
		console.warn = printed.handler
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
			const recorded = journal.output
			window.dispatchEvent(new ErrorEvent('error', { message: 'Ignored' }))
			expect(recorded).toContain('error: Boom')
			expect(recorded).toContain('rejection: Refused')
			// The listeners go with the console, so a failure after the journal stopped reaches neither.
			expect(journal.output).toStrictEqual(recorded)
		} finally {
			Object.assign(console, channels)
		}
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
		try {
			journal.start()
			const armed = console.log
			journal.record('click', 'First', 'alerts=0')
			console.log('first')
			journal.start()
			const rearmed = console.log
			journal.record('click', 'Second', 'alerts=1')
			journal.stop()
			const restored = console.log
			expect(rearmed).toBe(armed)
			expect(restored).toBe(printed.handler)
		} finally {
			console.log = original
		}
		// A restart that re-captured the console would stack its second wrapper on the first, and
		// `stop` would then hand back a wrapper instead of the recorder that was there.
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
		const outcome = await captureProduction(async () => {
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
		})
		const refused =
			outcome.status === 'fulfilled'
				? ''
				: outcome.reason instanceof Error
					? outcome.reason.message
					: 'no error'
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

describe('createHarness', () => {
	// A harness mounts itself and records nothing, exactly as `mount` does, so a harness a failing
	// assertion left behind is the next test's ambiguity. This takes back whatever is still there.
	afterEach(() => {
		for (const root of [...document.querySelectorAll(`[${STATECHART_ATTRIBUTES.status}]`)]) {
			root.remove()
		}
		mounted.value = undefined
	})

	// T2-C1.
	it('refuses a table with no transition in it and mounts nothing', () => {
		const before = document.body.childElementCount

		expect(
			captureError(() =>
				createHarness({
					scenarios: [],
					build: () => {
						return buildDisclosure((actual, expected) => {
							expect(actual).toBe(expected)
						})
					},
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
			build: () => {
				return buildDisclosure((actual, expected) => {
					expect(actual).toBe(expected)
				})
			},
			state: readDisclosure,
		})
		const records = observer.takeRecords()
		observer.disconnect()

		const rows = records.flatMap((record, index) =>
			record.type === 'attributes'
				? []
				: Array.from(record.addedNodes)
						.filter((node) => node instanceof Element && node.localName === 'li')
						.map(() => index),
		)
		const mountedRows = rows.length
		const lastRow = rows.at(-1) ?? -1
		const total = records.findLastIndex(
			(record) =>
				record.type === 'attributes' && record.attributeName === STATECHART_ATTRIBUTES.total,
		)
		const status = records.findLastIndex(
			(record) =>
				record.type === 'attributes' &&
				record.attributeName === STATECHART_ATTRIBUTES.status &&
				record.oldValue === 'pending',
		)
		const narration = records.findLastIndex(
			(record) =>
				record.type !== 'attributes' &&
				Array.from(record.addedNodes).some((node) => node instanceof Text),
		)

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
			build: () => {
				return buildDisclosure((actual, expected) => {
					expect(actual).toBe(expected)
				})
			},
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
			build: () => {
				return buildDisclosure((actual, expected) => {
					expect(actual).toBe(expected)
				})
			},
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
			build: () => {
				return buildDisclosure((actual, expected) => {
					expect(actual).toBe(expected)
				})
			},
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
		const refusals = new TestCounter()
		const announced = new TestValue<string | undefined>(undefined)
		const harness = createHarness({
			scenarios: MIXED_SCENARIOS,
			build(scenario) {
				if (refusals.count === 1 && announced.value === undefined) {
					announced.value = announcer.textContent ?? undefined
				}
				if (scenario.transition.name === 'the summary leaves it closed') {
					refusals.increment()
					throw refusal
				}
				return buildDisclosure((actual, expected) => {
					expect(actual).toBe(expected)
				})
			},
			state: readDisclosure,
		})
		// The builder first runs inside `execute`, which is after this reading is in hand.
		const announcer = requireValue(harness.root.querySelector('[role="status"]'))

		await harness.execute()

		expect(refusals.count).toBe(1)
		expect(announced.value).toBe(buildRefusal('the summary leaves it closed', refusal).message)
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
		const runs = new TestCounter()
		const observed = new TestValue<
			{ readonly attribute: string | null; readonly text: string } | undefined
		>(undefined)
		const harness = createHarness({
			scenarios: [requireValue(DISCLOSURE_SCENARIOS[0])],
			build() {
				runs.increment()
				// The element the first run rendered into, read on the second run before any row of
				// that run has produced a context. The builder first runs inside `execute`, which is
				// after the following reading is in hand.
				if (runs.count === 2) {
					observed.value = {
						attribute: rendered.getAttribute(STATECHART_ATTRIBUTES.state),
						text: rendered.textContent ?? '',
					}
				}
				return buildDisclosure((actual, expected) => {
					expect(actual).toBe(expected)
				})
			},
			state: readDisclosure,
		})

		await harness.execute()

		const rendered = requireValue(harness.root.querySelector(`[${STATECHART_ATTRIBUTES.state}]`))
		expect(rendered.getAttribute(STATECHART_ATTRIBUTES.state)).toBe('open')
		expect(rendered.textContent).toBe('open')

		await harness.execute()

		expect(requireValue(observed.value).attribute).toBeNull()
		expect(requireValue(observed.value).text).toBe('')
		// The reading was taken, so an absent one cannot pass for a cleared one.
		expect(runs.count).toBe(2)
		// The run put it back, so the clearing is the reset the tally gets rather than a removal.
		expect(rendered.getAttribute(STATECHART_ATTRIBUTES.state)).toBe('open')
		expect(rendered.textContent).toBe('open')

		harness.destroy()
	})

	// T2-C5.
	it('re-runs from a fresh tally and hands the root back on destroy', async () => {
		const harness = createHarness({
			scenarios: MIXED_SCENARIOS,
			build: () => {
				return buildDisclosure((actual, expected) => {
					expect(actual).toBe(expected)
				})
			},
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

		const count = document.body.childElementCount
		expect(captureError(() => harness.destroy())).toBeUndefined()
		expect(document.body.childElementCount).toBe(count)
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
				return buildDisclosure((actual, expected) => {
					expect(actual).toBe(expected)
				})
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
		for (const [row] of DISCLOSURE_SCENARIOS.slice(0, -1).entries()) {
			const time = requireValue(marks[row * 2 + 1])
			const next = requireValue(marks[row * 2 + 2])
			expect(next - time).toBeGreaterThanOrEqual(pause - TIMER_LEAD)
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
			build: () => {
				return buildDisclosure((actual, expected) => {
					expect(actual).toBe(expected)
				})
			},
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
			build: () => {
				return buildDisclosure((actual, expected) => {
					expect(actual).toBe(expected)
				})
			},
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
		await executeScenarios(DISCLOSURE_SCENARIOS, () => {
			return buildDisclosure((actual, expected) => {
				expect(actual).toBe(expected)
			})
		})

		const mismatched = requireValue(MISMATCHED_SCENARIOS[0])
		expect(mismatched.arrange).toBeTypeOf('function')
		expect(mismatched.act).toBeTypeOf('function')
		expect(mismatched.assert).toBeTypeOf('function')

		const pending = executeScenarios(MISMATCHED_SCENARIOS, () => {
			return buildDisclosure((actual, expected) => {
				expect(actual).toBe(expected)
			})
		})
		const thrown = await pending.catch((error: unknown) => error)
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
		expect(event.composed).toBe(true)
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
		const event = createPointerEvent('pointerdown', {
			bubbles: false,
			cancelable: false,
			composed: false,
		})
		expect(event.bubbles).toBe(false)
		expect(event.cancelable).toBe(false)
		expect(event.composed).toBe(false)
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

	// The control: the same event without `composed` stops at the shadow root, which is the shape
	// that fails in a test and works in a browser, whose own pointer events cross the boundary.
	it('crosses an open shadow root to a document listener', () => {
		expect(dispatchFromShadow(createPointerEvent('pointerdown'))).toStrictEqual(['pointerdown'])
		expect(dispatchFromShadow(new PointerEvent('pointerdown', { bubbles: true }))).toStrictEqual([])
	})

	// The 0.0.26 default left `composed` false, so a pointer event dispatched inside an open shadow
	// root stayed there. The override restores that boundary behavior.
	it('stays inside an open shadow root when the caller names composed false', () => {
		expect(
			dispatchFromShadow(createPointerEvent('pointerdown', { composed: false })),
		).toStrictEqual([])
	})
})

describe('createDragEvent', () => {
	it('builds a real drag event of the type asked for', () => {
		const event = createDragEvent('dragstart')
		expect(event).toBeInstanceOf(DragEvent)
		expect(event.type).toBe('dragstart')
		expect(event.bubbles).toBe(true)
		expect(event.cancelable).toBe(true)
		expect(event.composed).toBe(true)
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

	it('crosses an open shadow root to a document listener', () => {
		expect(dispatchFromShadow(createDragEvent('drop'))).toStrictEqual(['drop'])
		expect(dispatchFromShadow(new DragEvent('drop', { bubbles: true }))).toStrictEqual([])
	})

	// The 0.0.26 default left `composed` false, so a drag event dispatched inside an open shadow
	// root stayed there. The override restores that boundary behavior.
	it('stays inside an open shadow root when the caller names composed false', () => {
		expect(dispatchFromShadow(createDragEvent('drop', { composed: false }))).toStrictEqual([])
	})
})

describe('createKeyboardEvent', () => {
	it('builds a real keyboard event of the type asked for', () => {
		const event = createKeyboardEvent('keydown', { key: 'Escape' })
		expect(event).toBeInstanceOf(KeyboardEvent)
		expect(event.type).toBe('keydown')
		expect(event.key).toBe('Escape')
	})

	it('carries the defaults a hand-built event lacks', () => {
		const event = createKeyboardEvent('keyup')
		expect(event.bubbles).toBe(true)
		expect(event.cancelable).toBe(true)
		expect(event.composed).toBe(true)
	})

	it('takes an override without restating the rest', () => {
		const event = createKeyboardEvent('keydown', { key: 'k', ctrlKey: true })
		expect(event.ctrlKey).toBe(true)
		expect(event.shiftKey).toBe(false)
		expect(event.bubbles).toBe(true)
	})

	it('overrides a bubbling default when the caller names it', () => {
		const event = createKeyboardEvent('keydown', {
			bubbles: false,
			cancelable: false,
			composed: false,
		})
		expect(event.bubbles).toBe(false)
		expect(event.cancelable).toBe(false)
		expect(event.composed).toBe(false)
	})

	it('reaches an ancestor listener and can be prevented, which a bare event cannot', () => {
		const container = buildFixture('<div><button type="button">Save</button></div>')
		const heard = createRecorder<[string]>()
		container.addEventListener('keydown', (event) => heard.handler(event.type))
		const button = requireValue(container.querySelector('button'))
		const bare = new KeyboardEvent('keydown')
		button.dispatchEvent(bare)
		bare.preventDefault()
		expect(heard.calls).toStrictEqual([])
		expect(bare.defaultPrevented).toBe(false)
		const event = createKeyboardEvent('keydown')
		const proceeded = button.dispatchEvent(event)
		expect(heard.calls).toStrictEqual([['keydown']])
		expect(proceeded).toBe(true)
		event.preventDefault()
		expect(event.defaultPrevented).toBe(true)
	})

	it('crosses an open shadow root to a document listener', () => {
		expect(dispatchFromShadow(createKeyboardEvent('keydown', { key: 'Escape' }))).toStrictEqual([
			'keydown',
		])
		expect(
			dispatchFromShadow(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })),
		).toStrictEqual([])
	})
})
