import type { Guard } from '@orkestrel/contract'
import type { ProgressError, ProgressEvent } from './types.js'
import { arrayOf, isNumber, isString, literalOf, recordOf, unionOf } from '@orkestrel/contract'

/**
 * Checks whether a value is one error a progress line carries.
 *
 * @example
 * ```ts
 * import { isProgressError } from '@orkestrel/test/server'
 *
 * isProgressError({ message: 'Error: refused', location: 'tests/a.test.ts:4:9' }) // true
 * isProgressError({ location: 'tests/a.test.ts:4:9' }) // false
 * ```
 */
export const isProgressError: Guard<ProgressError> = recordOf(
	{ message: isString, location: isString },
	['location'],
)

/**
 * Checks whether a value is one line of a progress file.
 *
 * @example
 * ```ts
 * import { isProgressEvent } from '@orkestrel/test/server'
 *
 * isProgressEvent({ event: 'cancel', reason: 'test-failure', wall: 1, time: 2, pid: 3 }) // true
 * isProgressEvent({ event: 'cancel', reason: 'test-failure' }) // false
 * ```
 */
export const isProgressEvent: Guard<ProgressEvent> = unionOf(
	recordOf({
		event: literalOf('init'),
		version: isNumber,
		wall: isNumber,
		bail: isNumber,
		time: isNumber,
		pid: isNumber,
	}),
	recordOf({
		event: literalOf('start'),
		specifications: arrayOf(recordOf({ project: isString, module: isString })),
		time: isNumber,
		pid: isNumber,
	}),
	recordOf({
		event: literalOf('collected'),
		project: isString,
		module: isString,
		planned: isNumber,
		errors: arrayOf(isProgressError),
		time: isNumber,
		pid: isNumber,
	}),
	recordOf({
		event: literalOf('ready'),
		project: isString,
		id: isString,
		name: isString,
		time: isNumber,
		pid: isNumber,
	}),
	recordOf(
		{
			event: literalOf('case'),
			project: isString,
			module: isString,
			id: isString,
			name: isString,
			state: literalOf('passed', 'failed', 'skipped', 'pending'),
			duration: isNumber,
			start: isNumber,
			errors: arrayOf(isProgressError),
			time: isNumber,
			pid: isNumber,
		},
		['duration', 'start', 'errors'],
	),
	recordOf({
		event: literalOf('cancel'),
		reason: isString,
		wall: isNumber,
		time: isNumber,
		pid: isNumber,
	}),
	recordOf({
		event: literalOf('module'),
		project: isString,
		module: isString,
		state: literalOf('passed', 'failed', 'skipped', 'pending', 'queued'),
		duration: isNumber,
		time: isNumber,
		pid: isNumber,
	}),
	recordOf({
		event: literalOf('end'),
		reason: literalOf('passed', 'interrupted', 'failed'),
		overhead: isNumber,
		unhandled: arrayOf(isProgressError),
		time: isNumber,
		pid: isNumber,
	}),
)
