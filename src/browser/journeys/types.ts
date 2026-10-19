import type { StatechartStatus, StateScenario, WaitOptions } from '@src/core'

/** Represents one scripted step a journal recorded, and what the surface did about it. */
export interface JournalStep {
	/** Names what the run did, as one verb. */
	readonly action: string
	/** Names the exact thing it did it to. */
	readonly trigger: string
	/** Holds what was observed on the surface after the step landed. */
	readonly result: string
}

/**
 * Records one scenario: every step it took and everything the page said while it ran.
 *
 * @remarks
 * Recording is off until {@link JournalInterface.start} arms it, so a suite that never starts a
 * journal pays for none of it. The console is observed by standing in front of it and forwarding
 * every call to the channel that was there: a browser offers no listener for its own output, and a
 * journal that swallowed what it read would hide exactly the diagnostics it exists to keep.
 */
export interface JournalInterface {
	/** Lists every step recorded since the journal started, in the order it was taken; a snapshot. */
	readonly steps: readonly JournalStep[]
	/** Lists every console line and uncaught failure the page emitted since it started; a snapshot. */
	readonly output: readonly string[]
	/**
	 * Starts a fresh recording, dropping whatever the previous scenario left.
	 *
	 * @remarks
	 * Calling this on a started journal clears both lists and leaves the console interception
	 * standing, so a restart never wraps its own wrappers.
	 */
	start(): void
	/**
	 * Stops recording and hands every intercepted console channel back by identity.
	 *
	 * @remarks
	 * Calling this on a stopped journal does nothing. The recorded lists survive, so a scenario is
	 * read after its recording ends.
	 */
	stop(): void
	/**
	 * Records one step, when the journal is started.
	 *
	 * @param action - What the run did, as one verb.
	 * @param trigger - The exact thing it did it to.
	 * @param result - What was observed on the surface after the step landed.
	 * @remarks The appended step is frozen. A step taken before `start` or after `stop` is not
	 * recorded at all.
	 */
	record(action: string, trigger: string, result: string): void
}

/**
 * Configures a bounded wait over the states a control announces.
 *
 * @remarks
 * The direction is a boolean because a state is either announced or it is not, and both directions
 * are the same wait over the same reading. The time bounds and the abort signal come from
 * {@link WaitOptions} and mean there what they mean everywhere else.
 */
export interface StateOptions extends WaitOptions {
	/** Determines the direction: `true` waits until the state is gone, `false` until it appears. */
	readonly absent?: boolean
}

/**
 * Represents one point in the coordinates of the browser's top-level viewport, the space a DevTools
 * input command addresses.
 *
 * @remarks
 * As an input to {@link readProtocolPoint}, the same shape names an offset from the element's
 * top-left corner, in the element's own pixels.
 */
export interface ProtocolPoint {
	/** Holds the distance from the left edge, in CSS pixels. */
	readonly x: number
	/** Holds the distance from the top edge, in CSS pixels. */
	readonly y: number
}

/**
 * Represents the accessibility node the browser computed for one element.
 *
 * @remarks
 * The values are the browser's own computation, which is what separates this from the DOM-based
 * `readRole`, `readName`, and `readStates` readings: the browser applies every naming and role rule
 * itself, so the node is what an assistive technology is handed.
 */
export interface AccessibilityNode {
	/** Holds the computed role, or `undefined` when the node states none. */
	readonly role: string | undefined
	/** Holds the computed accessible name, or `undefined` when the node states none. */
	readonly name: string | undefined
	/** Maps each property name to its value; an ID reference reads as the list of referenced IDs. */
	readonly properties: Readonly<Record<string, unknown>>
}

/**
 * Configures one capture settle: the time bounds of {@link WaitOptions} and whether the pointer
 * parks first.
 *
 * @remarks
 * The bounds go to the wait on finite animations and mean there what they mean everywhere else.
 * Leave the pointer where it is only where the pointer is part of the state being shot, such as a
 * drag in flight.
 */
export interface SettleOptions extends WaitOptions {
	/** Determines whether the pointer parks outside the page before the wait. Default: `true`. */
	readonly pointer?: boolean
}

/**
 * Represents the animations running on one element and its subtree, split by whether each one ends.
 *
 * @remarks
 * An animation counts as endless when its effect declares infinite iterations. A paused, an idle,
 * and a finished animation are at rest, so neither list holds one.
 */
export interface AnimationReading {
	/** Lists the running animations that end, the ones `waitForAnimations` waits on. */
	readonly finite: readonly Animation[]
	/** Lists the running animations whose effect declares infinite iterations. */
	readonly endless: readonly Animation[]
}

