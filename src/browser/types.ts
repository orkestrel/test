/**
 * Represents one rendered color as straight sRGB channels and its alpha.
 *
 * @remarks
 * The channels run 0–255 and the alpha runs 0–1, which is the shape a computed `rgb()` value already
 * carries. `parseColor` converts the 0–1 channels of `color(srgb …)` onto the same scale, so every
 * color the measurement family passes around is comparable without asking where it came from.
 */
export type Color = readonly [red: number, green: number, blue: number, alpha: number]

/**
 * Configures one built element.
 *
 * @remarks
 * `classes` is written the way a `class` attribute is written — one space-separated string — so a
 * fixture reads as the markup it stands in for. `attributes` is set name by name after the class
 * list and the text, so an `attributes` entry named `class` wins over `classes` rather than merging
 * with it.
 */
export interface ElementOptions {
	/** Holds the class list, space-separated, exactly as a `class` attribute writes it. */
	readonly classes?: string
	/** Holds the text the element carries, set as text rather than parsed as markup. */
	readonly text?: string
	/** Holds every attribute to set, keyed by attribute name. */
	readonly attributes?: Readonly<Record<string, string>>
}

/** Configures one captured frame. */
export interface FrameOptions {
	/** Holds the frame's path, relative to the calling test file. */
	readonly path: string
	/** Holds the viewport width in CSS pixels the frame is shot at. */
	readonly width: number
	/** Holds the viewport height in CSS pixels the frame is shot at. */
	readonly height: number
	/** Holds the element to shoot. Omit it to shoot the whole page. */
	readonly element?: Element | undefined
}

/**
 * Represents one written frame, read back from the file a capture produced.
 *
 * @remarks
 * The floor is the frame's bottom row, because that row is where coverage shows: a frame shot at a
 * pane shorter than the document ends on the runner's own canvas rather than on the document's
 * background, and the two read as different colors. A row counts as one color only when every
 * channel matches across it, alpha included, and `floor` names the three color channels of that one
 * color in the `rgb(r, g, b)` form a computed style is written in, so a literal comparison,
 * `parseColor`, and `matchesColor` all take it.
 */
export interface FrameReading {
	/** Holds the frame's width in device pixels. */
	readonly width: number
	/** Holds the frame's height in device pixels. */
	readonly height: number
	/** Holds the single color the frame's bottom row paints; `undefined` where that row paints several. */
	readonly floor: string | undefined
}

/** Represents one theme-and-viewport pair a capture run renders. */
export interface CaptureVariant {
	/** Holds the variant's name, which is the second half of every filename the run writes. */
	readonly name: string
	/** Holds the viewport width in pixels. */
	readonly width: number
	/** Holds the viewport height in pixels. */
	readonly height: number
	/**
	 * Holds the document change this variant needs before the viewport is resized — a theme
	 * attribute, a density class, a language direction. Omit it when the variant is a viewport alone.
	 */
	readonly apply?: () => void
}

/** Configures a capture portfolio. */
export interface PortfolioOptions {
	/**
	 * Lists every state name the journeys place, declared once. `place` refuses a name absent from
	 * this list, so the registry and the disk cannot drift apart.
	 */
	readonly states: readonly string[]
	/** Lists every variant the portfolio can be rendered in. One run renders exactly one of them. */
	readonly variants: readonly CaptureVariant[]
	/** Holds the name of the variant this run renders. Creation throws when no variant carries it. */
	readonly variant: string
	/** Holds the directory each written file is placed in, relative to the calling test file. */
	readonly directory: string
	/**
	 * Determines whether this run writes files. An ordinary run leaves it unset, so `place` resizes
	 * nothing, writes nothing, and records nothing.
	 */
	readonly enabled?: boolean
}

/** Holds the registry of capture states one run places, and the files it wrote placing them. */
export interface PortfolioInterface {
	/** Holds the name of the variant this run renders. */
	readonly variant: string
	/** Lists every state placed so far, in placement order. */
	readonly placements: readonly string[]
	/** Lists every path written so far, in write order. */
	readonly paths: readonly string[]
	/** Lists the filenames a complete portfolio holds: the registry expanded across every variant. */
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

/** Represents one scripted step a journal recorded, and what the surface did about it. */
export interface JournalStep {
	/** Names what the run did, as one verb. */
	readonly action: string
	/** Names the exact thing it did it to. */
	readonly trigger: string
	/** Holds what was observed on the surface after the step landed. */
	readonly result: string
}

/**
 * Records one scenario: every step it took and everything the page said while it ran.
 *
 * @remarks
 * Recording is off until {@link JournalInterface.start} arms it, so a suite that never starts a
 * journal pays for none of it. The console is observed by standing in front of it and forwarding
 * every call to the channel that was there: a browser offers no listener for its own output, and a
 * journal that swallowed what it read would hide exactly the diagnostics it exists to keep.
 */
export interface JournalInterface {
	/** Lists every step recorded since the journal started, in the order it was taken; a snapshot. */
	readonly steps: readonly JournalStep[]
	/** Lists every console line and uncaught failure the page emitted since it started; a snapshot. */
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
