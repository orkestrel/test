import { measureContent } from '@src/browser'
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
