import type {
	HarnessInterface,
	HarnessOptions,
	JournalInterface,
	JournalStep,
	PortfolioInterface,
	PortfolioOptions,
	StorageOptions,
	WebStorageInterface,
} from './types.js'
import { isError, isInteger } from '@orkestrel/contract'
import {
	executeScenario,
	requireValue,
	STATECHART_ATTRIBUTES,
	STATECHART_STATUSES,
	waitForDelay,
} from '@src/core'
import { build, buildDenial, captureFrame, expandCaptures, mount } from './helpers.js'

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
 * Creates the capture portfolio one run places its screenshots through.
 *
 * @param options - The state registry, the variant matrix, the variant this run renders, the
 * directory it writes into, and whether it writes at all.
 * @returns The portfolio: its registry expansion, what it has placed, and `place`.
 * @throws When no registered variant carries the name `variant` names.
 *
 * @remarks
 * A disabled portfolio is the ordinary run. `place` then resizes nothing, writes nothing, and
 * records nothing, so a journey calls it unconditionally and a suite with the flag unset pays for
 * none of it. The portfolio refuses an unregistered variant at creation. An enabled run refuses an
 * unregistered state name and a second placement of one state.
 *
 * An enabled `place` writes through `captureFrame`, so a placed state carries that helper's staged
 * pane and its byte readback: a path is recorded only after the file on disk has been proved to hold
 * this run's own frame.
 *
 * @example
 * ```ts
 * const portfolio = createPortfolio({
 * 	states: ['start-empty'],
 * 	variants: [{ name: 'dark-390', width: 390, height: 844 }],
 * 	variant: 'dark-390',
 * 	directory: '../../tmp/capture/states',
 * })
 * await portfolio.place('start-empty')
 * ```
 */
export function createPortfolio(options: PortfolioOptions): PortfolioInterface {
	const selected = options.variants.find((candidate) => candidate.name === options.variant)
	if (selected === undefined) {
		throw new Error(`Capture variant "${options.variant}" is not registered`)
	}
	const registry = [...options.states]
	const files = expandCaptures(registry, options.variants)
	const enabled = options.enabled ?? false
	const placed: string[] = []
	const paths: string[] = []
	return {
		variant: options.variant,
		files,
		get placements() {
			return [...placed]
		},
		get paths() {
			return [...paths]
		},
		async place(state, element) {
			if (!enabled) return undefined
			if (!registry.includes(state)) {
				throw new Error(`Capture state "${state}" is not registered`)
			}
			if (placed.includes(state)) {
				throw new Error(`Capture state "${state}" is already placed`)
			}
			const file = `${state}--${options.variant}.png`
			selected.apply?.()
			const written = await captureFrame({
				path: `${options.directory}/${file}`,
				width: selected.width,
				height: selected.height,
				element,
			})
			placed.push(state)
			paths.push(written)
			return written
		},
	}
}

/**
 * Creates one console channel that records every call it receives and hands that call on unchanged.
 *
 * @param name - The channel's name, which prefixes each line it records.
 * @param output - The list each call is recorded into, appended to in place.
 * @param forward - The channel every call is passed on to after it is recorded.
 * @returns A channel carrying the console's own call signature.
 *
 * @remarks
 * One call becomes one line. Every argument of that call is put through `String` and joined with a
 * space, so a call carrying several values reads as the one line the page printed rather than as
 * several entries.
 *
 * Nothing is swallowed. The record happens first and `forward` receives the arguments it would have
 * received, so a page recorded through this prints exactly what it printed without it. The list
 * belongs to the caller, so a channel writes into whatever it was handed and holds no state of its
 * own. {@link createJournal} builds one channel per console method over one list.
 *
 * @example
 * ```ts
 * const output: string[] = []
 * console.log = createChannel('log', output, console.log)
 * ```
 */
export function createChannel(
	name: string,
	output: string[],
	forward: (...data: unknown[]) => void,
): (...data: unknown[]) => void {
	return (...data) => {
		output.push(`${name}: ${data.map((value) => String(value)).join(' ')}`)
		forward(...data)
	}
}

