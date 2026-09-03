import type {
	EventSubscriber,
	HeadersSource,
	JSONSafe,
	Result,
	RetryOptions,
	SignalRegistration,
	StateScenario,
	WaitOptions,
} from './types.js'

/**
 * Checks the resolved bounds one bounded wait runs under.
 *
 * @param subject - The bound's owner, which opens each refusal message.
 * @param budget - The resolved elapsed-time limit in milliseconds.
 * @param interval - The resolved delay between readings in milliseconds.
 * @throws An `Error` reading `<subject> budget must be finite and non-negative` or
 * `<subject> interval must be finite and non-negative`.
 * @remarks Every member of the wait family resolves its own defaults first and passes the resolved
 * numbers here, so each keeps its own defaults while one contract states what a bound must be.
 */
export function checkBounds(subject: string, budget: number, interval: number): void {
	if (!Number.isFinite(budget) || budget < 0) {
		throw new Error(`${subject} budget must be finite and non-negative`)
	}
	if (!Number.isFinite(interval) || interval < 0) {
		throw new Error(`${subject} interval must be finite and non-negative`)
	}
}

/**
 * Builds the error {@link retryUntil} raises when its elapsed-time budget runs out.
 *
 * @param description - The operation the retry was named for.
 * @param budget - The elapsed-time limit in milliseconds.
 * @param elapsed - The milliseconds the retry actually spent.
 * @param last - The rendered last unsatisfying value, or `undefined` when the retry produced none.
 * @param cause - The last producer error, which becomes the returned error's `cause`.
 * @returns The exhaustion error, unthrown.
 * @remarks Both of `retryUntil`'s elapsed checks raise this one message, so an edit to it lands in
 * one place. The rendered value is appended only when the retry produced one.
 */
export function buildRetryExhausted(
	description: string,
	budget: number,
	elapsed: number,
	last: string | undefined,
	cause: unknown,
): Error {
	return new Error(
		`Retry "${description}" did not succeed within ${budget}ms (waited ${elapsed}ms)${last === undefined ? '' : ` (last value: ${last})`}`,
		{ cause },
	)
}

/**
 * Drops the registration an instrumented signal installed for one listener.
 *
 * @param registrations - The live registration list, spliced in place.
 * @param installed - The installed listener naming the registration to drop.
 * @returns The dropped registration, or `undefined` when the list holds none for that listener.
 * @remarks The dropped registration's cleanup controller is aborted as it leaves, so the scope
 * subscription installed beside it leaves with it. Removing the installed listener from the signal
 * stays with the caller, because only the scope-abort path has one to remove.
 */
export function dropRegistration(
	registrations: SignalRegistration[],
	installed: EventListener | EventListenerObject,
): SignalRegistration | undefined {
	const index = registrations.findIndex((registration) => registration[1] === installed)
	const registration = registrations[index]
	if (registration === undefined) return undefined
	registrations.splice(index, 1)
	registration[3]?.abort()
	return registration
}

/**
 * Waits for a host timer to elapse.
 *
 * @param ms - The delay in milliseconds.
 * @returns A promise that resolves after the timer fires.
 */
export function waitForDelay(ms = 0): Promise<void> {
	return new Promise((resolve) => setTimeout(resolve, ms))
}

/**
 * Waits until an abort signal is aborted.
 *
 * @param signal - The signal to observe.
 * @returns A promise that resolves when the signal is aborted.
 * @remarks An already-aborted signal resolves immediately. Otherwise the wait parks on a one-shot
 * abort listener without a timer or polling.
 */
export function waitForAbort(signal: AbortSignal): Promise<void> {
	if (signal.aborted) return Promise.resolve()
	return new Promise((resolve) => signal.addEventListener('abort', () => resolve(), { once: true }))
}

/**
 * Waits until a condition holds within an elapsed-time budget.
 *
 * @param description - The condition described in a timeout error.
 * @param condition - The synchronous or asynchronous condition to read.
 * @param options - The time bounds and abort signal.
 * @returns A promise that resolves when the condition first returns `true`.
 * @throws The condition's thrown value, the abort reason, or an `Error` when a bound is invalid or
 * the condition does not hold within the budget.
 * @remarks The first read is immediate. Default budget: `1000` milliseconds. Default interval: `10`
 * milliseconds.
 */
export async function waitForCondition(
	description: string,
	condition: () => boolean | Promise<boolean>,
	options?: WaitOptions,
): Promise<void> {
	const budget = options?.budget ?? 1000
	const interval = options?.interval ?? 10
	checkBounds('Wait', budget, interval)

	const start = performance.now()
	while (true) {
		options?.signal?.throwIfAborted()
		const held = await condition()
		options?.signal?.throwIfAborted()
		if (held) return

		const elapsed = performance.now() - start
		if (elapsed >= budget) {
			throw new Error(
				`Condition "${description}" did not hold within ${budget}ms (waited ${elapsed}ms)`,
			)
		}
		await waitForDelay(interval)
	}
}

