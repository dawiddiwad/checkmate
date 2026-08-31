import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { CHECKMATE_DEFAULTS } from '../config/resolved-config'
import { BrowserTool } from '../tools/browser/tool'

function readRepoFile(relativePath: string): string {
	return readFileSync(fileURLToPath(new URL(`../../${relativePath}`, import.meta.url)), 'utf-8')
}

// Every `checkmate*` option that replaced a 0.4.x environment variable. A stale reference to one
// of these names, outside a migration note that says so, is exactly the drift research §5
// catalogued: a doc claiming a contract the runtime no longer has.
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

	it('GUIDE.md only references a removed environment variable inside its migration section', () => {
		const migrationHeadingIndex = guide.indexOf('## Migrating from 0.4.x')
		expect(migrationHeadingIndex).toBeGreaterThan(-1)

		for (const name of REMOVED_ENV_VARS) {
			const firstOccurrence = guide.indexOf(name)
			if (firstOccurrence === -1) {
				continue
			}
			expect(
				firstOccurrence,
				`docs/GUIDE.md references removed variable ${name} outside its migration section`
			).toBeGreaterThan(migrationHeadingIndex)
		}
	})

	it('.env.example only references a removed environment variable inside its migration section', () => {
		const migrationHeadingIndex = envExample.indexOf('MIGRATION FROM 0.4.x')
		expect(migrationHeadingIndex).toBeGreaterThan(-1)

		for (const name of REMOVED_ENV_VARS) {
			const firstOccurrence = envExample.indexOf(name)
			if (firstOccurrence === -1) {
				continue
			}
			expect(
				firstOccurrence,
				`.env.example references removed variable ${name} outside its migration section`
			).toBeGreaterThan(migrationHeadingIndex)
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

	it("README states 'when not to use ai.step' before it says how to use it", () => {
		const whenNotToUseIndex = readme.indexOf('When NOT to use')
		const howToUseIndex = readme.indexOf('## Writing Tests')

		expect(whenNotToUseIndex, "README.md should have a 'when not to use ai.step' section").toBeGreaterThan(-1)
		expect(howToUseIndex, "README.md should have a 'Writing Tests' section").toBeGreaterThan(-1)
		expect(whenNotToUseIndex).toBeLessThan(howToUseIndex)
	})
})