/**
 * Configures an inert `Storage`: its seed, which operations the host permits, and its quota.
 *
 * @remarks
 * Every member describes a condition a real origin produces. A withheld read or write is what a
 * browser with site data blocked raises from the storage object, and a quota is what an origin with
 * no room left raises from `setItem`. Omit a member and the store behaves as an ordinary origin
 * does: seeded with nothing, permitting everything, and bounded by nothing.
 */
export interface StorageOptions {
	/** Holds the entries the store starts with, keyed by storage key. */
	readonly values?: Readonly<Record<string, string>>
	/** Determines whether the host permits reads. Default: `true`. */
	readonly reads?: boolean
	/** Determines whether the host permits writes. Default: `true`. */
	readonly writes?: boolean
	/**
	 * Caps the accepted `setItem` calls, as a non-negative safe integer. When omitted, nothing bounds
	 * the store.
	 */
	readonly quota?: number
}

/**
 * Holds a store the host can withhold and later grant.
 *
 * @remarks
 * The name carries `Web` because `@orkestrel/database` owns `StorageInterface` for the operations a
 * driver's transaction scope offers, and the fleet gives one bare exported name one owning package.
 * This one is the Web Storage surface a browser publishes on `localStorage`, plus the grant a
 * person allowing site data performs.
 *
 * `Storage` declares an index signature, so `store.theme` typechecks against this type. A store
 * `createStorage` returns answers through its methods alone and intercepts no named-property
 * access, so drive a consumer under test through `getItem` and `setItem`.
 */
export interface WebStorageInterface extends Storage {
	/** Grants the reads and the writes the host withheld, and replenishes no quota. */
	permit(): void
}

/**
 * Configures the harness that renders one transition table and drives it row by row.
 *
 * @typeParam TState - The states the entity moves between, as a string-literal union.
 * @typeParam TEvent - The events the entity accepts, as a string-literal union.
 * @typeParam TContext - The fixture the three phases of each row drive.
 * @remarks
 * `scenarios` is the table in the order it renders and the order it runs, so the rows a reader sees
 * are the rows the run walks. `build` is called once per row, the way `executeScenarios` calls it,
 * so one table can mix fixtures and a row never inherits the entity the row before it left behind.
 *
 * `state` is the reader that puts the entity's current state on the page. It is called with the
 * row's own context after that row settles, pass or fail, so the rendered state is where the event
 * actually left the entity rather than where the row expected it. It is a reader rather than a
 * phase: a `state` that throws rejects the run after the harness writes `failed`, and the row it was
 * reading is not counted as failed.
 *
 * `pause` holds a delay between rows, for a table whose entity is worth watching. Omit it and the
 * rows run back to back.
 */
export interface HarnessOptions<TState extends string, TEvent extends string, TContext> {
	/** Holds the table to render and drive, in the order it is written. */
	readonly scenarios: ReadonlyArray<StateScenario<TState, TEvent, TContext>>
	/** Builds the fixture one row drives, called once per row and awaited when it returns a promise. */
	readonly build: (
		scenario: StateScenario<TState, TEvent, TContext>,
	) => TContext | Promise<TContext>
	/** Reads the state the entity is in, for the element the harness renders it on. */
	readonly state: (context: TContext) => TState
	/** Holds the delay in milliseconds the harness waits between rows. */
	readonly pause?: number
}

/**
 * Holds a mounted statechart harness, the tally it publishes, and the run it drives.
 *
 * @remarks
 * Every reading comes off the mounted markup rather than out of a field beside it, so the object a
 * test asserts on and the attributes a gate polls cannot disagree. `status`, `total`, `passed`, and
 * `failed` read the root's own attributes, and `failures` reads the `scenario` name of every row
 * whose `result` reads `failed`, so no second list can drift from the rows.
 *
 * `root` is the mounted element, handed out so a test can read the markup a gate would read.
 * `failures` hands out a snapshot, so a list read mid-run stays what it was.
 */
export interface HarnessInterface {
	/** Holds the mounted root carrying the status, the tally, and every row. */
	readonly root: HTMLElement
	/** Reports the run state the root announces. */
	readonly status: StatechartStatus
	/** Reports how many rows the table declares. */
	readonly total: number
	/** Reports how many rows the last run finished with a passing result. */
	readonly passed: number
	/** Reports how many rows the last run finished with a failing result. */
	readonly failed: number
	/** Lists the name of every row whose rendered result reads failed, in table order. */
	readonly failures: readonly string[]
	/**
	 * Drives every row in table order, from a fresh tally and a cleared state.
	 *
	 * @returns A promise resolving after the last row settles and the terminal status is written.
	 * @throws The value a `state` reader or a non-`Error` phase threw, by identity, after the harness
	 * writes `failed`. Every exit is terminal, because the gate polling the markup has no rejection
	 * channel to read.
	 */
	execute(): Promise<void>
	/** Removes the mounted root, and does nothing when it is already removed. */
	destroy(): void
}
