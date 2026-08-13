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

/** Maps each event name to the argument tuple its listeners receive. */
export type RecorderEventMap = Record<string, readonly unknown[]>

/**
 * The subscribe half of an event source, declared structurally so no emitter package is imported.
 *
 * @typeParam TMap - The event map the source publishes.
 * @typeParam TName - The event names being subscribed to.
 */
export interface SubscriberInterface<TMap extends RecorderEventMap, TName extends keyof TMap> {
	/**
	 * Subscribes a listener to one event.
	 *
	 * @param event - The event name to listen for.
	 * @param handler - The listener receiving that event's arguments.
	 */
	on(event: TName, handler: (...args: TMap[TName]) => void): void
}

/**
 * One recorder per subscribed event, keyed by event name.
 *
 * @typeParam TMap - The event map the recorders cover.
 * @typeParam TName - The event names that have a recorder.
 */
export type RecorderMap<TMap extends RecorderEventMap, TName extends keyof TMap> = Readonly<
	{ [K in TName]: RecorderInterface<TMap[K]> }
>

/** A time source a test drives by hand instead of waiting for the host clock. */
export interface ClockInterface {
	/** Reads the current time in milliseconds. */
	readonly now: () => number
	/**
	 * Moves the current time forward.
	 *
	 * @param ms - The milliseconds to add.
	 */
	advance(ms: number): void
	/**
	 * Replaces the current time.
	 *
	 * @param value - The milliseconds to report from now on.
	 */
	set(value: number): void
}

/** Any value JSON can represent, so a round trip through JSON preserves the type. */
export type JSONValue =
	| string
	| number
	| boolean
	| null
	| readonly JSONValue[]
	| { readonly [key: string]: JSONValue }
