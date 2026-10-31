import type { RGBA } from '../types.js'
import type { ContrastFixture, ContrastOptions } from './types.js'
import { build, mount, readStyle } from '../helpers.js'
import { CANVAS_COLOR } from './constants.js'

/**
 * Converts normalized encoded sRGB channels to the clipped paint scale.
 *
 * @param red - The encoded red channel, with `1` representing full intensity.
 * @param green - The encoded green channel.
 * @param blue - The encoded blue channel.
 * @param alpha - The opacity. Default: `1`.
 * @returns Frozen straight sRGB channels clipped to 0–255, with alpha clipped to 0–1.
 *
 * @example
 * ```ts
 * convertSRGB(1.2, -0.1, 0.5) // [255, 0, 127.5, 1]
 * ```
 */
export function convertSRGB(red: number, green: number, blue: number, alpha = 1): RGBA {
	return Object.freeze([
		Math.min(255, Math.max(0, red * 255)),
		Math.min(255, Math.max(0, green * 255)),
		Math.min(255, Math.max(0, blue * 255)),
		Math.min(1, Math.max(0, alpha)),
	])
}

/**
 * Converts linear sRGB channels to encoded, clipped paint channels.
 *
 * @param red - The linear red channel on the normalized scale.
 * @param green - The linear green channel.
 * @param blue - The linear blue channel.
 * @param alpha - The opacity. Default: `1`.
 * @returns Frozen straight sRGB channels clipped to 0–255, with alpha clipped to 0–1.
 *
 * @remarks
 * Applies the CSS Color 4 extended sRGB transfer function before clipping.
 *
 * @example
 * ```ts
 * convertLinearSRGB(0, 0, 0) // [0, 0, 0, 1]
 * ```
 */
export function convertLinearSRGB(red: number, green: number, blue: number, alpha = 1): RGBA {
	const [encodedRed = 0, encodedGreen = 0, encodedBlue = 0] = [red, green, blue].map((channel) =>
		Math.abs(channel) <= 0.0031308
			? 12.92 * channel
			: Math.sign(channel) * (1.055 * Math.abs(channel) ** (1 / 2.4) - 0.055),
	)
	return convertSRGB(encodedRed, encodedGreen, encodedBlue, alpha)
}

/**
 * Converts D65 XYZ coordinates to clipped sRGB paint channels.
 *
 * @param x - The normalized X coordinate.
 * @param y - The normalized Y coordinate.
 * @param z - The normalized Z coordinate.
 * @param alpha - The opacity. Default: `1`.
 * @returns Frozen straight sRGB channels clipped to 0–255, with alpha clipped to 0–1.
 *
 * @remarks
 * Uses the CSS Color 4 XYZ D65 to linear sRGB matrix, then the sRGB transfer function.
 *
 * @example
 * ```ts
 * convertXYZD65(0, 0, 0) // [0, 0, 0, 1]
 * ```
 */
export function convertXYZD65(x: number, y: number, z: number, alpha = 1): RGBA {
	return convertLinearSRGB(
		(12831 / 3959) * x - (329 / 214) * y - (1974 / 3959) * z,
		(-851781 / 878810) * x + (1648619 / 878810) * y + (36519 / 878810) * z,
		(705 / 12673) * x - (2585 / 12673) * y + (705 / 667) * z,
		alpha,
	)
}

/**
 * Converts D50 XYZ coordinates to clipped sRGB paint channels.
 *
 * @param x - The normalized X coordinate relative to D50.
 * @param y - The normalized Y coordinate relative to D50.
 * @param z - The normalized Z coordinate relative to D50.
 * @param alpha - The opacity. Default: `1`.
 * @returns Frozen straight sRGB channels clipped to 0–255, with alpha clipped to 0–1.
 *
 * @remarks
 * Applies the CSS Color 4 Bradford adaptation from D50 to D65 before converting to sRGB.
 *
 * @example
 * ```ts
 * convertXYZD50(0, 0, 0) // [0, 0, 0, 1]
 * ```
 */
export function convertXYZD50(x: number, y: number, z: number, alpha = 1): RGBA {
	return convertXYZD65(
		0.955473421488075 * x - 0.02309845494876471 * y + 0.06325924320057072 * z,
		-0.0283697093338637 * x + 1.0099953980813041 * y + 0.021041441191917323 * z,
		0.012314014864481998 * x - 0.020507649298898964 * y + 1.330365926242124 * z,
		alpha,
	)
}

/**
 * Converts OKLab coordinates to clipped sRGB paint channels.
 *
 * @param lightness - The OKLab lightness on the 0–1 scale.
 * @param a - The signed green-to-red axis.
 * @param b - The signed blue-to-yellow axis.
 * @param alpha - The opacity. Default: `1`.
 * @returns Frozen straight sRGB channels clipped to 0–255, with alpha clipped to 0–1.
 *
 * @remarks
 * Cubes the transformed cone responses before applying the linear sRGB matrix.
 *
 * @example
 * ```ts
 * convertOKLab(0, 0, 0) // [0, 0, 0, 1]
 * ```
 */
