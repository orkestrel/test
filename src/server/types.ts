import type { WaitOptions } from '@src/core'
import type { FrameLocator, Page } from 'playwright'

/** Supplies the real Playwright page and tester frame to a native chooser command. */
export interface ChooserContext {
	/** Holds the Playwright page that emits the native chooser event. */
	readonly page: Page
	/** Holds the tester frame that contains the resolved input. */
	readonly iframe: FrameLocator
}

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
	 * @throws When the target resolves outside the scratch directory, the scratch root is missing, a symbolic
	 * link, or a file, or the host refuses to write the file.
	 */
	write(target: string, text: string): string
	/**
	 * Reads a file.
	 *
	 * @param target - A relative or absolute file path contained by the scratch directory.
	 * @returns The file contents, or `undefined` when no file can be read, including through a
	 * symbolic link whose target is missing.
	 * @throws When the path is a directory, resolves outside the scratch directory, or its root is a symbolic
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
	 * @throws When the path resolves outside the scratch directory or its root is a symbolic link or file.
	 */
	has(target: string): boolean
	/**
	 * Lists the names directly inside a directory in sorted order.
	 *
	 * @param target - A relative or absolute directory path contained by the scratch directory.
	 * Default: the scratch root.
	 * @returns The sorted entry names, without their parent paths.
	 * @throws When the path resolves outside the scratch directory, the target is missing or is not a
	 * directory, or the scratch root is a symbolic link or file.
	 */
	names(target?: string): readonly string[]
	/**
	 * Creates a directory and every missing parent.
	 *
	 * @param target - A relative or absolute directory path contained by the scratch directory.
	 * @returns The absolute path of the directory.
	 * @throws When the path resolves outside the scratch directory, the target exists and is not a directory,
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
	 * @throws When the target resolves outside the scratch directory, the scratch root is missing, a symbolic
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
	 * @throws When the target resolves outside the scratch directory, when it names the allocation itself
	 * lexically or through an intermediate symbolic link, when the scratch root is missing, a symbolic
	 * link, or a file, or when the host refuses to remove the target.
	 */
	remove(target: string): void
	/**
	 * Removes the allocated directory and everything in it when its identity still matches.
	 *
	 * @throws When the host refuses to inspect or remove the matching allocation.
	 * @remarks Idempotent. An identity that no longer matches removes nothing.
	 */
	destroy(): void
}

