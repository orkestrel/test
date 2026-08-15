/** One theme-and-viewport pair a capture run renders. */
export interface CaptureVariant {
	/** The variant's name, which is the second half of every filename the run writes. */
	readonly name: string
	/** The viewport width in pixels. */
	readonly width: number
	/** The viewport height in pixels. */
	readonly height: number
	/**
	 * The document change this variant needs before the viewport is resized — a theme attribute, a
	 * density class, a language direction. Omit it when the variant is a viewport alone.
	 */
	readonly apply?: () => void
}

/** Options for a capture portfolio. */
export interface PortfolioOptions {
	/**
	 * Every state name the journeys place, declared once. `place` refuses a name absent from this
	 * list, so the registry and the disk cannot drift apart.
	 */
	readonly states: readonly string[]
	/** Every variant the portfolio can be rendered in. One run renders exactly one of them. */
	readonly variants: readonly CaptureVariant[]
	/** The name of the variant this run renders. Creation throws when no variant carries it. */
	readonly variant: string
	/** The directory each written file is placed in, relative to the calling test file. */
	readonly directory: string
	/**
	 * Whether this run writes files. An ordinary run leaves it unset, so `place` resizes nothing,
	 * writes nothing, and records nothing.
	 */
	readonly enabled?: boolean
}

/** The registry of capture states one run places, and the files it wrote placing them. */
export interface PortfolioInterface {
	/** The name of the variant this run renders. */
	readonly variant: string
	/** Every state placed so far, in placement order. */
	readonly states: readonly string[]
	/** Every path written so far, in write order. */
	readonly paths: readonly string[]
	/** The registry expanded across every variant: the filenames a complete portfolio holds. */
	readonly files: readonly string[]
	/**
	 * Places one registered state: applies the variant, resizes the viewport, and writes the
	 * screenshot.
	 *
	 * @param state - The state name from the registry.
	 * @returns The written path, or `undefined` when the portfolio is not enabled.
	 * @throws When the state is not registered or has already been placed.
	 */
	place(state: string): Promise<string | undefined>
}
