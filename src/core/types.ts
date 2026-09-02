/**
 * Records every call made to its handler.
 *
 * @typeParam TArgs - The argument tuple the recorded handler accepts.
 */
export interface RecorderInterface<TArgs extends readonly unknown[]> {
	/** Every recorded call, oldest first, each entry the arguments of one call. */
	readonly calls: readonly TArgs[]
	/** How many calls have been recorded. */
	readonly count: number
	/** The callback to hand to the code under test. */
	readonly handler: (...args: TArgs) => void
	/** Discards the recorded calls and keeps the recorder usable. */
	clear(): void
}

/**
 * Subscribes handlers to a typed event source.
 *
 * @typeParam TMap - The event names and argument tuples the source delivers.
 */
export interface EventSourceInterface<TMap extends Record<string, readonly unknown[]>> {
	/**
	 * Subscribes a handler to an event.
	 *
	 * @param event - The event to subscribe to.
	 * @param handler - The handler that receives each delivery.
	 */
	on<K extends keyof TMap>(event: K, handler: (...args: TMap[K]) => void): void
}

/**
 * Maps event names to recorders for their delivered argument tuples.
 *
 * @typeParam TMap - The event names and argument tuples the source delivers.
 * @typeParam TName - The event names represented in the map.
 */
export type RecorderMap<
	TMap extends Record<string, readonly unknown[]>,
	TName extends keyof TMap,
> = { readonly [K in TName]: RecorderInterface<TMap[K]> }

/** A real abort signal and controller instrumented with its live abort-listener tally. */
export interface SignalInterface {
	/** The controller that owns the signal. */
	readonly controller: AbortController
	/** The instrumented signal. */
	readonly signal: AbortSignal
	/** The live abort-listener tally. */
	readonly count: number
}

/** A numbered resource factory with records of every creation and destruction. */
export interface ResourceFactoryInterface {
	/** The ids returned by `create`, in order. */
	readonly created: RecorderInterface<readonly [id: number]>
	/** The ids passed to `destroy`, in order. */
	readonly destroyed: RecorderInterface<readonly [id: number]>
	/**
	 * Creates a numbered resource.
	 *
	 * @returns The next monotonically increasing id.
	 */
	create(): number
	/**
	 * Destroys a numbered resource.
	 *
	 * @param id - The resource id to destroy.
	 */
	destroy(id: number): void
}

/** The work one teardown entry performs when the list is destroyed. */
export type TeardownHandler = () => void | Promise<void>

/** The cleanup a test adds as it goes and runs once, newest first, when it is done. */
export interface TeardownInterface {
	/** How many handlers are registered. */
	readonly count: number
	/**
	 * Registers a handler to run when the list is destroyed.
	 *
	 * @param handler - The work to perform.
	 */
	add(handler: TeardownHandler): void
	/**
	 * Runs every registered handler in reverse registration order, awaiting each in turn, and empties
	 * the list.
	 *
	 * @throws The value the failed handler threw, by identity, when exactly one handler failed. An
	 * `AggregateError` carrying every thrown value in run order, when several did.
	 * @remarks Every handler runs, including after an earlier one throws or rejects. A handler
	 * registered while the run is in progress stays registered for the next call rather than joining
	 * this one. The snapshot it ran is discarded, so a repeated call runs nothing that already ran.
	 */
	destroy(): Promise<void>
}

/**
 * Configures a bounded asynchronous wait.
 *
 * @remarks
 * A default belongs to the function that reads these bounds rather than to the shape, because the
 * consumers do not agree on one. Each states its own numbers in its `@remarks`.
 */
export interface WaitOptions {
	/** The elapsed-time limit in milliseconds. */
	readonly budget?: number
	/** The delay between readings in milliseconds. */
	readonly interval?: number
	/** The signal that aborts the wait. */
	readonly signal?: AbortSignal
}

/** Configures a bounded retry. */
export interface RetryOptions extends WaitOptions {
	/** The maximum number of producer calls. When omitted, only the time budget bounds the retry. */
	readonly attempts?: number
}

/**
 * Subscribes a listener to one event source.
 *
 * @typeParam TArgs - The argument tuple the event delivers.
 * @param listener - The listener that receives each delivery.
 * @returns The cleanup that removes the listener, or `void` when the source needs none.
 */
export type EventSubscriber<TArgs extends readonly unknown[]> = (
	listener: (...args: TArgs) => void,
) => (() => void) | void

/** Any value JSON can represent, so a round trip through JSON preserves the type. */
export type JSONValue =
	| string
	| number
	| boolean
	| null
	| readonly JSONValue[]
	| { readonly [key: string]: JSONValue }

