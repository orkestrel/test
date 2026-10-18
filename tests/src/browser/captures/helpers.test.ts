import {
	CAPTURE_PANE,
	captureFrame,
	clipsOverflow,
	computeOffset,
	expandCaptures,
	hoverAccessible,
	measureContent,
	MEDIA_STAGE,
	readClipEdge,
	readClipMargin,
	readFrame,
	readPixels,
	readStyle,
	releaseMedia,
	releasePane,
	releasePointer,
	resolveAccessible,
	sendProtocol,
	stageMedia,
	stagePane,
	waitForFrame,
	waitForStability,
} from '@src/browser'
import { createRecorder, requireValue, waitForCondition } from '@src/core'
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest'
import { commands, page, server } from 'vitest/browser'
import { rewriteWindowsAbsolutePath } from '../../../setup.js'
import {
	buildFixture,
	buildStylesheet,
	CLIP_CASES,
	CLIP_EDGE_CASES,
	CLIP_MARGIN_CASES,
	resetFixtures,
	VARIANTS,
} from '../../../setupBrowser.js'

// Relative to this test file, which is where the provider resolves a screenshot path from. `tmp` is
// ignored by git, so a written frame never reaches a commit.
const FRAMES = '../../../../tmp/capture/frame'

// The viewport the runner handed this file, restored after every test that stages a pane, so a
// resized tester never reaches the next test or the next file.
let width = 0

let height = 0

beforeAll(() => {
	width = window.innerWidth
	height = window.innerHeight
})

afterAll(async () => {
	await page.viewport(width, height)
})

afterEach(resetFixtures)

afterEach(releasePointer)

afterEach(releaseMedia)

describe('clipsOverflow', () => {
	it('reports a clipping or scrolling overflow and a paint containment, and nothing else', () => {
		for (const { style, clips } of CLIP_CASES) {
			const frame = requireValue(buildFixture(`<div style="${style}"></div>`).firstElementChild)
			expect({ style, clips: clipsOverflow(frame) }).toStrictEqual({ style, clips })
		}
	})
})

describe('readClipEdge', () => {
	it('reads the clip edge from the box the clip margin selects, the padding box by default', () => {
		for (const { style, edge } of CLIP_EDGE_CASES) {
			const container = buildFixture(
				`<div style="height: 400px; padding-bottom: 20px; border-bottom: 3px solid; ${style}"></div>`,
			)
			const frame = requireValue(container.firstElementChild)
			const top = frame.getBoundingClientRect().top + window.scrollY
			const read = readClipEdge(frame)
			expect({ style, edge: read === undefined ? undefined : read - top }).toStrictEqual({
				style,
				edge,
			})
		}
	})
})

describe('readClipMargin', () => {
	it('reads the clip margin of a clip overflow and of a paint containment, and nothing of the rest', () => {
		for (const { style, margin } of CLIP_MARGIN_CASES) {
			const frame = requireValue(buildFixture(`<div style="${style}"></div>`).firstElementChild)
			expect({ style, margin: readClipMargin(frame) }).toStrictEqual({ style, margin })
		}
	})
})

describe('measureContent', () => {
	// guides/test.md → Patterns → "Measure a document's content edge". A browser fence carries in
	// this directory because the guides project runs with the browser disabled.
	it('reads one content edge under a pane the document outruns and under a pane it does not', async () => {
		buildFixture('<div style="height: 1600px">Taller than the pane</div>')
		await stagePane(390, 844)
		const short = [measureContent(), document.documentElement.scrollHeight]
		await stagePane(390, 2356)
		const tall = [measureContent(), document.documentElement.scrollHeight]
		await releasePane()

		// The scroll height is the second reading of each pair, and it is what the content edge is
		// measured against: the two agree under the shorter pane, where the body's box is the
		// document's own height, and part company under the taller one, where the box is the pane.
		expect(short).toStrictEqual([1600, 1600])
		expect(tall).toStrictEqual([1600, 2356])
	})

	it('counts a trailing bottom margin and a bottom padding on the body', async () => {
		// The last element's own bottom margin sits outside its client rectangle, and the body's
		// bottom padding sits under every child, so a reading taken from rectangles alone stops 100
		// rows short of the document here.
		buildStylesheet('body { padding-bottom: 40px }')
		buildFixture('<div style="height: 1600px; margin-bottom: 60px">Trailing margin</div>')
		await stagePane(390, 844)
		const short = [measureContent(), document.documentElement.scrollHeight]
		await stagePane(390, 2356)
		const tall = measureContent()
		await releasePane()

		// 1600 rows of content, the child's 60-row bottom margin, and the body's 40-row bottom
		// padding. The scroll height agrees under the shorter pane, which is what makes 1700 the
		// document's own height rather than this helper's opinion of it.
		expect(short).toStrictEqual([1700, 1700])
		expect(tall).toBe(1700)
	})

	it('ends a clipped viewport-height child at its frame under every pane', async () => {
		// The child is as tall as the pane, so an unclipped reading would follow every staging up and
		// never settle; the frame clips it, and the reading ends at the frame's own edge, its bottom
		// border included, whatever the pane.
		buildFixture(
			'<div style="height: 400px; overflow: clip; border-bottom: 3px solid"><div style="height: 100vh">Clipped</div></div>',
		)
		await stagePane(390, 844)
		const short = measureContent()
		await stagePane(390, 2356)
		const tall = measureContent()
		await releasePane()

		expect([short, tall]).toStrictEqual([403, 403])
	})

	it('ends a child inside a paint-contained frame and inside a scroll container at that frame', async () => {
		buildFixture(
			'<div style="height: 300px; contain: paint"><div style="height: 100vh">Contained</div></div><div style="height: 200px; overflow: auto"><div style="height: 100vh">Scrolled</div></div>',
		)
		await stagePane(390, 844)
		const short = measureContent()
		await stagePane(390, 2356)
		const tall = measureContent()
		await releasePane()

		// The frames stack: 300 rows of the contained frame and 200 of the scroll container.
		expect([short, tall]).toStrictEqual([500, 500])
	})

	it('lets a clip margin show a clipped child past its frame by that margin', async () => {
		// A clip overflow with a clip margin shows 100 rows of the 600-row child past the 400-row
		// frame, so the document ends at 500 rather than at the frame's 400 or the child's 600.
		buildFixture(
			'<div style="height: 400px; overflow: clip; overflow-clip-margin: 100px"><div style="height: 600px">Margined</div></div>',
		)
		await stagePane(390, 844)
		const short = measureContent()
		await stagePane(390, 2356)
		const tall = measureContent()
		await releasePane()

		expect([short, tall]).toStrictEqual([500, 500])
	})

	it('expands a clip margin from the padding box rather than from the border box', async () => {
		// The 100-row clip margin grows from the frame's padding edge at row 400, so 100 rows of the
		// 600-row child show and the document ends at 500; grown from the border edge under the
		// 3-row bottom border, the reading would be 503.
		buildFixture(
			'<div style="height: 400px; border-bottom: 3px solid; overflow: clip; overflow-clip-margin: 100px"><div style="height: 600px">Bordered</div></div>',
		)
		await stagePane(390, 844)
		const short = measureContent()
		await stagePane(390, 2356)
		const tall = measureContent()
		await releasePane()

		expect([short, tall]).toStrictEqual([500, 500])
	})
})

describe('stagePane', () => {
	it('marks the pane, renders the tester at the viewport it was given, and releases both', async () => {
		const pane = requireValue(window.frameElement?.parentElement)
		const owner = pane.ownerDocument
		expect(pane.hasAttribute(CAPTURE_PANE)).toBe(false)
		await stagePane(390, 844)
		expect(pane.hasAttribute(CAPTURE_PANE)).toBe(true)
		expect(owner.querySelector(`style[${CAPTURE_PANE}]`)).not.toBeNull()
		const box = requireValue(window.frameElement).getBoundingClientRect()
		expect(Math.round(box.width)).toBe(390)
		expect(Math.round(box.height)).toBe(844)
		expect(window.innerWidth).toBe(390)
		await releasePane()
		expect(pane.hasAttribute(CAPTURE_PANE)).toBe(false)
		expect(owner.querySelector(`style[${CAPTURE_PANE}]`)).toBeNull()
	})

	it('hands the tester back the viewport it had before the staging', async () => {
		// Read rather than written out, so the case pins the hand-back itself instead of the size the
		// runner happens to start this file at.
		const before = [window.innerWidth, window.innerHeight]
		await stagePane(390, 844)
		expect([window.innerWidth, window.innerHeight]).toStrictEqual([390, 844])
		// A capture stages twice when the document outruns the pane, and the release owes the tester
		// the viewport it had before the first staging rather than the one the second left.
		await stagePane(390, 1200)
		expect([window.innerWidth, window.innerHeight]).toStrictEqual([390, 1200])
		await releasePane()
		expect([window.innerWidth, window.innerHeight]).toStrictEqual(before)
	})

	it('releases an unstaged pane without complaining', async () => {
		const pane = requireValue(window.frameElement?.parentElement)
		const before = [window.innerWidth, window.innerHeight]
		await releasePane()
		await releasePane()
		expect(pane.hasAttribute(CAPTURE_PANE)).toBe(false)
		expect([window.innerWidth, window.innerHeight]).toStrictEqual(before)
	})
})