/**
 * Repeats a producer until one produced value satisfies a predicate.
 *
 * @typeParam T - The produced value type.
 * @param description - The operation described in an exhaustion error.
 * @param produce - The synchronous or asynchronous operation to repeat.
 * @param satisfied - The predicate that accepts a produced value.
 * @param options - The time, attempt, and abort bounds.
 * @returns The first produced value the predicate accepts.
 * @throws The predicate's thrown value, the abort reason, or an `Error` when a bound is invalid or
 * the retry exhausts its budget or attempts.
 * @remarks A producer throw counts as an unsatisfied attempt. The last producer error becomes the
 * exhaustion error's `cause`. Default budget: `1000` milliseconds. Default interval: `10`
 * milliseconds.
 */
export async function retryUntil<T>(
	description: string,
	produce: () => T | Promise<T>,
	satisfied: (value: T) => boolean,
	options?: RetryOptions,
): Promise<T> {
	const budget = options?.budget ?? 1000
	const interval = options?.interval ?? 10
	const attempts = options?.attempts
	checkBounds('Retry', budget, interval)
	if (attempts !== undefined && (!Number.isInteger(attempts) || attempts < 1)) {
		throw new Error('Retry attempts must be a positive integer')
	}

	const start = performance.now()
	let count = 0
	let cause: unknown
	let last: string | undefined
	while (true) {
		options?.signal?.throwIfAborted()
		if (count > 0) {
			const elapsed = performance.now() - start
			if (elapsed >= budget) {
				throw buildRetryExhausted(description, budget, elapsed, last, cause)
			}
		}
		let produced: Result<T, unknown>
		try {
			produced = { success: true, value: await produce() }
		} catch (error) {
			produced = { success: false, error }
		}
		count += 1
		options?.signal?.throwIfAborted()

		if (produced.success) {
			if (satisfied(produced.value)) return produced.value
			let rendered: string
			try {
				const serialized = JSON.stringify(produced.value)
				rendered = serialized === undefined ? String(produced.value) : serialized
			} catch {
				try {
					rendered = String(produced.value)
				} catch {
					rendered = '[unrenderable]'
				}
			}
			last = rendered.length > 200 ? `${rendered.slice(0, 197)}...` : rendered
		} else {
			cause = produced.error
		}

		const elapsed = performance.now() - start
		if (elapsed >= budget) {
			throw buildRetryExhausted(description, budget, elapsed, last, cause)
		}
		if (attempts !== undefined && count >= attempts) {
			throw new Error(
				`Retry "${description}" did not succeed within ${attempts} attempts${last === undefined ? '' : ` (last value: ${last})`}`,
				{ cause },
			)
		}
		await waitForDelay(Math.min(interval, budget - elapsed))
	}
}

/**
 * Invokes an unknown method through an explicit unchecked result contract.
 *
 * @typeParam T - The result type claimed by the caller.
 * @param target - The value used as the method's `this` argument.
 * @param method - The unknown method to invoke.
 * @param args - The arguments to pass.
 * @returns The method's result under the caller's claimed type.
 * @throws A `TypeError` when `method` is not callable.
 * @remarks The caller owns the claim that the returned value has type `T`. The contained `any`
 * bridges the unchecked runtime result to that caller-owned claim.
 */
export function invokeUnchecked<T>(target: unknown, method: unknown, args: readonly unknown[]): T {
	if (typeof method !== 'function') throw new TypeError('Method must be callable')
	const result: T = Reflect.apply(method, target, args)
	return result
}

/**
 * Reads a property from an unknown object or function.
 *
 * @typeParam T - The property type claimed by the caller.
 * @param target - The unknown value to read.
 * @param key - The property key to read.
 * @returns The property value under the caller's claimed type.
 * @throws A `TypeError` when `target` is neither an object nor a function.
 * @remarks The caller owns the claim that the returned value has type `T`. The contained `any`
 * bridges the unchecked runtime result to that caller-owned claim.
 */
export function readProperty<T>(target: unknown, key: PropertyKey): T {
	if ((typeof target !== 'object' || target === null) && typeof target !== 'function') {
		throw new TypeError('Target must be an object or function')
	}
	const result: T = Reflect.get(target, key)
	return result
}

/**
 * Normalizes headers into a frozen plain record.
 *
 * @param init - The platform header initializer to normalize.
 * @returns A frozen record of normalized header names and values.
 * @remarks Normalization follows the host `Headers` implementation, including lowercased names and
 * combined values.
 */
export function flattenHeaders(init: HeadersSource): Readonly<Record<string, string>> {
	return Object.freeze(Object.fromEntries(new Headers(init).entries()))
}

