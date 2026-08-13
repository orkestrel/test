/** A temporary directory a test owns, writes into, reads back, and removes when it is done. */
export interface ScratchInterface {
	/** The absolute path of the allocated directory. */
	readonly path: string
	/**
	 * Writes a file, creating each parent directory that does not exist.
	 *
	 * @param target - A relative or absolute file path contained by the scratch directory.
	 * @param text - The file contents.
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
	 * Reports whether a path exists.
	 *
	 * @param target - A relative or absolute path contained by the scratch directory.
	 * @returns True when the entry exists, including a symbolic link whose target is missing.
	 * @throws When the path escapes the scratch directory or its root is a symbolic link or file.
	 */
	exists(target: string): boolean
	/** Removes the directory and everything in it. */
	destroy(): void
}

/** Options for allocating a scratch directory. */
export interface ScratchOptions {
	/** The leading text of the generated directory name. */
	readonly prefix?: string
	/** Files to write on allocation, keyed by path below the scratch directory. */
	readonly files?: Readonly<Record<string, string>>
}

/** Options for reading a source inventory. */
export interface InventoryOptions {
	/** The file extensions to include, each written with its leading dot. */
	readonly extensions?: readonly string[]
	/** The root-relative path keys to exclude. A directory key also excludes its descendants. */
	readonly exclude?: readonly string[]
}
