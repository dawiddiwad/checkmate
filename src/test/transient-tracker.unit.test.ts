import { describe, test, expect, beforeEach, vi } from 'vitest'
import { EventEmitter } from 'events'
import { TransientStateTracker } from '../tools/browser/transient-state-tracker'
import type { ConsoleMessage, Dialog, Frame, Page } from '@playwright/test'

class FakePage extends EventEmitter {
	readonly mainFrameObj: Frame = { url: () => 'about:blank#fake' } as unknown as Frame
	readonly evaluate = vi.fn(async () => undefined)

	on(event: string | symbol, listener: (...args: unknown[]) => void): this {
		this.addListener(event, listener)
		return this
	}

	off(event: string | symbol, listener: (...args: unknown[]) => void): this {
		this.removeListener(event, listener)
		return this
	}

	mainFrame(): Frame {
		return this.mainFrameObj
	}

	[key: string]: unknown
}

const makeConsoleMessage = (text: string, type: string = 'log'): ConsoleMessage =>
	({
		text: () => text,
		type: () => type,
	}) as unknown as ConsoleMessage

const makeDialog = (message: string, kind: string = 'alert') => {
	const accept = vi.fn(async () => undefined)
	const dismiss = vi.fn(async () => undefined)
	const dialog: Dialog = {
		message: () => message,
		type: () => kind,
		dismiss,
		accept,
		defaultValue: () => '',
	} as unknown as Dialog
	return { dialog, accept, dismiss }
}

describe('TransientStateTracker (unit)', () => {
	let page: FakePage
	const asPage = () => page as unknown as Page

	beforeEach(() => {
		page = new FakePage()
		vi.clearAllMocks()
	})

	test('attaches and detaches observers around start/stop', async () => {
		const tracker = new TransientStateTracker(asPage())
		await tracker.start()
		expect(page.evaluate).toHaveBeenCalledTimes(1)

		await tracker.stop()
		expect(page.evaluate).toHaveBeenCalledTimes(2)
	})

	test('records mutation payloads once when duplicated back-to-back', async () => {
		const tracker = new TransientStateTracker(asPage())
		await tracker.start()

		page.emit('console', makeConsoleMessage(`${TransientStateTracker.LOG_PREFIX}Appeared: Alpha`))
		page.emit('console', makeConsoleMessage(`${TransientStateTracker.LOG_PREFIX}Appeared: Alpha`))

		const timeline = await tracker.stop()
		const occurrences = timeline.filter((e) => e.includes('Appeared: Alpha')).length
		expect(occurrences).toBe(1)
	})

	test('records console errors', async () => {
		const tracker = new TransientStateTracker(asPage())
		await tracker.start()

		page.emit('console', makeConsoleMessage('Boom error', 'error'))
		const timeline = await tracker.stop()

		expect(timeline.some((e) => e.includes('Console Error: Boom error'))).toBe(true)
	})

	test('records dialogs and dismisses them when unarmed', async () => {
		const tracker = new TransientStateTracker(asPage())
		await tracker.start()

		const { dialog, accept, dismiss } = makeDialog('Heads up')
		page.emit('dialog', dialog)

		const timeline = await tracker.stop()
		expect(timeline.some((e) => e.includes('Dialog appeared: "Heads up"'))).toBe(true)
		expect(dismiss).toHaveBeenCalledTimes(1)
		expect(accept).not.toHaveBeenCalled()
	})

	test('accepts dialog with armed response', async () => {
		const tracker = new TransientStateTracker(asPage(), {
			consumeDialogHandlingIntent: () => ({ action: 'accept' }),
		})
		await tracker.start()

		const { dialog, accept, dismiss } = makeDialog('Delete item?', 'confirm')
		page.emit('dialog', dialog)

		const timeline = await tracker.stop()
		expect(timeline.some((e) => e.includes('accepted by armed dialog response'))).toBe(true)
		expect(accept).toHaveBeenCalledTimes(1)
		expect(dismiss).not.toHaveBeenCalled()
	})

	test('dismisses dialog with armed response', async () => {
		const tracker = new TransientStateTracker(asPage(), {
			consumeDialogHandlingIntent: () => ({ action: 'dismiss' }),
		})
		await tracker.start()

		const { dialog, accept, dismiss } = makeDialog('Delete item?', 'confirm')
		page.emit('dialog', dialog)

		const timeline = await tracker.stop()
		expect(timeline.some((e) => e.includes('dismissed by armed dialog response'))).toBe(true)
		expect(dismiss).toHaveBeenCalledTimes(1)
		expect(accept).not.toHaveBeenCalled()
	})

	test('accepts prompt with armed prompt text', async () => {
		const tracker = new TransientStateTracker(asPage(), {
			consumeDialogHandlingIntent: () => ({ action: 'accept', promptText: 'Alice' }),
		})
		await tracker.start()

		const { dialog, accept, dismiss } = makeDialog('Name?', 'prompt')
		page.emit('dialog', dialog)

		await tracker.stop()
		expect(accept).toHaveBeenCalledWith('Alice')
		expect(dismiss).not.toHaveBeenCalled()
	})

	test('consumes dialog intent once per dialog', async () => {
		let intent = true
		const tracker = new TransientStateTracker(asPage(), {
			consumeDialogHandlingIntent: () => {
				if (!intent) return null
				intent = false
				return { action: 'accept' }
			},
		})
		await tracker.start()

		const first = makeDialog('First')
		const second = makeDialog('Second')
		page.emit('dialog', first.dialog)
		page.emit('dialog', second.dialog)

		const timeline = await tracker.stop()
		expect(first.accept).toHaveBeenCalledTimes(1)
		expect(first.dismiss).not.toHaveBeenCalled()
		expect(second.accept).not.toHaveBeenCalled()
		expect(second.dismiss).toHaveBeenCalledTimes(1)
		expect(
			timeline.some((e) => e.includes('Dialog appeared: "Second"') && e.includes('automatically dismissed'))
		).toBe(true)
	})

	test('stops tracking on main-frame navigation', async () => {
		const tracker = new TransientStateTracker(asPage())
		await tracker.start()

		page.emit('framenavigated', page.mainFrame())
		await Promise.resolve()

		const timelineAfterNav = tracker.formatTimeline()
		expect(timelineAfterNav).toContain('Navigated to:')

		const timeline = await tracker.stop()
		expect(timeline.some((e) => e.includes('Navigated to:'))).toBe(true)
	})
})
