/**
 * Describes an adopted stylesheet and its idempotent release operation.
 */
export interface SheetAdoption {
	/** Holds the stylesheet adopted into the document. */
	readonly sheet: CSSStyleSheet
	/**
	 * Removes this sheet from the document without removing another adoption.
	 *
	 * @returns Nothing.
	 */
	release(): void
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
