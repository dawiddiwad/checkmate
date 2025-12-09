import test from "@playwright/test"
import { AriaSnapshotMapper, AriaSnapshotStore } from "../../../src/step/tool/page-snapshot"
import { BrowserTool } from "../../../src/step/tool/browser-tool"

test.describe('ARIA Playground - Debug', async () => {
    test('snapshot capture', async ({ page }) => {
        await test.step('capture snapshot of google.com', async () => {
            const browserTool = new BrowserTool(page)
            const pageSnapshot = await browserTool.call({
                name: BrowserTool.TOOL_NAVIGATE,
                arguments: { url: 'https://www.google.com/' }
            })
            await page.waitForTimeout(5000)


            // await page.goto('https://huggingface.co/Tongyi-MAI/Z-Image-Turbo')

            // await page.goto('https://www.google.com/')
            // await page.getByRole('button', { name: 'Zaakceptuj wszystko' }).click()

            // await page.goto('https://playwright.dev/docs/intro')

            const snapshot = await page.locator('body').ariaSnapshot()
            console.log('ARIA Snapshot captured:')
            console.log(snapshot)
            const mapper = new AriaSnapshotMapper()
            const store = new AriaSnapshotStore()
            const mapping = await mapper.map(snapshot, page)
            store.set(mapping)

            console.log('\n\n--------------\n\nARIA Snapshot with references:')
            console.log(mapping.snapshot)

            const sampleRef = mapping.entries[0]?.ref
            if (sampleRef) {
                const locator = store.getLocator(sampleRef)
                console.log(`Locator for ref ${sampleRef}: ${locator?.toString()}`)
                await locator.click()
            }
        })
    })
})