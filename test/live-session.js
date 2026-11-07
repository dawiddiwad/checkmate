import assert from 'node:assert/strict'
import { mkdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { fixture } from './fixture.js'
import { sandbox, prepare, revised, executeRequest, root, write } from './support.js'
import { worker } from '../plugin/src/launcher.ts'
import { schema } from '../plugin/src/contracts.ts'
import { readReference } from '../plugin/src/files.ts'

assert(
	process.env.CLAUDE_CODE_OAUTH_TOKEN ||
		process.env.ANTHROPIC_API_KEY ||
		process.env.CHECKMATE_USE_HOST_LOGIN === '1',
	'Configure Claude authentication before live tests'
)
process.env.PATH = `${join(root, 'node_modules/.bin')}:${process.env.PATH}`
process.env.CLAUDE_CONFIG_DIR ??= '/tmp/checkmate-live-claude'
const workspace = await sandbox()
const app = await fixture()
console.log(`Same-session artifacts: ${workspace}`)
try {
	const p = await prepare(workspace, app.baseUrl)
	const r = await revised(workspace, p)
	const request = executeRequest(p, r, { timeoutSeconds: 240 })
	await write(workspace, 'request.json', request)
	await mkdir(join(workspace, '.playwright'), { recursive: true })
	await writeFile(
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
	await writeFile(
		join(workspace, 'AGENTS.md'),
		'# Fixture\n\nUse `.playwright/cli.config.json`. Use an isolated browser session with `--idle-timeout=30000`. Click the checkout button to create a standard order. GET /quote?promotion=true&loyalty=true returns the promotion quote. The caller owns the server. Close the browser session. No fixture record cleanup is required.\n'
	)
	const args = [
		'-p',
		'--plugin-dir',
		root,
		'--output-format',
		'json',
		'--json-schema',
		JSON.stringify(schema('response')),
		'--permission-prompts',
		'none',
		'--no-session-persistence',
	]
	const denied = await worker('claude', [...args, '--tools', 'Read,Skill'], {
		cwd: workspace,
		timeoutSeconds: 90,
		prompt: 'Use checkmate:execute with request.json. You have no shell or write permission. Return needs_decision with artifact null if a required tool is unavailable. Do not invent a result.',
	})
	assert.equal(denied.status, 'needs_decision')
	assert.equal(denied.artifact, null)
	assert.equal(app.actions(), 0)
	const result = await worker('claude', [...args, '--allowedTools', 'Read,Write,Edit,Bash'], {
		cwd: workspace,
		timeoutSeconds: 240,
		prompt: 'Use checkmate:execute in this session with request.json. This is not a delegated candidate task. Apply the gate, begin the run, execute the tests, and publish the result with the Checkmate CLI. Return its response. Do not fix the application.',
	})
	assert.equal(result.status, 'completed', JSON.stringify(result))
	assert(result.artifact)
	const saved = await readReference(workspace, result.artifact)
	assert(saved.findings.some((finding) => finding.type === 'defect' && finding.requirementIds.includes('R2')))
	assert.equal(saved.coverage.status, 'partial')
	console.log('Same-session execution and live permission denial passed.')
} finally {
	await app.close()
}