export function convertOKLab(lightness: number, a: number, b: number, alpha = 1): RGBA {
	const long = (lightness + 0.3963377773761749 * a + 0.2158037573099136 * b) ** 3
	const medium = (lightness - 0.1055613458156586 * a - 0.0638541728258133 * b) ** 3
	const short = (lightness - 0.0894841775298119 * a - 1.2914855480194092 * b) ** 3
	return convertLinearSRGB(
		4.076741661347994 * long - 3.307711590408193 * medium + 0.230969929060199 * short,
		-1.2684380040921763 * long + 2.6097574006633715 * medium - 0.3413193965711952 * short,
		-0.0041960865418371 * long - 0.7034186144594493 * medium + 1.7076147010012863 * short,
		alpha,
	)
}

/**
 * Converts CIE Lab coordinates relative to D50 to clipped sRGB paint channels.
 *
 * @param lightness - The CIE lightness on the 0–100 scale.
 * @param a - The signed green-to-red axis.
 * @param b - The signed blue-to-yellow axis.
 * @param alpha - The opacity. Default: `1`.
 * @returns Frozen straight sRGB channels clipped to 0–255, with alpha clipped to 0–1.
 *
 * @remarks
 * Resolves the CSS Color 4 Lab curve against the D50 white point before adapting to D65.
 *
 * @example
 * ```ts
 * convertLab(0, 0, 0) // [0, 0, 0, 1]
 * ```
 */
export function convertLab(lightness: number, a: number, b: number, alpha = 1): RGBA {
	const luminance = (lightness + 16) / 116
	const [x = 0, y = 0, z = 0] = [luminance + a / 500, luminance, luminance - b / 200].map(
		(channel) => (channel ** 3 > 216 / 24389 ? channel ** 3 : (116 * channel - 16) / (24389 / 27)),
	)
	return convertXYZD50(x * (0.3457 / 0.3585), y, z * ((1 - 0.3457 - 0.3585) / 0.3585), alpha)
}

/**
 * Converts encoded Display P3 channels to clipped sRGB paint channels.
 *
 * @param red - The normalized encoded red channel.
 * @param green - The normalized encoded green channel.
 * @param blue - The normalized encoded blue channel.
 * @param alpha - The opacity. Default: `1`.
 * @returns Frozen straight sRGB channels clipped to 0–255, with alpha clipped to 0–1.
 *
 * @remarks
 * Decodes the extended sRGB transfer curve and uses the CSS Color 4 P3 to XYZ D65 matrix.
 *
 * @example
 * ```ts
 * convertDisplayP3(0, 0, 0) // [0, 0, 0, 1]
 * ```
 */
export function convertDisplayP3(red: number, green: number, blue: number, alpha = 1): RGBA {
	const [r = 0, g = 0, b = 0] = [red, green, blue].map((channel) =>
		Math.abs(channel) <= 0.04045
			? channel / 12.92
			: Math.sign(channel) * ((Math.abs(channel) + 0.055) / 1.055) ** 2.4,
	)
	return convertXYZD65(
		(608311 / 1250200) * r + (189793 / 714400) * g + (198249 / 1000160) * b,
		(35783 / 156275) * r + (247089 / 357200) * g + (198249 / 2500400) * b,
		(32229 / 714400) * g + (5220557 / 5000800) * b,
		alpha,
	)
}

/**
 * Converts encoded A98 RGB channels to clipped sRGB paint channels.
 *
 * @param red - The normalized encoded red channel.
 * @param green - The normalized encoded green channel.
 * @param blue - The normalized encoded blue channel.
 * @param alpha - The opacity. Default: `1`.
 * @returns Frozen straight sRGB channels clipped to 0–255, with alpha clipped to 0–1.
 *
 * @remarks
 * Decodes the signed 563/256 power curve and uses the CSS Color 4 A98 RGB to XYZ D65 matrix.
 *
 * @example
 * ```ts
 * convertA98RGB(0, 0, 0) // [0, 0, 0, 1]
 * ```
 */
export function convertA98RGB(red: number, green: number, blue: number, alpha = 1): RGBA {
	const [r = 0, g = 0, b = 0] = [red, green, blue].map(
		(channel) => Math.sign(channel) * Math.abs(channel) ** (563 / 256),
	)
	return convertXYZD65(
		(573536 / 994567) * r + (263643 / 1420810) * g + (187206 / 994567) * b,
		(591459 / 1989134) * r + (6239551 / 9945670) * g + (374412 / 4972835) * b,
		(53769 / 1989134) * r + (351524 / 4972835) * g + (4929758 / 4972835) * b,
		alpha,
	)
}

/**
 * Converts encoded ProPhoto RGB channels to clipped sRGB paint channels.
 *
 * @param red - The normalized encoded red channel.
 * @param green - The normalized encoded green channel.
 * @param blue - The normalized encoded blue channel.
 * @param alpha - The opacity. Default: `1`.
 * @returns Frozen straight sRGB channels clipped to 0–255, with alpha clipped to 0–1.
 *
 * @remarks
 * Decodes the signed ProPhoto curve, converts to XYZ D50, and adapts to D65 before clipping.
 *
 * @example
 * ```ts
 * convertProPhotoRGB(0, 0, 0) // [0, 0, 0, 1]
 * ```
 */
