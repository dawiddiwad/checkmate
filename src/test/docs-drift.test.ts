import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { CHECKMATE_DEFAULTS } from '../config/resolved-config'
import { BrowserTool } from '../tools/browser/tool'

function readRepoFile(relativePath: string): string {
	return readFileSync(fileURLToPath(new URL(`../../${relativePath}`, import.meta.url)), 'utf-8')
}

// Every `checkmate*` option that replaced a 0.4.x environment variable. There's no migration
// guide for these anymore (0.5.0 has no legacy-env layer to point a stale variable at), so a
// reference to one of these names anywhere in the docs is stale by definition.
const REMOVED_ENV_VARS = [
	'OPENAI_MODEL',
	'OPENAI_BASE_URL',
	'OPENAI_TEMPERATURE',
	'OPENAI_REASONING_EFFORT',
	'OPENAI_TOOL_CHOICE',
	'OPENAI_ALLOWED_TOOLS',
	'OPENAI_RETRY_MAX_ATTEMPTS',
	'OPENAI_TIMEOUT_SECONDS',
	'OPENAI_API_RATE_LIMIT_DELAY_SECONDS',
	'OPENAI_API_TOKEN_BUDGET_USD',
	'OPENAI_API_TOKEN_BUDGET_COUNT',
	'OPENAI_LOOP_MAX_REPETITIONS',
	'OPENAI_INCLUDE_SCREENSHOT_IN_SNAPSHOT',
	'CHECKMATE_SNAPSHOT_FILTERING',
]

describe('docs drift', () => {
	const readme = readRepoFile('README.md')
	const guide = readRepoFile('docs/GUIDE.md')
	const envExample = readRepoFile('.env.example')

	it('README never references a removed environment variable', () => {
		for (const name of REMOVED_ENV_VARS) {
			expect(readme, `README.md should not reference removed variable ${name}`).not.toContain(name)
		}
	})

	it('GUIDE.md never references a removed environment variable', () => {
		for (const name of REMOVED_ENV_VARS) {
			expect(guide, `docs/GUIDE.md should not reference removed variable ${name}`).not.toContain(name)
		}
	})

	it('.env.example never references a removed environment variable', () => {
		for (const name of REMOVED_ENV_VARS) {
			expect(envExample, `.env.example should not reference removed variable ${name}`).not.toContain(name)
		}
	})

	it('documented tool count matches the browser tool registry', () => {
		const registeredToolCount = Object.keys(BrowserTool).length

		const match = guide.match(/(\d+) browser tools/)
		expect(match, "docs/GUIDE.md should state the browser tool count as '<N> browser tools'").not.toBeNull()
		expect(Number(match?.[1])).toBe(registeredToolCount)
	})

	it('documented default model matches resolveConfig', () => {
		const match = guide.match(/`checkmateModel`\s*\|\s*`([^`]+)`/)
		expect(match, 'docs/GUIDE.md should document the checkmateModel default in its options table').not.toBeNull()
		expect(match?.[1]).toBe(CHECKMATE_DEFAULTS.checkmateModel)
	})

	it("README has a 'when not to use ai.step' section", () => {
		expect(
			readme.indexOf('When NOT to use'),
			"README.md should have a 'when not to use ai.step' section"
		).toBeGreaterThan(-1)
	})
})
