import { createDragEvent, createKeyboardEvent, createPointerEvent } from '@src/browser'
import { createRecorder, requireValue } from '@src/core'
import { afterEach, describe, expect, it } from 'vitest'
import { buildFixture, resetFixtures } from '../../setupBrowser.js'

afterEach(resetFixtures)

describe('createPointerEvent', () => {
	it('builds a real pointer event of the type asked for', () => {
		const event = createPointerEvent('pointerdown')
		expect(event).toBeInstanceOf(PointerEvent)
		expect(event.type).toBe('pointerdown')
	})

	it('carries the defaults a hand-built event lacks', () => {
		const event = createPointerEvent('pointerdown')
		expect(event.bubbles).toBe(true)
		expect(event.cancelable).toBe(true)
		expect(event.pointerId).toBe(1)
		expect(event.pointerType).toBe('mouse')
		expect(event.isPrimary).toBe(true)
	})

	it('takes an override without restating the rest', () => {
		const event = createPointerEvent('pointerdown', { pointerType: 'touch', clientX: 10 })
		expect(event.pointerType).toBe('touch')
		expect(event.clientX).toBe(10)
		expect(event.bubbles).toBe(true)
		expect(event.isPrimary).toBe(true)
	})

	it('overrides a bubbling default when the caller names it', () => {
		const event = createPointerEvent('pointerdown', { bubbles: false, cancelable: false })
		expect(event.bubbles).toBe(false)
		expect(event.cancelable).toBe(false)
	})

	it('bubbles to an ancestor and can be prevented', () => {
		const container = buildFixture('<div><button type="button">Save</button></div>')
		const heard = createRecorder<[string]>()
		container.addEventListener('pointerdown', (event) => heard.handler(event.type))
		const event = createPointerEvent('pointerdown')
		const proceeded = requireValue(container.querySelector('button')).dispatchEvent(event)
		expect(heard.calls).toStrictEqual([['pointerdown']])
		expect(proceeded).toBe(true)
		event.preventDefault()
		expect(event.defaultPrevented).toBe(true)
	})
})

describe('createDragEvent', () => {
	it('builds a real drag event of the type asked for', () => {
		const event = createDragEvent('dragstart')
		expect(event).toBeInstanceOf(DragEvent)
		expect(event.type).toBe('dragstart')
		expect(event.bubbles).toBe(true)
		expect(event.cancelable).toBe(true)
	})

	it('allocates a live data transfer this environment can carry a payload in', () => {
		const event = createDragEvent('dragstart')
		const transfer = requireValue(event.dataTransfer)
		transfer.setData('text/plain', 'row-3')
		expect(transfer.getData('text/plain')).toBe('row-3')
	})

	it('takes a seeded data transfer in place of the allocated one', () => {
		const seeded = new DataTransfer()
		seeded.setData('text/plain', 'row-7')
		const event = createDragEvent('drop', { dataTransfer: seeded })
		expect(event.dataTransfer).toBe(seeded)
		expect(requireValue(event.dataTransfer).getData('text/plain')).toBe('row-7')
	})

	it('carries its payload to a drop handler on an ancestor', () => {
		const container = buildFixture('<div><span data-slot="target">Drop</span></div>')
		const carried = createRecorder<[string]>()
		container.addEventListener('drop', (event) =>
			carried.handler(requireValue(event.dataTransfer).getData('text/plain')),
		)
		const event = createDragEvent('drop')
		requireValue(event.dataTransfer).setData('text/plain', 'row-9')
		requireValue(container.querySelector('span')).dispatchEvent(event)
		expect(carried.calls).toStrictEqual([['row-9']])
	})
})

describe('createKeyboardEvent', () => {
	it('builds a real keyboard event of the type asked for', () => {
		const event = createKeyboardEvent('keydown', { key: 'Escape' })
		expect(event).toBeInstanceOf(KeyboardEvent)
		expect(event.type).toBe('keydown')
		expect(event.key).toBe('Escape')
	})

	it('carries the defaults a hand-built event lacks', () => {
		const event = createKeyboardEvent('keyup')
		expect(event.bubbles).toBe(true)
		expect(event.cancelable).toBe(true)
	})

	it('takes an override without restating the rest', () => {
		const event = createKeyboardEvent('keydown', { key: 'k', ctrlKey: true })
		expect(event.ctrlKey).toBe(true)
		expect(event.shiftKey).toBe(false)
		expect(event.bubbles).toBe(true)
	})

	it('overrides a bubbling default when the caller names it', () => {
		const event = createKeyboardEvent('keydown', { bubbles: false, cancelable: false })
		expect(event.bubbles).toBe(false)
		expect(event.cancelable).toBe(false)
	})

	it('reaches an ancestor listener and can be prevented, which a bare event cannot', () => {
		const container = buildFixture('<div><button type="button">Save</button></div>')
		const heard = createRecorder<[string]>()
		container.addEventListener('keydown', (event) => heard.handler(event.type))
		const button = requireValue(container.querySelector('button'))
		const bare = new KeyboardEvent('keydown')
		button.dispatchEvent(bare)
		bare.preventDefault()
		expect(heard.calls).toStrictEqual([])
		expect(bare.defaultPrevented).toBe(false)
		const event = createKeyboardEvent('keydown')
		const proceeded = button.dispatchEvent(event)
		expect(heard.calls).toStrictEqual([['keydown']])
		expect(proceeded).toBe(true)
		event.preventDefault()
		expect(event.defaultPrevented).toBe(true)
	})
})