describe('captureFrame', () => {
	it('keeps a viewport-bound sticky panel at its fitted native alignment', async () => {
		buildStylesheet(
			'html { scroll-padding-top: 55px }' +
				' .header { position: sticky; top: 0; height: 47px; background: rgb(255, 0, 0); z-index: 1 }' +
				' .layout { display: grid; grid-template-columns: 240px 1fr; padding-top: 24px }' +
				' .panel { position: sticky; top: 47px; max-height: calc(100dvh - 47px); overflow: auto; background: rgb(0, 128, 0) }' +
				' .panel h2 { margin: 0 }',
		)
		const container = buildFixture(
			'<div class="header">Header</div><div class="layout"><aside><div class="panel">' +
				'<div style="height: 1600px"><h2>Contents</h2></div></div></aside>' +
				'<main style="height: 3000px">Document</main></div>',
		)
		const element = requireValue(container.querySelector('.panel'))
		const before = [window.innerWidth, window.innerHeight, window.scrollY]
		await stagePane(1280, 800)
		element.scrollIntoView({ block: 'nearest', behavior: 'instant' })
		const nearest = element.getBoundingClientRect()
		element.scrollIntoView({ block: 'start', behavior: 'instant' })
		const aligned = element.getBoundingClientRect()
		element.scrollIntoView({ block: 'end', behavior: 'instant' })
		const end = element.getBoundingClientRect()
		await releasePane()
		window.scrollTo({ top: 0, behavior: 'instant' })
		expect([
			nearest.top,
			nearest.bottom,
			aligned.top,
			aligned.bottom,
			end.top,
			end.bottom,
		]).toStrictEqual([55, 808, 55, 808, 47, 800])
		const written = await captureFrame({
			path: `${FRAMES}/clearance-sticky.png`,
			width: 1280,
			height: 800,
			element,
		})
		const reading = await readFrame(written)
		expect([reading.width, reading.height]).toStrictEqual([240, 753])
		const image = new Image()
		image.src = `data:image/png;base64,${await commands.readFile(written, 'base64')}`
		await image.decode()
		const canvas = requireValue(new OffscreenCanvas(image.width, image.height).getContext('2d'))
		canvas.drawImage(image, 0, 0)
		expect([...canvas.getImageData(200, 5, 1, 1).data]).toStrictEqual([0, 128, 0, 255])
		expect([...canvas.getImageData(200, 751, 1, 1).data]).toStrictEqual([0, 128, 0, 255])
		expect([window.innerWidth, window.innerHeight, window.scrollY]).toStrictEqual(before)
	})

	it.each([
		{ height: 1600, clearance: '0px', margin: '0px', position: 'static' },
		{ height: 1600, clearance: 'calc(80px + 5.25px)', margin: '0px', position: 'static' },
		{ height: 843, clearance: '0px', margin: '0px', position: 'static' },
		{ height: 843, clearance: 'calc(80px + 5.25px)', margin: '0px', position: 'static' },
		{ height: 843, clearance: '0px', margin: 'calc(80px + 5.25px)', position: 'static' },
		{ height: 843, clearance: 'calc(80px + 5.25px)', margin: '25px', position: 'static' },
		{ height: 843, clearance: 'calc(80px + 5.25px)', margin: '0px', position: 'sticky' },
	])(
		'keeps a $height-pixel $position element below native scroll clearance $clearance and margin $margin in the written frame',
		async ({ height: extent, clearance, margin, position }) => {
			buildStylesheet(
				`html { scroll-padding-top: ${clearance} }` +
					' .cover { position: sticky; top: 0; height: 80px; background: rgb(255, 0, 0); z-index: 1 }' +
					` .subject { position: ${position}; height: ${String(extent)}px; scroll-margin-top: ${margin}; background: rgb(0, 128, 0) }` +
					' .subject h2 { position: sticky; top: 0; margin: 0 }',
			)
			const container = buildFixture(
				'<div class="cover">Header</div><div style="height: 300px">Above</div>' +
					'<div class="subject"><h2>Heading</h2></div><div style="height: 2000px">After</div>',
			)
			const element = requireValue(container.querySelector('.subject'))
			window.scrollTo({ top: 200, behavior: 'instant' })
			const before = [window.innerWidth, window.innerHeight, window.scrollY]
			const written = await captureFrame({
				path: `${FRAMES}/clearance-${String(extent)}-${String(clearance.length)}-${String(margin.length)}-${position}.png`,
				width: 390,
				height: 844,
				element,
			})
			expect(await readFrame(written)).toStrictEqual({
				width: 390,
				height: extent,
				floor: 'rgb(0, 128, 0)',
			})
			const image = new Image()
			image.src = `data:image/png;base64,${await commands.readFile(written, 'base64')}`
			await image.decode()
			const canvas = requireValue(new OffscreenCanvas(image.width, image.height).getContext('2d'))
			canvas.drawImage(image, 0, 0)
			// Read away from the heading's glyphs. With no authored clearance the sticky red
			// header remains in the shot: the camera must not hide or restyle an overlay.
			expect([...canvas.getImageData(380, 5, 1, 1).data]).toStrictEqual(
				clearance === '0px' && margin === '0px' ? [255, 0, 0, 255] : [0, 128, 0, 255],
			)
			expect([window.innerWidth, window.innerHeight, window.scrollY]).toStrictEqual(before)
		},
	)

	it('refuses native clearance that has not settled within the staging bound and restores the scroll', async () => {
		buildStylesheet('html { scroll-padding-top: 10% }')
		const container = buildFixture(
			'<div style="height: 400px">Above</div><div style="height: 1600px">Subject</div>' +
				'<div style="height: 2000px">After</div>',
		)
		window.scrollTo({ top: 200, behavior: 'instant' })
		const before = [window.innerWidth, window.innerHeight, window.scrollY]
		const frame = requireValue(window.frameElement)
		const style = frame.getAttribute('style')
		await expect(
			captureFrame({
				path: `${FRAMES}/clearance-growing.png`,
				width: 390,
				height: 844,
				element: requireValue(container.children[1]),
			}),
		).rejects.toThrow(
			`Capture frame at ${FRAMES}/clearance-growing.png never settled after 4 restagings`,
		)
		expect([window.innerWidth, window.innerHeight, window.scrollY]).toStrictEqual(before)
		expect(frame.getAttribute('style')).toBe(style)
		expect(requireValue(frame.parentElement).hasAttribute(CAPTURE_PANE)).toBe(false)
	})

	it('keeps a fixed element beyond a padded viewport at the declared viewport height', async () => {
		buildStylesheet(
			'html { scroll-padding-top: 85.25px }' +
				' .panel { position: fixed; top: 900px; left: 0; width: 100px; height: 10vh; background: rgb(0, 0, 255) }',
		)
		const container = buildFixture(
			'<div style="height: 3000px">Document</div><div class="panel">Fixed</div>',
		)
		window.scrollTo({ top: 200, behavior: 'instant' })
		const written = await captureFrame({
			path: `${FRAMES}/clearance-fixed.png`,
			width: 390,
			height: 844,
			element: requireValue(container.lastElementChild),
		})
		const reading = await readFrame(written)
		expect([reading.width, reading.height]).toStrictEqual([100, 85])
		expect(window.scrollY).toBe(200)
	})

	it('writes a real file, reads it back, and returns the verified absolute path', async () => {
		const written = await captureFrame({ path: `${FRAMES}/page.png`, width: 390, height: 844 })
		// The provider returns the written path in its host's own separator, and the runner reports
		// its root with forward slashes on every host, so each side is compared through
		// `rewriteWindowsAbsolutePath` and the comparison reads the file rather than the separator.
		expect(rewriteWindowsAbsolutePath(written)).toBe(
			rewriteWindowsAbsolutePath(`${server.config.root}/tmp/capture/frame/page.png`),
		)
		const onDisk = await commands.readFile(written, 'base64')
		expect(onDisk.length).toBeGreaterThan(0)
		// The negative control for the equality `captureFrame` asserts: bytes that are not this
		// frame's read back different, so the comparison discriminates rather than always holding.
		const planted = `${server.config.root}/tmp/capture/frame/planted.png`
		await commands.writeFile(planted, 'not a frame')
		expect(await commands.readFile(planted, 'base64')).not.toBe(onDisk)
	})

	it('refuses a pane that will not render at the viewport, and hands it back anyway', async () => {
		const pane = requireValue(window.frameElement?.parentElement)
		// The staging rule sizes the tester from the runner's own custom properties. A rule of higher
		// specificity, marked important, outranks it, so the pane renders at a size the viewport never
		// asked for and `stagePane` refuses instead of shooting a frame of the wrong surface.
		const pinned = pane.ownerDocument.createElement('style')
		pinned.textContent =
			'html iframe[data-vitest] { width: 200px !important; height: 200px !important }'
		pane.ownerDocument.head.append(pinned)
		try {
			await expect(
				captureFrame({ path: `${FRAMES}/refused.png`, width: 390, height: 844 }),
			).rejects.toThrow('Tester pane rendered 200x200 for a 390x844 viewport')
		} finally {
			pinned.remove()
		}
		expect(pane.hasAttribute(CAPTURE_PANE)).toBe(false)
		expect(pane.ownerDocument.querySelector(`style[${CAPTURE_PANE}]`)).toBeNull()
	})

	it('shoots one element rather than the page, and releases the pane either way', async () => {
		const container = buildFixture(
			'<div style="background: #000; width: 40px; height: 40px">.</div>',
		)
		const pane = requireValue(window.frameElement?.parentElement)
		const whole = await captureFrame({ path: `${FRAMES}/whole.png`, width: 390, height: 844 })
		const part = await captureFrame({
			path: `${FRAMES}/part.png`,
			width: 390,
			height: 844,
			element: requireValue(container.firstElementChild),
		})
		expect(pane.hasAttribute(CAPTURE_PANE)).toBe(false)
		const shot = await commands.readFile(part, 'base64')
		expect(shot.length).toBeGreaterThan(0)
		expect(shot).not.toBe(await commands.readFile(whole, 'base64'))
	})

	it('covers a document taller than the pane, down to its last row and no further', async () => {
		// The background is declared on the root element, so the browser paints it across the whole
		// canvas the document owns rather than across a box inside it. Everything the frame holds
		// beyond that canvas is the runner's own page, which is white, so the bottom row is what
		// separates a covered document from a clipped one.
		//
		// The height is an equality against the fixture's own declared 1600, not a floor. A frame
		// taller than the document is rows nothing in the document asked for, and it paints the same
		// floor as a covered one because the root's background covers the whole canvas the pane
		// stretched — so `toBeGreaterThanOrEqual` reads a 2356-row frame as coverage.
		buildStylesheet('html { background: rgb(0, 128, 0) }')
		buildFixture('<div style="height: 1600px">Taller than the pane</div>')

		const written = await captureFrame({ path: `${FRAMES}/tall.png`, width: 390, height: 844 })
		const reading = await readFrame(written)
		expect(reading.width).toBe(390)
		expect(reading.height).toBe(1600)
		expect(reading.floor).toBe('rgb(0, 128, 0)')
	})

	it('settles a document whose height converges under a viewport-bound rule', async () => {
		// `min-height: 50vh` plus a fixed 900-row block is a document whose height is half the pane
		// plus 900, so it converges on 1800 and never reaches it by restaging at the height last
		// read: each staging closes half the remaining gap. The two readings below are that
		// approach measured — 1322 under the declared pane, 1561 under a pane staged at 1322 — so a
		// fixture that stops converging reddens here rather than passing on a document that settles
		// on its own.
		buildStylesheet('html { background: rgb(0, 128, 0) } .half { min-height: 50vh }')
		buildFixture('<div class="half">Half</div><div style="height: 900px">Beyond</div>')
		await stagePane(390, 844)
		const first = document.documentElement.scrollHeight
		await stagePane(390, first)
		const second = document.documentElement.scrollHeight
		await releasePane()
		expect([first, second]).toStrictEqual([1322, 1561])

		const written = await captureFrame({
			path: `${FRAMES}/converging.png`,
			width: 390,
			height: 844,
		})
		const reading = await readFrame(written)
		expect(reading.width).toBe(390)
		// 900 fixed rows over a rule that keeps half the pane: the fixed point is 900 / (1 - 1/2),
		// written out rather than read back from the capture that staged it.
		expect(reading.height).toBe(1800)
		expect(reading.floor).toBe('rgb(0, 128, 0)')
	})

	it('shoots a document shorter than the pane at the pane height, on the same floor', async () => {
		buildStylesheet('html { background: rgb(0, 128, 0) }')
		buildFixture('<div style="height: 40px">Shorter than the pane</div>')
		const written = await captureFrame({ path: `${FRAMES}/short.png`, width: 390, height: 844 })
		const reading = await readFrame(written)
		expect(reading.width).toBe(390)
		expect(reading.height).toBe(844)
		expect(reading.floor).toBe('rgb(0, 128, 0)')
	})

	it('covers a body whose box ends on a fraction of a pixel', async () => {
		// The provider clips the shot to the body's own box, and that box can end part way through a
		// row. `scrollHeight` is an integer, so a box ending on a fraction under a half reads back a
		// row short and a pane staged from that reading leaves the last row to the runner's page.
		// The rounding is what the case turns on, so it is measured under the staged pane rather
		// than assumed: a browser that rounds the other way reddens here instead of passing quietly.
		buildStylesheet('html { background: rgb(0, 128, 0) }')
		buildFixture('<div style="height: 1600px; padding-bottom: 0.25px">Fractional</div>')
		await stagePane(390, 844)
		const box = document.body.getBoundingClientRect().height
		const rounded = document.documentElement.scrollHeight
		await releasePane()
		expect(rounded).toBeLessThan(Math.ceil(box))

		const written = await captureFrame({ path: `${FRAMES}/fraction.png`, width: 390, height: 844 })
		const reading = await readFrame(written)
		expect(reading.width).toBe(390)
		expect(reading.height).toBeGreaterThanOrEqual(Math.ceil(box))
		expect(reading.floor).toBe('rgb(0, 128, 0)')
	})

	it('re-reads the document after the pane grows, and covers what the reflow added', async () => {
		// A rule bound to the viewport height lays the document out taller against the taller pane,
		// so the height read before the restaging is already stale when the shot is taken. The media
		// query caps that growth, which is what makes this the re-reading case rather than the
		// refusal below. The height before the reflow and the height after it are measured here, so
		// a fixture that stops reflowing reddens rather than passing on a document that never moved.
		buildStylesheet(
			'html { background: rgb(0, 128, 0) } .grow { min-height: 100vh }' +
				' @media (min-height: 900px) { .grow { min-height: 900px } }',
		)
		buildFixture('<div class="grow">Full height</div><div style="height: 200px">Beyond</div>')
		await stagePane(390, 844)
		const first = document.documentElement.scrollHeight
		await stagePane(390, first)
		const reflowed = document.documentElement.scrollHeight
		await releasePane()
		expect(first).toBeGreaterThan(844)
		expect(reflowed).toBeGreaterThan(first)

		const written = await captureFrame({ path: `${FRAMES}/reflow.png`, width: 390, height: 844 })
		const reading = await readFrame(written)
		expect(reading.width).toBe(390)
		expect(reading.height).toBeGreaterThanOrEqual(reflowed)
		expect(reading.floor).toBe('rgb(0, 128, 0)')
	})

	it.each(['0px', 'calc(80px + 5.25px)'])(
		'shoots a fixed viewport-height panel at the declared pane under clearance %s and hands the scroll back',
		async (clearance) => {
			// The panel is 30% of whatever pane it sits in, and the document under it is taller than the
			// declared pane, so a pane staged to the document's height lays the panel out taller. The
			// declared height is read from the runner's window and is a multiple of 10, so the panel's
			// 30% and its top at 70% are whole rows, its top lies at least 70 rows past that window, and
			// the panel itself fits inside the window on any host. The declared width is read from the
			// window too, so the panel fits across it. The shot then depends on the offset
			// and on the compositing that keeps a fixed element past the window from being culled.
			const declared = 10 * Math.ceil((requireValue(window.top).innerHeight + 100) / 7)
			const across = Math.min(390, requireValue(window.top).innerWidth)
			buildStylesheet(
				`html { background: rgb(0, 128, 0); scroll-padding-top: ${clearance} }` +
					' .panel { position: fixed; left: 0; right: 0; bottom: 0; height: 30vh; background: rgb(0, 0, 255) }',
			)
			const container = buildFixture(
				`<div style="height: ${String(declared + 2000)}px">Taller than the pane</div><div class="panel">Panel</div>`,
			)
			window.scrollTo({ top: 400, left: 0, behavior: 'instant' })
			expect(window.scrollY).toBe(400)

			const written = await captureFrame({
				path: `${FRAMES}/panel.png`,
				width: across,
				height: declared,
				element: requireValue(container.lastElementChild),
			})
			const reading = await readFrame(written)
			expect(reading.width).toBe(across)
			expect(reading.height).toBe((declared * 3) / 10)
			// The panel's own color on the bottom row is what separates a shot of the panel from a shot
			// of the document behind it or of the runner's page.
			expect(reading.floor).toBe('rgb(0, 0, 255)')
			expect(window.scrollY).toBe(400)
		},
	)

	it('shoots an element that ends below the declared pane whole, on the document floor', async () => {
		// The element starts below the declared pane, and the declared pane is 200 rows taller than
		// the runner's window, which is read rather than assumed. The scroll brings the element to
		// the pane's bottom, which still lies past the window, so the shot needs the offset on any
		// host. The declared width is read from the window too, so the element fits across it. It paints no background of its own, so its bottom row is the document's green where
		// the shot covers it and the runner's white where it does not.
		const declared = Math.max(844, requireValue(window.top).innerHeight + 200)
		const across = Math.min(390, requireValue(window.top).innerWidth)
		buildStylesheet('html { background: rgb(0, 128, 0) }')
		const container = buildFixture(
			`<div style="height: ${String(declared + 400)}px">Above</div><div style="height: 100px">Below</div><div style="height: 400px">After</div>`,
		)
		window.scrollTo({ top: 200, left: 0, behavior: 'instant' })
		expect(window.scrollY).toBe(200)

		const written = await captureFrame({
			path: `${FRAMES}/below.png`,
			width: across,
			height: declared,
			element: requireValue(container.children[1]),
		})
		const reading = await readFrame(written)
		expect(reading.width).toBe(across)
		expect(reading.height).toBe(100)
		expect(reading.floor).toBe('rgb(0, 128, 0)')
		expect(window.scrollY).toBe(200)
	})

	it.each(['0px', 'calc(80px + 5.25px)'])(
		'shoots a viewport-height element below the fold at the declared pane under clearance %s',
		async (clearance) => {
			// Half of the declared 844 rows is 422. A pane grown to reach the element's bottom edge lays
			// the element out at half of that taller pane instead.
			buildStylesheet(
				`html { background: rgb(0, 128, 0); scroll-padding-top: ${clearance} } .probe { height: 50vh; background: rgb(0, 0, 255) }`,
			)
			const container = buildFixture(
				'<div style="height: 900px">Above</div><div class="probe">Half</div>',
			)

			const written = await captureFrame({
				path: `${FRAMES}/half.png`,
				width: 390,
				height: 844,
				element: requireValue(container.lastElementChild),
			})
			const reading = await readFrame(written)
			expect(reading.width).toBe(390)
			expect(reading.height).toBe(422)
			expect(reading.floor).toBe('rgb(0, 0, 255)')
		},
	)

	it('shoots a 30vh element below the fold at the declared pane under either spacer', async () => {
		// 30% of the declared 844 rows is 253.2, and the frame holds the part row too. A pane grown
		// to reach this element's bottom edge chases an edge that moves with every pane, and the
		// capture is refused instead.
		buildStylesheet(
			'html { background: rgb(0, 128, 0) } .probe { height: 30vh; background: rgb(0, 0, 255) }',
		)
		const heights: number[] = []
		for (const spacer of [900, 1000]) {
			const container = buildFixture(
				`<div style="height: ${String(spacer)}px">Above</div><div class="probe">Share</div>`,
			)
			const written = await captureFrame({
				path: `${FRAMES}/share-${String(spacer)}.png`,
				width: 390,
				height: 844,
				element: requireValue(container.lastElementChild),
			})
			heights.push((await readFrame(written)).height)
			container.remove()
		}
		expect(heights).toStrictEqual([254, 254])
	})

	it('shoots an element taller than the declared pane in a pane of its own height', async () => {
		// The element is a 1000-row block over a 10vh strip, so its height is 1000 rows plus a
		// tenth of the pane it sits in. In a pane of its own height that settles at 1000 / 0.9, which
		// is 1111.1 rows, and the frame holds the part row too. A pane that also reaches the 300
		// rows above the element lays the strip out taller. The part row is the frame's bottom row,
		// so the floor is not the strip's own color and the height is the reading.
		buildStylesheet(
			'html { background: rgb(0, 128, 0) } .strip { height: 10vh; background: rgb(0, 0, 255) }',
		)
		const container = buildFixture(
			'<div style="height: 300px">Above</div><div><div style="height: 1000px">Block</div><div class="strip">Strip</div></div><div style="height: 300px">After</div>',
		)

		const written = await captureFrame({
			path: `${FRAMES}/tall-element.png`,
			width: 390,
			height: 844,
			element: requireValue(container.children[1]),
		})
		const reading = await readFrame(written)
		expect(reading.width).toBe(390)
		expect(reading.height).toBe(1112)
	})

	it('refuses an element that outgrows every pane, and hands the pane and the scroll back', async () => {
		// The fixed element is one and a half panes tall, so a pane of its own height is always too
		// short for it. The document under it is 1400 rows, so the panes the capture stages outgrow
		// it and clamp the scroll to the top before the refusal.
		buildStylesheet('.over { position: fixed; top: 0; left: 0; right: 0; height: 150vh }')
		const container = buildFixture(
			'<div style="height: 1400px">Document</div><div class="over">Over</div>',
		)
		const pane = requireValue(window.frameElement?.parentElement)
		const before = [window.innerWidth, window.innerHeight]
		window.scrollTo({ top: 100, left: 0, behavior: 'instant' })
		expect(window.scrollY).toBe(100)

		await expect(
			captureFrame({
				path: `${FRAMES}/over.png`,
				width: 390,
				height: 844,
				element: requireValue(container.lastElementChild),
			}),
		).rejects.toThrow(`Capture frame at ${FRAMES}/over.png never settled after 4 restagings`)
		expect(pane.hasAttribute(CAPTURE_PANE)).toBe(false)
		expect([window.innerWidth, window.innerHeight]).toStrictEqual(before)
		expect(window.scrollY).toBe(100)
	})

	it('offsets only the calling tester frame, and hands its style back', async () => {
		// A second frame the staging selector matches stands in for any other `iframe[data-vitest]`
		// frame. An offset that reached it would move it above the window's origin, where nothing
		// else puts it. A reading is taken at every change to the runner page, which includes the
		// change that applies the offset. The declared pane is 200 rows taller than the runner's
		// window, so the element the scroll brings to the pane's bottom needs the offset on any host.
		const frame = requireValue(window.frameElement)
		const owner = frame.ownerDocument
		const style = frame.getAttribute('style')
		const other = owner.createElement('iframe')
		// It carries another value because the provider's locator refuses a second `true` frame.
		other.setAttribute('data-vitest', 'earlier')
		owner.body.append(other)
		const readings: Array<[calling: number, other: number]> = []
		const observer = new MutationObserver(() => {
			readings.push([frame.getBoundingClientRect().top, other.getBoundingClientRect().top])
		})
		observer.observe(owner, { subtree: true, childList: true, attributes: true })
		const declared = Math.max(844, requireValue(window.top).innerHeight + 200)
		const across = Math.min(390, requireValue(window.top).innerWidth)
		const container = buildFixture(
			`<div style="height: ${String(declared + 400)}px">Above</div><div style="height: 100px">Below</div>`,
		)
		try {
			await captureFrame({
				path: `${FRAMES}/scoped.png`,
				width: across,
				height: declared,
				element: requireValue(container.lastElementChild),
			})
		} finally {
			observer.disconnect()
			other.remove()
		}
		// The calling frame moving is the control that a reading was taken under the offset.
		expect(Math.min(...readings.map(([calling]) => calling))).toBeLessThan(0)
		expect(readings.map(([, reading]) => reading).filter((reading) => reading < 0)).toStrictEqual(
			[],
		)
		expect(frame.getAttribute('style')).toBe(style)
	})

	it('hands back a frame that carried no style attribute without one', async () => {
		// The runner writes an inline style on every tester frame it creates, so this case takes the
		// attribute off first and puts it back after, to reach the restore that removes the
		// attribute rather than rewriting it.
		const frame = requireValue(window.frameElement)
		const style = frame.getAttribute('style')
		const declared = Math.max(844, requireValue(window.top).innerHeight + 200)
		const across = Math.min(390, requireValue(window.top).innerWidth)
		const container = buildFixture(
			`<div style="height: ${String(declared + 400)}px">Above</div><div style="height: 100px">Below</div>`,
		)
		frame.removeAttribute('style')
		try {
			await captureFrame({
				path: `${FRAMES}/unstyled.png`,
				width: across,
				height: declared,
				element: requireValue(container.lastElementChild),
			})
			expect(frame.hasAttribute('style')).toBe(false)
		} finally {
			if (style !== null) frame.setAttribute('style', style)
		}
	})

	it('takes no mouseover from the parked pointer for a flush-left element the scroll brings to the top', async () => {
		// The element opens the document and the tester is scrolled past it, so the scroll that
		// brings it back into the pane puts its corner on the runner page's origin, beside the
		// pointer parked outside the viewport.
		await releasePointer()
		const container = buildFixture(
			'<div style="height: 100px">Target</div><div style="height: 3000px">After</div>',
		)
		window.scrollTo({ top: 1000, left: 0, behavior: 'instant' })
		expect(window.scrollY).toBe(1000)
		const element = requireValue(container.firstElementChild)
		const entered = createRecorder<[event: Event]>()
		element.addEventListener('mouseover', entered.handler)

		const written = await captureFrame({
			path: `${FRAMES}/scrolled-corner.png`,
			width: 390,
			height: 844,
			element,
		})
		await waitForFrame()
		expect(entered.count).toBe(0)
		expect((await readFrame(written)).height).toBe(100)
	})

	it('takes no mouseover from the parked pointer for an element the offset brings to the left edge', async () => {
		// The declared pane is twice as wide as the runner's window, which is read rather than
		// assumed, and the fixed element fills the pane's right half, so the offset that brings it
		// inside the window puts its corner on the runner page's origin, beside the parked pointer.
		await releasePointer()
		const across = requireValue(window.top).innerWidth
		buildStylesheet(
			`.edge { position: fixed; top: 0; left: ${String(across)}px; width: ${String(across)}px; height: 100px }`,
		)
		const container = buildFixture('<div class="edge">Edge</div>')
		const element = requireValue(container.firstElementChild)
		const entered = createRecorder<[event: Event]>()
		element.addEventListener('mouseover', entered.handler)

		const written = await captureFrame({
			path: `${FRAMES}/offset-corner.png`,
			width: across * 2,
			height: 844,
			element,
		})
		await waitForFrame()
		expect(entered.count).toBe(0)
		const reading = await readFrame(written)
		expect([reading.width, reading.height]).toStrictEqual([across, 100])
	})

	it('takes no mouseover from the parked pointer for a flush-left element too large for the runner window', async () => {
		// The element opens the document and is taller than the runner's window, which is read
		// rather than assumed, so the provider shoots it beyond the viewport without an offset. The
		// tester is scrolled past the element first, so the scroll that brings it back puts its
		// corner on the runner page's origin, beside the parked pointer.
		await releasePointer()
		const tall = requireValue(window.top).innerHeight + 200
		const container = buildFixture(
			`<div style="height: ${String(tall)}px">Tall</div><div style="height: 3000px">After</div>`,
		)
		window.scrollTo({ top: 1000, left: 0, behavior: 'instant' })
		expect(window.scrollY).toBe(1000)
		const element = requireValue(container.firstElementChild)
		const entered = createRecorder<[event: Event]>()
		element.addEventListener('mouseover', entered.handler)

		const written = await captureFrame({
			path: `${FRAMES}/tall-corner.png`,
			width: 390,
			height: 844,
			element,
		})
		await waitForFrame()
		expect(entered.count).toBe(0)
		expect((await readFrame(written)).height).toBe(tall)
	})

	it.each(['0px', 'calc(80px + 5.25px)'])(
		'takes no mouseover or scroll event for an element inside the runner window under clearance %s',
		async (clearance) => {
			// An element inside both the pane and the window needs neither a scroll nor an offset, so
			// the capture moves nothing and the document is not scrolled. The document runs on well past
			// the pane, so a scroll the capture took would move it and fire an event.
			await releasePointer()
			buildStylesheet(`html { scroll-padding-top: ${clearance} }`)
			const container = buildFixture(
				'<div style="height: 100px">Above</div><div style="height: 100px">Resting</div><div style="height: 3000px">After</div>',
			)
			const element = requireValue(container.children[1])
			const entered = createRecorder<[event: Event]>()
			const scrolled = createRecorder<[event: Event]>()
			element.addEventListener('mouseover', entered.handler)
			window.addEventListener('scroll', scrolled.handler)
			try {
				await captureFrame({ path: `${FRAMES}/resting.png`, width: 390, height: 844, element })
				await waitForFrame()
			} finally {
				window.removeEventListener('scroll', scrolled.handler)
			}
			expect(entered.count).toBe(0)
			expect(scrolled.count).toBe(0)
		},
	)

	it('takes no mouseover from the parked pointer for an element past both window edges', async () => {
		// The declared pane is twice as wide as the runner's window and 200 rows taller, both read
		// rather than assumed, and the fixed element sits past the window's right and bottom edges.
		// The offset then moves the frame up and left, so the frame covers the point outside the
		// runner page's viewport where the pointer is parked.
		await releasePointer()
		const view = requireValue(window.top)
		const declared = Math.max(844, view.innerHeight + 200)
		buildStylesheet(
			`.corner { position: fixed; left: ${String(view.innerWidth + 50)}px; top: ${String(declared - 100)}px; width: 100px; height: 100px }`,
		)
		const container = buildFixture('<div class="corner">Corner</div>')
		const entered = createRecorder<[event: Event]>()
		document.addEventListener('mouseover', entered.handler)
		const frame = requireValue(window.frameElement)
		const places: DOMRect[] = []
		const observer = new MutationObserver(() => {
			places.push(frame.getBoundingClientRect())
		})
		observer.observe(frame, { attributes: true, attributeFilter: ['style'] })
		try {
			const written = await captureFrame({
				path: `${FRAMES}/both-edges.png`,
				width: view.innerWidth * 2,
				height: declared,
				element: requireValue(container.firstElementChild),
			})
			await waitForFrame()
			const reading = await readFrame(written)
			expect([reading.width, reading.height]).toStrictEqual([100, 100])
		} finally {
			observer.disconnect()
			document.removeEventListener('mouseover', entered.handler)
		}
		// The frame moving up and left past the viewport's corner is the control that the offset
		// took the frame over the parked pointer.
		expect(places.some((place) => place.top < -1 && place.left < -1)).toBe(true)
		expect(entered.count).toBe(0)
	})

	it('takes no mouseover from the parked pointer for an element touching the origin', async () => {
		await releasePointer()
		const container = buildFixture('<div style="height: 100px">Origin</div>')
		const entered = createRecorder<[event: Event]>()
		document.addEventListener('mouseover', entered.handler)
		try {
			await captureFrame({
				path: `${FRAMES}/origin.png`,
				width: 390,
				height: 844,
				element: requireValue(container.firstElementChild),
			})
			await waitForFrame()
		} finally {
			document.removeEventListener('mouseover', entered.handler)
		}
		expect(entered.count).toBe(0)
	})

	it('takes no mouseover from the parked pointer for an element that fills the runner window', async () => {
		// The element is as wide and as tall as the runner's window, which is read rather than
		// assumed, and sits at the tester's top-left corner.
		await releasePointer()
		const view = requireValue(window.top)
		const container = buildFixture(
			`<div style="width: ${String(view.innerWidth)}px; height: ${String(view.innerHeight)}px">Fill</div>`,
		)
		const entered = createRecorder<[event: Event]>()
		document.addEventListener('mouseover', entered.handler)
		try {
			const written = await captureFrame({
				path: `${FRAMES}/fill.png`,
				width: view.innerWidth,
				height: Math.max(844, view.innerHeight),
				element: requireValue(container.firstElementChild),
			})
			await waitForFrame()
			const reading = await readFrame(written)
			expect([reading.width, reading.height]).toStrictEqual([view.innerWidth, view.innerHeight])
		} finally {
			document.removeEventListener('mouseover', entered.handler)
		}
		expect(entered.count).toBe(0)
	})

	it('takes no mouseover from the parked pointer across a scroll the staging clamps', async () => {
		// The tester starts scrolled to 600 in a 1600-row document, and the 1500-row pane the
		// capture stages clamps that scroll to 100. The scroll that brings the element back to the
		// top then runs from the clamped position, and the release hands back 600.
		await releasePointer()
		const container = buildFixture(
			'<div style="height: 100px">Top</div><div style="height: 1500px">After</div>',
		)
		window.scrollTo({ top: 600, left: 0, behavior: 'instant' })
		expect(window.scrollY).toBe(600)
		const entered = createRecorder<[event: Event]>()
		document.addEventListener('mouseover', entered.handler)
		try {
			await captureFrame({
				path: `${FRAMES}/clamped.png`,
				width: 390,
				height: 1500,
				element: requireValue(container.firstElementChild),
			})
			await waitForFrame()
		} finally {
			document.removeEventListener('mouseover', entered.handler)
		}
		expect(entered.count).toBe(0)
		expect(window.scrollY).toBe(600)
	})

	it('takes no mouseover from the parked pointer for an svg in the shadow tree of a fixed host', async () => {
		await releasePointer()
		buildStylesheet('.host { position: fixed; top: 800px; left: 0; width: 100px; height: 100px }')
		const container = buildFixture(
			'<div style="height: 3000px">Document</div><div class="host"></div>',
		)
		const host = requireValue(container.querySelector('.host'))
		const shadow = host.attachShadow({ mode: 'open' })
		shadow.innerHTML = '<svg width="100" height="100"><rect width="100" height="100" /></svg>'
		const entered = createRecorder<[event: Event]>()
		document.addEventListener('mouseover', entered.handler)
		try {
			const written = await captureFrame({
				path: `${FRAMES}/shadow-svg.png`,
				width: 390,
				height: 844,
				element: requireValue(shadow.querySelector('svg')),
			})
			await waitForFrame()
			const reading = await readFrame(written)
			expect([reading.width, reading.height]).toStrictEqual([100, 100])
		} finally {
			document.removeEventListener('mouseover', entered.handler)
		}
		expect(entered.count).toBe(0)
	})

	it('takes no mouseover from the parked pointer for a fixed svg under a containing-block ancestor', async () => {
		// The transformed ancestor is the fixed svg's containing block, so the document's scroll
		// moves it, and the scroll brings it into the pane.
		await releasePointer()
		buildStylesheet('.fixed-svg { position: fixed; top: 900px; left: 0 }')
		const container = buildFixture(
			'<div style="transform: translateX(0)"><div style="height: 3000px">Document</div>' +
				'<svg class="fixed-svg" width="100" height="100"><rect width="100" height="100" /></svg></div>',
		)
		const entered = createRecorder<[event: Event]>()
		document.addEventListener('mouseover', entered.handler)
		try {
			const written = await captureFrame({
				path: `${FRAMES}/contained-svg.png`,
				width: 390,
				height: 844,
				element: requireValue(container.querySelector('svg')),
			})
			await waitForFrame()
			const reading = await readFrame(written)
			expect([reading.width, reading.height]).toStrictEqual([100, 100])
		} finally {
			document.removeEventListener('mouseover', entered.handler)
		}
		expect(entered.count).toBe(0)
	})

	it('keeps the hover a resting pointer paints on the element it shoots', async () => {
		// The pointer is put on the element with the pane already staged at the frame's size, because
		// the staging itself moves the tester to the window's origin, so the capture's own staging
		// moves nothing. The element sits at the tester's top-left corner and is one row tall, so a
		// capture that moved it even one row off the origin would move it out from under the pointer.
		buildStylesheet(
			'.hovered { display: block; width: 100px; height: 1px; padding: 0; border: 0; background: rgb(0, 0, 255) }' +
				' .hovered:hover { background: rgb(255, 0, 0) }',
		)
		const container = buildFixture('<button class="hovered" aria-label="Hovered"></button>')
		await stagePane(390, 844)
		await hoverAccessible('button', 'Hovered')

		const written = await captureFrame({
			path: `${FRAMES}/hovered.png`,
			width: 390,
			height: 844,
			element: requireValue(container.lastElementChild),
		})
		expect((await readFrame(written)).floor).toBe('rgb(255, 0, 0)')
	})

	it('refuses a document whose height never settles, and hands the pane back anyway', async () => {
		// Nothing caps this one: the full-height panel grows with every pane the capture stages, so
		// the document outruns each staged height however many times the capture restages, and each
		// staging's overshoot carries the growth forward rather than closing on anything. The count
		// is written out rather than read from the constant, so a changed bound reddens here instead
		// of re-deriving its own answer.
		buildStylesheet('html { background: rgb(0, 128, 0) } .grow { min-height: 100vh }')
		buildFixture(
			'<div class="grow">Grows with the pane</div><div style="height: 200px">Beyond</div>',
		)
		const pane = requireValue(window.frameElement?.parentElement)
		const before = [window.innerWidth, window.innerHeight]

		await expect(
			captureFrame({ path: `${FRAMES}/growing.png`, width: 390, height: 844 }),
		).rejects.toThrow(`Capture frame at ${FRAMES}/growing.png never settled after 4 restagings`)
		expect(pane.hasAttribute(CAPTURE_PANE)).toBe(false)
		expect([window.innerWidth, window.innerHeight]).toStrictEqual(before)
	})
})

