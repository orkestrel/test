import type { Color } from './types.js'

/**
 * Names the color a browser paints an unstyled document with: opaque white.
 *
 * @remarks
 * This is the floor a backdrop walk ends on wherever the caller wants the browser's own canvas
 * assumed. `readBackdrop` takes its floor as an argument rather than reaching for this one, so a
 * measurement over a surface the canvas never shows through names the color it actually sits on.
 */
export const CANVAS_COLOR: Color = Object.freeze([255, 255, 255, 1])
