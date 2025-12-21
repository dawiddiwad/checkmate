import { describe, test, expect, beforeAll, afterAll } from "vitest"
import { chromium, Browser, Page } from "playwright"
import { TransientStateTracker } from "../step/tool/transient-state-tracker"

describe('TransientStateTracker - Visibility via Class Change', () => {
    let browser: Browser
    let page: Page

    beforeAll(async () => {
        browser = await chromium.launch({ headless: true })
        page = await browser.newPage()
    })

    afterAll(async () => {
        await page?.close()
        await browser?.close()
    })

    test('should track appearance changes for the subscription success message', async () => {
        await page.setContent(`
            <div class="col-md-9 form-group hide" id="success-subscribe">
                <div class="alert-success alert">You have been successfully subscribed!</div>
            </div>
        `)
        const tracker = new TransientStateTracker(page)
        await tracker.start()

        await page.evaluate(() => {
            document.getElementById('success-subscribe')!.className = "col-md-9 form-group"
        })
        await page.waitForTimeout(500)
        const timeline = await tracker.stop()
        const timelineStr = timeline.join('\n')

        expect(timelineStr, 'Timeline should contain the success message text').toContain('Changed: You have been successfully subscribed! [-hide]')
    })

    test('should track disappearance for the subscription success message', async () => {
        await page.setContent(`
                <div class="col-md-9 form-group" id="success-subscribe">
                    <div class="alert-success alert">You have been successfully subscribed!</div>
                </div>
            `)
        const tracker = new TransientStateTracker(page)
        await tracker.start()

        await page.evaluate(() => {
            document.getElementById('success-subscribe')!.className = 'col-md-9 form-group hide'
        })
        await page.waitForTimeout(500)
        const timeline = await tracker.stop()
        const timelineStr = timeline.join('\n')

        expect(timelineStr, 'Timeline should contain the success message text').toContain('Changed: You have been successfully subscribed! [+hide]')
    })

    test('should track attribute value changes with new value', async () => {
        await page.setContent(`
                <div style="color: red" id="styled-element">
                    <span>Styled content here</span>
                </div>
            `)
        const tracker = new TransientStateTracker(page)
        await tracker.start()

        await page.evaluate(() => {
            document.getElementById('styled-element')!.setAttribute('style', 'color: blue; font-size: 20px')
        })
        await page.waitForTimeout(500)
        const timeline = await tracker.stop()
        const timelineStr = timeline.join('\n')
        
        expect(timelineStr, 'Timeline should contain the success message text').toContain('Changed: Styled content here [~style=color: blue; font-size: 20px]')
    })
})