describe('computeOffset', () => {
	// A runner window of 800 by 513 CSS pixels, written out so each case is the same on every host.
	it('leaves an element inside the window where it is', () => {
		expect(computeOffset(new DOMRectReadOnly(0, 100, 390, 100), 800, 513)).toStrictEqual({
			top: 0,
			left: 0,
		})
	})

	it('leaves an element touching the origin, or starting above it, where it is', () => {
		expect(computeOffset(new DOMRectReadOnly(0, 0, 390, 100), 800, 513)).toStrictEqual({
			top: 0,
			left: 0,
		})
		expect(computeOffset(new DOMRectReadOnly(0, -50, 390, 100), 800, 513)).toStrictEqual({
			top: 0,
			left: 0,
		})
	})

	it('leaves an element that fills the window where it is', () => {
		expect(computeOffset(new DOMRectReadOnly(0, 0, 800, 513), 800, 513)).toStrictEqual({
			top: 0,
			left: 0,
		})
	})

	it('moves the frame up only as far as brings an element past the bottom edge inside', () => {
		expect(computeOffset(new DOMRectReadOnly(0, 744, 390, 100), 800, 513)).toStrictEqual({
			top: -331,
			left: 0,
		})
	})

	it('rounds a fractional bottom edge up to the next whole row', () => {
		// The bottom edge sits at 844.5, so the frame moves 332 rows rather than 331.5, and the
		// element's last part row lands inside the window rather than half outside it.
		expect(computeOffset(new DOMRectReadOnly(0, 744.5, 390, 100), 800, 513)).toStrictEqual({
			top: -332,
			left: 0,
		})
	})

	it('moves a fitting box with a fractional top only as far as the window start', () => {
		// The bottom edge rounds up to 514, one row past the window, but the box starts half a row
		// down, so a whole-row move would take its top to -0.5.
		const box = new DOMRectReadOnly(0, 0.5, 100, 513)
		const move = computeOffset(box, 800, 513)
		expect(move).toStrictEqual({ top: -0.5, left: 0 })
		expect([box.top + move.top, box.bottom + move.top]).toStrictEqual([0, 513])
	})

	it('moves a fitting box with a fractional left only as far as the window start', () => {
		const box = new DOMRectReadOnly(0.5, 0, 800, 100)
		const move = computeOffset(box, 800, 513)
		expect(move).toStrictEqual({ top: 0, left: -0.5 })
		expect([box.left + move.left, box.right + move.left]).toStrictEqual([0, 800])
	})

	it('leaves a box that already ends inside a fractional window where it is', () => {
		// The box ends exactly on the window's fractional bottom edge, so it is already inside.
		const box = new DOMRectReadOnly(0, 0, 800, 512.5)
		const move = computeOffset(box, 800, 512.5)
		expect(move).toStrictEqual({ top: 0, left: 0 })
		expect([box.top + move.top, box.bottom + move.top]).toStrictEqual([0, 512.5])
	})

	it('moves the frame left only as far as brings an element past the right edge inside', () => {
		expect(computeOffset(new DOMRectReadOnly(800, 0, 800, 100), 800, 513)).toStrictEqual({
			top: 0,
			left: -800,
		})
	})

	it('moves the frame up and left for an element past both edges', () => {
		// Both far edges are fractional, 844.5 and 1190.5, so each rounds up to its next whole row
		// or column before the move is taken.
		expect(computeOffset(new DOMRectReadOnly(800.5, 744.5, 390, 100), 800, 513)).toStrictEqual({
			top: -332,
			left: -391,
		})
	})

	it('does not move an element too large for the window', () => {
		expect(computeOffset(new DOMRectReadOnly(0, 0, 390, 1112), 800, 513)).toStrictEqual({
			top: 0,
			left: 0,
		})
		expect(computeOffset(new DOMRectReadOnly(0, 744, 900, 100), 800, 513)).toStrictEqual({
			top: 0,
			left: 0,
		})
	})
})

