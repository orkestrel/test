/**
 * Names the attribute marking the runner's tester pane, and the rule that sizes it, while a frame
 * is staged.
 *
 * @remarks
 * `stagePane` writes it onto the pane and onto the stylesheet it appends, and `releasePane` finds
 * both by it. The stylesheet's value is the viewport the tester had before the first staging, in
 * `<width>x<height>` form, which is what `releasePane` hands back. Nothing else reads it, so a
 * document carrying it after a capture returned is a pane that was never released.
 */
export const CAPTURE_PANE = 'data-capture-pane'

/**
 * Bounds the restagings one capture takes before it refuses a document whose height never settles.
 *
 * @remarks
 * `captureFrame` stages the pane at the content edge `measureContent` reads, and a rule bound to
 * the viewport height lays that document out taller against the taller pane, so the edge has to be
 * read again after every staging. The re-reading stops when the pane and the edge agree, and a rule
 * that adds height with every pane never reaches that point, so the re-reading is bounded here and
 * the shot is refused rather than taken at a height that is already stale.
 *
 * The bound is the measured need plus one. A document holding half the pane plus a fixed block
 * settles in two restagings, because the second carries the growth the first produced and lands on
 * the fixed point; a document whose growth is capped part way settles in three, because it takes
 * one restaging past the cap before it comes back down to the edge. Nothing measured needs a
 * fourth, so a fourth is the headroom that keeps a settling document off the refusal.
 */
export const CAPTURE_STAGE_LIMIT = 4

/**
 * Names the tester root's attribute holding the media readings observed before the first stage.
 *
 * @remarks
 * The value is a bit string in print, reduced motion, dark colour scheme, and forced colours order.
 * Each bit is `1` for a matching query and `0` otherwise, for example `0100`. The first pointer
 * stage appends a fifth bit for the pre-call `(pointer: coarse)` reading. Without a pointer stage,
 * the marker stays four bits and release leaves touch emulation alone.
 */
export const MEDIA_STAGE = 'data-media-stage'

/**
 * Bounds the characters of the region locator a capture refusal names.
 *
 * @remarks
 * `captureFrame` names each scroll region it leaves hiding rows by the path `renderSelector`
 * renders. The path carries ids the page wrote, so it is cut to this many characters from its end,
 * which keeps the steps nearest the region, and JSON-encoded, so a page-authored id can neither
 * fake the message nor grow it without bound.
 */
export const CAPTURE_LABEL_LIMIT = 120

/**
 * Lists the form controls an unrolled frame leaves scrolled.
 *
 * @remarks
 * A text area or a list box that overflows computes a scrolling overflow of its own, but its rows
 * are the control's value rather than the page's layout, and no style the page could change would
 * show them all. `collectUnrolledRegions` therefore leaves these elements out, so an unrolled frame
 * neither grows for them nor refuses over them.
 */
export const CAPTURE_CONTROLS: readonly string[] = Object.freeze(['input', 'select', 'textarea'])

/**
 * Bounds the scroll regions one capture refusal names.
 *
 * @remarks
 * `captureFrame` names each region it leaves hiding rows with its own correction. A page can hold
 * many such regions, so the refusal names this many and counts the rest, which keeps the message
 * readable without dropping the fact that more remain.
 */
export const CAPTURE_REGION_LIMIT = 5