/**
 * Waits for the first delivery from an event subscription.
 *
 * @typeParam TArgs - The delivered argument tuple.
 * @param subscribe - The function that installs the event listener and may return its cleanup.
 * @param description - The event described in a timeout error.
 * @param options - The time bounds and abort signal.
 * @returns The first delivered argument tuple.
 * @throws The subscription's thrown value, the abort reason, or an `Error` when a bound is invalid
 * or the event is not delivered within the budget.
 * @remarks Default budget: `1000` milliseconds. The interval is validated for consistency with the
 * wait family but is not used because this helper parks on the event.
 */
export async function waitForEvent<TArgs extends readonly unknown[]>(
	subscribe: EventSubscriber<TArgs>,
	description: string,
	options?: WaitOptions,
): Promise<TArgs> {
	const budget = options?.budget ?? 1000
	const interval = options?.interval ?? 10
	checkBounds('Event', budget, interval)

	const signal = options?.signal
	signal?.throwIfAborted()
	const delivery = Promise.withResolvers<TArgs>()
	const controller = new AbortController()
	let timeout: ReturnType<typeof setTimeout> | undefined
	const pending: Array<Promise<TArgs>> = [
		delivery.promise,
		new Promise((_resolve, reject) => {
			timeout = setTimeout(() => {
				reject(new Error(`Event "${description}" was not delivered within ${budget}ms`))
			}, budget)
		}),
	]
	if (signal !== undefined) {
		pending.push(
			new Promise((_resolve, reject) => {
				const combined = AbortSignal.any([signal, controller.signal])
				combined.addEventListener(
					'abort',
					() => {
						if (signal.aborted) reject(signal.reason)
					},
					{ once: true },
				)
			}),
		)
	}
	const result = Promise.race(pending)
	let cleanup: (() => void) | void = undefined
	try {
		try {
			cleanup = subscribe((...args) => delivery.resolve(args))
		} catch (error) {
			delivery.reject(error)
		}
		return await result
	} finally {
		controller.abort()
		if (timeout !== undefined) clearTimeout(timeout)
		cleanup?.()
	}
}

/**
 * Decodes newline-delimited JSON values.
 *
 * @param text - The JSON Lines text to decode.
 * @returns The decoded values in physical-line order.
 * @throws An `Error` naming the malformed physical line, with the native `SyntaxError` as its
 * `cause`.
 */
export function decodeJSONLines(text: string): readonly unknown[] {
	const values: unknown[] = []
	for (const [index, physical] of text.split('\n').entries()) {
		const line = physical.endsWith('\r') ? physical.slice(0, -1) : physical
		if (line.length === 0) continue
		try {
			const value: unknown = JSON.parse(line)
			values.push(value)
		} catch (cause) {
			throw new Error(`Invalid JSON on line ${index + 1}`, { cause })
		}
	}
	return values
}

/**
 * Captures the value thrown by a thunk.
 *
 * @param thunk - The work whose thrown value to capture.
 * @returns The thrown value, or `undefined` when the thunk completes.
 */
export function captureError(thunk: () => unknown): unknown {
	try {
		thunk()
	} catch (error) {
		return error
	}
	return undefined
}

/**
 * Requires a value to be present.
 *
 * @typeParam T - The required value type.
 * @param value - The value to check.
 * @param message - The error message used when the value is absent.
 * @returns The present value.
 */
export function requireValue<T>(value: T | null | undefined, message = 'Value is required'): T {
	if (value === null || value === undefined) throw new Error(message)
	return value
}

/**
 * Collects every value from an async iterable.
 *
 * @typeParam T - The yielded value type.
 * @param source - The async iterable to drain.
 * @returns The yielded values in iteration order.
 */
export async function collect<T>(source: AsyncIterable<T>): Promise<readonly T[]> {
	const values: T[] = []
	for await (const value of source) values.push(value)
	return values
}

/**
 * Collects every value from a readable stream.
 *
 * @typeParam T - The streamed value type.
 * @param stream - The readable stream to drain.
 * @returns The streamed values in read order.
 */
export async function collectStream<T>(stream: ReadableStream<T>): Promise<readonly T[]> {
	const reader = stream.getReader()
	const values: T[] = []
	try {
		while (true) {
			const result = await reader.read()
			if (result.done) return values
			values.push(result.value)
		}
	} finally {
		reader.releaseLock()
	}
}

/**
 * Copies a JSON value through serialization and parsing.
 *
 * @typeParam T - The copied value's type, which the copy keeps.
 * @param value - The value to copy, bounded by its own `JSONSafe` projection.
 * @returns The parsed JSON copy.
 * @remarks Non-finite numbers throw because JSON would replace them with `null`. Negative zero is
 * normalized to zero by JSON serialization. The bound intersects `JSONSafe<T>` rather than
 * constraining `T` to `JSONValue`, so an interface-typed value round-trips.
 */
