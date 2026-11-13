import assert from 'node:assert/strict'
import type { Measurement } from './live-support.ts'
import { worker, workerArgs } from '../cli/src/launcher.ts'
import { closeStore, openStore } from '../plugin/src/store.ts'
import { fixture } from './fixture.ts'
import { approved, candidate, plan, revised, target } from './support.ts'
import {
	allowedTools,
	checkmate,
	liveEnvironment,
	liveWorkspace,
	measure,
	pluginRoot,
	saveMeasurements,
} from './live-support.ts'

liveEnvironment()
const app = await fixture()
const workspace = liveWorkspace(app.baseUrl)
const measurements: Measurement[] = []
console.log(`Same-session workspace: ${workspace}`)

const task =
	'Use the checkmate:execute skill in this session. This is not a delegated stage. Plan revision: checkout@2. Tests: T1,T2. Build: fixture-build-1. Run ID: live-session.'
const env = { ...process.env, CHECKMATE_ACTOR: 'claude:same-session' }

let passed = false
try {
	const store = openStore(workspace)
	target(store, { baseUrl: app.baseUrl })
	const checkout = candidate()
	checkout.tests[0].assertions[1].check = 'The page lists one item before checkout.'
	plan(store, 'checkout', checkout)
	revised(store)
	approved(store)
	closeStore(store)

	const denied = await measure(measurements, 'denied-execute', () =>
		worker('claude', [...workerArgs(pluginRoot, []), '--tools', 'Read,Skill'], {
			cwd: workspace,
			timeoutSeconds: 180,
			env,
			prompt: `${task} You have no shell permission. Return needs_decision with the missing tool as a reason if a required tool is unavailable. Do not invent a result.`,
		})
	)
	assert.equal(denied.status, 'needs_decision', JSON.stringify(denied))
	assert.equal(app.actions(), 0)
	assert.deepEqual(checkmate(workspace, ['run', 'list']).runs, [])

	const executed = await measure(measurements, 'same-session-execute', () =>
		worker('claude', workerArgs(pluginRoot, allowedTools), {
			cwd: workspace,
			timeoutSeconds: 420,
			env,
			prompt: `${task} Check the gate, begin the run, execute the tests, and finish the run. Do not fix the application. Return the response of run finish.`,
		})
	)
	assert.equal(executed.status, 'completed', JSON.stringify(executed))
	const run = checkmate(workspace, ['run', 'show', 'live-session'])
	assert.equal(run.state, 'finalized')
	assert(
		run.findings.some(
			(finding: { type: string; requirementIds: string[] }) =>
				finding.type === 'defect' && finding.requirementIds.includes('R2')
		),
		'No R2 defect'
	)
	assert.equal(run.result.coverage.status, 'partial')
	passed = true
	console.log('Same-session execution and live permission denial passed.')
} finally {
	await app.close()
	saveMeasurements(workspace, measurements, passed)
}