export function convertProPhotoRGB(red: number, green: number, blue: number, alpha = 1): RGBA {
	const [r = 0, g = 0, b = 0] = [red, green, blue].map((channel) =>
		Math.abs(channel) <= 16 / 512 ? channel / 16 : Math.sign(channel) * Math.abs(channel) ** 1.8,
	)
	return convertXYZD50(
		0.7977666449006423 * r + 0.13518129740053308 * g + 0.0313477341283922 * b,
		0.2880748288194013 * r + 0.711835234241873 * g + 0.00008993693872564 * b,
		0.8251046025104602 * b,
		alpha,
	)
}

/**
 * Converts encoded Rec. 2020 channels to clipped sRGB paint channels.
 *
 * @param red - The normalized encoded red channel.
 * @param green - The normalized encoded green channel.
 * @param blue - The normalized encoded blue channel.
 * @param alpha - The opacity. Default: `1`.
 * @returns Frozen straight sRGB channels clipped to 0–255, with alpha clipped to 0–1.
 *
 * @remarks
 * Uses the piecewise Rec. 2020 transfer curve Chromium computes and the CSS Color 4 XYZ matrix.
 *
 * @example
 * ```ts
 * convertRec2020(0, 0, 0) // [0, 0, 0, 1]
 * ```
 */
export function convertRec2020(red: number, green: number, blue: number, alpha = 1): RGBA {
	const [r = 0, g = 0, b = 0] = [red, green, blue].map((channel) =>
		Math.abs(channel) < 0.018053968510807 * 4.5
			? channel / 4.5
			: Math.sign(channel) *
				((Math.abs(channel) + 1.09929682680944 - 1) / 1.09929682680944) ** (1 / 0.45),
	)
	return convertXYZD65(
		(63426534 / 99577255) * r + (20160776 / 139408157) * g + (47086771 / 278816314) * b,
		(26158966 / 99577255) * r + (472592308 / 697040785) * g + (8267143 / 139408157) * b,
		(19567812 / 697040785) * g + (295819943 / 278816314) * b,
		alpha,
	)
}

/**
 * Parses computed CSS Color 4 values into clipped straight sRGB channels.
 *
 * @param value - A computed `rgb()`, `rgba()`, `oklab()`, `oklch()`, `lab()`, `lch()`, or `color()` value.
 * @returns Frozen channels, or `undefined` for an unsupported syntax or non-finite channel.
 *
 * @remarks
 * Reads signed channels, scientific notation, percentage lightness, degree hues, and `none` as
 * zero. The `color()` spaces are `srgb`, `srgb-linear`, `display-p3`, `a98-rgb`, `prophoto-rgb`,
 * `rec2020`, `xyz`, `xyz-d50`, and `xyz-d65`. Conversion uses the CSS Color 4 matrices and white
 * point adaptation, then clips each encoded sRGB channel to 0–255 rather than gamut-mapping it.
 * Alpha is clipped to 0–1. Keywords, hex colors, unresolved expressions, and non-finite calculations
 * such as `color(srgb calc(infinity) 0 0)` remain unreadable; use {@link parseCSSColor} to resolve
 * ordinary authored expressions through the cascade.
 *
 * @example
 * ```ts
 * parseColor('rgba(255, 255, 255, 0.5)') // [255, 255, 255, 0.5]
 * parseColor('rebeccapurple') // undefined
 * ```
 */