export function roundTripJSON<T>(value: T & JSONSafe<T>): T {
	const serialized = JSON.stringify(value, (_key, current) => {
		if (current === undefined || typeof current === 'function' || typeof current === 'symbol') {
			throw new Error('JSON values must not contain undefined, functions, or symbols')
		}
		if (typeof current === 'number' && !Number.isFinite(current)) {
			throw new Error('JSON values must contain finite numbers')
		}
		return current
	})
	const parsed: T = JSON.parse(serialized)
	const pending: unknown[] = [parsed]
	while (pending.length > 0) {
		const current = pending.pop()
		if (typeof current === 'number' && !Number.isFinite(current)) {
			throw new Error('JSON values must contain finite numbers')
		}
		if (Array.isArray(current)) {
			for (const child of current) pending.push(child)
		} else if (typeof current === 'object' && current !== null) {
			for (const child of Object.values(current)) pending.push(child)
		}
	}
	return parsed
}

/**
 * Resolves the parent directory of a calling module, which is the workspace root when called from
 * the conventional `tests/setup.ts` location.
 *
 * @param meta - The calling module metadata.
 * @returns The root URL one directory above the calling file.
 */
export function resolveRoot(meta: ImportMeta): URL {
	return new URL('../', meta.url)
}

/**
 * Drives one statechart scenario through its arrange, act, and assert phases.
 *
 * @typeParam TState - The states the entity moves between.
 * @typeParam TEvent - The events the entity accepts.
 * @typeParam TContext - The fixture the phases drive.
 * @param scenario - The scenario to drive.
 * @param context - The fixture handed to each phase.
 * @returns A promise that resolves after the assert phase completes.
 * @throws An `Error` whose message opens with the transition's `name` and whose `cause` is the value
 * the failing phase threw.
 * @remarks Each phase is awaited before the next begins, so an asynchronous arrange settles before
 * the event is applied. The phases receive the transition's own parts: `arrange` receives `from`,
 * `act` receives `event`, and `assert` receives `to`.
 *
 * The row's name is prepended because a table's rows run under one test name, so a bare assertion
 * message says what failed and never which row. A thrown `Error` keeps its own message after the
 * name and arrives as the `cause`; anything else thrown is named by its type and arrives as the
 * `cause` unchanged.
 *
 * @example
 * ```ts
 * await executeScenario(scenarios[0], { disclosure: new Disclosure() })
 * ```
 */
export async function executeScenario<TState extends string, TEvent extends string, TContext>(
	scenario: StateScenario<TState, TEvent, TContext>,
	context: TContext,
): Promise<void> {
	const transition = scenario.transition
	try {
		await scenario.arrange(context, transition.from)
		await scenario.act(context, transition.event)
		await scenario.assert(context, transition.to)
	} catch (cause) {
		const message =
			cause instanceof Error ? cause.message : `threw a non-error ${typeof cause} value`
		throw new Error(`${transition.name}: ${message}`, { cause })
	}
}

/**
 * Drives a statechart table row by row, each row against a context of its own.
 *
 * @typeParam TState - The states the entity moves between.
 * @typeParam TEvent - The events the entity accepts.
 * @typeParam TContext - The fixture the phases drive.
 * @param scenarios - The table to drive, in the order it is written.
 * @param build - The fixture builder, called once per row and awaited when it returns a promise.
 * @returns A promise that resolves after the last row completes.
 * @throws An `Error` reading `<name>: build refused` when the row's builder throws or rejects, whose
 * `cause` is the value the builder refused with, or whatever {@link executeScenario} throws for the
 * first row whose phases fail. Either way the run stops at that row and the rows after it never
 * start.
 * @remarks The rows run one after another rather than together: a statechart's rows drive one
 * entity on one page, so a parallel run would have them arranging over each other. `build` receives
 * the row it is building for, which is what lets one table mix fixtures.
 *
 * A refusing builder is named for its row the way a failing phase is, because a table's rows build
 * under one test name too. The refusal itself arrives as the `cause`, by identity, so its own
 * message and stack survive the naming.
 *
 * @example
 * ```ts
 * await executeScenarios(SCENARIOS, () => ({ disclosure: new Disclosure() }))
 * ```
 */
export async function executeScenarios<TState extends string, TEvent extends string, TContext>(
	scenarios: ReadonlyArray<StateScenario<TState, TEvent, TContext>>,
	build: (scenario: StateScenario<TState, TEvent, TContext>) => TContext | Promise<TContext>,
): Promise<void> {
	for (const scenario of scenarios) {
		let context: TContext
		try {
			context = await build(scenario)
		} catch (cause) {
			throw new Error(`${scenario.transition.name}: build refused`, { cause })
		}
		await executeScenario(scenario, context)
	}
}
