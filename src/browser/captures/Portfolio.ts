import type {
	CaptureVariant,
	PortfolioInterface,
	PortfolioOptions,
	ScopeHandler,
	ViewportOptions,
} from './types.js'
import { requireValue } from '@src/core'
import { captureFrame, captureViewport, describeUnrolledView, expandCaptures } from './helpers.js'

/** Owns the registry, the placements in flight, and the written paths behind a portfolio projection. */
export class Portfolio implements PortfolioInterface {
	readonly #variant: string
	readonly #selected: CaptureVariant
	readonly #states: readonly string[]
	readonly #projection: string | undefined
	readonly #directory: string
	readonly #scope: ScopeHandler | undefined
	readonly #enabled: boolean
	readonly #unrolled: boolean
	readonly #files: readonly string[]
	readonly #observed: string[] = []
	readonly #paths: string[] = []
	readonly #pending = new Set<string>()

	constructor(options: PortfolioOptions) {
		const selected = options.variants.find((candidate) => candidate.name === options.variant)
		if (selected === undefined) {
			throw new Error(`Capture variant "${options.variant}" is not registered`)
		}
		const states = [...options.states]
		if (options.state !== undefined && !states.includes(options.state)) {
			throw new Error(`Capture state "${options.state}" is not registered`)
		}
		this.#variant = options.variant
		this.#selected = selected
		this.#states = states
		this.#projection = options.state
		this.#directory = options.directory
		this.#scope = options.scope
		this.#enabled = options.enabled ?? false
		this.#unrolled = options.unrolled ?? false
		this.#files = expandCaptures(states, options.variants, options.scope)
	}

	get variant(): string {
		return this.#variant
	}

	get files(): readonly string[] {
		return this.#files
	}

	get observed(): readonly string[] {
		return [...this.#observed]
	}

	get placements(): readonly string[] {
		return this.#observed.filter((state) => this.#writes(state))
	}

	get paths(): readonly string[] {
		return [...this.#paths]
	}

	async place(state: string, element?: Element): Promise<string | undefined> {
		this.#admit(state)
		return this.#write(state, (frame) =>
			captureFrame({ ...frame, element, unrolled: this.#unrolled }),
		)
	}

	async view(state: string): Promise<string | undefined> {
		this.#admit(state)
		if (this.#unrolled) throw new Error(describeUnrolledView(state))
		return this.#write(state, captureViewport)
	}

	#admit(state: string): void {
		if (!this.#states.includes(state)) {
			throw new Error(`Capture state "${state}" is not registered`)
		}
		if (this.#observed.includes(state) || this.#pending.has(state)) {
			throw new Error(`Capture state "${state}" is already placed`)
		}
	}

	#writes(state: string): boolean {
		return this.#enabled && (this.#projection === undefined || state === this.#projection)
	}

	async #write(
		state: string,
		shoot: (frame: ViewportOptions) => Promise<string>,
	): Promise<string | undefined> {
		if (!this.#writes(state)) {
			this.#observed.push(state)
			return undefined
		}
		const file = requireValue(expandCaptures([state], [this.#selected], this.#scope)[0])
		// Reserved before the first await, so a concurrent call for this state is refused.
		this.#pending.add(state)
		try {
			this.#selected.apply?.()
			const written = await shoot({
				path: `${this.#directory}/${file}`,
				width: this.#selected.width,
				height: this.#selected.height,
			})
			this.#observed.push(state)
			this.#paths.push(written)
			return written
		} finally {
			this.#pending.delete(state)
		}
	}
}
