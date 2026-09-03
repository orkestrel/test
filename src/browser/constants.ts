import type { Color } from './types.js'

/**
 * The interactive ARIA roles a bare accessible name is searched across.
 *
 * @remarks
 * A person names a control, not a role, so the one-argument resolver searches every role a control
 * can compute. The two-argument form searches exactly the role it is given, which is how a name
 * shared by a tab and its panel is disambiguated.
 */
export const ACCESSIBLE_ROLES: readonly string[] = Object.freeze([
	'button',
	'checkbox',
	'combobox',
	'link',
	'listbox',
	'menuitem',
	'option',
	'radio',
	'searchbox',
	'slider',
	'spinbutton',
	'switch',
	'tab',
	'tabpanel',
	'textbox',
	'treeitem',
])

/**
 * The page a browser paints an unstyled document onto.
 *
 * @remarks
 * This is the floor a backdrop walk ends on wherever the caller wants the browser's own canvas
 * assumed. `readBackdrop` takes its floor as an argument rather than reaching for this one, so a
 * measurement over a surface the canvas never shows through names the color it actually sits on.
 */
export const CANVAS_COLOR: Color = Object.freeze([255, 255, 255, 1])

/**
 * The attribute marking the runner's tester pane, and the rule that sizes it, while a frame is
 * staged.
 *
 * @remarks
 * `stagePane` writes it onto the pane and onto the stylesheet it appends, and `releasePane` finds
 * both by it. The stylesheet's value is the viewport the tester had before the first staging, in
 * `<width>x<height>` form, which is what `releasePane` hands back. Nothing else reads it, so a
 * document carrying it after a capture returned is a pane that was never released.
 */
export const CAPTURE_PANE = 'data-capture-pane'

/**
 * The restagings one capture takes before it refuses a document whose height never settles.
 *
 * @remarks
 * `captureFrame` stages the pane at the height the document needs, and a rule bound to the viewport
 * height lays that document out taller against the taller pane, so the height has to be read again
 * after every staging. The re-reading stops when a reading no longer outruns the pane it was taken
 * under, and a rule that adds height with every pane never reaches that point, so the re-reading is
 * bounded here and the shot is refused rather than taken at a height that is already stale.
 */
export const CAPTURE_STAGINGS = 3

/**
 * The roles whose accessible name is the text a reader can see inside them.
 *
 * @remarks
 * `readName` reads an element in this list from its own rendered text, after every `aria-hidden`
 * descendant is dropped, and falls through to `title` for every other role.
 */
export const CONTENT_ROLES: readonly string[] = Object.freeze([
	'button',
	'cell',
	'columnheader',
	'heading',
	'link',
	'listitem',
	'option',
	'row',
	'rowheader',
	'tab',
])

/**
 * The role each `input` type carries.
 *
 * @remarks
 * Membership is the contract. The map answers for `button`, `checkbox`, `email`, `number`,
 * `password`, `radio`, `range`, `reset`, `search`, `submit`, `tel`, `text`, and `url`. A type the
 * map omits — `color`, `date`, `file`, `hidden`, and the rest — exposes no role of its own, so
 * `readRole` returns `undefined` for it and `describeTree` writes no line for it.
 */
export const FIELD_ROLES: Readonly<Record<string, string>> = Object.freeze({
	button: 'button',
	checkbox: 'checkbox',
	email: 'textbox',
	number: 'spinbutton',
	password: 'textbox',
	radio: 'radio',
	range: 'slider',
	reset: 'button',
	search: 'searchbox',
	submit: 'button',
	tel: 'textbox',
	text: 'textbox',
	url: 'textbox',
})

/**
 * What sequential keyboard navigation can reach, before disabled and unrendered elements go.
 *
 * @remarks
 * `describeFocus` queries this selector and then drops what a browser drops: an element the
 * accessibility tree does not present, a disabled control, and one removed from the sequence by
 * `tabindex="-1"`. `traverseAccessible` counts the same population to bound its walk, so this is
 * the one list either one reads.
 */
export const FOCUSABLE_SELECTOR =
	'a[href], area[href], button, input, select, summary, textarea, [tabindex]'

/**
 * The role a `th` carries for the header axis its `scope` names.
 *
 * @remarks
 * A header cell heads a column or a row, and this map answers for the `col` and `row` scopes that
 * say which. A `th` declaring no scope keeps {@link IMPLICIT_ROLES}' `columnheader` rather than the
 * ARIA computation that infers the axis from the table's shape.
 */
export const HEADER_ROLES: Readonly<Record<string, string>> = Object.freeze({
	col: 'columnheader',
	row: 'rowheader',
})

/**
 * The role each listed tag carries in the accessibility tree when it declares none of its own.
 *
 * @remarks
 * Membership is the contract. The map answers for the sectioning elements `ARTICLE`, `ASIDE`,
 * `FOOTER`, `HEADER`, `MAIN`, `NAV`, `SEARCH`, and `SECTION`; the headings `H1` through `H6`; the
 * grouping and list elements `FIELDSET`, `FORM`, `HR`, `LI`, `OL`, and `UL`; the table elements
 * `TABLE`, `TBODY`, `THEAD`, `TR`, `TD`, and `TH`; and the widgets `BUTTON`, `DIALOG`, `IMG`,
 * `OPTION`, `OUTPUT`, `PROGRESS`, `SUMMARY`, and `TEXTAREA`.
 *
 * A tag the map omits carries no implicit role, so `readRole` returns `undefined` for it,
 * `describeTree` writes no line for it, and the walk continues straight into its children at the
 * depth the omitted element sat at. `A`, `INPUT`, and `SELECT` are absent deliberately: each takes
 * its role from an attribute rather than from its tag, and `readRole` answers for them from their
 * own anatomy.
 *
 * `SECTION` maps to `region`, which `readRole` withholds from an unnamed one, because an unnamed
 * section is not a landmark. `TH` maps to `columnheader`, which {@link HEADER_ROLES} replaces when
 * the cell declares a `scope`.
 */
export const IMPLICIT_ROLES: Readonly<Record<string, string>> = Object.freeze({
	ARTICLE: 'article',
	ASIDE: 'complementary',
	BUTTON: 'button',
	DIALOG: 'dialog',
	FIELDSET: 'group',
	FOOTER: 'contentinfo',
	FORM: 'form',
	H1: 'heading',
	H2: 'heading',
	H3: 'heading',
	H4: 'heading',
	H5: 'heading',
	H6: 'heading',
	HEADER: 'banner',
	HR: 'separator',
	IMG: 'img',
	LI: 'listitem',
	MAIN: 'main',
	NAV: 'navigation',
	OL: 'list',
	OPTION: 'option',
	OUTPUT: 'status',
	PROGRESS: 'progressbar',
	SEARCH: 'search',
	SECTION: 'region',
	SUMMARY: 'button',
	TABLE: 'table',
	TBODY: 'rowgroup',
	TD: 'cell',
	TEXTAREA: 'textbox',
	TH: 'columnheader',
	THEAD: 'rowgroup',
	TR: 'row',
	UL: 'list',
})
