import assert from 'node:assert/strict'
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { run } from '../plugin/src/cli.ts'
import { minimumRules } from '../cli/src/launcher.ts'
import { root } from './support.ts'

export type Measurement = { stage: string; durationMs: number; status: string }

export const pluginRoot = join(root, 'plugin')
export const allowedTools = minimumRules

export function liveEnvironment() {
	const token = process.env.CLAUDE_CODE_OAUTH_TOKEN || process.env.ANTHROPIC_API_KEY
	const hostLogin = process.env.CHECKMATE_USE_HOST_LOGIN === '1'
	assert(token || hostLogin, 'Configure Claude authentication before live tests')
	process.env.PATH = `${join(root, 'node_modules/.bin')}:${process.env.PATH}`
	if (token && !hostLogin) process.env.CLAUDE_CONFIG_DIR ??= join(tmpdir(), 'checkmate-live-claude')
	process.env.ANTHROPIC_MODEL ??= 'claude-haiku-5-5'
}

export function liveWorkspace(baseUrl: string) {
	const workspace = mkdtempSync(join(tmpdir(), 'checkmate-live-'))
	mkdirSync(join(workspace, '.playwright'))
	writeFileSync(
		join(workspace, '.playwright/cli.config.json'),
		JSON.stringify({
			browser: {
				browserName: 'chromium',
				launchOptions: {
					executablePath: process.env.CHECKMATE_BROWSER_EXECUTABLE ?? '/usr/bin/chromium',
					headless: true,
				},
			},
		})
	)
	writeFileSync(
		join(workspace, 'AGENTS.md'),
		[
			'# Fixture workspace',
			'',
			`The checkout fixture runs at ${baseUrl}. The factory owns the server. Do not change its code.`,
			'The browser config is `.playwright/cli.config.json`. Use `open --idle-timeout=30000`.',
			'The page `/` has one 400 PLN item. Its checkout button creates an order and shows the total.',
			'GET /quote?promotion=true&loyalty=true returns the quote for a cart with the promotion and 20 PLN loyalty.',
			'GET /health is read-only. Use only /health during setup and planning.',
			'The fixture stores no records. No record cleanup is required. Close browser sessions.',
			'',
		].join('\n')
	)
	return workspace
}

export function checkmate(workspace: string, args: string[], stdin: unknown = undefined) {
	const outcome = run([...args, '--workspace', workspace, '--json'], {
		cwd: workspace,
		env: { CHECKMATE_ACTOR: 'acceptance-test' },
		stdin: () => (stdin === undefined ? '' : JSON.stringify(stdin)),
	})
	const body = JSON.parse(outcome.output)
	assert.equal(outcome.code, 0, `checkmate ${args.join(' ')}: ${outcome.output}`)
	return body
}

export async function measure<T extends { status: string }>(
	measurements: Measurement[],
	stage: string,
	action: () => Promise<T>
) {
	const started = Date.now()
	const result = await action()
	measurements.push({ stage, durationMs: Date.now() - started, status: result.status })
	console.log(JSON.stringify({ ...measurements.at(-1), reasons: (result as { reasons?: unknown }).reasons }))
	return result
}

export function saveMeasurements(workspace: string, measurements: Measurement[], passed: boolean) {
	const report = { workspace, model: process.env.ANTHROPIC_MODEL, passed, measurements }
	writeFileSync(join(workspace, 'measurements.json'), JSON.stringify(report, null, '\t') + '\n')
	console.log(JSON.stringify(report))
	console.log(`Live workspace kept: ${workspace}`)
}
