import { expect, test as base } from '@playwright/test'
import { CheckmateRunner } from './runtime/runner'

export type CheckmateFixtures = {
	ai: CheckmateRunner
}

export const test = base.extend<CheckmateFixtures>({
	ai: async ({ page }, use) => {
		const ai = new CheckmateRunner(page)
		await use(ai)
		await ai.teardown()
	},
})

export { expect }
