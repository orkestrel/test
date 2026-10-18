import type { PortfolioInterface, PortfolioOptions } from './types.js'
import { captureFrame, expandCaptures } from './helpers.js'

/**
 * Creates the capture portfolio one run places its screenshots through; a disabled run still refuses.
 *
 * @param options - The state registry, the variant matrix, the variant this run renders, the
 * directory it writes into, and whether it writes at all.
 * @returns The portfolio: its registry expansion, what it has placed, and `place`.
 * @throws When no registered variant carries the name `variant` names.
 *
 * @remarks
 * A disabled portfolio is the ordinary run. `place` then resizes nothing, writes nothing, and
 * records no placement, so a journey calls it unconditionally and a suite with the flag unset pays
 * for none of it. The portfolio refuses an unregistered variant at creation. Every run, enabled or not,
 * refuses an unregistered state name and a second placement of one state, so a wrong name fails the
 * ordinary run. A disabled run keeps the names it has seen apart from `placements`, which stays
 * empty.
 *
 * An enabled `place` writes through `captureFrame`, so a placed state carries that helper's staged
 * pane and its byte readback: a path is recorded only after the file on disk has been proved to hold
 * this run's own frame.
 *
 * @example
 * ```ts
 * const portfolio = createPortfolio({
 * 	states: ['start-empty'],
 * 	variants: [{ name: 'dark-390', width: 390, height: 844 }],
 * 	variant: 'dark-390',
 * 	directory: '../../tmp/capture/states',
 * })
 * await portfolio.place('start-empty')
 * ```
 */
export function createPortfolio(options: PortfolioOptions): PortfolioInterface {
	const selected = options.variants.find((candidate) => candidate.name === options.variant)
	if (selected === undefined) {
		throw new Error(`Capture variant "${options.variant}" is not registered`)
	}
	const registry = [...options.states]
	const files = expandCaptures(registry, options.variants)
	const enabled = options.enabled ?? false
	const placed: string[] = []
	const paths: string[] = []
	// The names a disabled run has been asked for, kept apart from `placed` so that list keeps
	// meaning "captured".
	const seen: string[] = []
	return {
		variant: options.variant,
		files,
		get placements() {
			return [...placed]
		},
		get paths() {
			return [...paths]
		},
		async place(state, element) {
			if (!registry.includes(state)) {
				throw new Error(`Capture state "${state}" is not registered`)
			}
			if (placed.includes(state) || seen.includes(state)) {
				throw new Error(`Capture state "${state}" is already placed`)
			}
			if (!enabled) {
				seen.push(state)
				return undefined
			}
			const file = `${state}--${options.variant}.png`
			selected.apply?.()
			const written = await captureFrame({
				path: `${options.directory}/${file}`,
				width: selected.width,
				height: selected.height,
				element,
			})
			placed.push(state)
			paths.push(written)
			return written
		},
	}
}
