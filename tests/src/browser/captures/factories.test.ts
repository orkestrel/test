import type { CaptureVariant } from '@src/browser'
import { CAPTURE_PANE, createPortfolio, expandCaptures } from '@src/browser'
import { createRecorder, requireValue } from '@src/core'
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest'
import { commands, page, server } from 'vitest/browser'
import { rewriteWindowsAbsolutePath } from '../../../setup.js'
import { buildFixture, resetFixtures, STATES, VARIANTS } from '../../../setupBrowser.js'

// Relative to this test file, which is where the provider resolves a screenshot path from. `tmp` is
// ignored by git, so a written portfolio never reaches a commit.
const DIRECTORY = '../../../../tmp/capture/portfolio'

let width = 0

let height = 0

beforeAll(() => {
	width = window.innerWidth
	height = window.innerHeight
})

afterAll(async () => {
	await page.viewport(width, height)
})

afterEach(resetFixtures)

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
		expect(portfolio.placements).toStrictEqual([])
		expect(portfolio.paths).toStrictEqual([])
	})

	it('refuses a second placement of one state while the run is not enabled', async () => {
		const portfolio = createPortfolio({
			states: STATES,
			variants: VARIANTS,
			variant: 'dark-390',
			directory: DIRECTORY,
		})
		await expect(portfolio.place('answer-ideal')).resolves.toBeUndefined()
		await expect(portfolio.place('answer-ideal')).rejects.toThrow(
			'Capture state "answer-ideal" is already placed',
		)
		expect(portfolio.placements).toStrictEqual([])
		expect(portfolio.paths).toStrictEqual([])
	})

	it('refuses a state the registry does not carry while the run is not enabled', async () => {
		const portfolio = createPortfolio({
			states: STATES,
			variants: VARIANTS,
			variant: 'dark-390',
			directory: DIRECTORY,
		})
		await expect(portfolio.place('answer-partial')).rejects.toThrow(
			'Capture state "answer-partial" is not registered',
		)
		expect(portfolio.placements).toStrictEqual([])
	})

	it('accepts two distinct registered states while the run is not enabled', async () => {
		const portfolio = createPortfolio({
			states: STATES,
			variants: VARIANTS,
			variant: 'dark-390',
			directory: DIRECTORY,
		})
		await expect(portfolio.place('start-empty')).resolves.toBeUndefined()
		await expect(portfolio.place('answer-ideal')).resolves.toBeUndefined()
		expect(portfolio.placements).toStrictEqual([])
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
		expect(portfolio.placements).toStrictEqual([])
	})

	it('applies the variant, hands the viewport back, writes the file, and records it', async () => {
		const applied = createRecorder<[]>()
		const portfolio = createPortfolio({
			states: STATES,
			variants: [{ name: 'dark-390', width: 390, height: 844, apply: applied.handler }],
			variant: 'dark-390',
			directory: DIRECTORY,
			enabled: true,
		})
		const before = portfolio.placements
		const written = await portfolio.place('start-empty')
		// The provider returns the written path in its host's own separator, and the runner reports
		// its root with forward slashes on every host, so each side is compared through
		// `rewriteWindowsAbsolutePath` and the comparison reads the file rather than the separator.
		const expected = rewriteWindowsAbsolutePath(
			`${server.config.root}/tmp/capture/portfolio/start-empty--dark-390.png`,
		)
		expect(applied.count).toBe(1)
		// `place` shoots at the variant's viewport and `captureFrame` hands the tester back, so the
		// reading after it is the viewport this file started at rather than the variant's.
		expect(window.innerWidth).toBe(width)
		expect(window.innerHeight).toBe(height)
		expect(rewriteWindowsAbsolutePath(requireValue(written))).toBe(expected)
		expect((await commands.readFile(expected)).length).toBeGreaterThan(0)
		expect(portfolio.placements).toStrictEqual(['start-empty'])
		expect(portfolio.paths.map(rewriteWindowsAbsolutePath)).toStrictEqual([expected])
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
		expect(portfolio.placements).toStrictEqual(['answer-ideal'])
		expect(portfolio.paths.map(rewriteWindowsAbsolutePath)).toStrictEqual([
			rewriteWindowsAbsolutePath(
				`${server.config.root}/tmp/capture/portfolio/answer-ideal--dark-390.png`,
			),
		])
	})

	it('places one element rather than the page, and hands the staged pane back', async () => {
		const container = buildFixture(
			'<div style="background: #000; width: 40px; height: 40px">.</div>',
		)
		const pane = requireValue(window.frameElement?.parentElement)
		const whole = createPortfolio({
			states: STATES,
			variants: VARIANTS,
			variant: 'dark-390',
			directory: DIRECTORY,
			enabled: true,
		})
		const part = createPortfolio({
			states: STATES,
			variants: VARIANTS,
			variant: 'light-1440',
			directory: DIRECTORY,
			enabled: true,
		})
		const surface = await whole.place('start-empty')
		const element = await part.place('start-empty', requireValue(container.firstElementChild))
		expect(pane.hasAttribute(CAPTURE_PANE)).toBe(false)
		expect(rewriteWindowsAbsolutePath(requireValue(element))).toBe(
			rewriteWindowsAbsolutePath(
				`${server.config.root}/tmp/capture/portfolio/start-empty--light-1440.png`,
			),
		)
		const shot = await commands.readFile(requireValue(element), 'base64')
		expect(shot.length).toBeGreaterThan(0)
		expect(shot).not.toBe(await commands.readFile(requireValue(surface), 'base64'))
	})

	// guides/test.md → Patterns → "Place a capture portfolio". A browser fence carries in this
	// directory because the guides project runs with the browser disabled.
	it('answers what a full portfolio holds and what this run placed', async () => {
		const states: readonly string[] = ['start-empty', 'answer-ideal']
		const variants: readonly CaptureVariant[] = [
			{ name: 'light-1440', width: 1440, height: 1000 },
			{
				name: 'dark-390',
				width: 390,
				height: 844,
				apply: () => document.documentElement.setAttribute('data-theme', 'dark'),
			},
		]
		const portfolio = createPortfolio({
			states,
			variants,
			variant: 'dark-390',
			directory: '../../../../tmp/capture/states',
			// This example is an enabled capture run. A real suite supplies its own gate here.
			enabled: true,
		})
		try {
			// The registry times the variants, and the portfolio's own list is that same expansion, so
			// one declaration answers what a full portfolio holds and what this run placed alike.
			expect(expandCaptures(states, variants)).toHaveLength(4)
			expect(portfolio.files).toStrictEqual([
				'start-empty--light-1440.png',
				'start-empty--dark-390.png',
				'answer-ideal--light-1440.png',
				'answer-ideal--dark-390.png',
			])
			expect(portfolio.files).toStrictEqual(expandCaptures(states, variants))

			const written = await portfolio.place('start-empty')
			const expected = rewriteWindowsAbsolutePath(
				`${server.config.root}/tmp/capture/states/start-empty--dark-390.png`,
			)
			expect(document.documentElement.getAttribute('data-theme')).toBe('dark')
			expect(rewriteWindowsAbsolutePath(requireValue(written))).toBe(expected)
			expect((await commands.readFile(expected)).length).toBeGreaterThan(0)
			expect(portfolio.placements).toStrictEqual(['start-empty'])

			// A run that omits `enabled` returns undefined here, resizes nothing, and records nothing.
			// The preceding placement handed the viewport back and left the theme at what `dark-390`
			// selects, so a viewport and a theme that variant does not produce are staged before the
			// disabled call. The readings after it then answer for that call rather than for the one
			// before it.
			await page.viewport(320, 480)
			document.documentElement.removeAttribute('data-theme')
			expect(window.innerWidth).toBe(320)
			expect(window.innerHeight).toBe(480)

			const ordinary = createPortfolio({
				states,
				variants,
				variant: 'dark-390',
				directory: '../../../../tmp/capture/states',
			})
			await expect(ordinary.place('answer-ideal')).resolves.toBeUndefined()
			expect(window.innerWidth).toBe(320)
			expect(window.innerHeight).toBe(480)
			expect(document.documentElement.getAttribute('data-theme')).toBeNull()
			expect(ordinary.placements).toStrictEqual([])
			expect(ordinary.paths).toStrictEqual([])

			await expect(portfolio.place('answer-partial')).rejects.toThrow(
				'Capture state "answer-partial" is not registered',
			)
		} finally {
			document.documentElement.removeAttribute('data-theme')
		}
	})
})
