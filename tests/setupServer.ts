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

/** Reports whether this host links a file, as {@link supportsFileLinks} reads it. */
export const FILE_LINKS = supportsFileLinks()

/** Reports whether this host links a directory, as {@link supportsDirectoryLinks} reads it. */
export const DIRECTORY_LINKS = supportsDirectoryLinks()

/** Reports whether this host stores POSIX permission bits, as {@link supportsMode} reads it. */
export const POSIX_MODE = supportsMode()

/** Reports whether this host distinguishes filenames by case, as {@link supportsCase} reads it. */
export const CASE_SENSITIVE_FS = supportsCase()

/**
 * Reports whether this host accepts a filename carrying a raw byte no UTF-8 decoder resolves, as
 * {@link supportsBytes} reads it.
 */
export const RAW_BYTE_NAMES = supportsBytes()

/**
 * Lists every host-capability probe, paired with the name its failures are reported under. The
 * pairs are a case matrix rather than test registration, so a residue or boolean proof runs once
 * per probe instead of being written out per probe.
 */
export const HOST_PROBES: ReadonlyArray<readonly [name: string, probe: () => boolean]> =
	Object.freeze([
		Object.freeze<readonly [name: string, probe: () => boolean]>([
			'supportsDirectoryLinks',
			supportsDirectoryLinks,
		]),
		Object.freeze<readonly [name: string, probe: () => boolean]>([
			'supportsFileLinks',
			supportsFileLinks,
		]),
		Object.freeze<readonly [name: string, probe: () => boolean]>(['supportsMode', supportsMode]),
		Object.freeze<readonly [name: string, probe: () => boolean]>(['supportsCase', supportsCase]),
		Object.freeze<readonly [name: string, probe: () => boolean]>(['supportsBytes', supportsBytes]),
	])

/**
 * Lists every environment variable a host's `os.tmpdir()` reads. Each platform reads its own name
 * first — win32 takes `TEMP`, then `TMP`; POSIX takes `TMPDIR`, then `TMP`, then `TEMP` — so an
 * override that sets one name steers one platform, and an override that sets the whole set steers
 * either.
 */
export const TEMPORARY_VARIABLES: readonly string[] = Object.freeze(['TMPDIR', 'TEMP', 'TMP'])

/**
 * Lists absolute target spellings that carry a root of their own. `relative` compares spellings and
 * reads no filesystem, so neither the drive nor the share has to exist for the comparison to
 * answer.
 */
export const FOREIGN_ROOT_SPELLINGS: readonly string[] = Object.freeze([
	'Z:\\orkestrel-test-outside',
	'\\\\orkestrel-test-host\\share\\outside',
])
