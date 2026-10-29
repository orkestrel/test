import { Production } from '../../../src/core/Production.js'
import { describe, expect, it } from 'vitest'

describe('Production', () => {
	it('distinguishes an unsettled attempt from an accepted or refused undefined', () => {
		const accepted = new Production<undefined>()
		expect(() => accepted.result).toThrow('Producer attempt has not settled')
		accepted.accept(undefined)
		expect(accepted.result).toEqual({ status: 'fulfilled', value: undefined })
		const refused = new Production<undefined>()
		refused.refuse(undefined)
		expect(refused.result).toEqual({ status: 'rejected', reason: undefined })
	})
})
