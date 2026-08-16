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
	 * this one. The list is empty afterwards, so a repeated call runs nothing that already ran.
	 */
	destroy(): Promise<void>
}

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
						: { readonly [K in keyof T]: K extends symbol ? never : JSONSafe<T[K]> }
					: never
