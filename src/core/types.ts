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
