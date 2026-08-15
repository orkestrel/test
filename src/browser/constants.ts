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