describe('readFrame', () => {
	// guides/test.md → Patterns → "Read a written frame back". A browser fence carries in this
	// directory because the guides project runs with the browser disabled.
	it('reports the size of a written frame and the color its bottom row paints', async () => {
		buildStylesheet('html { background: rgb(0, 128, 0) }')
		const written = await captureFrame({ path: `${FRAMES}/read.png`, width: 390, height: 844 })

		const reading = await readFrame(written)
		expect(reading.width).toBe(390)
		expect(reading.height).toBe(844)
		expect(reading.floor).toBe('rgb(0, 128, 0)')

		// The frame is decoded rather than computed, so the floor is a second reading of the same
		// claim: the cascade's own answer for the canvas this document paints.
		expect(reading.floor).toBe(readStyle(document.documentElement, 'background-color'))
	})

	it('reports no floor for a frame whose bottom row paints more than one color', async () => {
		const container = buildFixture(
			'<div style="width: 40px; height: 40px; background: linear-gradient(' +
				'to right, rgb(0, 0, 0) 50%, rgb(255, 255, 255) 50%)">.</div>',
		)
		const written = await captureFrame({
			path: `${FRAMES}/split.png`,
			width: 390,
			height: 844,
			element: requireValue(container.firstElementChild),
		})

		const reading = await readFrame(written)
		expect(reading.width).toBe(40)
		expect(reading.floor).toBeUndefined()
	})

	it('refuses a path holding no file, and a file holding no image', async () => {
		const absent = `${server.config.root}/tmp/capture/frame/absent.png`
		await expect(readFrame(absent)).rejects.toThrow(`Capture frame at ${absent} could not be read`)

		// Bytes carrying no PNG header name no size, so the refusal is the bare sentence.
		const planted = `${server.config.root}/tmp/capture/frame/planted-read.png`
		await commands.writeFile(planted, 'not a frame')
		await expect(readFrame(planted)).rejects.toHaveProperty(
			'message',
			`Capture frame at ${planted} is not an image this browser decodes`,
		)
	})

	it('names the size a PNG header declares when the image under it does not decode', async () => {
		// The PNG signature, then an IHDR chunk declaring a width of 40000 (0x9C40) and a height of
		// 30000 (0x7530) at 8 bits of RGBA, with no image data after it: the header is readable and
		// the image is not.
		const header = '\x89PNG\r\n\x1A\n\0\0\0\rIHDR\0\0\x9C\x40\0\0\x75\x30\x08\x06\0\0\0'
		const planted = `${server.config.root}/tmp/capture/frame/planted-header.png`
		await commands.writeFile(planted, btoa(header), 'base64')
		await expect(readFrame(planted)).rejects.toHaveProperty(
			'message',
			`Capture frame at ${planted} is not an image this browser decodes: 40000x30000 device pixels`,
		)
	})
})