/** Represents the fields that together identify one allocated directory on its host. */
export interface ScratchIdentity {
	/** Holds the identifier of the device holding the directory, read as a bigint. */
	readonly device: bigint
	/** Holds the number of the directory's index node on that device, exact past 2^53. */
	readonly inode: bigint
	/** Holds the directory's creation time in nanoseconds. */
	readonly birth: bigint
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
	 * removes its directory and rethrows when a key resolves outside it or the host refuses a write.
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
	 * rather than honoured. A field carrying no `name=value` pair is read past too and still
	 * returned. Nothing outlives the jar.
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

/** Represents one error a progress line carries: its first message line and where it was thrown. */
export interface ProgressError {
	/** Holds the error's name and the first line of its message, stripped of terminal colour codes. */
	readonly message: string
	/**
	 * Names the first stack frame outside `node_modules` as `file:line:column`, relative to the run's
	 * root, or the first frame when every frame sits in `node_modules`. Absent when the error carries
	 * no parsed stack.
	 */
	readonly location?: string
}

/** Names one module a run starts, under the project that runs it. */
export interface ProgressModule {
	/** Names the Vitest project. */
	readonly project: string
	/** Holds the module path relative to the run's root. */
	readonly module: string
}

/** Represents the stamp every progress line carries. */
export interface ProgressStamp {
	/** Holds the milliseconds since the reporter was constructed, read from the monotonic clock. */
	readonly time: number
	/** Holds the id of the process that wrote the line. */
	readonly pid: number
}

/** Represents the line a reporter writes when Vitest initializes it. */
export interface ProgressInitEvent extends ProgressStamp {
	/** Names the line's event. */
	readonly event: 'init'
	/** Holds the format version the line stream follows. */
	readonly version: number
	/** Holds the wall-clock time of the line, in milliseconds since the Unix epoch. */
	readonly wall: number
	/** Holds the run's `bail` setting; `0` runs every case. */
	readonly bail: number
}

/** Represents the line a reporter writes when a run starts, listing the modules it runs. */
export interface ProgressStartEvent extends ProgressStamp {
	/** Names the line's event. */
	readonly event: 'start'
	/** Lists every module the run starts, in Vitest's order. */
	readonly modules: readonly ProgressModule[]
}

/** Represents the line a reporter writes when Vitest collects one module's cases. */
export interface ProgressCollectedEvent extends ProgressStamp {
	/** Names the line's event. */
	readonly event: 'collected'
	/** Names the Vitest project. */
	readonly project: string
	/** Holds the module path relative to the run's root. */
	readonly module: string
	/** Counts the collected cases whose mode is `run` or `only`, the cases the run plans to report. */
	readonly planned: number
	/** Lists the errors the module raised while it was collected. */
	readonly errors: readonly ProgressError[]
}

/** Represents the line a reporter writes when a planned case starts. */
export interface ProgressReadyEvent extends ProgressStamp {
	/** Names the line's event. */
	readonly event: 'ready'
	/** Names the Vitest project. */
	readonly project: string
	/** Holds Vitest's id for the case. */
	readonly id: string
	/** Holds the case's full name, its suites joined by ` > `. */
	readonly name: string
}

/** Names the state a case result reports, mirroring Vitest's `TestState`. */
export type ProgressCaseState = 'passed' | 'failed' | 'skipped' | 'pending'

/** Represents the line a reporter writes once for each planned case's result. */
export interface ProgressCaseEvent extends ProgressStamp {
	/** Names the line's event. */
	readonly event: 'case'
	/** Names the Vitest project. */
	readonly project: string
	/** Holds the module path relative to the run's root. */
	readonly module: string
	/** Holds Vitest's id for the case. */
	readonly id: string
	/** Holds the case's full name, its suites joined by ` > `. */
	readonly name: string
	/** Holds the case's result state. */
	readonly state: ProgressCaseState
	/** Holds how long the case ran, in whole milliseconds. Absent when Vitest reports no diagnostic. */
	readonly duration?: number
	/**
	 * Holds the wall-clock time the case started, in milliseconds since the Unix epoch. Absent when
	 * Vitest reports no diagnostic.
	 */
	readonly start?: number
	/** Lists each error of a failed case. Absent unless the state is `failed`. */
	readonly errors?: readonly ProgressError[]
}

/** Represents the line a reporter writes each time Vitest cancels the run. */
export interface ProgressCancelEvent extends ProgressStamp {
	/** Names the line's event. */
	readonly event: 'cancel'
	/** Holds the reason Vitest's `onCancel` delivers, such as `test-failure` for a bail. */
	readonly reason: string
	/** Holds the wall-clock time of the line, in milliseconds since the Unix epoch. */
	readonly wall: number
}

/** Names the state a finished module reports, mirroring Vitest's `TestModuleState`. */
export type ProgressModuleState = 'passed' | 'failed' | 'skipped' | 'pending' | 'queued'

/** Represents the line a reporter writes when a module finishes. */
export interface ProgressModuleEvent extends ProgressStamp {
	/** Names the line's event. */
	readonly event: 'module'
	/** Names the Vitest project. */
	readonly project: string
	/** Holds the module path relative to the run's root. */
	readonly module: string
	/** Holds the module's final state. */
	readonly state: ProgressModuleState
	/** Holds how long the module ran, in whole milliseconds. */
	readonly duration: number
}

/** Names why a run ended, mirroring Vitest's `TestRunEndReason`. */
export type ProgressEndReason = 'passed' | 'interrupted' | 'failed'

/** Represents the line a reporter writes when a run ends. */
export interface ProgressEndEvent extends ProgressStamp {
	/** Names the line's event. */
	readonly event: 'end'
	/** Holds why the run ended. */
	readonly reason: ProgressEndReason
	/** Holds the reporter's own time across every hook since it was initialized, in milliseconds. */
	readonly overhead: number
	/** Lists the errors Vitest reported outside any case. */
	readonly unhandled: readonly ProgressError[]
}

/** Represents one line of a progress file, discriminated by `event`. */
export type ProgressEvent =
	| ProgressInitEvent
	| ProgressStartEvent
	| ProgressCollectedEvent
	| ProgressReadyEvent
	| ProgressCaseEvent
	| ProgressCancelEvent
	| ProgressModuleEvent
	| ProgressEndEvent

/** Names a run's state as a reader sees it: `live` until its `end` line, then the end reason. */
export type ProgressState = 'live' | ProgressEndReason

/**
 * Names how a failure relates to the run's bail: `first` is the earliest failure, `bail` is a
 * failure past the bail setting whose result arrived or whose case ended after the first cancel, and
 * `later` is any other failure.
 */
export type ProgressRelation = 'first' | 'bail' | 'later'

/** Represents one project's tallies in a progress reading. */
export interface ProgressProject {
	/** Names the Vitest project. */
	readonly name: string
	/** Counts the cases the project's collected modules plan to report. */
	readonly planned: number
	/** Counts the cases that reported a result. */
	readonly done: number
	/** Counts the cases that passed. */
	readonly passed: number
	/** Counts the cases that failed. */
	readonly failed: number
	/** Counts the planned cases that reported a skip at run time, a bail-cut case included. */
	readonly skipped: number
	/** Counts the modules the run started for the project. */
	readonly modules: number
	/** Counts the modules Vitest has collected for the project. */
	readonly collected: number
}

/** Represents a case that started and has not reported a result. */
export interface ProgressCase {
	/** Names the Vitest project. */
	readonly project: string
	/** Holds the case's full name. */
	readonly name: string
	/** Holds how long the case has been running, in milliseconds. */
	readonly duration: number
}

/** Represents one failed case in a progress reading. */
export interface ProgressFailure {
	/** Names the Vitest project. */
	readonly project: string
	/** Holds the case's full name. */
	readonly name: string
	/** Holds the milliseconds since the reporter started at which the result was written. */
	readonly time: number
	/** Names how the failure relates to the run's bail. */
	readonly relation: ProgressRelation
	/** Holds the case's first error, or `undefined` when the result carried none. */
	readonly error: ProgressError | undefined
}

/** Represents the first cancel a run recorded. */
export interface ProgressCancel {
	/** Holds the reason Vitest delivered. */
	readonly reason: string
	/** Holds the milliseconds since the reporter started at which the cancel was written. */
	readonly time: number
}

/** Represents where one run stands, read from its progress lines. */
export interface ProgressRun {
	/** Holds the id of the process that wrote the run. */
	readonly pid: number
	/** Names the run's state. */
	readonly state: ProgressState
	/** Holds the run's `bail` setting; `0` runs every case. */
	readonly bail: number
	/** Holds the milliseconds the run has taken, up to its end or to the reading. */
	readonly elapsed: number
	/** Counts the cases that reported a result, across every project. */
	readonly done: number
	/** Counts the cases the collected modules plan to report, across every project. */
	readonly planned: number
	/** True if the run started and every module it started has been collected; false otherwise. */
	readonly collected: boolean
	/** Holds the results per minute since the first case started, or `undefined` before one. */
	readonly rate: number | undefined
	/**
	 * Holds the estimated milliseconds left, or `undefined` once the run ended, before a rate exists,
	 * or while a module is still uncollected.
	 */
	readonly remaining: number | undefined
	/** Lists each project's tallies, in first-seen order. */
	readonly projects: readonly ProgressProject[]
	/** Lists the cases still running while the run is live, and none after it ends. */
	readonly running: readonly ProgressCase[]
	/** Holds the first cancel, or `undefined` when the run recorded none. */
	readonly cancel: ProgressCancel | undefined
	/** Lists the failed cases in result order. */
	readonly failures: readonly ProgressFailure[]
	/** Holds the reporter's own time from the `end` line, or `undefined` while the run is live. */
	readonly overhead: number | undefined
	/** Lists the errors Vitest reported outside any case, empty while the run is live. */
	readonly unhandled: readonly ProgressError[]
}
