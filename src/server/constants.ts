import type { ProgressRelation } from './types.js'

/**
 * Caps the attempts `removeTree` makes before rethrowing a retryable removal error.
 */
export const REMOVE_TREE_MAX_ATTEMPTS = 10

/**
 * Names the synchronous delay, in milliseconds, `removeTree` waits between attempts.
 */
export const REMOVE_TREE_RETRY_DELAY_MS = 100

/**
 * Names the error codes `removeTree` retries; every other code rethrows immediately.
 */
export const REMOVE_TREE_RETRYABLE_CODES: readonly string[] = Object.freeze([
	'EBUSY',
	'ENOTEMPTY',
	'EPERM',
])

/**
 * Names the format version a progress file's `init` line carries; a reader refuses any other.
 */
export const PROGRESS_VERSION = 1

/**
 * Caps the characters a progress error message keeps.
 */
export const PROGRESS_MESSAGE_LIMIT = 300

/**
 * Keys the brand every `ProgressReporter` carries, registered so that each copy of this package
 * reads the same key.
 */
export const PROGRESS_BRAND: unique symbol = Symbol.for('@orkestrel/test.ProgressReporter')

/**
 * Names the label a rendered progress reading prints for each failure relation.
 */
export const PROGRESS_LABELS: Readonly<Record<ProgressRelation, string>> = Object.freeze({
	first: 'FIRST',
	bail: 'AFTER-BAIL',
	later: 'FAILED',
})
