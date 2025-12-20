import { test, expect } from "@playwright/test"
import { TransientStateTracker } from "../../../src/step/tool/transient-state-tracker"

/**
 * Permanent test to verify that TransientStateTracker correctly identifies 
 * visibility changes triggered by class modifications (e.g., removing a 'hide' class).
 */
test.describe('TransientStateTracker - Visibility via Class Change', () => {
    test('should track visibility changes for the subscription success message', async ({ page }) => {
        // 1. Set the exact "before" state provided by the user
        await page.setContent(`

            <div class="col-md-9 form-group hide" id="success-subscribe">
                <div class="alert-success alert">You have been successfully subscribed!</div>
            </div>
        `)
        
        const tracker = new TransientStateTracker(page)
        await tracker.start()

        // 2. Perform the exact change: removing the "hide" class to make it visible
        await page.evaluate(() => {
            const el = document.getElementById('success-subscribe')
            if (el) {
                // Transitioning from "col-md-9 form-group hide" to "col-md-9 form-group"
                el.className = "col-md-9 form-group"
            }
        })

        // 3. Wait briefly for the MutationObserver to process and report via the exposed function
        await page.waitForTimeout(500)

        const timeline = await tracker.stop()
        const timelineStr = timeline.join('\n')

        // Log to console so user can see the output when running with --reporter=list or similar
        console.log('\n--- Captured Timeline ---')
        console.log(timelineStr)
        console.log('--------------------------\n')

        // 4. Assertions
        expect(timelineStr, 'Timeline should contain the success message text').toContain('You have been successfully subscribed!')
        expect(timelineStr, 'Timeline should indicate a state change').toContain('Element state changed')
    })
})
