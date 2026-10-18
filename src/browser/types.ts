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
