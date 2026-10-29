import { createServer } from 'node:net'
import { Loopback } from '../../../src/server/Loopback.js'
import { describe, expect, it } from 'vitest'

describe('Loopback', () => {
	it('shares one shutdown promise and accepts an unstarted server', async () => {
		const server = createServer()
		const loopback = new Loopback(server)
		const first = loopback.destroy()
		expect(loopback.destroy()).toBe(first)
		await expect(first).resolves.toBeUndefined()
		expect(server.listening).toBe(false)
	})
})
