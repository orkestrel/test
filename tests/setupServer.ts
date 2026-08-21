import {
	supportsBytes,
	supportsCase,
	supportsDirectoryLinks,
	supportsFileLinks,
	supportsMode,
} from '@src/server'

// The package ships one probe per host capability, and each is proved against real fixtures in
// tests/src/server/helpers.test.ts. Reading them here makes the suites consumers of the shipped
// mechanism rather than of a second one that can answer differently. Setup calls each probe a
// single time, so a suite gating on a capability pays for one allocation rather than one per case.

/** Whether this host links a file, as {@link supportsFileLinks} reads it. */
export const FILE_LINKS = supportsFileLinks()

/** Whether this host links a directory, as {@link supportsDirectoryLinks} reads it. */
export const DIRECTORY_LINKS = supportsDirectoryLinks()

/** Whether this host stores POSIX permission bits, as {@link supportsMode} reads it. */
export const POSIX_MODE = supportsMode()

/** Whether this host distinguishes filenames by case, as {@link supportsCase} reads it. */
export const CASE_SENSITIVE_FS = supportsCase()

/**
 * Whether this host accepts a filename carrying a raw byte no UTF-8 decoder resolves, as
 * {@link supportsBytes} reads it.
 */
export const RAW_BYTE_NAMES = supportsBytes()
