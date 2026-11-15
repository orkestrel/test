import {
	parkPointer,
	readAnimations,
	releasePane,
	releasePointer,
	settleCapture,
	stagePane,
	waitForAnimations,
	waitForFrame,
} from '@src/browser'
import { expect, it } from 'vitest'
import {
	buildFixture,
	buildStylesheet,
	resetFixtures,
	restartTransition,
	SETTLE_MARKUP,
	SETTLE_SHEET,
} from '../../../setupBrowser.js'

// The cost of one `settleCapture` call on the two fixtures where its frames are spent: a spinner the
// settle holds, and a transition whose end listener finalizes the box. The base arm transcribes the
// settle that painted a frame after the park and another before it returned. The arm without the
// yield transcribes the settle with neither frame and no task yield, so its gap to the shipped
// settle is the yield's own cost. The two shipped arms are identical sides that bracket the others,
// so their gap is the run's own spread. Keep the shipped settle while, on the held fixture, the base
// arm's mean exceeds it by more than that spread and by more than the two arms' median absolute
// deviations summed, and while, on the end fixture, it costs no more than the base arm beyond that
// spread; there the yield costs about one frame, so the two arms cost the same. A capture run pays
// the gain once per frame it places. No gate collects this
// file; run it with
// `npx vitest bench --config vite.config.ts --project bench:browser --mode benchmark --reporter=default tests/src/browser/journeys/helpers.bench.ts`.

it.for([{ fixture: 'held' }, { fixture: 'end' }])(
	'reads the settle cost on the $fixture fixture',
	{ timeout: 600_000 },
	async ({ fixture }, { bench }) => {
		await stagePane(390, 844)
		if (fixture === 'held') {
			buildStylesheet(SETTLE_SHEET)
			buildFixture(SETTLE_MARKUP.held)
		}
		try {
			const result = await bench.compare(
				bench(
					'shipped settle',
					fixture === 'end' ? { beforeEach: restartTransition } : {},
					async () => {
						const resume = await settleCapture({ budget: 2000 })
						resume()
					},
				),
				bench(
					'base settle',
					fixture === 'end' ? { beforeEach: restartTransition } : {},
					async () => {
						await parkPointer()
						await waitForFrame()
						await waitForAnimations(document.documentElement, { budget: 2000 })
						const held = readAnimations(document.documentElement).endless
						for (const animation of held) {
							animation.pause()
							animation.currentTime = 0
						}
						await waitForFrame()
						for (const animation of held) animation.play()
					},
				),
				bench(
					'settle without the yield',
					fixture === 'end' ? { beforeEach: restartTransition } : {},
					async () => {
						await parkPointer()
						await waitForAnimations(document.documentElement, { budget: 2000 })
						const held = readAnimations(document.documentElement).endless
						for (const animation of held) {
							animation.pause()
							animation.currentTime = 0
						}
						for (const animation of held) animation.play()
					},
				),
				bench(
					'shipped settle again',
					fixture === 'end' ? { beforeEach: restartTransition } : {},
					async () => {
						const resume = await settleCapture({ budget: 2000 })
						resume()
					},
				),
				{ time: 2000, iterations: 30 },
			)
			const readings = (
				[
					'shipped settle',
					'base settle',
					'settle without the yield',
					'shipped settle again',
				] as const
			).map((name) => {
				const { latency } = result.get(name)
				return {
					name,
					mean: latency.mean,
					p50: latency.p50,
					mad: latency.mad,
					samples: latency.samplesCount,
				}
			})
			expect(readings.every(({ mean, samples }) => Number.isFinite(mean) && samples > 0)).toBe(true)
			console.log(`SETTLE-BENCH ${JSON.stringify({ fixture, readings })}`)
		} finally {
			resetFixtures()
			await releasePointer()
			await releasePane()
		}
	},
)
