import type { JourneyVariant } from '@src/core'

/** Configures one captured frame: where it is written, the viewport it is shot at, and what it shoots. */
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
 * Represents how far an element frame moves the tester frame from the runner window's origin for the
 * shot, in CSS pixels.
 *
 * @remarks
 * Both are zero where the frame stays at the origin.
 */
export interface FrameOffset {
	/** Holds the frame's vertical move, zero or negative; a negative value moves the frame up. */
	readonly top: number
	/** Holds the frame's horizontal move, zero or negative; a negative value moves the frame left. */
	readonly left: number
}

/**
 * Represents one written frame read back from the file a capture produced: its size in device
 * pixels, and the single color its bottom row paints.
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

/**
 * Adds to a journey variant the document change a capture run applies before resizing.
 *
 * @remarks
 * The name, the width, and the height come from {@link JourneyVariant}, which a project
 * configuration can serialize and hand to the suite that renders it. The change this adds is a
 * function, so it belongs to the suite rather than to that configuration: a variant a configuration
 * declares and a variant a capture run renders are the same row read at two depths.
 */
export interface CaptureVariant extends JourneyVariant {
	/**
	 * Holds the document change this variant needs before the viewport is resized — a theme
	 * attribute, a density class, a language direction. Omit it when the variant is a viewport alone.
	 */
	readonly apply?: () => void
}

/**
 * Configures a capture portfolio: the state registry, the variant matrix, this run's variant, where
 * it writes, and whether it writes at all.
 */
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

/** Configures the tester's print medium, motion preference, and forced colours. */
export interface MediaOptions {
	/** Determines whether the tester lays out for print. Omit it to leave the medium alone. */
	readonly print?: boolean
	/** Determines whether the tester prefers motion. Omit it to leave the preference alone. */
	readonly motion?: boolean
	/** Determines whether the tester runs under forced colours. Omit it to leave the colours alone. */
	readonly forced?: boolean
}
