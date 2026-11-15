import {
	measureContent,
	readClipHandler,
	releasePane,
	stagePane,
	takeFrameShot,
} from '@src/browser'
import { requireValue } from '@src/core'
import { expect, it } from 'vitest'
import { buildFixture, climbContentEdge, resetFixtures } from '../../../setupBrowser.js'

// The content edge cost of one `measureContent` call, at the DOM-growth populations the capture
// audit measured: chains of plain boxes, each holding a scroll frame and a paint-contained frame
// near its leaf. The per-element climb arm runs `climbContentEdge`, the reading the shipped
// measurement took before its clip bounds shared one memo. The two one-walk arms are identical
// sides that bracket it, so their gap is the run's own spread. Keep the one walk while the climb's
// gap to it is outside that spread and at least 10 ms per call at 3,201 elements, which a prepared
// frame pays twice. No gate collects this file; run it with
// `npx vitest bench --config vite.config.ts --project bench:browser --mode benchmark tests/src/browser/captures/helpers.bench.ts`.

it.for([
	{ chains: 400, depth: 8 },
	{ chains: 300, depth: 16 },
])(
	'reads the content edge cost over $chains chains $depth deep',
	{ timeout: 600_000 },
	async ({ chains, depth }, { bench }) => {
		const chain =
			'<div style="padding-bottom: 1px">'.repeat(depth - 3) +
			'<div style="overflow: auto; height: 400px"><div style="contain: paint">' +
			'<div style="height: 30px"></div></div></div>' +
			'</div>'.repeat(depth - 3)
		buildFixture(chain.repeat(chains))
		try {
			const climb = bench('per-element climb', () => climbContentEdge())
			expect(climb.fn?.()).toBe(measureContent())
			const result = await bench.compare(
				bench('one walk', () => measureContent()),
				climb,
				bench('one walk again', () => measureContent()),
				{ time: 2000, iterations: 30 },
			)
			const readings = (['one walk', 'per-element climb', 'one walk again'] as const).map(
				(name) => {
					const { latency } = result.get(name)
					return {
						name,
						mean: latency.mean,
						p50: latency.p50,
						mad: latency.mad,
						samples: latency.samplesCount,
					}
				},
			)
			console.log(
				`F2-BENCH ${JSON.stringify({ elements: document.body.querySelectorAll('*').length, depth, readings })}`,
			)
		} finally {
			resetFixtures()
		}
	},
)

// The cost of one frame shot of a staged card, through the element path and through the clip route
// the `shootClip` command opens. The two element-path sides are identical and bracket the clip
// route, so their gap is the run's own spread, and each round rotates the three sides so no side
// always runs first. Keep the clip route while its gap to the element path is outside that spread
// and at least 20 ms per frame, the bar the clip probe set before its first run, because 37 to 41 ms
// of an element shot is spent in the steps the clip route drops.
it(
	'reads the frame shot cost of the element path against the clip route',
	{
		timeout: 600_000,
	},
	async ({ bench }) => {
		const handler = requireValue(readClipHandler())
		const card = requireValue(
			buildFixture(
				'<article style="margin: 20px; padding: 16px; border: 1px solid rgb(30, 60, 90); background: rgb(250, 240, 230)">Quarterly orders shipped on schedule</article>',
			).querySelector('article'),
		)
		const options = { path: '../../../../tmp/capture/bench-shot.png', width: 390, height: 400 }
		try {
			await stagePane(390, 400)
			const rounds: Array<Readonly<Record<string, number>>> = []
			for (const turn of [0, 1, 2, 0, 1, 2]) {
				const sides = [
					bench('element path', async () => {
						await takeFrameShot(options, card)
					}),
					bench('clip route', async () => {
						await takeFrameShot(options, card, handler)
					}),
					bench('element path again', async () => {
						await takeFrameShot(options, card)
					}),
				]
				const result = await bench.compare(...sides.slice(turn), ...sides.slice(0, turn), {
					iterations: 5,
					time: 0,
					warmup: false,
				})
				rounds.push(
					Object.fromEntries(
						(['element path', 'clip route', 'element path again'] as const).map((name) => [
							name,
							result.get(name).latency.p50,
						]),
					),
				)
			}
			const medians = Object.fromEntries(
				['element path', 'clip route', 'element path again'].map((name) => {
					const sorted = rounds.map((round) => requireValue(round[name])).toSorted((a, b) => a - b)
					return [name, (requireValue(sorted[2]) + requireValue(sorted[3])) / 2]
				}),
			)
			expect(Object.values(medians).every((median) => Number.isFinite(median) && median > 0)).toBe(
				true,
			)
			console.log(`CLIP-BENCH ${JSON.stringify({ rounds, medians })}`)
		} finally {
			await releasePane()
			resetFixtures()
		}
	},
)
