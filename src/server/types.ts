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
	 * @param source - The destination path the link points at. The stored value is a path naming that
	 * destination, but its exact text is not promised. The path may name a destination outside the
	 * scratch directory and is not containment-checked.
	 * @throws When the target escapes the scratch directory, the scratch root is missing, a symbolic
	 * link, or a file, or the host refuses to create the link, including a host that creates no
	 * symbolic link when the source names an existing non-directory.
	 * @remarks {@link createLink} owns the host-specific link mechanism.
	 */
	link(target: string, source: string): void
	/**
	 * Removes a file, an empty directory, or a directory and its descendants.
	 *
	 * @param target - A relative or absolute path contained by the scratch directory. A missing target
	 * is a no-op. A final symbolic link is removed without following it, so its destination survives.
	 * @throws When the target escapes the scratch directory, when it names the allocation itself
	 * lexically or through an intermediate symbolic link, when the scratch root is missing, a symbolic
	 * link, or a file, or when the host refuses to remove the target.
	 */
	remove(target: string): void
	/**
	 * Removes the allocated directory and everything in it when its identity still matches.
	 *
	 * @throws When the host refuses to inspect or remove the matching allocation.
	 */
	destroy(): void
}

/** The fields that together identify one allocated directory on its host. */
export interface ScratchIdentity {
	/** The identifier of the device holding the directory. */
	readonly device: number
	/** The number of the directory's index node on that device. */
	readonly inode: number
	/** The directory's creation time in milliseconds. */
	readonly birth: number
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

/** A server a test owns, listening on an ephemeral loopback port until the test releases it. */
export interface LoopbackInterface {
	/**
	 * The `http` origin for the assigned port, without a trailing slash. A TLS server answers on the
	 * same port under `https`.
	 */
	readonly url: string
	/** The ephemeral port the host assigned. */
	readonly port: number
	/**
	 * Drops every live connection on a server that carries `closeAllConnections`, stops listening, and
	 * releases the port.
	 *
	 * @remarks Idempotent. A plain `net.Server` waits for its open sockets to end.
	 */
	destroy(): Promise<void>
}

/** A name-keyed cookie store a test drives one origin with, filled from real responses. */
export interface CookieJarInterface {
	/**
	 * The `Cookie` request header naming every stored cookie, or `undefined` while the jar holds none.
	 */
	readonly header: string | undefined
	/**
	 * Reads one stored cookie value.
	 *
	 * @param name - The cookie name.
	 * @returns The stored value, or `undefined` when the jar holds no cookie of that name.
	 */
	read(name: string): string | undefined
	/**
	 * Applies every `Set-Cookie` field a response carries.
	 *
	 * @param response - The response whose `Set-Cookie` fields are applied.
	 * @returns Those fields unmodified, in the order the response carried them.
	 * @remarks Selection is by name alone. A field spelling `Max-Age=0` deletes its cookie and every
	 * other field stores or replaces one, so `Domain`, `Path`, `Expires`, and `Secure` are read past
	 * rather than honoured. Nothing outlives the jar.
	 */
	capture(response: Response): readonly string[]
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

/** Options for driving a client upgrade request. */
export interface UpgradeOptions {
	/** The request path, written with its leading slash. Defaults to `/`. */
	readonly path?: string
	/**
	 * The subprotocol tokens the request offers. They are sent as one comma-separated
	 * `Sec-WebSocket-Protocol` field, and an empty or omitted list sends no field at all.
	 */
	readonly protocols?: readonly string[]
}

/** What one server did with a client upgrade request. */
export interface UpgradeResult {
	/**
	 * True if the server upgraded the connection; false if it answered with a plain response
	 * instead.
	 */
	readonly claimed: boolean
	/** The plain response's status, or `undefined` when the server upgraded. */
	readonly status: number | undefined
	/**
	 * The subprotocol the server selected, or `undefined` when the server selected none and when it
	 * answered plainly. A server selects at most one, so this is the field it sent rather than a
	 * list.
	 */
	readonly protocol: string | undefined
}