/**
 * Creates the journal one scenario records its steps and the page's own output into.
 *
 * @returns A journal that records nothing until it is started.
 *
 * @remarks
 * The console is recorded rather than replaced: every intercepted call is forwarded to the channel
 * that was there when the journal started, so a run under a journal prints exactly what it printed
 * without one. `stop` puts those same function references back by identity.
 *
 * Uncaught errors and unhandled rejections are recorded too, through listeners the journal drops
 * when it stops. `steps` and `output` hand out snapshots, so a list read mid-scenario stays what it
 * was. Each journal owns its own recording, so a file that needs one per scenario creates one per
 * scenario.
 *
 * @example
 * ```ts
 * const journal = createJournal()
 * journal.start()
 * journal.record('click', 'Evaluate', 'alerts=0')
 * journal.stop()
 * journal.steps // [{ action: 'click', trigger: 'Evaluate', result: 'alerts=0' }]
 * ```
 */
export function createJournal(): JournalInterface {
	const steps: JournalStep[] = []
	const output: string[] = []
	// The channels the page was writing to when the journal started. Their presence is what "started"
	// means, so no second flag can disagree with it. The listeners are dropped through one signal,
	// which is why no handler reference has to be kept to take them off again.
	let intercepted: Pick<Console, 'debug' | 'error' | 'info' | 'log' | 'warn'> | undefined
	let listeners: AbortController | undefined
	return {
		get steps() {
			return [...steps]
		},
		get output() {
			return [...output]
		},
		start() {
			steps.length = 0
			output.length = 0
			if (intercepted !== undefined) return
			const forwarded = {
				debug: console.debug,
				error: console.error,
				info: console.info,
				log: console.log,
				warn: console.warn,
			}
			intercepted = forwarded
			for (const channel of ['debug', 'error', 'info', 'log', 'warn'] as const) {
				console[channel] = createChannel(channel, output, forwarded[channel])
			}
			const dropped = new AbortController()
			listeners = dropped
			window.addEventListener(
				'error',
				(event) => {
					output.push(`error: ${event.message}`)
				},
				{ signal: dropped.signal },
			)
			window.addEventListener(
				'unhandledrejection',
				(event) => {
					output.push(`rejection: ${String(event.reason)}`)
				},
				{ signal: dropped.signal },
			)
		},
		stop() {
			if (intercepted === undefined) return
			Object.assign(console, intercepted)
			intercepted = undefined
			listeners?.abort()
			listeners = undefined
		},
		record(action, trigger, result) {
			if (intercepted === undefined) return
			steps.push(Object.freeze({ action, trigger, result }))
		},
	}
}

/**
 * Creates an inert `Storage` a host can withhold, grant, and run out of room in.
 *
 * @param options - The seed, the read and write permissions, and the quota.
 * @returns A store carrying the Web Storage surface plus the grant.
 * @throws An `Error` when `quota` is not a non-negative integer.
 *
 * @remarks
 * Conditions a real origin produces are unreachable from a test otherwise: a browser with
 * site data blocked refuses every operation the permission withholds, an origin with no room left
 * refuses `setItem`, and a person allowing site data grants what was withheld. This makes each of
 * them reachable against a real `Storage` surface rather than a shaped object.
 *
 * It is backed by a map of its own and patches nothing: `localStorage` and `sessionStorage` are
 * untouched, no `storage` event is dispatched, and the store is reached only by the code the test
 * hands it to. Reach for {@link clearStorage} where the real browser surfaces are the subject.
 *
 * `length`, `key`, and `getItem` are reads; `clear`, `removeItem`, and `setItem` are writes. A
 * withheld operation raises {@link buildDenial}'s `SecurityError`, and `permit` lifts both
 * permissions at once, the way a person allowing site data lifts them. Reads answer from what the
 * store actually accepted, so a journey reads what the application kept while the host was refusing.
 *
 * `quota` counts accepted `setItem` calls rather than bytes, because the number of writes is what a
 * journey scripts and a byte budget is the browser's own arithmetic. `removeItem` consumes none of
 * it, and `permit` replenishes none of it: room and permission are different refusals, and a test
 * that granted the permission still meets the full origin.
 *
 * @example
 * ```ts
 * const storage = createStorage({ values: { theme: 'dark' }, writes: false })
 * storage.getItem('theme') // 'dark'
 * storage.permit()
 * storage.setItem('theme', 'light')
 * ```
 */
