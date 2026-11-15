import type { CaptureVariant } from '@src/browser'
import { CAPTURE_PANE, createPortfolio, expandCaptures, readFrame } from '@src/browser'
import { createRecorder, requireValue } from '@src/core'
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest'
import { commands, page, server } from 'vitest/browser'
import { rewriteWindowsAbsolutePath } from '../../../setup.js'
import {
	applyDarkTheme,
	BANDS_MARKUP,
	BANDS_SHEET,
	buildFixture,
	buildStylesheet,
	resetFixtures,
	SHELL_MARKUP,
	SHELL_SHEET,
	STATES,
	VARIANTS,
} from '../../../setupBrowser.js'

// Relative to this test file, which is where the provider resolves a screenshot path from. `tmp` is
// ignored by git, so a written portfolio never reaches a commit.
const DIRECTORY = '../../../../tmp/capture/portfolio'

const viewport = Promise.withResolvers<readonly [number, number]>()

beforeAll(() => {
	viewport.resolve([window.innerWidth, window.innerHeight])
})

afterAll(async () => {
	await page.viewport(...(await viewport.promise))
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
		expect(portfolio.observed).toStrictEqual(['start-empty'])
		expect(portfolio.placements).toStrictEqual([])
		expect(portfolio.paths).toStrictEqual([])
	})

	it('lists every state a disabled run accepts, in placement order, while placements stay empty', async () => {
		const portfolio = createPortfolio({
			states: STATES,
			state: 'answer-ideal',
			variants: VARIANTS,
			variant: 'dark-390',
			directory: DIRECTORY,
			scope: (state) => state.slice(0, state.indexOf('-')),
		})
		const before = portfolio.observed
		await expect(portfolio.place('answer-ideal')).resolves.toBeUndefined()
		await expect(portfolio.place('start-empty')).resolves.toBeUndefined()
		await expect(portfolio.place('start-empty')).rejects.toThrow(
			'Capture state "start-empty" is already placed',
		)
		expect(portfolio.observed).toStrictEqual(['answer-ideal', 'start-empty'])
		expect(portfolio.placements).toStrictEqual([])
		expect(portfolio.paths).toStrictEqual([])
		// The reader hands out a snapshot, so a list read before a placement stays what it was.
		expect(before).toStrictEqual([])
	})

	it('refuses a projected state the registry does not carry at creation', () => {
		expect(() =>
			createPortfolio({
				states: STATES,
				state: 'answer-partial',
				variants: VARIANTS,
				variant: 'dark-390',
				directory: DIRECTORY,
			}),
		).toThrow('Capture state "answer-partial" is not registered')
	})

	it.each(['', '.', '..', 'start/empty', 'start\\empty'])(
		'refuses a scope that is not one path segment at creation: %j',
		(scope) => {
			expect(() =>
				createPortfolio({
					states: STATES,
					variants: VARIANTS,
					variant: 'dark-390',
					directory: DIRECTORY,
					scope: () => scope,
				}),
			).toThrow(
				`Capture scope ${JSON.stringify(scope)} of state "start-empty" is not one path segment`,
			)
		},
	)

	it('writes each state under its scope and keeps placement order across interleaved scopes', async () => {
		const portfolio = createPortfolio({
			states: ['start-empty', 'answer-ideal', 'start-filled'],
			variants: VARIANTS,
			variant: 'dark-390',
			directory: DIRECTORY,
			enabled: true,
			scope: (state) => state.slice(0, state.indexOf('-')),
		})
		expect(portfolio.files).toStrictEqual([
			'start/start-empty--light-1440.png',
			'start/start-empty--dark-390.png',
			'answer/answer-ideal--light-1440.png',
			'answer/answer-ideal--dark-390.png',
			'start/start-filled--light-1440.png',
			'start/start-filled--dark-390.png',
		])
		await portfolio.place('start-filled')
		await portfolio.place('answer-ideal')
		await portfolio.place('start-empty')
		const expected = [
			'start/start-filled--dark-390.png',
			'answer/answer-ideal--dark-390.png',
			'start/start-empty--dark-390.png',
		].map((file) =>
			rewriteWindowsAbsolutePath(`${server.config.root}/tmp/capture/portfolio/${file}`),
		)
		expect(portfolio.placements).toStrictEqual(['start-filled', 'answer-ideal', 'start-empty'])
		expect(portfolio.observed).toStrictEqual(['start-filled', 'answer-ideal', 'start-empty'])
		expect(portfolio.paths.map(rewriteWindowsAbsolutePath)).toStrictEqual(expected)
		for (const path of expected) expect((await commands.readFile(path)).length).toBeGreaterThan(0)
	})

	it('writes only the projected state and accepts every other state unwritten', async () => {
		const applied = createRecorder<[]>()
		const portfolio = createPortfolio({
			states: STATES,
			state: 'answer-ideal',
			variants: [{ name: 'dark-390', width: 390, height: 844, apply: applied.handler }],
			variant: 'dark-390',
			directory: DIRECTORY,
			enabled: true,
			scope: (state) => state.slice(0, state.indexOf('-')),
		})
		await expect(portfolio.place('start-empty')).resolves.toBeUndefined()
		expect(applied.count).toBe(0)
		const written = await portfolio.place('answer-ideal')
		const expected = rewriteWindowsAbsolutePath(
			`${server.config.root}/tmp/capture/portfolio/answer/answer-ideal--dark-390.png`,
		)
		expect(applied.count).toBe(1)
		expect(rewriteWindowsAbsolutePath(requireValue(written))).toBe(expected)
		expect(portfolio.files).toStrictEqual([
			'start/start-empty--dark-390.png',
			'answer/answer-ideal--dark-390.png',
		])
		expect(portfolio.observed).toStrictEqual(['start-empty', 'answer-ideal'])
		expect(portfolio.placements).toStrictEqual(['answer-ideal'])
		expect(portfolio.paths.map(rewriteWindowsAbsolutePath)).toStrictEqual([expected])
		await expect(portfolio.place('start-empty')).rejects.toThrow(
			'Capture state "start-empty" is already placed',
		)
		await expect(portfolio.place('answer-partial')).rejects.toThrow(
			'Capture state "answer-partial" is not registered',
		)
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
		expect(portfolio.observed).toStrictEqual(['start-empty', 'answer-ideal'])
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
		const [width, height] = await viewport.promise
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
		expect(portfolio.observed).toStrictEqual(['start-empty'])
		expect(portfolio.paths.map(rewriteWindowsAbsolutePath)).toStrictEqual([expected])
		// The readers hand out snapshots, so a list read before a placement stays what it was.
		expect(before).toStrictEqual([])
	})

	it('hands its unrolled switch to every frame it places, beside a plain portfolio', async () => {
		buildStylesheet(SHELL_SHEET)
		buildFixture(SHELL_MARKUP)
		const plain = createPortfolio({
			states: STATES,
			variants: VARIANTS,
			variant: 'dark-390',
			directory: `${DIRECTORY}/plain`,
			enabled: true,
		})
		const unrolled = createPortfolio({
			states: STATES,
			variants: VARIANTS,
			variant: 'dark-390',
			directory: `${DIRECTORY}/unrolled`,
			enabled: true,
			unrolled: true,
		})
		const flat = await readFrame(requireValue(await plain.place('start-empty')))
		const whole = await readFrame(requireValue(await unrolled.place('start-empty')))
		expect(flat.height).toBe(844)
		// The shell's 60-row header over its twenty 100-row rows.
		expect(whole.height).toBe(2060)
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
		const element = await part.place('start-empty', {
			element: requireValue(container.firstElementChild),
		})
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

	it('places the viewport at the scroll the journey reached, beside a placement of the page', async () => {
		buildStylesheet(BANDS_SHEET)
		buildFixture(BANDS_MARKUP)
		const portfolio = createPortfolio({
			states: STATES,
			variants: VARIANTS,
			variant: 'dark-390',
			directory: `${DIRECTORY}/visible`,
			enabled: true,
		})
		await page.viewport(390, 844)
		window.scrollTo({ top: 600, behavior: 'instant' })
		const visible = await readFrame(
			requireValue(await portfolio.place('start-empty', { visible: true })),
		)
		const whole = await readFrame(requireValue(await portfolio.place('answer-ideal')))
		// Rows 600 to 1443: the yellow band ends the viewport; the page frame ends on purple.
		expect(visible).toStrictEqual({ width: 390, height: 844, floor: 'rgb(255, 255, 0)' })
		expect(whole).toStrictEqual({ width: 390, height: 2000, floor: 'rgb(128, 0, 128)' })
		expect(window.scrollY).toBe(600)
		expect(portfolio.placements).toStrictEqual(['start-empty', 'answer-ideal'])
	})

	it('refuses a visible placement in an unrolled portfolio, and records no placement', async () => {
		const portfolio = createPortfolio({
			states: STATES,
			variants: VARIANTS,
			variant: 'dark-390',
			directory: DIRECTORY,
			enabled: true,
			unrolled: true,
		})
		await expect(portfolio.place('start-empty', { visible: true })).rejects.toThrow(
			`Capture frame at ${DIRECTORY}/start-empty--dark-390.png is visible, so it takes neither an element nor unrolled`,
		)
		expect(portfolio.observed).toStrictEqual([])
		expect(portfolio.paths).toStrictEqual([])
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
				apply: applyDarkTheme,
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
