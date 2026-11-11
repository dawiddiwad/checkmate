import test from 'node:test'
import assert from 'node:assert/strict'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import type { Store } from '../plugin/src/store.ts'
import { fixture } from './fixture.ts'
import { checkAssertion, closeTest, finishRun, recordFinding, runResult } from '../plugin/src/runs.ts'
import { actor, approved, begin, candidate, evidenceFile, plan, revised, root, store, target } from './support.ts'

const exec = promisify(execFile)

function record(opened: Store, runId: string, reference: string, result: 'passed' | 'failed', observed: string) {
	const [testId, assertionId] = reference.split('.')
	const evidence = evidenceFile(opened, runId, `${reference}.txt`, observed)
	return checkAssertion(opened, actor, { runId, testId, assertionId, result, observed, evidence: [evidence] })
}

async function quote(baseUrl: string) {
	const response = await fetch(`${baseUrl}/quote?promotion=true&loyalty=true`, { signal: AbortSignal.timeout(5000) })
	return { status: response.status, body: (await response.json()) as { totalPLN: number } }
}

function finish(opened: Store, runId: string) {
	return finishRun(opened, actor, {
		runId,
		completion: 'completed',
		cleanup: 'completed',
		cleanupReason: 'The isolated Playwright CLI session was closed.',
	})
}

test('real browser and API find the defect; caller fix passes a narrow retest', { timeout: 180000 }, async (t) => {
	const opened = store(t)
	const app = await fixture()
	t.after(() => app.close())
	target(opened, { baseUrl: app.baseUrl })
	const independent = candidate()
	independent.tests[1].dependsOn = []
	plan(opened, 'checkout', independent)
	revised(opened)
	approved(opened)
	begin(opened, 'run-1', ['T1', 'T2'], 'fixture-build-1')

	const browserConfig = join(opened.workspace, 'browser.json')
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
		(await exec(cli, [`-s=${session}`, ...args], { cwd: opened.workspace, timeout: 60000, maxBuffer: 1024 * 1024 }))
			.stdout
	t.after(() => browser(['close']).catch(() => {}))
	await browser(['open', app.baseUrl, `--config=${browserConfig}`, '--idle-timeout=30000'])
	await browser(['click', 'button'])
	const confirmation = await browser(['eval', '() => document.querySelector("#confirmation").textContent'])
	assert.match(confirmation, /Order confirmed: 400 PLN/)
	const page = await browser(['eval', '() => document.body.innerText'])
	assert.match(page, /One item: 400 PLN/)
	await browser(['close'])
	record(opened, 'run-1', 'T1.A1', 'passed', confirmation.trim())
	record(opened, 'run-1', 'T1.A2', 'passed', 'The page lists one item: 400 PLN.')
	closeTest(opened, actor, { runId: 'run-1', testId: 'T1' })

	const defect = await quote(app.baseUrl)
	assert.equal(defect.status, 200)
	assert.equal(defect.body.totalPLN, 220)
	record(opened, 'run-1', 'T2.A1', 'passed', 'HTTP 200')
	const failed = record(opened, 'run-1', 'T2.A2', 'failed', `totalPLN = ${defect.body.totalPLN}`)
	recordFinding(opened, actor, {
		runId: 'run-1',
		finding: {
			id: 'F1',
			type: 'defect',
			severity: 'medium',
			assertionIds: ['T2.A2'],
			requirementIds: ['R2'],
			title: 'Promotion stacks with loyalty',
			expected: '240 PLN',
			observed: '220 PLN',
			reproduction: ['Create a 400 PLN cart with 20 PLN loyalty.', 'Apply the promotion.', 'Read the quote.'],
			evidenceIds: failed.data.evidenceIds as string[],
		},
	})
	closeTest(opened, actor, { runId: 'run-1', testId: 'T2' })
	assert.equal(finish(opened, 'run-1').status, 'completed')

	app.fix()
	const fixed = await quote(app.baseUrl)
	assert.equal(fixed.body.totalPLN, 240)
	begin(opened, 'run-2', ['T2'], 'fixture-build-2', { retestOf: 'run-1' })
	record(opened, 'run-2', 'T2.A1', 'passed', 'HTTP 200')
	record(opened, 'run-2', 'T2.A2', 'passed', `totalPLN = ${fixed.body.totalPLN}`)
	closeTest(opened, actor, { runId: 'run-2', testId: 'T2' })
	finish(opened, 'run-2')
	const retest = runResult(opened, 'run-2')!.result
	assert.equal(retest.tests[1].outcome, 'passed')
	assert.equal(retest.retestOf, 'run-1')
	assert.equal(retest.coverage.status, 'partial')
	assert.equal(runResult(opened, 'run-1')!.result.tests[1].outcome, 'failed')
})
