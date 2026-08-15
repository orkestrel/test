import type { PortfolioInterface, PortfolioOptions } from './types.js'
import { page } from 'vitest/browser'
import { expandCaptures } from './helpers.js'

/**
 * Creates the capture portfolio one run places its screenshots through.
 *
 * @param options - The state registry, the variant matrix, the variant this run renders, the
 * directory it writes into, and whether it writes at all.
 * @returns The portfolio: its registry expansion, what it has placed, and `place`.
 * @throws When no registered variant carries the name `variant` names.
 *
 * @remarks
 * A disabled portfolio is the ordinary run. `place` then resizes nothing, writes nothing, and
 * records nothing, so a journey calls it unconditionally and a suite with the flag unset pays for
 * none of it. An enabled run refuses three things, and those refusals are what keep the registry
 * and the disk in agreement: an unregistered state name, a second placement of one state, and a
 * filename this portfolio already wrote.
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
	return {
		variant: options.variant,
		files,
		get states() {
			return [...placed]
		},
		get paths() {
			return [...paths]
		},
		async place(state) {
			if (!enabled) return undefined
			if (!registry.includes(state)) {
				throw new Error(`Capture state "${state}" is not registered`)
			}
			if (placed.includes(state)) {
				throw new Error(`Capture state "${state}" is already placed`)
			}
			const file = `${state}--${options.variant}.png`
			// The written-filename guard reads the placements rather than a second record of its own,
			// so the two can never disagree about what this run put on disk.
			if (expandCaptures(placed, [selected]).includes(file)) {
				throw new Error(`Capture file "${file}" is already written`)
			}
			selected.apply?.()
			if (window.innerWidth !== selected.width || window.innerHeight !== selected.height) {
				await page.viewport(selected.width, selected.height)
			}
			const written = await page.screenshot({ path: `${options.directory}/${file}` })
			placed.push(state)
			paths.push(written)
			return written
		},
	}
}
