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
 * Configures one color contrast reading: the surface the backdrop walk ends on, and the opacity the
 * painted color is shown at.
 *
 * @remarks
 * Omit `floor` to refuse a stack whose walk reaches no opaque layer, exactly as `readContrast` does.
 * `opacity` multiplies the color's own alpha before it is composited, so a mark painted in a
 * translucent element reads at the strength a reader sees.
 */
export interface ContrastOptions {
	/** Holds the opaque color the backdrop walk ends on when nothing above it paints. */
	readonly floor?: Color
	/** Holds the factor, from `0` to `1`, the color's alpha is multiplied by. Default: `1`. */
	readonly opacity?: number
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
