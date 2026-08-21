import type {
	JournalInterface,
	JournalStep,
	PortfolioInterface,
	PortfolioOptions,
} from './types.js'
import { captureFrame, expandCaptures } from './helpers.js'

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
