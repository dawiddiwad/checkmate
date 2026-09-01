import { access, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { CHECKMATE_DEFAULTS } from '../config/resolved-config.js'
import { writeAgentInstructions, WriteAgentInstructionsResult } from './agent-instructions.js'

/**
 * The fixtures file `init` writes.
 *
 * Named `checkmate.fixtures.ts` rather than the conventional `fixtures.ts` so it never
 * collides with a project's own fixtures file — `init` only ever adds files, it does not
 * edit or merge into one that already exists.
 */
export const FIXTURES_FILE_NAME = 'checkmate.fixtures.ts'

const FIXTURES_FILE_CONTENT = `import { mergeTests, test as base } from '@playwright/test'
import { checkmate } from '@xoxoai/checkmate/playwright'

/**
 * Merge your own fixtures in too, once you have them:
 *
 *   import { test as ownFixtures } from './fixtures'
 *   export const test = mergeTests(ownFixtures, checkmate)
 */
export const test = mergeTests(base, checkmate)
export { expect } from '@playwright/test'
`

export type InitOptions = {
	/**
	 * Directory `init` runs against. Defaults to `process.cwd()`.
	 */
	cwd?: string

	/**
	 * Overrides where the agent instruction section is written.
	 */
	target?: string
}

export type FixturesFileResult = {
	path: string
	action: 'created' | 'skipped'
}

export type InitResult = {
	fixturesFile: FixturesFileResult
	instructions: WriteAgentInstructionsResult
	configBlock: string
}

/**
 * Runs `checkmate init`: writes the mergeable fixtures file, writes or updates the agent
 * instruction section, and returns the `playwright.config.ts` snippet to paste.
 *
 * `init` never edits `playwright.config.ts` itself — an agent applies "add this to your
 * config" correctly to a config with spreads, conditional projects, or a wrapped
 * `defineConfig`, which is exactly where an AST heuristic of ours would misfire.
 *
 * @example
 * ```ts
 * const result = await runInit({ cwd: process.cwd() })
 * console.log(result.configBlock)
 * ```
 */
export async function runInit(options: InitOptions = {}): Promise<InitResult> {
	const cwd = path.resolve(options.cwd ?? process.cwd())

	const fixturesFile = await writeFixturesFile(cwd)
	const instructions = await writeAgentInstructions({ cwd, target: options.target })

	return {
		fixturesFile,
		instructions,
		configBlock: buildConfigBlock(),
	}
}

async function writeFixturesFile(cwd: string): Promise<FixturesFileResult> {
	const targetPath = path.join(cwd, FIXTURES_FILE_NAME)
	if (await pathExists(targetPath)) {
		return { path: FIXTURES_FILE_NAME, action: 'skipped' }
	}

	await writeFile(targetPath, FIXTURES_FILE_CONTENT)
	return { path: FIXTURES_FILE_NAME, action: 'created' }
}

function buildConfigBlock(): string {
	return `use: { checkmateModel: '${CHECKMATE_DEFAULTS.checkmateModel}', checkmateTurnCap: ${CHECKMATE_DEFAULTS.checkmateTurnCap} },`
}

async function pathExists(filePath: string): Promise<boolean> {
	try {
		await access(filePath)
		return true
	} catch {
		return false
	}
}