export function createStorage(options?: StorageOptions): WebStorageInterface {
	const quota = options?.quota
	if (quota !== undefined && (!isInteger(quota) || quota < 0)) {
		throw new Error('Storage quota must be a non-negative integer')
	}
	const values = new Map<string, string>(Object.entries(options?.values ?? {}))
	let reads = options?.reads ?? true
	let writes = options?.writes ?? true
	let room = quota
	return {
		get length() {
			if (!reads) throw buildDenial('length')
			return values.size
		},
		permit() {
			reads = true
			writes = true
		},
		clear() {
			if (!writes) throw buildDenial('clear')
			values.clear()
		},
		getItem(key) {
			if (!reads) throw buildDenial('getItem', key)
			return values.get(key) ?? null
		},
		key(index) {
			if (!reads) throw buildDenial('key')
			return [...values.keys()][index] ?? null
		},
		removeItem(key) {
			if (!writes) throw buildDenial('removeItem', key)
			values.delete(key)
		},
		setItem(key, value) {
			if (!writes) throw buildDenial('setItem', key)
			if (room !== undefined) {
				if (room === 0) throw new DOMException(`No room is left for ${key}`, 'QuotaExceededError')
				room -= 1
			}
			values.set(key, value)
		},
	}
}

/**
 * Creates a mounted statechart harness that renders one transition table and drives it row by row.
 *
 * @typeParam TState - The states the entity moves between.
 * @typeParam TEvent - The events the entity accepts.
 * @typeParam TContext - The fixture each row drives.
 * @param options - The table, the fixture builder, the state reader, and the delay between rows.
 * @returns The mounted harness, standing idle with its tally at zero.
 * @throws An `Error` reading `Statechart harness mounted no transition` for an empty table, before
 * anything reaches the document.
 *
 * @remarks
 * A page cannot import this package, because the browser entry imports `vitest/browser` at module
 * scope. So the harness is test-side: the suite mounts it, a gate outside the page polls the
 * markup it renders, and `STATECHART_ATTRIBUTES` is the whole contract between the two. Nothing
 * here spells a `data-statechart-*` string of its own, and neither does a gate.
 *
 * The markup is framework-free. The root carries `status` and the tally; a `role="status"`
 * announcer narrates each step in a sentence; one element carries `state` and renders what the
 * entity's own reader reports; and an ordered list carries one row per scenario, each labelled with
 * its `from`, its `event`, and its `to` and marked with the transition's name. The `state` element
 * mounts empty and takes its attribute from the first row that produces a context, because a state
 * is read from an entity and no entity exists until a row builds one.
 *
 * Construction writes `pending`, mounts the root, renders every row, then writes the row count and
 * `idle` — so a gate that reads `pending` has found a harness whose rows never mounted, and the
 * order is observable from outside through the mutations the document records.
 *
 * `execute` clears every rendered result, writes `running`, and drives each row in order through
 * {@link executeScenario} against a context of that row's own. It continues past a failing row, so
 * one run reports on the whole table rather than stopping at the first finding, and a builder that
 * throws counts as its row failing under the name `executeScenarios` gives it. A second `execute`
 * runs the same table from a fresh tally.
 *
 * Every reading comes off the markup, so the object and the page cannot disagree, and `failures` is
 * the `scenario` name of each row whose rendered `result` reads `failed` rather than a second list
 * beside them.
 *
 * @example
 * ```ts
 * const harness = createHarness({ scenarios: SCENARIOS, build: buildDisclosure, state: readState })
 * await harness.execute()
 * harness.status // 'passed'
 * harness.destroy()
 * ```
 */