export function parseColor(value: string): RGBA | undefined {
	const match = /^(?<syntax>rgba?|oklab|oklch|lab|lch|color)\((?<body>[^()]*)\)$/u.exec(value)
	if (match?.groups === undefined) return undefined
	const { syntax, body = '' } = match.groups
	const legacy = syntax === 'rgb' || syntax === 'rgba'
	const polar = syntax === 'oklch' || syntax === 'lch'
	const perceptual =
		syntax === 'oklab' || syntax === 'oklch' || syntax === 'lab' || syntax === 'lch'
	const tokens = body.trim().split(legacy && body.includes(',') ? /\s*,\s*/u : /\s*\/\s*|\s+/u)
	const space = syntax === 'color' ? tokens.shift() : syntax
	if (tokens.length !== 3 && tokens.length !== 4) return undefined
	if (!legacy && body.includes(',')) return undefined
	if (body.split('/').length > 2) return undefined
	if (body.includes('/') && (tokens.length !== 4 || !/\/\s*[^\s/]+\s*$/u.test(body)))
		return undefined
	if (!(legacy && body.includes(',')) && tokens.length === 4 && !body.includes('/'))
		return undefined
	const parts = tokens.map((token, index) => {
		if (token === 'none') return 0
		const part = /^(?<number>[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?)(?<unit>%|deg)?$/u.exec(
			token,
		)
		if (part?.groups === undefined) return Number.NaN
		const number = Number(part.groups.number)
		const unit = part.groups.unit
		if (unit === 'deg') return polar && index === 2 ? number : Number.NaN
		if (unit !== '%') return number
		if (index === 3 || syntax === 'color') return number / 100
		if (legacy) return (number * 255) / 100
		if (index === 0) return syntax === 'oklab' || syntax === 'oklch' ? number / 100 : number
		return Number.NaN
	})
	const [first, second, third, alpha = 1] = parts
	if (first === undefined || second === undefined || third === undefined) return undefined
	if (!parts.every((part) => Number.isFinite(part))) return undefined
	if (legacy) return convertSRGB(first / 255, second / 255, third / 255, alpha)
	if (perceptual) {
		const lightness = Math.max(
			0,
			Math.min(syntax === 'oklab' || syntax === 'oklch' ? 1 : 100, first),
		)
		const a = polar ? Math.max(0, second) * Math.cos((third * Math.PI) / 180) : second
		const b = polar ? Math.max(0, second) * Math.sin((third * Math.PI) / 180) : third
		return syntax === 'oklab' || syntax === 'oklch'
			? convertOKLab(lightness, a, b, alpha)
			: convertLab(lightness, a, b, alpha)
	}
	switch (space) {
		case 'srgb':
			return convertSRGB(first, second, third, alpha)
		case 'srgb-linear':
			return convertLinearSRGB(first, second, third, alpha)
		case 'display-p3':
			return convertDisplayP3(first, second, third, alpha)
		case 'a98-rgb':
			return convertA98RGB(first, second, third, alpha)
		case 'prophoto-rgb':
			return convertProPhotoRGB(first, second, third, alpha)
		case 'rec2020':
			return convertRec2020(first, second, third, alpha)
		case 'xyz':
		case 'xyz-d65':
			return convertXYZD65(first, second, third, alpha)
		case 'xyz-d50':
			return convertXYZD50(first, second, third, alpha)
		default:
			return undefined
	}
}

/**
 * Resolves any CSS color expression to straight sRGB channels, by asking the browser.
 *
 * @param value - Any value the `color` property accepts: a keyword, a hex triple, a `var()`
 * reference, a `color-mix()`, or a computed CSS Color 4 value.
 * @param scope - The element whose cascade the expression resolves in. Omit it to resolve at the
 * document's body.
 * @returns The resolved color's channels, or `undefined` when the CSSOM refuses the value, the
 * computed result names no color {@link parseColor} speaks, or the scope is disconnected and
 * computes no style.
 *
 * @remarks
 * This is the live half of the pair {@link parseColor} opens. `parseColor` reads text and speaks
 * only the computed syntaxes a cascade hands back; this hands the expression to the real cascade
 * and reads back what the engine computed — which is the only way a keyword, a hex triple, or a
 * `var()` reference becomes channels at all. The read itself goes through `parseColor`, so both
 * halves agree on what a computed value means.
 * Modern perceptual and predefined RGB/XYZ spaces resolve through that parser's conversions;
 * out-of-gamut sRGB channels are clipped to 0–255 after conversion.
 *
 * With no scope the expression resolves on a probe that is a child of `document.body`, mounted
 * because an unmounted element inherits nothing, so a `var()` reference or `currentColor` resolves
 * against what the body declares and paints. The probe is removed in a `finally`, so a value that
 * throws on the way through leaves no node behind.
 *
 * With a scope the expression resolves on that same body-mounted probe, which carries the scope's
 * computed context onto its own inline style: the computed value of every custom property the
 * expression names, a fallback's included, the scope's computed `color`, and its computed
 * `color-scheme`. The expression is written into `background-color`, so `currentColor` is the
 * carried `color`, and a system color or `light-dark()` answers as the scope's scheme. The element's
 * own and inherited custom properties therefore apply, a registered property that does not inherit
 * included, and an `input`, an SVG element, or any other element resolves like any other. A custom
 * property is named by letters, digits, `_`, and `-` after its `--`. A name the scope leaves
 * undeclared is not carried, so its `var()` fallback still applies.
 *
 * The scope element is never written. The probe is freshly created, so it has no earlier style to start a
 * transition from, and a transition running on the scope keeps running: `currentColor` reads the
 * color the scope shows at that moment, and the scope's geometry and scroll position stay as they
 * were. No attribute, style, or child of the scope changes, so a `MutationObserver` on it records
 * nothing.
 *
 * Refusal is the CSSOM's: an expression it will not parse leaves the probe's declaration empty and
 * this returns `undefined`. A `var()` naming an undeclared custom property is not refused, because
 * the cascade accepts it and computes the inherited color, so a test that means to catch a
 * missing token asserts on {@link readToken} rather than on this.
 *
 * @example
 * ```ts
 * parseCSSColor('rebeccapurple') // [102, 51, 153, 1]
 * parseCSSColor('not-a-color') // undefined
 * parseCSSColor('var(--ink)', panel) // the token as the panel declares it
 * ```
 */
export function parseCSSColor(value: string, scope?: Element): RGBA | undefined {
	const computed = scope?.isConnected === true ? getComputedStyle(scope) : undefined
	// A scope with no computed style has no cascade to carry, so it reads nothing.
	if (scope !== undefined && (computed === undefined || computed.color === '')) return undefined
	const probe = build('span')
	mount(probe)
	try {
		if (computed !== undefined) {
			for (const name of new Set(value.match(/--[\p{L}\p{N}_-]+/gu))) {
				const token = computed.getPropertyValue(name)
				// An undeclared token stays undeclared on the probe, so its fallback still applies.
				if (token !== '') probe.style.setProperty(name, token)
			}
			probe.style.color = computed.color
			probe.style.colorScheme = computed.colorScheme
		}
		// With a scope, `currentColor` is the carried color only in a property other than `color`.
		const property = computed === undefined ? 'color' : 'background-color'
		probe.style.setProperty(property, value)
		return probe.style.getPropertyValue(property) === ''
			? undefined
			: parseColor(readStyle(probe, property))
	} finally {
		probe.remove()
	}
}

/**
 * Determines whether two colors render the same, within the rounding a browser does.
 *
 * @param first - A CSS color expression or an already-parsed color.
 * @param second - A CSS color expression or an already-parsed color.
 * @returns True if every channel and the alpha agree within the tolerance; false otherwise,
 * including when either side names no readable color.
 *
 * @remarks
 * Each string side is resolved through {@link parseCSSColor}, so a keyword, a token reference, and the
 * `rgb()` the engine computes for either of them compare equal without a test converting anything
 * first. A side that resolves to nothing makes the answer `false` rather than a throw, because this
 * is a predicate.
 *
 * The tolerance is half a channel step on the 0–255 scale, and the alpha is scaled onto that same
 * range before it is compared, so one number covers both. Half a step is what a composite of
 * translucent layers and a `color-mix()` round trip actually drift by; anything a reader could see
 * is further than that and reports unequal.
 *
 * @example
 * ```ts
 * matchesColor('rebeccapurple', 'rgb(102, 51, 153)') // true
 * matchesColor('red', [0, 0, 255, 1]) // false
 * ```
 */
export function matchesColor(first: string | RGBA, second: string | RGBA): boolean {
	const left = typeof first === 'string' ? parseCSSColor(first) : first
	const right = typeof second === 'string' ? parseCSSColor(second) : second
	if (left === undefined || right === undefined) return false
	const tolerance = 0.5
	const [leftRed, leftGreen, leftBlue, leftAlpha] = left
	const [rightRed, rightGreen, rightBlue, rightAlpha] = right
	return (
		Math.abs(leftRed - rightRed) <= tolerance &&
		Math.abs(leftGreen - rightGreen) <= tolerance &&
		Math.abs(leftBlue - rightBlue) <= tolerance &&
		Math.abs(leftAlpha - rightAlpha) * 255 <= tolerance
	)
}

/**
 * Composites one color over another.
 *
 * @param front - The color painted on top.
 * @param back - The color already on the surface.
 * @returns The opaque result a reader sees, its alpha always `1`.
 *
 * @example
 * ```ts
 * blendColor([255, 255, 255, 0.5], [0, 0, 0, 1]) // [127.5, 127.5, 127.5, 1]
 * ```
 */
export function blendColor(front: RGBA, back: RGBA): RGBA {
	const [red, green, blue, alpha] = front
	const [under, over, beneath] = back
	return Object.freeze([
		red * alpha + under * (1 - alpha),
		green * alpha + over * (1 - alpha),
		blue * alpha + beneath * (1 - alpha),
		1,
	])
}

/**
 * Measures one opaque color's WCAG relative luminance.
 *
 * @param color - The color to weigh. Its alpha is ignored, so composite before calling.
 * @returns The relative luminance, from `0` for black to `1` for white.
 *
 * @example
 * ```ts
 * measureLuminance([255, 255, 255, 1]) // 1
 * ```
 */
export function measureLuminance(color: RGBA): number {
	const [red, green, blue] = color
	const [first = 0, second = 0, third = 0] = [red, green, blue].map((channel) => {
		const part = channel / 255
		return part <= 0.040_45 ? part / 12.92 : ((part + 0.055) / 1.055) ** 2.4
	})
	return 0.2126 * first + 0.7152 * second + 0.0722 * third
}

/**
 * Measures the WCAG 2.x contrast ratio between two opaque colors.
 *
 * @param front - The foreground color, already composited.
 * @param back - The opaque backdrop.
 * @returns The ratio, from `1` for two identical colors to `21` for black against white.
 *
 * @remarks
 * The ratio is symmetric: the brighter of the two luminances is always the numerator, so swapping
 * the arguments returns the same number.
 *
 * @example
 * ```ts
 * measureContrast([0, 0, 0, 1], [255, 255, 255, 1]) // 21
 * ```
 */
export function measureContrast(front: RGBA, back: RGBA): number {
	const bright = Math.max(measureLuminance(front), measureLuminance(back))
	const dark = Math.min(measureLuminance(front), measureLuminance(back))
	return (bright + 0.05) / (dark + 0.05)
}

/**
 * Collects readable background color layers and refuses an unreadable painted layer.
 *
 * @param element - The element to walk up from.
 * @returns Every layer the walk paints, the element's own first and the deepest last.
 * @throws Thrown when a painted background color is unreadable; the error names the element and
 * its computed value.
 *
 * @remarks
 * A surface token paints one ancestor while every element between it and the text paints nothing,
 * so a backdrop is found by walking up rather than by reading the element's own `background-color`,
 * which is almost always transparent. A fully transparent layer paints nothing and is left out, and
 * the walk stops at the first fully opaque layer, because nothing above that layer is visible.
 * Legacy and modern CSS Color 4 values resolve through {@link parseColor}, with sRGB channels
 * clipped after conversion. Non-finite calculations such as `color(srgb calc(infinity) 0 0)` are
 * deliberately unreadable. An unreadable value with an explicit zero alpha paints nothing and is
 * skipped. An empty detached-element reading paints nothing too. Background images remain outside
 * this color reader.
 *
 * The stack is what tells a resolved backdrop from an assumed one: the walk reached an opaque
 * surface exactly when its last layer's alpha is `1`. {@link readContrast} refuses on that reading,
 * which no comparison of composited colors can replace — 64 half-transparent layers composite to
 * the same channels over opposite floors, because the floor's remaining share falls below the last
 * bit a channel carries.
 *
 * @example
 * ```ts
 * readLayers(requireValue(container.querySelector('p')))
 * ```
 */
export function readLayers(element: Element): readonly RGBA[] {
	const computed = getComputedStyle(element).backgroundColor
	const layer = computed === '' ? undefined : parseColor(computed)
	if (layer === undefined && computed !== '' && !/\/\s*(?:0(?:\.0*)?|none)\s*\)$/u.test(computed)) {
		throw new Error(
			`Computed background color is unreadable on ${element.localName}${element.id === '' ? '' : `#${element.id}`}: ${computed}`,
		)
	}
	if (layer !== undefined && layer[3] >= 1) return Object.freeze([layer])
	const parent = element.parentElement
	return Object.freeze([
		...(layer === undefined || layer[3] === 0 ? [] : [layer]),
		...(parent === null ? [] : readLayers(parent)),
	])
}

