import {
	measureContent,
	readAnimations,
	readStyle,
	sendProtocol,
	waitForAnimations,
} from '@src/browser'
import { createRecorder, requireValue, waitForCondition, waitForDelay } from '@src/core'
import { describe, expect, expectTypeOf, it } from 'vitest'
import {
	buildFileFixture,
	buildFixture,
	buildStylesheet,
	climbContentEdge,
	inferPointerRestoration,
	POINTER_RESTORATION,
	readPointerMedia,
	recordStyleReads,
	resetFixtures,
	restartTransition,
	SETTLE_MARKUP,
	SETTLE_SHEET,
	skipUnrestoredPointer,
	startTransition,
	supportsPointerRestoration,
} from './setupBrowser.js'

describe('buildFileFixture', () => {
	it('builds two labeled native inputs and removes both with fixture cleanup', () => {
		const { input, other } = buildFileFixture()
		expect(input.type).toBe('file')
		expect(input.multiple).toBe(true)
		expect(other.type).toBe('file')
		expect(input.labels?.[0]?.textContent).toBe('Attachments')
		expect(other.labels?.[0]?.textContent).toBe('Other files')
		resetFixtures()
		expect(input.isConnected).toBe(false)
		expect(other.isConnected).toBe(false)
	})
})

// This proof runs in the `setup:browser` project, a browser project where a real DOM exists, so
// every case here drives that DOM directly rather than proving a Node fallback.
describe('resetFixtures', () => {
	it('returns without touching the DOM when no fixture was built', () => {
		expect(() => resetFixtures()).not.toThrow()
	})

	it('is idempotent on an already-empty record', () => {
		resetFixtures()
		expect(() => resetFixtures()).not.toThrow()
	})
})

describe('buildFixture', () => {
	it('renders markup into an attached container reachable by querySelector', () => {
		const container = buildFixture('<p data-testid="ready">Ready</p>')
		expect(document.body.contains(container)).toBe(true)
		expect(document.querySelector('[data-testid="ready"]')?.textContent).toBe('Ready')
		resetFixtures()
	})

	it('records the container so resetFixtures removes it', () => {
		const container = buildFixture('<p data-testid="tracked">Tracked</p>')
		resetFixtures()
		expect(document.body.contains(container)).toBe(false)
		expect(document.querySelector('[data-testid="tracked"]')).toBeNull()
	})
})

describe('buildStylesheet', () => {
	it('attaches a style element to document.head', () => {
		const sheet = buildStylesheet('.card { color: red }')
		expect(document.head.contains(sheet)).toBe(true)
		expect(sheet.tagName).toBe('STYLE')
		expect(sheet.textContent).toBe('.card { color: red }')
		resetFixtures()
	})

	it('records the style element so resetFixtures removes it', () => {
		const sheet = buildStylesheet('.badge { color: blue }')
		resetFixtures()
		expect(document.head.contains(sheet)).toBe(false)
	})
})

describe('startTransition', () => {
	it('starts the opacity transition, and the final listener grows the box once its end has been dispatched, beside the box no listener finalizes', async () => {
		buildStylesheet(SETTLE_SHEET)
		const final = requireValue(
			buildFixture(SETTLE_MARKUP.end).querySelector<HTMLElement>('.settle-end'),
		)
		const plain = requireValue(
			buildFixture(SETTLE_MARKUP.end).querySelector<HTMLElement>('.settle-end'),
		)
		try {
			startTransition(final, true)
			startTransition(plain, false)
			expect(
				[...readAnimations(final).finite, ...readAnimations(plain).finite].map((animation) =>
					animation instanceof CSSTransition ? animation.transitionProperty : animation.id,
				),
			).toStrictEqual(['opacity', 'opacity'])
			await waitForAnimations(document.body, { budget: 2000 })
			await waitForDelay(0)
			expect(final.getBoundingClientRect().height).toBe(60)
			expect(final.style.backgroundColor).toBe('rgb(0, 128, 0)')
			expect(plain.getBoundingClientRect().height).toBe(20)
			expect(plain.style.backgroundColor).toBe('')
		} finally {
			resetFixtures()
		}
	})

	it('restarts from a fresh fixture: the earlier stage is gone and the new box transitions toward its final listener', async () => {
		restartTransition()
		const earlier = requireValue(document.querySelector('.settle-end'))
		restartTransition()
		try {
			expect(earlier.isConnected).toBe(false)
			expect(document.querySelectorAll('.settle-end')).toHaveLength(1)
			const box = requireValue(document.querySelector<HTMLElement>('.settle-end'))
			expect(readAnimations(document.body).finite).toHaveLength(1)
			await waitForAnimations(document.body, { budget: 2000 })
			await waitForDelay(0)
			expect(box.getBoundingClientRect().height).toBe(60)
		} finally {
			resetFixtures()
		}
	})

	it('refuses a box that is not at full opacity, and starts nothing', () => {
		buildStylesheet(SETTLE_SHEET)
		const box = requireValue(
			buildFixture(SETTLE_MARKUP.end).querySelector<HTMLElement>('.settle-end'),
		)
		try {
			box.style.opacity = '0.5'
			expect(() => startTransition(box, true)).toThrow('Settle box must rest at full opacity')
			expect(readAnimations(box).finite).toStrictEqual([])
		} finally {
			resetFixtures()
		}
	})
})

