import test from 'node:test'
import assert from 'node:assert/strict'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { fixture } from './fixture.ts'
import type { Result } from '../plugin/src/types.ts'
import { sandbox, prepare, revised, executeRequest, observation, root, artifact, load } from './support.ts'
import { finalize } from '../plugin/src/stages.ts'

const exec = promisify(execFile)

test('real browser and API find the defect; caller fix passes a narrow retest', { timeout: 180000 }, async (t) => {
	const workspace = await sandbox(t)
	const app = await fixture()
	t.after(() => app.close())
	const p = await prepare(workspace, app.baseUrl),
		r = await revised(workspace, p)
	const browserConfig = join(workspace, 'browser.json')
	await writeFile(
		browserConfig,
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
	const session = `test-${Date.now()}`
	const cli = join(root, 'node_modules/.bin/playwright-cli')
	// A cold browser start on a shared CI runner can take most of a minute.
	const browser = async (args: string[]) =>
		(await exec(cli, [`-s=${session}`, ...args], { cwd: workspace, timeout: 60000, maxBuffer: 1024 * 1024 })).stdout
	t.after(() => browser(['close']).catch(() => {}))
	await browser(['open', app.baseUrl, `--config=${browserConfig}`, '--idle-timeout=30000'])
	await browser(['click', 'button'])
	const confirmation = await browser(['eval', '() => document.querySelector("#confirmation").textContent'])
	assert.match(confirmation, /Order confirmed: 400 PLN/)
	const response = await fetch(`${app.baseUrl}/quote?promotion=true&loyalty=true`, {
		signal: AbortSignal.timeout(5000),
	})
	const quote = await response.json()
	assert.equal(response.status, 200)
	assert.equal(quote.totalPLN, 220)
	const request = executeRequest(p, r)
	const candidate = await observation(workspace, request, r.plan, quote.totalPLN)
	const evidencePath = join(workspace, request.outputDirectory, 'evidence/T1.txt')
	await writeFile(evidencePath, confirmation)
	candidate.cleanup.reason = 'The isolated Playwright CLI session was closed.'
	await browser(['close'])
	const failed = await finalize(workspace, request, candidate)
	app.fix()
	const fixedResponse = await fetch(`${app.baseUrl}/quote?promotion=true&loyalty=true`)
	const fixed = await fixedResponse.json()
	assert.equal(fixed.totalPLN, 240)
	const retest = executeRequest(p, r, {
		requestId: 'retest',
		runId: 'run-2',
		outputDirectory: 'runs/run-2',
		selectedTestIds: ['T2'],
		applicationBuild: 'fixture-build-2',
		retestOf: artifact(failed),
	})
	const passed = await finalize(workspace, retest, await observation(workspace, retest, r.plan, fixed.totalPLN))
	const result = await load<Result>(workspace, artifact(passed))
	assert.equal(result.tests[1].outcome, 'passed')
	assert.equal(result.coverage.status, 'partial')
	assert.equal((await load<Result>(workspace, artifact(failed))).tests[1].outcome, 'failed')
})