describe('readPixels', () => {
	it('reads a resolved length as its number of pixels', () => {
		const container = buildFixture('<p style="padding-left: 12px; margin-top: 0.5px">Ready</p>')
		const subject = requireValue(container.querySelector('p'))
		expect(readPixels(subject, 'padding-left')).toBe(12)
		expect(readPixels(subject, 'margin-top')).toBe(0.5)
	})

	it('reads a custom property carrying a length', () => {
		const container = buildFixture('<p style="--journey-gap: 8px">Ready</p>')
		expect(readPixels(requireValue(container.querySelector('p')), '--journey-gap')).toBe(8)
	})

	it('reads an unparsable value as zero', () => {
		const container = buildFixture('<p style="--journey-label: wide">Ready</p>')
		const subject = requireValue(container.querySelector('p'))
		expect(readStyle(subject, '--journey-label')).toBe('wide')
		expect(readPixels(subject, '--journey-label')).toBe(0)
		expect(readPixels(subject, '--journey-absent')).toBe(0)
	})
})

describe('stageMedia', () => {
	// guides/test.md → Patterns → "Emulate reduced motion and print"
	it('pins the base, stages motion and print, and restores the host medium', async () => {
		await releaseMedia()
		const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches
		const dark = matchMedia('(prefers-color-scheme: dark)').matches
		const forced = matchMedia('(forced-colors: active)').matches
		buildStylesheet(
			'.journey-media { padding-top: 1px } @media (prefers-reduced-motion: reduce) { .journey-media { padding-top: 2px } } @media print { .journey-media { padding-top: 3px } }',
		)
		buildFixture('<button class="journey-media">Media</button>')
		const button = resolveAccessible('Media')
		await stageMedia({ motion: true })
		expect(document.documentElement.getAttribute(MEDIA_STAGE)).toBe(
			`0${Number(reduced)}${Number(dark)}${Number(forced)}`,
		)
		expect(readPixels(button, 'padding-top')).toBe(1)
		expect(matchMedia('(prefers-reduced-motion: no-preference)').matches).toBe(true)
		await stageMedia({ motion: false })
		expect(readPixels(button, 'padding-top')).toBe(2)
		expect(matchMedia('(prefers-reduced-motion: reduce)').matches).toBe(true)
		await stageMedia({ motion: reduced })
		expect(matchMedia('(prefers-reduced-motion: reduce)').matches).toBe(!reduced)
		expect(readPixels(button, 'padding-top')).toBe(reduced ? 1 : 2)
		await stageMedia({ print: true })
		expect(readPixels(button, 'padding-top')).toBe(3)
		expect(matchMedia('print').matches).toBe(true)
		expect(matchMedia('(prefers-reduced-motion: reduce)').matches).toBe(!reduced)
		await releaseMedia()
		expect(matchMedia('print').matches).toBe(false)
		expect(matchMedia('(prefers-reduced-motion: reduce)').matches).toBe(reduced)
		expect(readPixels(button, 'padding-top')).toBe(reduced ? 2 : 1)
		expect(document.documentElement.hasAttribute(MEDIA_STAGE)).toBe(false)
	})

	it('preserves print and its paint through a motion-only stage', async () => {
		const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches
		buildStylesheet(
			'.journey-media { padding-top: 1px } @media print { .journey-media { padding-top: 3px } }',
		)
		buildFixture('<button class="journey-media">Media</button>')
		const button = resolveAccessible('Media')
		await stageMedia({ print: true })
		expect(readPixels(button, 'padding-top')).toBe(3)
		await stageMedia({ motion: reduced })
		expect(matchMedia('(prefers-reduced-motion: reduce)').matches).toBe(!reduced)
		expect(matchMedia('print').matches).toBe(true)
		expect(readPixels(button, 'padding-top')).toBe(3)
	})

	it('preserves a provider color scheme inverse through stage and release', async () => {
		await releaseMedia()
		const dark = matchMedia('(prefers-color-scheme: dark)').matches
		const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches
		await sendProtocol('Emulation.setEmulatedMedia', {
			features: [{ name: 'prefers-color-scheme', value: dark ? 'light' : 'dark' }],
		})
		await waitForCondition(
			'inverse color scheme override',
			() => matchMedia('(prefers-color-scheme: dark)').matches === !dark,
		)
		expect(matchMedia('(prefers-color-scheme: dark)').matches).toBe(!dark)
		await stageMedia({ motion: reduced })
		expect(matchMedia('(prefers-color-scheme: dark)').matches).toBe(!dark)
		await releaseMedia()
		expect(matchMedia('(prefers-color-scheme: dark)').matches).toBe(!dark)
	})

	it('preserves a provider forced colors inverse through stage and release', async () => {
		await releaseMedia()
		const forced = matchMedia('(forced-colors: active)').matches
		const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches
		await sendProtocol('Emulation.setEmulatedMedia', {
			features: [{ name: 'forced-colors', value: forced ? 'none' : 'active' }],
		})
		await waitForCondition(
			'inverse forced colors override',
			() => matchMedia('(forced-colors: active)').matches === !forced,
		)
		expect(matchMedia('(forced-colors: active)').matches).toBe(!forced)
		await stageMedia({ motion: reduced })
		expect(matchMedia('(forced-colors: active)').matches).toBe(!forced)
		await releaseMedia()
		expect(matchMedia('(forced-colors: active)').matches).toBe(!forced)
	})

	it('stages screen explicitly and preserves an omitted motion axis', async () => {
		await stageMedia({ print: true, motion: false })
		await stageMedia({ print: false })
		expect(matchMedia('print').matches).toBe(false)
		expect(matchMedia('screen').matches).toBe(true)
		expect(matchMedia('(prefers-reduced-motion: reduce)').matches).toBe(true)
	})

	it('stages forced colours on and off, reads each back, and restores the host mode', async () => {
		await releaseMedia()
		const forced = matchMedia('(forced-colors: active)').matches
		const print = matchMedia('print').matches
		const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches
		await stageMedia({ forced: !forced })
		expect(matchMedia('(forced-colors: active)').matches).toBe(!forced)
		expect(matchMedia('print').matches).toBe(print)
		expect(matchMedia('(prefers-reduced-motion: reduce)').matches).toBe(reduced)
		expect(document.documentElement.getAttribute(MEDIA_STAGE)?.at(3)).toBe(String(Number(forced)))
		await stageMedia({ forced })
		expect(matchMedia('(forced-colors: active)').matches).toBe(forced)
		await stageMedia({ forced: !forced, motion: reduced })
		expect(matchMedia('(forced-colors: active)').matches).toBe(!forced)
		expect(matchMedia('(prefers-reduced-motion: reduce)').matches).toBe(!reduced)
		await stageMedia({ motion: !reduced })
		expect(matchMedia('(forced-colors: active)').matches).toBe(!forced)
		await releaseMedia()
		expect(matchMedia('(forced-colors: active)').matches).toBe(forced)
		expect(matchMedia('(prefers-reduced-motion: reduce)').matches).toBe(reduced)
	})

	it('refuses an empty media stage', async () => {
		await expect(stageMedia({})).rejects.toThrow(
			'Media emulation was staged with nothing to emulate',
		)
	})
})

