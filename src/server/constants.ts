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