describe('inferPointerRestoration', () => {
	it('reads a fine pointer as restored and a pointer of none as kept', () => {
		expect(inferPointerRestoration('fine')).toBe(true)
		expect(inferPointerRestoration('none')).toBe(false)
	})

	it('refuses a coarse reading and a reading that matches no pointer value', () => {
		expect(() => inferPointerRestoration('coarse')).toThrow(
			'Pointer media reads coarse after touch emulation ends, where fine or none was expected',
		)
		expect(() => inferPointerRestoration(undefined)).toThrow(
			'Pointer media reads no pointer value after touch emulation ends, where fine or none was expected',
		)
	})
})

describe('readPointerMedia', () => {
	it('reads coarse under touch emulation and the one value that matches after it ends', async () => {
		await sendProtocol('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 1 })
		try {
			await waitForCondition(
				'touch emulation reads coarse',
				() => matchMedia('(pointer: coarse)').matches,
			)
			expect(readPointerMedia()).toBe('coarse')
		} finally {
			await sendProtocol('Emulation.setTouchEmulationEnabled', { enabled: false })
		}
		await waitForCondition('touch emulation ends', () => !matchMedia('(pointer: coarse)').matches)
		const pointer = readPointerMedia()
		expect(['fine', 'none']).toContain(pointer)
		expect(matchMedia(`(pointer: ${String(pointer)})`).matches).toBe(true)
	})

	it('returns the closed set of pointer values, or undefined', () => {
		expectTypeOf(readPointerMedia).returns.toEqualTypeOf<'fine' | 'coarse' | 'none' | undefined>()
	})
})

describe('supportsPointerRestoration', () => {
	it('answers with the pointer the browser reads after touch emulation ends, and leaves it off', async () => {
		const restored = await supportsPointerRestoration()
		expect(matchMedia('(pointer: fine)').matches).toBe(restored)
		expect(matchMedia('(pointer: none)').matches).toBe(!restored)
		expect(navigator.maxTouchPoints).toBe(0)
	})
})

describe('climbContentEdge', () => {
	it('caps a row at the clip edge of the frame around it and adds the body padding under it', () => {
		buildStylesheet('body { margin: 0; padding-bottom: 7px }')
		const container = buildFixture(
			'<div style="height: 120px"></div>' +
				'<div style="overflow: hidden; height: 50px"><div style="height: 900px"></div></div>',
		)
		try {
			const top = container.getBoundingClientRect().top + window.scrollY
			// The 900-row child ends 850 rows under the frame's clip edge, so an uncapped climb reads
			// 1027 rows past the container's top rather than 177.
			expect(climbContentEdge()).toBe(Math.ceil(top + 120 + 50 + 7))
			expect(climbContentEdge()).toBe(measureContent())
		} finally {
			resetFixtures()
		}
	})
})

describe('recordStyleReads', () => {
	it('records the element of each computed-style read in call order, answered by the window', () => {
		const original = window.getComputedStyle
		const container = buildFixture('<p style="display: inline">First</p><p>Second</p>')
		try {
			const first = requireValue(container.firstElementChild)
			const second = requireValue(container.lastElementChild)
			const reads = recordStyleReads(() => {
				expect(readStyle(first, 'display')).toBe('inline')
				expect(readStyle(second, 'display')).toBe('block')
			})
			expect(reads).toStrictEqual([first, second])
			expect(window.getComputedStyle).toBe(original)
		} finally {
			resetFixtures()
		}
	})

	it('puts the window function back when the reading throws', () => {
		const original = window.getComputedStyle
		expect(() =>
			recordStyleReads(() => {
				throw new Error('The reading failed')
			}),
		).toThrow('The reading failed')
		expect(window.getComputedStyle).toBe(original)
	})
})

describe('skipUnrestoredPointer', () => {
	it('skips with the named mechanism exactly where no fine pointer returns', async () => {
		const skips = createRecorder<[condition: boolean, note?: string]>()
		await skipUnrestoredPointer({ skip: skips.handler })
		expect(skips.calls).toStrictEqual([
			[!matchMedia('(pointer: fine)').matches, POINTER_RESTORATION],
		])
	})
})
