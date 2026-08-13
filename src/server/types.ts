/** A temporary directory a test owns, writes into, reads back, and removes when it is done. */
export interface ScratchInterface {
	/** The absolute path of the allocated directory. */
	readonly path: string
	/**
	 * Writes a file, creating each parent directory that does not exist.
	 *
	 * @param relative - The path of the file below the scratch directory.
	 * @param text - The file contents.
	 */
	write(relative: string, text: string): void
	/**
	 * Reads a file.
	 *
	 * @param relative - The path of the file below the scratch directory.
	 * @returns The file contents, or `undefined` when the file does not exist.
	 */
	read(relative: string): string | undefined
	/**
	 * Reports whether a path exists.
	 *
	 * @param relative - The path below the scratch directory.
	 * @returns True when the path exists.
	 */
	exists(relative: string): boolean
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
	/** The path segments that exclude a file or directory from the walk. */
	readonly exclude?: readonly string[]
}