describe('releaseMedia', () => {
	it('restores every media axis before the next line reads it', async () => {
		await releaseMedia()
		const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches
		const dark = matchMedia('(prefers-color-scheme: dark)').matches
		const forced = matchMedia('(forced-colors: active)').matches
		await stageMedia({ print: true, motion: reduced })
		await sendProtocol('Emulation.setEmulatedMedia', {
			media: 'print',
			features: [
				{ name: 'prefers-reduced-motion', value: reduced ? 'no-preference' : 'reduce' },
				{ name: 'prefers-color-scheme', value: dark ? 'light' : 'dark' },
				{ name: 'forced-colors', value: forced ? 'none' : 'active' },
			],
		})
		await waitForCondition(
			'every inverse media axis staged',
			() =>
				matchMedia('print').matches &&
				matchMedia('(prefers-reduced-motion: reduce)').matches === !reduced &&
				matchMedia('(prefers-color-scheme: dark)').matches === !dark &&
				matchMedia('(forced-colors: active)').matches === !forced,
		)
		await stageMedia({ print: true, motion: reduced })
		await releaseMedia()
		expect([
			matchMedia('print').matches,
			matchMedia('(prefers-reduced-motion: reduce)').matches,
			matchMedia('(prefers-color-scheme: dark)').matches,
			matchMedia('(forced-colors: active)').matches,
		]).toEqual([false, reduced, dark, forced])
	})

	it('restores provider inverses on every axis after changing print and motion', async () => {
		await releaseMedia()
		const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches
		const dark = matchMedia('(prefers-color-scheme: dark)').matches
		const forced = matchMedia('(forced-colors: active)').matches
		await sendProtocol('Emulation.setEmulatedMedia', {
			media: 'print',
			features: [
				{ name: 'prefers-reduced-motion', value: reduced ? 'no-preference' : 'reduce' },
				{ name: 'prefers-color-scheme', value: dark ? 'light' : 'dark' },
				{ name: 'forced-colors', value: forced ? 'none' : 'active' },
			],
		})
		await waitForCondition(
			'provider inverses arrived',
			() =>
				matchMedia('print').matches &&
				matchMedia('(prefers-reduced-motion: reduce)').matches === !reduced &&
				matchMedia('(prefers-color-scheme: dark)').matches === !dark &&
				matchMedia('(forced-colors: active)').matches === !forced,
		)
		await stageMedia({ print: false, motion: !reduced })
		expect(document.documentElement.getAttribute(MEDIA_STAGE)).toBe(
			`1${Number(!reduced)}${Number(!dark)}${Number(!forced)}`,
		)
		expect(matchMedia('print').matches).toBe(false)
		expect(matchMedia('(prefers-reduced-motion: reduce)').matches).toBe(reduced)
		await releaseMedia()
		expect([
			matchMedia('print').matches,
			matchMedia('(prefers-reduced-motion: reduce)').matches,
			matchMedia('(prefers-color-scheme: dark)').matches,
			matchMedia('(forced-colors: active)').matches,
		]).toEqual([true, !reduced, !dark, !forced])
		expect(document.documentElement.hasAttribute(MEDIA_STAGE)).toBe(false)
	})

	it('reads a stable value after a release with nothing staged', async () => {
		expect(document.documentElement.hasAttribute(MEDIA_STAGE)).toBe(false)
		await releaseMedia()
		const readings = [
			matchMedia('print').matches,
			matchMedia('(prefers-reduced-motion: reduce)').matches,
			matchMedia('(prefers-color-scheme: dark)').matches,
			matchMedia('(forced-colors: active)').matches,
		]
		await waitForFrame()
		expect([
			matchMedia('print').matches,
			matchMedia('(prefers-reduced-motion: reduce)').matches,
			matchMedia('(prefers-color-scheme: dark)').matches,
			matchMedia('(forced-colors: active)').matches,
		]).toEqual(readings)
	})
})

