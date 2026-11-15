import type { PortfolioInterface, PortfolioOptions } from './types.js'
import { requireValue } from '@src/core'
import { captureFrame, expandCaptures } from './helpers.js'

/**
 * Creates the capture portfolio one run places its screenshots through; a disabled run still refuses.
 *
 * @param options - The state registry, the one state it projects, the variant matrix, the variant
 * this run renders, the directory and scopes it writes into, and whether it writes at all.
 * @returns The portfolio: its registry expansion, what it has accepted and placed, and `place`.
 * @throws When no registered variant carries the name `variant` names, when the registry does not
 * carry the `state` option, and when `scope` names a scope that is not one path segment.
 *
 * @remarks
 * A disabled portfolio is the ordinary run. `place` then resizes nothing, writes nothing, and
 * records no placement, so a journey calls it unconditionally and a suite with the flag unset pays
 * for none of it. The portfolio refuses an unregistered variant at creation. Every run, enabled or not,
 * refuses an unregistered state name and a second placement of one state, so a wrong name fails the
 * ordinary run. `observed` lists every state `place` accepted, written or not, and `placements`
 * lists the ones it wrote, so a disabled run's `placements` stays empty.
 *
 * A `state` option projects the run onto one state: `place` writes that state and accepts every
 * other registered state unwritten. A `scope` handler writes each state under
 * `<directory>/<scope>/`, and `files` carries the same scope, as {@link expandCaptures} expands it.
 *
 * An enabled `place` writes through `captureFrame`, so a placed state carries that helper's staged
 * pane and its byte readback: a path is recorded only after the file on disk has been proved to hold
 * this run's own frame. The portfolio's `unrolled` option reaches every frame `place` writes. A
 * placement's `visible` option shoots the viewport at the scroll the journey reached, and an
 * unrolled portfolio refuses it through `captureFrame`.
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
	const projection = options.state
	if (projection !== undefined && !registry.includes(projection)) {
		throw new Error(`Capture state "${projection}" is not registered`)
	}
	const scope = options.scope
	const files = expandCaptures(registry, options.variants, scope)
	const enabled = options.enabled ?? false
	const observed: string[] = []
	const paths: string[] = []
	return {
		variant: options.variant,
		files,
		get observed() {
			return [...observed]
		},
		get placements() {
			return observed.filter(
				(state) => enabled && (projection === undefined || state === projection),
			)
		},
		get paths() {
			return [...paths]
		},
		async place(state, placement) {
			if (!registry.includes(state)) {
				throw new Error(`Capture state "${state}" is not registered`)
			}
			if (observed.includes(state)) {
				throw new Error(`Capture state "${state}" is already placed`)
			}
			if (!enabled || (projection !== undefined && state !== projection)) {
				observed.push(state)
				return undefined
			}
			const file = requireValue(expandCaptures([state], [selected], scope)[0])
			selected.apply?.()
			const written = await captureFrame({
				path: `${options.directory}/${file}`,
				width: selected.width,
				height: selected.height,
				element: placement?.element,
				visible: placement?.visible,
				unrolled: options.unrolled,
			})
			observed.push(state)
			paths.push(written)
			return written
		},
	}
}
