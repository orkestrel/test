import type { JourneyVariant, WaitOptions } from '@src/core'

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
 * Configures one built element: its class list, its text, and its attributes.
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
	 * @remarks The appended step is frozen. A step taken before `start` or after `stop` is not
	 * recorded at all.
	 */
	record(action: string, trigger: string, result: string): void
}

/**
 * Configures a bounded wait over the states a control announces.
 *
 * @remarks
 * The direction is a boolean because a state is either announced or it is not, and both directions
 * are the same wait over the same reading. The time bounds and the abort signal come from
 * {@link WaitOptions} and mean there what they mean everywhere else.
 */
export interface StateOptions extends WaitOptions {
	/** Determines the direction: `true` waits until the state is gone, `false` until it appears. */
	readonly absent?: boolean
}

/**
 * Configures an inert `Storage`: its seed, which operations the host permits, and its quota.
 *
 * @remarks
 * Every member describes a condition a real origin produces. A withheld read or write is what a
 * browser with site data blocked raises from the storage object, and a quota is what an origin with
 * no room left raises from `setItem`. Omit a member and the store behaves as an ordinary origin
 * does: seeded with nothing, permitting everything, and bounded by nothing.
 */
export interface StorageOptions {
	/** Holds the entries the store starts with, keyed by storage key. */
	readonly values?: Readonly<Record<string, string>>
	/** Determines whether the host permits reads. Default: `true`. */
	readonly reads?: boolean
	/** Determines whether the host permits writes. Default: `true`. */
	readonly writes?: boolean
	/** Caps the accepted `setItem` calls. When omitted, nothing bounds the store. */
	readonly quota?: number
}

/**
 * Holds a store the host can withhold and later grant.
 *
 * @remarks
 * The name carries `Web` because `@orkestrel/database` owns `StorageInterface` for the operations a
 * driver's transaction scope offers, and the fleet gives one bare exported name one owning package.
 * This one is the Web Storage surface a browser publishes on `localStorage`, plus the grant a
 * person allowing site data performs.
 */
export interface WebStorageInterface extends Storage {
	/** Grants the reads and the writes the host withheld, and replenishes no quota. */
	permit(): void
}

/**
 * Reports an authored-class census: the population walked, the tokens found, and the undeclared.
 *
 * @remarks
 * The population is reported beside the finding because an empty walk satisfies every difference
 * check: a census that read no element reports no undeclared token, and so does a census over
 * markup whose every class the cascade declares. Assert on `elements` as well as on `undeclared`
 * and the two cannot be confused.
 */
export interface CensusReading {
	/** Reports how many elements the walk read, the root included when it is an element. */
	readonly elements: number
	/** Lists every class token the markup carries, sorted. */
	readonly tokens: readonly string[]
	/** Lists every carried token no loaded stylesheet declares, sorted. */
	readonly undeclared: readonly string[]
}

/**
 * Holds a detached translucent stack whose flat and composited readings disagree across one bar.
 *
 * @remarks
 * `refused` and `accepted` are the control a composited-contrast reading owes: the composited
 * reading refuses one and the flat reading clears it, and the other way about for the second. A reader that takes the
 * nearest declared background at full strength answers the opposite pair, so no single
 * non-compositing reading satisfies both.
 */
export interface ContrastFixture {
	/** Holds the opaque floor carrying the translucent tint; append this to read either foreground. */
	readonly root: HTMLElement
	/** Holds the foreground whose composited reading falls under the bar. */
	readonly refused: HTMLElement
	/** Holds the foreground whose composited reading reaches the bar. */
	readonly accepted: HTMLElement
}

/**
 * Holds detached markup a style-escape reading must find, and the one it must leave alone.
 *
 * @remarks
 * `inline`, `embedded`, and `permitted` are the branches a style-escape reading has: an inline
 * attribute, an embedded element, and the sheet a project deliberately allows. A reading that passes
 * by refusing every `<style>` element clears the escapes and fails the exemption.
 */
export interface EscapeFixture {
	/** Holds the detached root carrying the inline escape, the embedded escape, and the exempt sheet. */
	readonly root: HTMLElement
	/** Holds the element carrying an inline `style` attribute. */
	readonly inline: HTMLElement
	/** Holds the embedded `<style>` element. */
	readonly embedded: HTMLElement
	/** Holds the `<style>` element carrying the exempt id the caller named. */
	readonly permitted: HTMLElement
}

/**
 * Holds detached markup an authored-class census must report as undeclared.
 *
 * @remarks
 * One token rides on an HTML element and the other on an SVG element, because `className` on an SVG
 * element is an `SVGAnimatedString` rather than a string: a census splitting that value finds
 * nothing and reports one token where two are carried.
 */
export interface CensusFixture {
	/** Holds the detached root carrying both marked elements. */
	readonly root: HTMLElement
	/** Holds the class token the HTML element carries. */
	readonly token: string
	/** Holds the class token the SVG element carries. */
	readonly mark: string
}
