/**
 * One rendered color as straight sRGB channels and its alpha.
 *
 * @remarks
 * The channels run 0–255 and the alpha runs 0–1, which is the shape a computed `rgb()` value already
 * carries. `parseColor` converts the 0–1 channels of `color(srgb …)` onto the same scale, so every
 * color the measurement family passes around is comparable without asking where it came from.
 */
export type Color = readonly [red: number, green: number, blue: number, alpha: number]

/** Options for one captured frame. */
export interface FrameOptions {
	/** The frame's path, relative to the calling test file. */
	readonly path: string
	/** The viewport width in CSS pixels the frame is shot at. */
	readonly width: number
	/** The viewport height in CSS pixels the frame is shot at. */
	readonly height: number
	/** The element to shoot. Omit it to shoot the whole page. */
	readonly element?: Element | undefined
}

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
	 * Places one registered state: applies the variant, stages the pane, and writes the verified
	 * screenshot.
	 *
	 * @param state - The state name from the registry.
	 * @param element - The element to shoot. Omit it to shoot the whole page.
	 * @returns The written path, or `undefined` when the portfolio is not enabled.
	 * @throws When the state is not registered, has already been placed, or the written frame does
	 * not read back as the bytes this shot produced.
	 */
	place(state: string, element?: Element): Promise<string | undefined>
}

/** One scripted step a journal recorded, and what the surface did about it. */
export interface JournalStep {
	/** What the run did, as one verb. */
	readonly action: string
	/** The exact thing it did it to. */
	readonly trigger: string
	/** What was observed on the surface after the step landed. */
	readonly result: string
}

/**
 * The record of one scenario: every step it took and everything the page said while it ran.
 *
 * @remarks
 * Recording is off until {@link JournalInterface.start} arms it, so a suite that never starts a
 * journal pays for none of it. The console is observed by standing in front of it and forwarding
 * every call to the channel that was there: a browser offers no listener for its own output, and a
 * journal that swallowed what it read would hide exactly the diagnostics it exists to keep.
 */
export interface JournalInterface {
	/** Every step recorded since the journal started, in the order it was taken; a snapshot. */
	readonly steps: readonly JournalStep[]
	/** Every console line and uncaught failure the page emitted since it started; a snapshot. */
	readonly output: readonly string[]
	/**
	 * Starts a fresh recording, dropping whatever the previous scenario left.
	 *
	 * @remarks
	 * Calling this on a started journal clears both lists and leaves the console interception
	 * standing, so a restart never wraps its own wrappers.
	 */
	start(): void
	/**
	 * Stops recording and hands every intercepted console channel back by identity.
	 *
	 * @remarks
	 * Calling this on a stopped journal does nothing. The recorded lists survive, so a scenario is
	 * read after its recording ends.
	 */
	stop(): void
	/**
	 * Records one step, when the journal is started.
	 *
	 * @param action - What the run did, as one verb.
	 * @param trigger - The exact thing it did it to.
	 * @param result - What was observed on the surface after the step landed.
	 */
	record(action: string, trigger: string, result: string): void
}
