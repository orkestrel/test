import type { StorageOptions } from './types.js'
import { buildDenial } from './helpers.js'

/** Owns permissions, values, and quota behind a Web Storage projection. */
export class WebStorage {
	readonly #values: Map<string, string>
	#reads: boolean
	#writes: boolean
	#room: number | undefined

	constructor(options: StorageOptions | undefined, quota: number | undefined) {
		this.#values = new Map(Object.entries(options?.values ?? {}))
		this.#reads = options?.reads ?? true
		this.#writes = options?.writes ?? true
		this.#room = quota
	}

	get length(): number {
		if (!this.#reads) throw buildDenial('length')
		return this.#values.size
	}

	permit(): void {
		this.#reads = true
		this.#writes = true
	}

	clear(): void {
		if (!this.#writes) throw buildDenial('clear')
		this.#values.clear()
	}

	getItem(key: string): string | null {
		if (!this.#reads) throw buildDenial('getItem', key)
		return this.#values.get(key) ?? null
	}

	key(index: number): string | null {
		if (!this.#reads) throw buildDenial('key')
		return [...this.#values.keys()][index] ?? null
	}

	removeItem(key: string): void {
		if (!this.#writes) throw buildDenial('removeItem', key)
		this.#values.delete(key)
	}

	setItem(key: string, value: string): void {
		if (!this.#writes) throw buildDenial('setItem', key)
		if (this.#room !== undefined) {
			if (this.#room === 0)
				throw new DOMException(`No room is left for ${key}`, 'QuotaExceededError')
			this.#room -= 1
		}
		this.#values.set(key, value)
	}
}
