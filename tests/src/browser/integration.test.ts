import {
	readAnimations,
	readStyle,
	releaseMedia,
	releasePane,
	settleCapture,
	stageMedia,
	stagePane,
} from '@src/browser'
import { requireValue } from '@src/core'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { page } from 'vitest/browser'
import {
	MOTION_CASES,
	MOTION_MARKUP,
	navigateMotion,
	resetFixtures,
	shootSettled,
} from '../../setupBrowser.js'

describe('a capture run that navigates under reduced motion and restores motion before the settle', () => {
	beforeEach(async () => {
		await stagePane(390, 844)
	})

	afterEach(async () => {
		resetFixtures()
		try {
			await releaseMedia()
		} finally {
			await releasePane()
		}
	})

	it.for(MOTION_CASES)(
		'shoots the frame a default-motion run shoots of the $fixture fixture',
		async ({ fixture, subject, property, full, reduced }) => {
			await stageMedia({ motion: true })
			const base = await navigateMotion(MOTION_MARKUP[fixture])
			expect(readStyle(requireValue(base.querySelector(subject)), property)).toBe(full)
			const expected = await shootSettled(base)
			await stageMedia({ motion: false })
			const stage = await navigateMotion(MOTION_MARKUP[fixture])
			const element = requireValue(stage.querySelector(subject))
			// The run navigated under the reduced-motion rule, so the restore has work to undo.
			expect(readStyle(element, property)).toBe(reduced)
			await stageMedia({ motion: true })
			expect(readStyle(element, property)).toBe(full)
			const actual = await shootSettled(stage)
			expect(actual === expected).toBe(true)
		},
	)

	it('shoots another frame of the rule fixture when the run settles under reduced motion without the restore', async () => {
		await stageMedia({ motion: true })
		const expected = await shootSettled(await navigateMotion(MOTION_MARKUP.rule))
		await stageMedia({ motion: false })
		const actual = await shootSettled(await navigateMotion(MOTION_MARKUP.rule))
		expect(actual === expected).toBe(false)
	})

	it('shoots another frame of the entrance fixture when the run restores motion after the settle, because the restore starts the entrance again', async () => {
		await stageMedia({ motion: true })
		const expected = await shootSettled(await navigateMotion(MOTION_MARKUP.entrance))
		await stageMedia({ motion: false })
		const stage = await navigateMotion(MOTION_MARKUP.entrance)
		const resume = await settleCapture({ budget: 2000 })
		try {
			await stageMedia({ motion: true })
			expect(readAnimations(stage).finite).toHaveLength(1)
			const actual = await page.screenshot({ element: stage, save: false })
			expect(actual === expected).toBe(false)
		} finally {
			resume()
		}
	})

	it('shoots another frame, even with the restore, where the page fixes a state at mount from the motion query', async () => {
		await stageMedia({ motion: true })
		const base = await navigateMotion(MOTION_MARKUP.mount)
		expect(base.dataset.motion).toBe('full')
		const expected = await shootSettled(base)
		await stageMedia({ motion: false })
		const stage = await navigateMotion(MOTION_MARKUP.mount)
		await stageMedia({ motion: true })
		expect(stage.dataset.motion).toBe('reduce')
		const actual = await shootSettled(stage)
		expect(actual === expected).toBe(false)
	})
})
