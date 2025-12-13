import { test as base } from '@playwright/test'
import { OpenAITestManager } from '../../src/step/openai/openai-test-manager'

type CheckmateFixtures = {
    ai: OpenAITestManager
}

export const test = base.extend<CheckmateFixtures>({
    ai: async ({ page }, use) => {
        const ai = new OpenAITestManager(page)
        await use(ai)
        await ai.teardown()
    }
})