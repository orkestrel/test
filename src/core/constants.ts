/**
 * The attributes a statechart harness publishes, keyed by the fact each one carries.
 *
 * @remarks
 * A harness renders its own table and a gate outside the page polls the rendered markup, so these
 * names are the whole contract between the two. `status`, `passed`, `failed`, and `total` belong on
 * the harness root, because a gate finds the harness by `status` and reads the tally from the same
 * element. `scenario` and `result` belong on each row, so a failing row is found by `result` and
 * named by `scenario`. `state` belongs on the element rendering the entity's current state.
 *
 * The values are the attribute names themselves, so a harness writes `setAttribute` against this map
 * and a gate writes `querySelector` against it, and neither spells a `data-statechart-*` string of
 * its own.
 *
 * @example
 * ```ts
 * harness.getAttribute(STATECHART_ATTRIBUTES.status) // 'passed'
 * ```
 */
export const STATECHART_ATTRIBUTES = Object.freeze({
	status: 'data-statechart-status',
	passed: 'data-statechart-passed',
	failed: 'data-statechart-failed',
	total: 'data-statechart-total',
	scenario: 'data-statechart-scenario',
	result: 'data-statechart-result',
	state: 'data-statechart-state',
})

/**
 * Every value a statechart harness reports through its `status` attribute.
 *
 * @remarks
 * `pending` is what a harness carries before a run has produced a result for every row, `idle` is a
 * harness standing ready with nothing running, and `running` is a run in flight. `passed` and
 * `failed` are the two terminal readings, so a gate waits for membership in that pair rather than
 * for a fixed duration.
 *
 * The tuple's order is the order a run passes through, and its element type is the literal union, so
 * `(typeof STATECHART_STATUSES)[number]` is the status type a harness and its gate share.
 *
 * @example
 * ```ts
 * const terminal = new Set<string>([STATECHART_STATUSES[3], STATECHART_STATUSES[4]])
 * ```
 */
export const STATECHART_STATUSES = Object.freeze([
	'pending',
	'idle',
	'running',
	'passed',
	'failed',
] as const)
