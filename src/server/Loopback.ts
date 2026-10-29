import type { Server } from 'node:net'
import { isFunction } from '@orkestrel/contract'

/** Owns the one shutdown promise behind a loopback projection. */
export class Loopback {
	readonly #server: Server
	#destruction: Promise<void> | undefined

	constructor(server: Server) {
		this.#server = server
	}

	destroy(): Promise<void> {
		this.#destruction ??= new Promise<void>((resolve, reject) => {
			if ('closeAllConnections' in this.#server && isFunction(this.#server.closeAllConnections)) {
				this.#server.closeAllConnections()
			}
			this.#server.close((error) => {
				if (error === undefined || ('code' in error && error.code === 'ERR_SERVER_NOT_RUNNING')) {
					resolve()
				} else {
					reject(error)
				}
			})
		})
		return this.#destruction
	}
}
