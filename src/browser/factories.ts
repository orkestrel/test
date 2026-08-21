import type {
	JournalInterface,
	JournalStep,
	PortfolioInterface,
	PortfolioOptions,
} from './types.js'
import { captureFrame, expandCaptures } from './helpers.js'

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
		get states() {
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
				console[channel] = (...data: unknown[]) => {
					output.push(`${channel}: ${data.map((value) => String(value)).join(' ')}`)
					forwarded[channel](...data)
				}
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
