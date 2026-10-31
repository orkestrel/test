import type { JournalInterface, JournalStep } from './types.js'
import { recordConsole } from './helpers.js'

/** Owns the state and console subscriptions behind a journal projection. */
export class Journal implements JournalInterface {
	readonly #steps: JournalStep[] = []
	readonly #output: string[] = []
	#intercepted: Pick<Console, 'debug' | 'error' | 'info' | 'log' | 'warn'> | undefined
	#listeners: AbortController | undefined
	get steps(): readonly JournalStep[] {
		return [...this.#steps]
	}
	get output(): readonly string[] {
		return [...this.#output]
	}
	start() {
		this.#steps.length = 0
		this.#output.length = 0
		if (this.#intercepted !== undefined) return
		const forwarded = {
			debug: console.debug,
			error: console.error,
			info: console.info,
			log: console.log,
			warn: console.warn,
		}
		this.#intercepted = forwarded
		for (const channel of ['debug', 'error', 'info', 'log', 'warn'] as const) {
			console[channel] = recordConsole(channel, this.#output, forwarded[channel])
		}
		const dropped = new AbortController()
		this.#listeners = dropped
		window.addEventListener(
			'error',
			(event) => {
				this.#output.push(`error: ${event.message}`)
			},
			{ signal: dropped.signal },
		)
		window.addEventListener(
			'unhandledrejection',
			(event) => {
				this.#output.push(`rejection: ${String(event.reason)}`)
			},
			{ signal: dropped.signal },
		)
	}
	stop() {
		if (this.#intercepted === undefined) return
		Object.assign(console, this.#intercepted)
		this.#intercepted = undefined
		this.#listeners?.abort()
		this.#listeners = undefined
	}
	record(action: string, trigger: string, result: string) {
		if (this.#intercepted === undefined) return
		this.#steps.push(Object.freeze({ action, trigger, result }))
	}
}
