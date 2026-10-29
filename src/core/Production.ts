/** Holds one producer attempt across its native await and catch boundary. */
export class Production<T> {
	#result: Readonly<PromiseSettledResult<T>> | undefined

	get result(): Readonly<PromiseSettledResult<T>> {
		if (this.#result === undefined) throw new Error('Producer attempt has not settled')
		return this.#result
	}

	accept(value: T): void {
		this.#result = { status: 'fulfilled', value }
	}

	refuse(reason: unknown): void {
		this.#result = { status: 'rejected', reason }
	}
}