/**
 * Resolves the opaque color standing behind one element.
 *
 * @param element - The element whose backdrop to resolve.
 * @param floor - The opaque color the walk ends on when nothing above it paints.
 * @returns The composited color a reader sees behind the element.
 * @throws Thrown when the backdrop contains an unreadable painted color layer.
 *
 * @remarks
 * The layers {@link readLayers} collects composite top-over-bottom onto the floor, so a 3% surface
 * tint reads as a tint over what shows through it rather than as a full-strength paint.
 * Those layers include the modern CSS Color 4 spaces, converted and clipped to sRGB by
 * {@link parseColor}; an unreadable painted layer refuses the entire reading.
 *
 * The floor is required, because this leaf never guesses what a document sits on. Pass
 * {@link CANVAS_COLOR} for the page a browser paints behind an unstyled document, or the color of
 * the surface a fragment is really rendered into. When no layer paints, the floor is returned by
 * identity.
 *
 * The composite alone never says whether the floor is part of the answer. A caller that must know
 * reads the stack instead.
 *
 * @example
 * ```ts
 * readBackdrop(requireValue(container.querySelector('p')), CANVAS_COLOR)
 * ```
 */
export function readBackdrop(element: Element, floor: RGBA): RGBA {
	return readLayers(element).reduceRight((back, front) => blendColor(front, back), floor)
}

