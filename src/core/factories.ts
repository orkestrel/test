import type {
	EventSourceInterface,
	RecorderInterface,
	RecorderMap,
	ResourceFactoryInterface,
	SignalInterface,
	TeardownHandler,
	TeardownInterface,
} from './types.js'

/**
 * Creates values that make common object readers throw or violate their assumptions.
 *
 * @returns A frozen array whose values are fresh on every call.
 * @remarks Every member makes a naive reader throw or violates a naive structural assumption. A
 * total guard survives every member without throwing. Whether it accepts or refuses one is that
 * guard's own contract. Membership may grow in a release, so test the whole returned set in a loop
 * and include the index in each failure.
 * @example
 * ```ts
 * import { expect } from 'vitest'
 * import { createHostileValues } from '@orkestrel/test'
 *
 * function isWireRecord(value: unknown): value is Readonly<Record<string, string>> {
 * 	if (typeof value !== 'object' || value === null) return false
 * 	try {
 * 		if (Object.getPrototypeOf(value) !== Object.prototype) return false
 * 		Reflect.get(value, 'value')
 * 		if (Reflect.ownKeys(value).length === 0) return false
 * 		return Object.values(value).every((member) => typeof member === 'string')
 * 	} catch {
 * 		return false
 * 	}
 * }
 *
 * for (const [index, value] of createHostileValues().entries()) {
 * 	let accepted: boolean | undefined
 * 	expect(() => {
 * 		accepted = isWireRecord(value)
 * 	}, `hostile value ${index}`).not.toThrow()
 * 	expect(accepted, `hostile value ${index}`).toBe(false)
 * }
 * ```
 */
export function createHostileValues(): readonly unknown[] {
	const cyclic: Record<string, unknown> = {}
	cyclic.self = cyclic
	const revoked = Proxy.revocable({}, {})
	revoked.revoke()
	const revokedArray = Proxy.revocable([], {})
	revokedArray.revoke()
	const cyclicArray: unknown[] = []
	cyclicArray.push(cyclicArray)
	const sparseArray = Array<unknown>(2)
	sparseArray[1] = 'present'
	const hidden = {}
	Object.defineProperty(hidden, 'hidden', { value: true })
	Reflect.set(hidden, 'self', hidden)
	const getter = {}
	Object.defineProperty(getter, 'danger', {
		enumerable: true,
		get() {
			throw new Error('Hostile named getter read')
		},
	})

	return Object.freeze([
		cyclic,
		revoked.proxy,
		new Proxy(
			{},
			{
				get() {
					throw new Error('Hostile property read')
				},
			},
		),
		new Proxy(
			{},
			{
				ownKeys() {
					throw new Error('Hostile key enumeration')
				},
			},
		),
		new Proxy(
			{},
			{
				getPrototypeOf() {
					throw new Error('Hostile prototype read')
				},
			},
		),
		Object.create(null),
		revokedArray.proxy,
		cyclicArray,
		sparseArray,
		hidden,
		getter,
	])
}

/**
 * Creates a recorder for callback arguments.
 *
 * @typeParam TArgs - The argument tuple to record.
 * @returns A recorder whose handler appends calls in order.
 */
export function createRecorder<
	TArgs extends readonly unknown[] = readonly unknown[],
>(): RecorderInterface<TArgs> {
	const calls: TArgs[] = []
	return {
		calls,
		get count() {
			return calls.length
		},
		handler(...args) {
			calls.push(args)
		},
		clear() {
			calls.length = 0
		},
	}
}

/**
 * Creates event recorders and subscribes them to the source.
 *
 * @typeParam TMap - The source's event names and delivered argument tuples.
 * @typeParam TName - The requested event names.
 * @param source - The source to subscribe to.
 * @param events - The events to record.
 * @returns A map from each requested event name to its recorder.
 * @remarks A duplicate event name installs a fresh recorder for every occurrence. The returned map
 * keeps the recorder installed for the last occurrence.
 */
export function createRecorders<
	TMap extends Record<string, readonly unknown[]>,
	TName extends keyof TMap,
