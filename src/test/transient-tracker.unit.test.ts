import { describe, test, expect, beforeEach, vi } from "vitest"
import { EventEmitter } from "events"
import { TransientStateTracker } from "../step/tool/transient-state-tracker"
import type { ConsoleMessage, Dialog, Frame, Page } from "@playwright/test"

class FakePage extends EventEmitter {
    readonly mainFrameObj: Frame = { url: () => 'about:blank#fake' } as unknown as Frame
    readonly evaluate = vi.fn(async () => undefined)

    on(event: string | symbol, listener: (...args: any[]) => void): this {
        this.addListener(event, listener)
        return this
    }

    off(event: string | symbol, listener: (...args: any[]) => void): this {
        this.removeListener(event, listener)
        return this
    }

    mainFrame(): Frame {
        return this.mainFrameObj
    }
    
    [key: string]: any
}

const makeConsoleMessage = (text: string, type: string = 'log'): ConsoleMessage => ({
    text: () => text,
    type: () => type,
} as unknown as ConsoleMessage)

const makeDialog = (message: string, kind: string = 'alert') => {
    const dismiss = vi.fn(async () => undefined)
    const dialog: Dialog = {
        message: () => message,
        type: () => kind,
        dismiss,
        accept: dismiss,
        defaultValue: () => "",
    } as unknown as Dialog & { dismiss: ReturnType<typeof vi.fn> }
    return { dialog, dismiss }
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
        const occurrences = timeline.filter(e => e.includes('Appeared: Alpha')).length
        expect(occurrences).toBe(1)
    })

    test('records console errors', async () => {
        const tracker = new TransientStateTracker(asPage())
        await tracker.start()

        page.emit('console', makeConsoleMessage('Boom error', 'error'))
        const timeline = await tracker.stop()

        expect(timeline.some(e => e.includes('Console Error: Boom error'))).toBe(true)
    })

    test('records dialogs and dismisses them', async () => {
        const tracker = new TransientStateTracker(asPage())
        await tracker.start()

        const { dialog, dismiss } = makeDialog('Heads up')
        page.emit('dialog', dialog)

        const timeline = await tracker.stop()
        expect(timeline.some(e => e.includes('Dialog appeared: "Heads up"'))).toBe(true)
        expect(dismiss).toHaveBeenCalledTimes(1)
    })

    test('stops tracking on main-frame navigation', async () => {
        const tracker = new TransientStateTracker(asPage())
        await tracker.start()

        page.emit('framenavigated', page.mainFrame())
        await Promise.resolve()

        const timelineAfterNav = tracker.formatTimeline()
        expect(timelineAfterNav).toContain('Navigated to:')

        const timeline = await tracker.stop()
        expect(timeline.some(e => e.includes('Navigated to:'))).toBe(true)
    })
})