describe.sequential('media teardown after failure', () => {
	let reduced = false
	beforeAll(() => {
		reduced = matchMedia('(prefers-reduced-motion: reduce)').matches
	})

	// An assertion inside an it.fails body cannot fail the suite; the following case carries the proof.
	it.fails('throws a sentinel after staging and leaves the release to afterEach', async () => {
		await stageMedia({ print: true, motion: reduced })
		expect(matchMedia('print').matches).toBe(true)
		expect(matchMedia('(prefers-reduced-motion: reduce)').matches).toBe(!reduced)
		throw new Error('media sentinel')
	})

	it('reads restored media in the following case', () => {
		expect(matchMedia('print').matches).toBe(false)
		expect(matchMedia('(prefers-reduced-motion: reduce)').matches).toBe(reduced)
	})

	it('releases explicitly before its afterEach hook', async () => {
		await stageMedia({ print: true, motion: reduced })
		expect(matchMedia('(prefers-reduced-motion: reduce)').matches).toBe(!reduced)
		await releaseMedia()
		expect(matchMedia('print').matches).toBe(false)
		expect(matchMedia('(prefers-reduced-motion: reduce)').matches).toBe(reduced)
	})

	it('reads provider defaults after the repeated release', () => {
		expect(matchMedia('print').matches).toBe(false)
		expect(matchMedia('(prefers-reduced-motion: reduce)').matches).toBe(reduced)
	})
})