/**
 * Measures the WCAG 2.x contrast ratio one color reaches when painted over an element's backdrop.
 *
 * @param element - The element whose own and ancestor backgrounds paint the surface.
 * @param color - Any CSS color expression, such as the resolved `border-left-color` of a
 * pseudo-element, resolved at the element's own scope.
 * @param options - The floor the backdrop walk ends on and the opacity the color is shown at.
 * @returns The ratio of the color composited over the backdrop, against that backdrop.
 * @throws Thrown when `color` names no readable color, as under a disconnected element that computes
 * no style, when `opacity` lies outside `0` to `1`, when a painted background layer is unreadable,
 * and — with `floor` omitted — when the walk from the element upwards reaches no opaque layer.
 *
 * @remarks
 * This is the reading {@link readContrast} and {@link readRing} take for their own colors, with the
 * color handed in: a separator grip, a placeholder, a checkbox mark, or any other paint that is not
 * the element's text. The backdrop composites the {@link readLayers} stack top-over-bottom, the
 * color composites over that backdrop, and the ratio is measured between the two, so a translucent
 * color reads at the strength a reader sees.
 *
 * A computed color value parses directly through {@link parseColor}; any other expression, such as
 * a keyword or a `var()` reference, resolves through {@link parseCSSColor} at the element's own
 * scope. A `var()` reference therefore reads the token as the element and its ancestors declare it,
 * and `currentColor` reads the element's own text color, not the body's. The read carries the
 * element's computed custom properties, `color`, and `color-scheme` onto a probe, so an `input` and
 * a non-inheriting registered token resolve as they do on any other element, and the element itself
 * is never written. A disconnected element computes no style, so it reads no expression; hand it a
 * computed color such as `rgb(255, 255, 255)`.
 *
 * With `options.floor` omitted, the walk must reach a fully opaque layer, and the refusal shares
 * `readContrast`'s voice, because the number a stack the canvas shows through produces is as much a
 * report of the assumption as of the page. Name the floor wherever the caller knows what the stack
 * sits on: {@link CANVAS_COLOR} for a document, or the color a fragment is really mounted onto.
 * `options.opacity` multiplies the color's alpha before compositing, for a mark painted inside an
 * element whose own `opacity` is below `1`. Default: `1`.
 *
 * @example
 * ```ts
 * const container = render('<div style="background: #fff"><span>Mark</span></div>')
 * const mark = requireValue(container.querySelector('span'))
 * readColorContrast(mark, 'rgb(0, 0, 0)') // 21
 * readColorContrast(mark, 'rgb(0, 0, 0)', { opacity: 0.5 }) // the rgba(0, 0, 0, 0.5) reading
 * ```
 */