>(source: EventSourceInterface<TMap>, events: readonly TName[]): RecorderMap<TMap, TName> {
	const entries = events.map((event) => {
		const recorder = createRecorder<TMap[typeof event]>()
		source.on(event, recorder.handler)
		return [event, recorder]
	})
	return Object.fromEntries(entries)
}

/**
 * Creates a real abort controller whose signal reports its live abort listeners.
 *
 * @returns The controller, its instrumented signal, and the current listener tally.
 * @remarks Instrumentation is installed on the created signal instance. A one-shot listener leaves
 * the tally when it fires, and removal accepts the original listener supplied by the caller.
 */
export function createSignal(): SignalInterface {
	const controller = new AbortController()
	const signal = controller.signal
	const add = signal.addEventListener.bind(signal)
	const remove = signal.removeEventListener.bind(signal)
	const registrations: Array<
		readonly [
			listener: EventListenerOrEventListenerObject,
			installed: EventListener,
			capture: boolean,
		]
	> = []

	Object.defineProperty(signal, 'addEventListener', {
		configurable: true,
		value(
			type: string,
			listener: EventListenerOrEventListenerObject | null,
			options?: boolean | AddEventListenerOptions,
		) {
			if (listener === null) return
			if (type !== 'abort') {
				add(type, listener, options)
				return
			}
			const capture = typeof options === 'boolean' ? options : (options?.capture ?? false)
			if (
				registrations.some(
					(registration) => registration[0] === listener && registration[2] === capture,
				)
			) {
				return
			}
			const once = typeof options === 'object' && options.once === true
			const installed: EventListener = (event) => {
				if (once) {
					const index = registrations.findIndex((registration) => registration[1] === installed)
					if (index >= 0) registrations.splice(index, 1)
				}
				if (typeof listener === 'function') listener.call(signal, event)
				else listener.handleEvent(event)
			}
			registrations.push([listener, installed, capture])
			add(type, installed, options)
		},
	})
	Object.defineProperty(signal, 'removeEventListener', {
		configurable: true,
		value(
			type: string,
			listener: EventListenerOrEventListenerObject | null,
			options?: boolean | EventListenerOptions,
		) {
			if (listener === null) return
			if (type !== 'abort') {
				remove(type, listener, options)
				return
			}
			const capture = typeof options === 'boolean' ? options : (options?.capture ?? false)
			const index = registrations.findIndex(
				(registration) => registration[0] === listener && registration[2] === capture,
			)
			const registration = registrations[index]
			if (registration === undefined) {
				remove(type, listener, options)
				return
			}
			registrations.splice(index, 1)
			remove(type, registration[1], options)
		},
	})

	return {
		controller,
		signal,
		get count() {
			return registrations.length
		},
	}
}

/**
 * Creates a monotonically numbered resource factory with creation and destruction records.
 *
 * @returns A resource factory whose recorders retain every affected id in order.
 */
export function createResourceFactory(): ResourceFactoryInterface {
	const created = createRecorder<readonly [id: number]>()
	const destroyed = createRecorder<readonly [id: number]>()
	return {
		created,
		destroyed,
		create() {
			const id = created.calls.length + 1
			created.handler(id)
			return id
		},
		destroy(id) {
			destroyed.handler(id)
		},
	}
}

/**
 * Creates a teardown list that runs registered handlers newest-first.
 *
 * @returns A teardown list that awaits every handler and collects failures.
 */
export function createTeardown(): TeardownInterface {
	let handlers: TeardownHandler[] = []
	return {
		get count() {
			return handlers.length
		},
		add(handler) {
			handlers.push(handler)
		},
		async destroy() {
			const snapshot = handlers
			handlers = []
			const failures: unknown[] = []
			for (const handler of snapshot.reverse()) {
				try {
					await handler()
				} catch (error) {
					failures.push(error)
				}
			}
			if (failures.length === 1) throw failures[0]
			if (failures.length > 1) throw new AggregateError(failures)
		},
	}
}
