/** A temporary directory a test owns, writes into, reads back, and removes when it is done. */
export interface ScratchInterface {
	/** The absolute path of the allocated directory. */
	readonly path: string
	/**
	 * Writes a file, creating each parent directory that does not exist.
	 *
	 * @param target - A relative or absolute file path contained by the scratch directory.
	 * @param text - The file contents.
	 * @throws When the target escapes the scratch directory, the scratch root is missing, a symbolic
	 * link, or a file, or the host refuses to write the file.
	 */
	write(target: string, text: string): void
	/**
	 * Reads a file.
	 *
	 * @param target - A relative or absolute file path contained by the scratch directory.
	 * @returns The file contents, or `undefined` when no file can be read, including through a
	 * symbolic link whose target is missing.
	 * @throws When the path is a directory, escapes the scratch directory, or its root is a symbolic
	 * link or file. Reading follows links, so a link the host cannot resolve — a cycle, for one —
	 * surfaces the host's own error rather than `undefined`.
	 */
	read(target: string): string | undefined
	/**
	 * Reports whether a path exists without following its final symbolic link.
	 *
	 * @param target - A relative or absolute path contained by the scratch directory.
	 * @returns True when the entry exists, including a symbolic link whose target is missing.
	 * @throws When the path escapes the scratch directory or its root is a symbolic link or file.
	 */
	has(target: string): boolean
	/**
	 * Lists the names directly inside a directory in sorted order.
	 *
	 * @param target - A relative or absolute directory path contained by the scratch directory. The
	 * scratch root is used when omitted.
	 * @returns The sorted entry names, without their parent paths.
	 * @throws When the path escapes the scratch directory, the target is missing or is not a
	 * directory, or the scratch root is a symbolic link or file.
	 */
	names(target?: string): readonly string[]
	/**
	 * Creates a directory and every missing parent.
	 *
	 * @param target - A relative or absolute directory path contained by the scratch directory.
	 * @returns The absolute path of the directory.
	 * @throws When the path escapes the scratch directory, the target exists and is not a directory,
	 * or the scratch root is missing, a symbolic link, or a file.
	 */
	ensure(target: string): string
	/**
	 * Creates a symbolic link at a contained path, creating its missing parent directories.
	 *
	 * @param target - The relative or absolute contained path where the link is created. Unlike
	 * `node:fs`'s `symlinkSync(target, path)` vocabulary, this interface consistently calls the
	 * contained path the target.
	 * @param source - The link text naming the pointed-at path. It may name a path outside the scratch
	 * directory and is not containment-checked.
	 * @throws When the target escapes the scratch directory, the scratch root is missing, a symbolic
	 * link, or a file, or the host refuses to create the link.
	 */
	link(target: string, source: string): void
	/**
	 * Removes the allocated directory and everything in it when its identity still matches.
	 *
	 * @throws When the host refuses to inspect or remove the matching allocation.
	 */
	destroy(): void
}

/** Options for allocating a scratch directory. */
export interface ScratchOptions {
	/**
	 * The existing directory in which to create the allocation. Defaults to the host temporary
	 * directory. Allocation throws when this path is missing, a symbolic link, or not a directory.
	 */
	readonly parent?: string
	/**
	 * The name fragment that starts the generated directory name. Allocation throws when this value
	 * contains `/` or `\`. Both are refused on every host, so the rule does not vary by host. A
	 * fragment carrying no separator is one path segment and cannot steer the allocation, so
	 * `release-0..2-` allocates.
	 */
	readonly prefix?: string
	/**
	 * Files to write on allocation, keyed by path below the scratch directory. Allocation removes its
	 * directory and rethrows when a key escapes or the host refuses a write.
	 */
	readonly files?: Readonly<Record<string, string>>
}

/** Options for reading a source inventory. */
export interface InventoryOptions {
	/** The file extensions to include, each written with its leading dot. */
	readonly extensions?: readonly string[]
	/**
	 * The root-relative path keys to exclude. A key excludes itself and every key below it, matched
	 * on whole segments, so `excluded` drops `excluded/file.ts` and keeps `excluded-other/file.ts`.
	 */
	readonly exclude?: readonly string[]
}