/**
 * The JSON-safe projection of a type: every member JSON preserves, mapped to itself, and every
 * member it does not, mapped to `never`.
 *
 * @typeParam T - The type to project.
 * @remarks Intersect a parameter with this rather than constraining it to `JSONValue`. A `JSONValue`
 * constraint rejects every `interface`, because TypeScript grants an implicit index signature to a
 * type alias and never to an interface, and interfaces are what this project's public types are. A
 * value whose type survives the projection satisfies the intersection unchanged; one that carries a
 * method, a `Date`, a `Map`, the opaque `object` type, or a symbol-keyed member meets `never` at that
 * member and is rejected there. A member typed `undefined` is rejected the same way, because
 * serialization drops it from an object and rewrites it to `null` in an array, so the returned type
 * would claim a member the copy does not carry. An optional member survives, since its declared type
 * still narrows to what JSON keeps. A member declared `?: X | undefined` and passed an explicit
 * `undefined` is refused; declare it `?: X` and omit the member instead. `unknown` passes through
 * unvetted by the projection. For an `unknown` member, `roundTripJSON` refuses `undefined`,
 * functions, symbols, and non-finite numbers at runtime; JSON otherwise may silently reshape the
 * value, such as a `Date` to a string or a `Map` to `{}`.
 * @example
 * ```ts
 * interface Snapshot {
 * 	readonly id: string
 * 	readonly turns: number
 * }
 *
 * // { readonly id: string; readonly turns: number } — every member survives.
 * type Safe = JSONSafe<Snapshot>
 * ```
 */
export type JSONSafe<T> = unknown extends T
	? T
	: T extends string | number | boolean | null
		? T
		: T extends ReadonlyArray<infer E>
			? ReadonlyArray<JSONSafe<E>>
			: T extends (...args: never[]) => unknown
				? never
				: T extends object
					? object extends T
						? never
						: {
								readonly [K in keyof T]: K extends symbol ? never : JSONSafe<T[K]>
							}
					: never

/**
 * Any value the host `Headers` constructor accepts.
 *
 * @remarks Derived from the host constructor rather than named from a single library, so the type
 * resolves in every project against that project's own `Headers` declaration. The record,
 * entries-array, and `Headers` forms all satisfy it.
 */
export type HeadersSource = NonNullable<ConstructorParameters<typeof Headers>[0]>

/**
 * One row of a statechart table: the entity's state before an event, the event, and the state that
 * event must leave it in.
 *
 * @typeParam TState - The states the entity moves between, as a string-literal union.
 * @typeParam TEvent - The events the entity accepts, as a string-literal union.
 * @remarks The two unions are the entity's own vocabulary, so a table naming a state or an event the
 * entity does not have fails to typecheck rather than failing at runtime.
 */
export interface StateTransition<TState extends string, TEvent extends string> {
	/** The row's name, which is prepended to the message of whatever the row throws. */
	readonly name: string
	/** The state the row arranges before it acts. */
	readonly from: TState
	/** The event the row applies to the arranged entity. */
	readonly event: TEvent
	/** The state the row asserts the entity reached. */
	readonly to: TState
}

/**
 * Drives one {@link StateTransition} through the three phases that prove it.
 *
 * @typeParam TState - The states the entity moves between, as a string-literal union.
 * @typeParam TEvent - The events the entity accepts, as a string-literal union.
 * @typeParam TContext - The fixture the three phases drive.
 * @remarks Each phase receives the context and the part of the transition it is responsible for, so
 * a phase reads its subject from its own parameters rather than from the row it belongs to. A phase
 * may be synchronous or asynchronous, and `executeScenario` awaits each one before starting the
 * next.
 */
export interface StateScenario<TState extends string, TEvent extends string, TContext> {
	/** The row this scenario drives. */
	readonly transition: StateTransition<TState, TEvent>
	/**
	 * Puts the entity into the transition's `from` state.
	 *
	 * @param context - The fixture this row drives.
	 * @param state - The transition's `from` state.
	 */
	arrange(context: TContext, state: TState): Promise<void> | void
	/**
	 * Applies the transition's event to the arranged entity.
	 *
	 * @param context - The fixture this row drives.
	 * @param event - The transition's event.
	 */
	act(context: TContext, event: TEvent): Promise<void> | void
	/**
	 * Checks that the entity reached the transition's `to` state.
	 *
	 * @param context - The fixture this row drives.
	 * @param state - The transition's `to` state.
	 */
	assert(context: TContext, state: TState): Promise<void> | void
}
