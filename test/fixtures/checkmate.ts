import { test as base } from '@playwright/test'
import { GeminiSessionManager } from '../../src/step/gemini/gemini-session-manager'

type CheckmateFixtures = {
    ai: GeminiSessionManager
}

export const test = base.extend<CheckmateFixtures>({
    ai: async ({ }, use) => {
        const ai = new GeminiSessionManager()
        await use(ai)
        await ai.teardown()
    }
})