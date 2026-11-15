import type { PortfolioInterface, PortfolioOptions } from './types.js'
import { Portfolio } from './Portfolio.js'

/**
 * Creates the capture portfolio one run places its screenshots through; a disabled run still refuses.
 *
 * @param options - The state registry, the one state it projects, the variant matrix, the variant
 * this run renders, the directory and scopes it writes into, and whether it writes at all.
 * @returns The portfolio: its registry expansion, what it has accepted and placed, `place`, and
 * `view`.
 * @throws When no registered variant carries the name `variant` names, when the registry does not
 * carry the `state` option, and when `scope` names a scope that is not one path segment.
 *
 * @remarks
 * A disabled portfolio is the ordinary run. `place` and `view` then resize nothing, write nothing,
 * and record no placement, so a journey calls them unconditionally and a suite with the flag unset
 * pays for none of it. The portfolio refuses an unregistered variant at creation. Every run, enabled
 * or not, refuses an unregistered state name and a second placement of one state, so a wrong name
 * fails the ordinary run, and an unrolled portfolio refuses every `view` in every run, with the text
 * {@link describeUnrolledView} renders. A placement holds its state from before its first await
 * until it settles, so a concurrent placement of that state is refused as already placed, and a
 * placement that throws leaves its state unplaced. `observed` lists every state `place` and `view`
 * accepted, written or not, and `placements` lists the ones they wrote, so a disabled run's
 * `placements` stays empty.
 *
 * A `state` option projects the run onto one state: `place` and `view` write that state and accept
 * every other registered state unwritten. A `scope` handler writes each state under
 * `<directory>/<scope>/`, and `files` carries the same scope, as {@link expandCaptures} expands it.
 *
 * An enabled `place` writes through `captureFrame`, and an enabled `view` through
 * `captureViewport`, so a placed state carries that helper's staged pane and its byte readback: a
 * path is recorded only after the file on disk has been proved to hold this run's own frame. The
 * portfolio's `unrolled` option reaches every frame `place` writes. `view` shoots the declared
 * viewport at the scroll the journey reached.
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
	const portfolio = new Portfolio(options)
	return {
		variant: portfolio.variant,
		files: portfolio.files,
		get observed() {
			return portfolio.observed
		},
		get placements() {
			return portfolio.placements
		},
		get paths() {
			return portfolio.paths
		},
		place: portfolio.place.bind(portfolio),
		view: portfolio.view.bind(portfolio),
	}
}
