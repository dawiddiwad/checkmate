import { test as base } from '@playwright/test'
import { GeminiLiveSessionManager } from '../../src/step/experimental/gemini-live-session-manager'

type CheckmateFixtures = {
    ai: GeminiLiveSessionManager
}

export const test = base.extend<CheckmateFixtures>({
    ai: async ({ }, use) => {
        const ai = new GeminiLiveSessionManager()
        await use(ai)
        await ai.teardown()
    }
})