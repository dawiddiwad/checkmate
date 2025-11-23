import { test as base } from '@playwright/test'
import { GeminiTestManager } from '../../src/step/gemini/gemini-test-manager'

type CheckmateFixtures = {
    ai: GeminiTestManager
}

export const test = base.extend<CheckmateFixtures>({
    ai: async ({ }, use) => {
        const ai = new GeminiTestManager()
        await use(ai)
        await ai.teardown()
    }
})