export function readColorContrast(
	element: Element,
	color: string,
	options?: ContrastOptions,
): number {
	const painted = parseColor(color) ?? parseCSSColor(color, element)
	if (painted === undefined) throw new Error(`Color "${color}" is unreadable`)
	const opacity = options?.opacity ?? 1
	if (!(opacity >= 0 && opacity <= 1)) throw new Error('Contrast opacity must be between 0 and 1')
	const floor = options?.floor
	const layers = readLayers(element)
	const deepest = layers.at(-1)
	// The walk reached a real surface exactly when its deepest layer is fully opaque. An empty stack
	// paints nothing, and a stack ending translucent leaves the floor showing through whatever the
	// composite reports: 64 half-transparent layers round to identical channels over opposite floors,
	// so comparing two composited readings admits the stack this refusal exists for.
	if (floor === undefined && (deepest === undefined || deepest[3] < 1)) {
		throw new Error('Computed background color is unavailable')
	}
	const backdrop = layers.reduceRight(
		(back, front) => blendColor(front, back),
		floor ?? CANVAS_COLOR,
	)
	const [red, green, blue, alpha] = painted
	return measureContrast(blendColor([red, green, blue, alpha * opacity], backdrop), backdrop)
}

/**
 * Measures the WCAG 2.x contrast ratio between an element's computed text and background colors.
 *
 * @param element - The element whose rendered text contrast to measure.
 * @param floor - The opaque color the backdrop walk ends on. Omit it to refuse a stack the floor
 * would show through instead of assuming one.
 * @returns The relative-luminance contrast ratio.
 * @throws Thrown when the element exposes no computed foreground color, and — with `floor` omitted
 * — when the walk from the element upwards reaches no opaque layer. An unreadable painted
 * background layer throws even when a floor is supplied.
 *
 * @remarks
 * A transparent or translucent background resolves through the element's ancestors: every painted
 * layer from the element up to the first opaque one composites top-over-bottom onto that opaque
 * base, so a 3% surface tint reads as a tint over what shows through it rather than as a
 * full-strength paint. A translucent foreground then resolves against that effective background
 * before luminance is measured.
 * Text and background colors can use the modern CSS Color 4 spaces {@link parseColor} reads;
 * each is converted to sRGB and clipped before composition and luminance measurement.
 *
 * With `floor` omitted, the walk from the target upwards must reach a fully opaque layer: the
 * measurement throws rather than assuming a white canvas wherever that canvas would still be part
 * of the answer. The refusal reads the alpha of the deepest layer {@link readLayers} collected, so
 * a chain that declares no background color at all, a chain painting only translucent layers, and a
 * chain deep enough for its composite to round to the canvas's own channels are refused alike,
 * because the number any of them produces is as much a report of the assumption as of the page.
 * Supply a floor wherever the caller knows what the stack sits on — a fragment mounted into a
 * painted host, or a document whose canvas is {@link CANVAS_COLOR} — and the composite is taken
 * over it rather than refused.
 *
 * The element itself must expose a computed foreground color either way. A detached element exposes
 * none, and the measurement throws rather than guessing one. The computed foreground is then
 * measured by {@link readColorContrast}, which owns the walk, the refusal, and the composite.
 *
 * @example
 * ```ts
 * const container = render('<p style="background: #000; color: #fff">Ready</p>')
 * readContrast(requireValue(container.firstElementChild)) // 21
 * readContrast(requireValue(container.firstElementChild), CANVAS_COLOR) // 21
 * ```
 */
export function readContrast(element: Element, floor?: RGBA): number {
	const foreground = getComputedStyle(element).color
	if (parseColor(foreground) === undefined) {
		throw new Error('Computed foreground color is unavailable')
	}
	return readColorContrast(element, foreground, floor === undefined ? {} : { floor })
}

/**
 * Measures the contrast the focus chrome painted on one control reaches against its own backdrop.
 *
 * @param control - The control that holds the focus.
 * @param worn - The element the control's focus chrome is painted onto. Default: `control`.
 * @returns The strongest ratio the painted focus chrome reaches, or `undefined` when the control is
 * not showing `:focus-visible` or the cascade paints no chrome of its own.
 * @throws Thrown when the control is showing `:focus-visible` and the backdrop behind the element
 * the chrome is worn on contains an unreadable painted color layer, whether or not the cascade
 * paints chrome.
 *
 * @remarks
 * This reads and never acts. Focus arrives through the published verbs — `traverseAccessible`,
 * `userEvent.keyboard` from `vitest/browser`, a real click — and this measures what the browser
 * painted after it landed. A control that is not matching `:focus-visible` when the call is made
 * reports nothing, because no measurement taken then would be about focus.
 *
 * Some controls are two elements: one that takes the focus and one a reader can see. A hidden radio
 * beside the label that carries every pixel of its chrome is the case `worn` exists for, so a
 * measurement is not taken on a rectangle nobody is looking at. The focus state is still read off
 * `control`, because that is what holds it.
 *
 * The backdrop is the surface behind the element the chrome is worn on: each painted color is
 * measured by {@link readColorContrast} from that element's parent, with {@link CANVAS_COLOR} as the
 * floor. A control whose ancestry paints nothing is therefore measured against the browser's own
 * canvas, which is what a reader looking at an unstyled document sees. The backdrop is read for
 * every control showing `:focus-visible` before the chrome is looked for, so an unreadable surface
 * refuses the reading even where the cascade paints no chrome.
 *
 * Only chrome the cascade paints is measured — an `outline` with a real style and width, and the
 * first color in a `box-shadow`. A control left the browser's own `outline-style: auto` ring reports
 * `undefined`, because that ring's two tones are guaranteed against any backdrop and its computed
 * color names neither. A focus style that only changes the control's own fill reports `undefined`
 * too: the resting fill is gone by the time focus is on the control, and this never moves focus to
 * go and read it.
 * Outline and shadow colors include `oklch()`, `oklab()`, `lab()`, `lch()`, and predefined
 * `color()` spaces. Each readable color converts to clipped sRGB through {@link parseColor}, and
 * the result remains a contrast ratio rather than a ring width.
 *
 * @example
 * ```ts
 * await traverseAccessible('Evaluate')
 * readRing(resolveRendered('Evaluate')) // the ratio the painted ring reaches
 * ```
 */
