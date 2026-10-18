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
