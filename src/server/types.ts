import type { WaitOptions } from '@src/core'

/** Holds a temporary directory a test owns, writes into, reads back, and removes when it is done. */
export interface ScratchInterface {
	/** Holds the absolute path of the allocated directory. */
	readonly path: string
	/**
	 * Writes a file, creating each parent directory that does not exist.
	 *
	 * @param target - A relative or absolute file path contained by the scratch directory.
	 * @param text - The file contents.
	 * @returns The absolute path of the written file.
	 * @throws When the target escapes the scratch directory, the scratch root is missing, a symbolic
	 * link, or a file, or the host refuses to write the file.
	 */
	write(target: string, text: string): string
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
	 * @returns True if the entry exists, including a symbolic link whose target is
	 * missing; false otherwise.
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
	 * @returns The absolute path of the created link, whatever host mechanism created it.
	 * @throws When the target escapes the scratch directory, the scratch root is missing, a symbolic
	 * link, or a file, or the host refuses to create the link, including a host that creates no
	 * symbolic link when the source names an existing non-directory.
	 * @remarks {@link createLink} owns the host-specific link mechanism.
	 */
	link(target: string, source: string): string
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

/** Represents the fields that together identify one allocated directory on its host. */
export interface ScratchIdentity {
	/** Holds the identifier of the device holding the directory. */
	readonly device: number
	/** Holds the number of the directory's index node on that device. */
	readonly inode: number
	/** Holds the directory's creation time in milliseconds. */
	readonly birth: number
}

/** Configures a scratch directory allocation. */
export interface ScratchOptions {
	/**
	 * Names the existing directory in which to create the allocation. Defaults to the host temporary
	 * directory. Allocation throws when this path is missing, a symbolic link, or not a directory.
	 */
	readonly parent?: string
	/**
	 * Holds the name fragment that starts the generated directory name. Allocation throws when this
	 * value contains `/` or `\`. Both are refused on every host, so the rule does not vary by host. A
	 * fragment carrying no separator is one path segment and cannot steer the allocation, so
	 * `release-0..2-` allocates.
	 */
	readonly prefix?: string
	/**
	 * Holds the files to write on allocation, keyed by path below the scratch directory. Allocation
	 * removes its directory and rethrows when a key escapes or the host refuses a write.
	 */
	readonly files?: Readonly<Record<string, string>>
}

/** Holds a server a test owns, listening on an ephemeral loopback port until the test releases it. */
export interface LoopbackInterface {
	/**
	 * Names the `http` origin for the assigned port, without a trailing slash. A TLS server answers
	 * on the same port under `https`.
	 */
	readonly url: string
	/** Holds the ephemeral port the host assigned. */
	readonly port: number
	/**
	 * Drops every live connection on a server that carries `closeAllConnections`, stops listening, and
	 * releases the port.
	 *
	 * @remarks Idempotent. A plain `net.Server` waits for its open sockets to end.
	 */
	destroy(): Promise<void>
}

/** Holds a name-keyed cookie store a test drives one origin with, filled from real responses. */
export interface CookieJarInterface {
	/**
	 * Reports the `Cookie` request header naming every stored cookie, or `undefined` while the jar
	 * holds none.
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

/** Configures a source inventory read. */
export interface InventoryOptions {
	/** Lists the file extensions to include, each written with its leading dot. */
	readonly extensions?: readonly string[]
	/**
	 * Lists the root-relative path keys to exclude. A key excludes itself and every key below it,
	 * matched on whole segments, so `excluded` drops `excluded/file.ts` and keeps
	 * `excluded-other/file.ts`.
	 */
	readonly exclude?: readonly string[]
}

/**
 * Configures a client upgrade request.
 *
 * @remarks The time bounds and abort signal bound the wait for the server's answer, so a server
 * that accepts the connection and never answers ends the call rather than parking it.
 */
export interface UpgradeOptions extends WaitOptions {
	/** Names the request path, written with its leading slash. Defaults to `/`. */
	readonly path?: string
	/**
	 * Lists the subprotocol tokens the request offers. They are sent as one comma-separated
	 * `Sec-WebSocket-Protocol` field, and an empty or omitted list sends no field at all.
	 */
	readonly protocols?: readonly string[]
}

/**
 * Represents what one server did with a client upgrade request.
 *
 * @remarks `claimed` is the discriminant. The claimed arm carries `protocol`, the subprotocol the
 * server selected, which is `undefined` when it selected none; a claimed upgrade produced no plain
 * answer, so it carries no status and the `101` on the wire is deliberately not reported as one.
 * The refused arm carries `status`, the plain answer's status, and no subprotocol.
 */
export type UpgradeResult =
	| { readonly claimed: true; readonly protocol: string | undefined }
	| { readonly claimed: false; readonly status: number }
