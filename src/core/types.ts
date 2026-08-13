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
 * method, a `Date`, or a `Map` meets `never` at that member and is rejected there. A member typed
 * `undefined` is rejected the same way, because serialization drops it from an object and rewrites
 * it to `null` in an array, so the returned type would claim a member the copy does not carry. An
 * optional member survives, since its declared type still narrows to what JSON keeps. A member
 * declared `?: X | undefined` and passed an explicit `undefined` is refused; declare it `?: X` and
 * omit the member instead. `unknown` passes through unvetted by the projection. For an `unknown`
 * member, `roundTripJSON` refuses `undefined`, functions, symbols, and non-finite numbers at runtime;
 * JSON otherwise may silently reshape the value, such as a `Date` to a string or a `Map` to `{}`.
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
					? { readonly [K in keyof T]: JSONSafe<T[K]> }
					: never