export function createHarness<TState extends string, TEvent extends string, TContext>(
	options: HarnessOptions<TState, TEvent, TContext>,
): HarnessInterface {
	const scenarios = options.scenarios
	if (scenarios.length === 0) throw new Error('Statechart harness mounted no transition')
	const root = mount(build('div', { attributes: { [STATECHART_ATTRIBUTES.status]: 'pending' } }))
	const announcer = build('p', { attributes: { role: 'status' } })
	const state = build('p')
	const rows = build('ol')
	root.append(announcer, state, rows)
	// Each row's element is kept beside the scenario it renders, so a run reaches its own row by
	// identity rather than by an index into a live collection or by a name the table may repeat.
	const table = scenarios.map((scenario) => ({
		scenario,
		element: build('li', {
			text: `${scenario.transition.name}: ${scenario.transition.from} on ${scenario.transition.event} becomes ${scenario.transition.to}`,
			attributes: { [STATECHART_ATTRIBUTES.scenario]: scenario.transition.name },
		}),
	}))
	for (const row of table) rows.append(row.element)
	root.setAttribute(STATECHART_ATTRIBUTES.total, String(table.length))
	root.setAttribute(STATECHART_ATTRIBUTES.passed, '0')
	root.setAttribute(STATECHART_ATTRIBUTES.failed, '0')
	root.setAttribute(STATECHART_ATTRIBUTES.status, 'idle')
	announcer.textContent = `Statechart harness is idle, 0 passed and 0 failed of ${table.length}.`
	return {
		root,
		get status() {
			const written = root.getAttribute(STATECHART_ATTRIBUTES.status)
			return requireValue(
				STATECHART_STATUSES.find((member) => member === written),
				'Statechart harness carries no status',
			)
		},
		get total() {
			return Number(root.getAttribute(STATECHART_ATTRIBUTES.total))
		},
		get passed() {
			return Number(root.getAttribute(STATECHART_ATTRIBUTES.passed))
		},
		get failed() {
			return Number(root.getAttribute(STATECHART_ATTRIBUTES.failed))
		},
		get failures() {
			const names: string[] = []
			for (const row of table) {
				if (row.element.getAttribute(STATECHART_ATTRIBUTES.result) !== 'failed') continue
				const name = row.element.getAttribute(STATECHART_ATTRIBUTES.scenario)
				if (name !== null) names.push(name)
			}
			return names
		},
		async execute() {
			for (const row of table) row.element.removeAttribute(STATECHART_ATTRIBUTES.result)
			let passed = 0
			let failed = 0
			root.setAttribute(STATECHART_ATTRIBUTES.passed, '0')
			root.setAttribute(STATECHART_ATTRIBUTES.failed, '0')
			root.setAttribute(STATECHART_ATTRIBUTES.status, 'running')
			announcer.textContent = `Statechart harness is running, 0 passed and 0 failed of ${table.length}.`
			for (const [index, row] of table.entries()) {
				let context: TContext | undefined
				let refusal: string | undefined
				try {
					context = await options.build(row.scenario)
				} catch {
					refusal = `${row.scenario.transition.name}: build refused`
				}
				if (context !== undefined) {
					try {
						await executeScenario(row.scenario, context)
					} catch (cause) {
						// `executeScenario` raises an `Error` for every failing phase, so anything else
						// came from outside this contract and is the caller's to see unchanged.
						if (!isError(cause)) throw cause
						refusal = cause.message
					}
					const current = options.state(context)
					state.setAttribute(STATECHART_ATTRIBUTES.state, current)
					state.textContent = current
				}
				if (refusal === undefined) passed += 1
				else failed += 1
				row.element.setAttribute(
					STATECHART_ATTRIBUTES.result,
					refusal === undefined ? 'passed' : 'failed',
				)
				root.setAttribute(STATECHART_ATTRIBUTES.passed, String(passed))
				root.setAttribute(STATECHART_ATTRIBUTES.failed, String(failed))
				announcer.textContent = refusal ?? `${row.scenario.transition.name} passed.`
				if (options.pause !== undefined && index < table.length - 1) {
					await waitForDelay(options.pause)
				}
			}
			const outcome = failed === 0 ? 'passed' : 'failed'
			root.setAttribute(STATECHART_ATTRIBUTES.status, outcome)
			announcer.textContent = `Statechart harness ${outcome}, ${passed} passed and ${failed} failed of ${table.length}.`
		},
		destroy() {
			root.remove()
		},
	}
}
