import {
	mkdirSync,
	mkdtempSync,
	readFileSync,
	readdirSync,
	rmSync,
	statSync,
	symlinkSync,
	writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { join, sep } from 'node:path'

/**
 * Determine a filesystem capability once, by attempting the operation in an owned scratch directory
 * and reading the real result. A capability the host refuses surfaces as a thrown error, which reads
 * as absence; a capability the host silently declines surfaces as a `false` return from `detect`.
 *
 * @param detect - Performs the operation in the scratch directory and reports whether it held.
 * @returns Whether the capability is present on this host.
 */
function probeCapability(detect: (directory: string) => boolean): boolean {
	const directory = mkdtempSync(join(tmpdir(), 'orkestrel-test-probe-'))
	try {
		return detect(directory)
	} catch {
		return false
	} finally {
		rmSync(directory, { force: true, recursive: true })
	}
}

/**
 * Whether this host creates symbolic links. Node's `symlinkSync` throws `EPERM` on Windows without
 * Developer Mode or administrator rights, so this is `true` on POSIX and on a privileged Windows
 * host, and `false` only where the link cannot be created.
 */
export const SYMLINKS = probeCapability((directory) => {
	const target = join(directory, 'target')
	mkdirSync(target)
	symlinkSync(target, join(directory, 'link'), 'dir')
	return true
})

/**
 * Whether this host honours POSIX permission bits. A directory created with mode `0o700` reports
 * `mode & 0o777 === 0o700` on POSIX; Windows reports `0o666` regardless, so this is `true` on POSIX
 * and `false` on Windows.
 */
export const POSIX_MODE = probeCapability((directory) => {
	const path = join(directory, 'moded')
	mkdirSync(path, { mode: 0o700 })
	return (statSync(path).mode & 0o777) === 0o700
})

/**
 * Whether this host distinguishes filenames by case. Files `A` and `a` are two entries on a
 * case-sensitive filesystem and one entry on a case-insensitive one, so this is `true` on a typical
 * POSIX host and `false` on a case-folding Windows or macOS volume.
 */
export const CASE_SENSITIVE_FS = probeCapability((directory) => {
	writeFileSync(join(directory, 'A'), 'upper')
	writeFileSync(join(directory, 'a'), 'lower')
	return readdirSync(directory).length === 2
})

/**
 * Whether this host accepts a filename carrying a raw byte no UTF-8 decoder resolves. Byte `0x80` is
 * an invalid UTF-8 lead byte; POSIX stores the name verbatim, while Windows rejects it with `ENOENT`,
 * so this is `true` on POSIX and `false` on Windows.
 */
export const RAW_BYTE_NAMES = probeCapability((directory) => {
	const name = Buffer.concat([Buffer.from(`${directory}${sep}`), Buffer.from([0x80])])
	writeFileSync(name, 'raw')
	return readFileSync(name, 'utf8') === 'raw'
})
