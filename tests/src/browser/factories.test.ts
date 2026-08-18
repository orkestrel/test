import type { CaptureVariant } from '@src/browser'
import { createPortfolio } from '@src/browser'
import { createRecorder } from '@src/core'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { commands, page, server } from 'vitest/browser'

const STATES: readonly string[] = ['start-empty', 'answer-ideal']

const VARIANTS: readonly CaptureVariant[] = [
	{ name: 'light-1440', width: 1440, height: 1000 },
	{ name: 'dark-390', width: 390, height: 844 },
]

// Relative to this test file, which is where the provider resolves a screenshot path from. `tmp` is
// ignored by git, so a written portfolio never reaches a commit.
const DIRECTORY = '../../../tmp/capture/portfolio'

let width = 0
let height = 0

beforeAll(() => {
	width = window.innerWidth
	height = window.innerHeight
})

afterAll(async () => {
	await page.viewport(width, height)
})

describe('createPortfolio', () => {
	it('refuses a variant name the matrix does not carry', () => {
		expect(() =>
			createPortfolio({
				states: STATES,
				variants: VARIANTS,
				variant: 'dark-1440',
				directory: DIRECTORY,
			}),
		).toThrow('Capture variant "dark-1440" is not registered')
	})

	it('expands the registry across every variant whether or not the run writes', () => {
		const portfolio = createPortfolio({
			states: STATES,
			variants: VARIANTS,
			variant: 'dark-390',
			directory: DIRECTORY,
		})
		expect(portfolio.variant).toBe('dark-390')
		expect(portfolio.files).toStrictEqual([
			'start-empty--light-1440.png',
			'start-empty--dark-390.png',
			'answer-ideal--light-1440.png',
			'answer-ideal--dark-390.png',
		])
	})

	it('places nothing at all when the run is not enabled', async () => {
		const applied = createRecorder<[]>()
		const portfolio = createPortfolio({
			states: STATES,
			variants: [{ name: 'dark-390', width: 390, height: 844, apply: applied.handler }],
			variant: 'dark-390',
			directory: DIRECTORY,
		})
		await expect(portfolio.place('start-empty')).resolves.toBeUndefined()
		expect(applied.count).toBe(0)
		expect(portfolio.states).toStrictEqual([])
		expect(portfolio.paths).toStrictEqual([])
	})

	it('refuses a state the registry does not carry', async () => {
		const portfolio = createPortfolio({
			states: STATES,
			variants: VARIANTS,
			variant: 'dark-390',
			directory: DIRECTORY,
			enabled: true,
		})
		await expect(portfolio.place('answer-partial')).rejects.toThrow(
			'Capture state "answer-partial" is not registered',
		)
		expect(portfolio.states).toStrictEqual([])
	})

	it('applies the variant, resizes the viewport, writes the file, and records it', async () => {
		const applied = createRecorder<[]>()
		const portfolio = createPortfolio({
			states: STATES,
			variants: [{ name: 'dark-390', width: 390, height: 844, apply: applied.handler }],
			variant: 'dark-390',
			directory: DIRECTORY,
			enabled: true,
		})
		const before = portfolio.states
		const written = await portfolio.place('start-empty')
		const expected = `${server.config.root}/tmp/capture/portfolio/start-empty--dark-390.png`
		expect(applied.count).toBe(1)
		expect(window.innerWidth).toBe(390)
		expect(window.innerHeight).toBe(844)
		expect(written).toBe(expected)
		expect((await commands.readFile(expected)).length).toBeGreaterThan(0)
		expect(portfolio.states).toStrictEqual(['start-empty'])
		expect(portfolio.paths).toStrictEqual([expected])
		// The readers hand out snapshots, so a list read before a placement stays what it was.
		expect(before).toStrictEqual([])
	})

	it('refuses a second placement of one state', async () => {
		const portfolio = createPortfolio({
			states: STATES,
			variants: VARIANTS,
			variant: 'dark-390',
			directory: DIRECTORY,
			enabled: true,
		})
		await portfolio.place('answer-ideal')
		await expect(portfolio.place('answer-ideal')).rejects.toThrow(
			'Capture state "answer-ideal" is already placed',
		)
		expect(portfolio.states).toStrictEqual(['answer-ideal'])
		expect(portfolio.paths).toStrictEqual([
			`${server.config.root}/tmp/capture/portfolio/answer-ideal--dark-390.png`,
		])
	})
})