describe('waitForStability', () => {
	// The reading changes on its first two reads and then holds, so the read count at resolution
	// separates a wait that counts unchanged frames from one that resolves on the first agreement.
	it('resolves only after the frames asked for have held the settled reading, four by default', async () => {
		for (const { options, reads: expected } of [
			{ options: { frames: 2 }, reads: 5 },
			{ options: { frames: 1 }, reads: 4 },
			{ options: undefined, reads: 7 },
		]) {
			const reads = createRecorder<[]>()
			await waitForStability(
				'the reading settles',
				() => {
					reads.handler()
					return String(Math.min(reads.count, 3))
				},
				options,
			)
			expect(reads.count).toBe(expected)
		}
	})

	// The control: a reading that moves on every frame never agrees with itself, so the budget runs
	// out and the refusal names what was being waited for.
	it('exhausts the budget on a reading that changes every frame, naming the description', async () => {
		const reads = createRecorder<[]>()
		await expect(
			waitForStability(
				'the box holds still',
				() => {
					reads.handler()
					return String(reads.count)
				},
				{ budget: 100 },
			),
		).rejects.toThrow('Condition "the box holds still" did not hold within 100ms')
		expect(reads.count).toBeGreaterThan(2)
	})

	it('refuses a frame count that is not a positive integer', async () => {
		for (const frames of [0, -1, 1.5, Number.NaN, Number.POSITIVE_INFINITY]) {
			await expect(
				waitForStability('the reading holds', () => 'still', { frames }),
			).rejects.toThrow('Stability frames must be a positive integer')
		}
	})
})

describe('expandCaptures', () => {
	it('expands the registry across every variant, each state first', () => {
		expect(expandCaptures(['start', 'answer'], VARIANTS)).toStrictEqual([
			'start--light-1440.png',
			'start--dark-390.png',
			'answer--light-1440.png',
			'answer--dark-390.png',
		])
	})

	it('expands an empty registry and an empty variant matrix to no files', () => {
		expect(expandCaptures([], VARIANTS)).toStrictEqual([])
		expect(expandCaptures(['start'], [])).toStrictEqual([])
	})
})