export function readRing(control: Element, worn?: Element): number | undefined {
	if (!control.matches(':focus-visible')) return undefined
	const target = worn ?? control
	const surface = target.parentElement ?? target
	// The backdrop refuses an unreadable layer before the chrome is looked for, so a focused control
	// over such a surface is refused whether or not the cascade paints a ring.
	readBackdrop(surface, CANVAS_COLOR)
	const declared = getComputedStyle(target)
	const outline =
		declared.outlineStyle === 'none' ||
		declared.outlineStyle === 'auto' ||
		Number.parseFloat(declared.outlineWidth) === 0
			? undefined
			: declared.outlineColor
	const shadow = /(?:rgba?|color|oklab|oklch|lab|lch)\([^)]*\)/u.exec(declared.boxShadow)?.[0]
	const ratios = [outline, shadow].flatMap((painted) =>
		painted === undefined || parseColor(painted) === undefined
			? []
			: [readColorContrast(surface, painted, { floor: CANVAS_COLOR })],
	)
	return ratios.length === 0 ? undefined : Math.max(...ratios)
}

/**
 * Builds a detached translucent stack whose composited and flat contrast readings straddle one bar.
 *
 * @param bar - The contrast ratio `refused` and `accepted` must sit on opposite sides of.
 * @returns The opaque root carrying the tint, and the refused and accepted foregrounds under it.
 * @throws An `Error` when no grey foreground puts the two readings on opposite sides of the bar.
 *
 * @remarks
 * A contrast instrument that never composites still clears every fixture painting its own opaque
 * background, so this is the control that makes {@link readContrast}'s ancestor walk and alpha
 * blend the thing under test. The stack is an opaque floor, a translucent tint over it, and two
 * grey foregrounds inside the tint. `refused` reads under the bar composited and at or over it
 * flat, and `accepted` reads the other way about, so no single non-compositing reading satisfies
 * both.
 *
 * The greys are searched rather than written down, so the control follows the bar it was asked for.
 * A bar at or under `1` is refused because every contrast ratio reaches `1`, and a bar above what
 * the tinted surface can reach is refused because no foreground clears it — each refusal names the
 * bar rather than returning a stack that proves nothing.
 *
 * The nodes are detached, so nothing is mounted for you. Append `root` to the surface you are
 * reading, take both readings, and remove it: a computed color needs the document, and a fixture
 * left behind is the next test's resolver ambiguity.
 *
 * @example
 * ```ts
 * const control = buildContrast(4.5)
 * mount(control.root)
 * readContrast(control.refused) < 4.5 // true
 * readContrast(control.accepted) >= 4.5 // true
 * control.root.remove()
 * ```
 */
export function buildContrast(bar: number): ContrastFixture {
	const tint: RGBA = [0, 0, 0, 0.06]
	const backdrop = blendColor(tint, CANVAS_COLOR)
	const flattened: RGBA = [tint[0], tint[1], tint[2], 1]
	const channels = Array.from({ length: 256 }, (_, channel) => {
		const front: RGBA = [channel, channel, channel, 1]
		const composited = measureContrast(front, backdrop)
		const flat = measureContrast(front, flattened)
		return { channel, composited, flat }
	})
	const refusedChannel = channels.find(
		({ composited, flat }) => composited < bar && flat >= bar,
	)?.channel
	const acceptedChannel = channels.find(
		({ composited, flat }) => composited >= bar && flat < bar,
	)?.channel
	if (refusedChannel === undefined || acceptedChannel === undefined) {
		throw new Error(`Contrast control cannot straddle the bar ${bar}`)
	}
	const root = build('div', {
		attributes: {
			style: `background-color: rgb(${CANVAS_COLOR[0]}, ${CANVAS_COLOR[1]}, ${CANVAS_COLOR[2]})`,
		},
	})
	const tinted = build('div', {
		attributes: {
			style: `background-color: rgba(${tint[0]}, ${tint[1]}, ${tint[2]}, ${tint[3]})`,
		},
	})
	const refused = build('p', {
		text: 'Composited contrast control',
		attributes: {
			style: `color: rgb(${refusedChannel}, ${refusedChannel}, ${refusedChannel})`,
		},
	})
	const accepted = build('p', {
		text: 'Composited contrast survivor',
		attributes: {
			style: `color: rgb(${acceptedChannel}, ${acceptedChannel}, ${acceptedChannel})`,
		},
	})
	tinted.append(refused, accepted)
	root.append(tinted)
	return Object.freeze({ root, refused, accepted })
}
