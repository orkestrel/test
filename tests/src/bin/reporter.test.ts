import { describe, expect, it } from 'vitest'
import { ProgressReporter } from '@src/server'
import reporter from '../../../src/bin/reporter.js'

describe('reporter entry', () => {
	it('exports the server barrel reporter class by default', () => {
		expect(reporter).toBe(ProgressReporter)
	})
})
