import type { TeardownHandler, TeardownInterface } from './types.js'

/** Owns the handlers behind a teardown projection. */
export class Teardown implements TeardownInterface {
	#handlers: TeardownHandler[] = []

	get count(): number {
		return this.#handlers.length
	}

	add(handler: TeardownHandler): void {
		this.#handlers.push(handler)
	}

	async destroy(): Promise<void> {
		const snapshot = this.#handlers
		this.#handlers = []
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
	}
}
