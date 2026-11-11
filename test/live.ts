import assert from 'node:assert/strict'
import { existsSync, readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import type { Plan } from '../plugin/src/types.ts'
import type { Measurement } from './live-support.ts'
import { delegate, worker, workerArgs } from '../cli/src/launcher.ts'
import { fixture } from './fixture.ts'
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
console.log(`Live workspace: ${workspace}`)

const request = {
	objective: 'Verify checkout totals and identify missing acceptance decisions.',
	requirements: [
		{ id: 'R1', text: 'A standard order for one 400 PLN item has a total of 400 PLN.', source: 'brief#standard' },
		{
			id: 'R2',
			text: 'A 40 percent promotion applies to the order. The brief does not say if it stacks with the 20 PLN loyalty discount.',
			source: 'brief#promotion',
		},
		{
			id: 'R3',
			text: 'Customers can request refunds. The brief does not say which orders qualify.',
			source: 'brief#refund',
		},
	],
	sourceContext: [
		{
			uri: 'brief',
			content:
				'The shop sells one item at 400 PLN. A loyal customer has a 20 PLN loyalty discount. A 40 percent promotion exists. Refunds exist.',
		},
	],
}

async function stage(name: string, kind: 'setup' | 'plan' | 'revise' | 'execute', subject: string) {
	const result = await measure(measurements, name, () =>
		delegate(workspace, kind, subject, { allowedTools, pluginRoot, timeoutSeconds: 420 })
	)
	assert(['completed', 'needs_decision'].includes(result.status), JSON.stringify(result))
	return result
}

function latestPlan(planId: string): Plan {
	return checkmate(workspace, ['plan', 'show', planId]).plan
}

function testsOf(plan: Plan, requirementId: string) {
	return plan.tests.filter((test) => test.requirementIds.includes(requirementId))
}

function requirementOfGap(plan: Plan, gap: Plan['gaps'][number]) {
	const scope = new Set([
		...gap.requirementIds,
		...plan.tests.filter((test) => gap.testIds.includes(test.id)).flatMap((test) => test.requirementIds),
	])
	assert(scope.size === 1, `Gap ${gap.id} needs one requirement scope: ${[...scope].join(', ')}`)
	return [...scope][0]
}

let passed = false
try {
	checkmate(workspace, [
		'target',
		'open',
		'checkout-local',
		'--base-url',
		app.baseUrl,
		'--capabilities',
		'browser,http',
		'--operations',
		'read_catalog,create_fixture_order,apply_fixture_discount',
	])
	assert.equal((await stage('setup', 'setup', 'checkout-local')).status, 'completed')
	const target = checkmate(workspace, ['target', 'show', 'checkout-local'])
	assert.equal(target.profile.readyForLiveExecution, true)

	checkmate(workspace, ['plan', 'open', 'checkout', '--target', `checkout-local@${target.revision}`], request)
	await stage('plan', 'plan', 'checkout')
	assert.equal(app.actions(), 0, 'Planning executed a fixture action')
	const first = latestPlan('checkout')
	for (const requirement of ['R2', 'R3'])
		assert(
			testsOf(first, requirement).some((test) => test.readiness === 'blocked'),
			`No ${requirement} test is blocked`
		)

	const blocking = first.gaps.filter((gap) => gap.status === 'open' && gap.severity === 'blocking')
	for (const gap of blocking) {
		const requirement = requirementOfGap(first, gap)
		assert(['R2', 'R3'].includes(requirement), `Unexpected blocking gap ${gap.id} for ${requirement}`)
		const decision =
			requirement === 'R2'
				? [
						'--kind',
						'clarify',
						'--value',
						'The promotion replaces the loyalty discount. With the promotion and loyalty, the quote total is 240 PLN.',
						'--source',
						'decisions#promotion',
					]
				: ['--kind', 'defer', '--value', 'Refunds are out of scope for this release.']
		checkmate(workspace, [
			'gap',
			'answer',
			'checkout',
			gap.id,
			...decision,
			'--rationale',
			'Product owner decision.',
		])
	}
	await stage('revise', 'revise', 'checkout')
	const revised = latestPlan('checkout')
	assert(revised.revision > first.revision, 'No new revision')
	assert.equal(checkmate(workspace, ['plan', 'pending', 'checkout']).decisions.length, 0)
	assert(
		testsOf(revised, 'R2').some((test) => test.readiness === 'ready'),
		'No R2 test is ready'
	)
	const reference = `checkout@${revised.revision}`
	checkmate(workspace, ['plan', 'approve', reference, '--rationale', 'Reviewed the revision.'])

	const ready = revised.tests.filter((test) => test.readiness === 'ready').map((test) => test.id)
	checkmate(workspace, [
		'run',
		'begin',
		'live-run',
		reference,
		'--tests',
		ready.join(','),
		'--build',
		'fixture-build-1',
	])
	await stage('execute', 'execute', 'live-run')
	const failed = checkmate(workspace, ['run', 'show', 'live-run'])
	assert.equal(failed.state, 'finalized')
	assert(
		failed.findings.some(
			(finding: { type: string; requirementIds: string[] }) =>
				finding.type === 'defect' && finding.requirementIds.includes('R2')
		),
		'No R2 defect'
	)
	assert.equal(failed.result.coverage.status, 'partial')
	checkmate(workspace, ['result', 'accept', 'live-run', '--rationale', 'The defect is real.'])

	app.fix()
	const retested = testsOf(revised, 'R2')
		.filter((test) => test.readiness === 'ready')
		.map((test) => test.id)
	const prerequisites = revised.tests
		.filter((test) => retested.includes(test.id))
		.flatMap((test) => test.dependsOn.filter((id) => !retested.includes(id)))
	checkmate(workspace, [
		'run',
		'begin',
		'live-retest',
		reference,
		'--tests',
		[...new Set([...prerequisites, ...retested])].join(','),
		'--build',
		'fixture-build-2',
		'--retest-of',
		'live-run',
	])
	await stage('retest', 'execute', 'live-retest')
	const retest = checkmate(workspace, ['run', 'show', 'live-retest'])
	assert.equal(retest.state, 'finalized')
	assert(
		retest.tests.every((test: { outcome: string }) => test.outcome === 'passed'),
		JSON.stringify(retest.tests)
	)
	assert.equal(retest.result.coverage.status, 'partial')
	assert.equal(checkmate(workspace, ['run', 'show', 'live-run']).result.completion, 'completed')
	assert.deepEqual(readdirSync(join(workspace, '.checkmate')), ['checkmate.db'])
	assert.equal(existsSync(join(workspace, '.playwright-cli')), false)

	checkmate(workspace, ['export', 'run', 'live-run', '--format', 'html', '--out', 'reports/live-run.html'])
	assert.match(readFileSync(join(workspace, 'reports/live-run.html'), 'utf8'), /live-run/)

	checkmate(workspace, ['plan', 'open', 'same-session', '--target', `checkout-local@${target.revision}`], request)
	await measure(measurements, 'same-session-plan', () =>
		worker('claude', workerArgs(pluginRoot, allowedTools), {
			cwd: workspace,
			timeoutSeconds: 420,
			env: { ...process.env, CHECKMATE_ACTOR: 'claude:same-session' },
			prompt: 'Use the checkmate:plan skill in this session. Plan ID: same-session. Its plan request is recorded. Read it with `plan request same-session`. This is not a delegated stage. Save revision 1 with the Checkmate CLI and return the response of plan save. Do not execute tests.',
		})
	)
	assert.equal(latestPlan('same-session').revision, 1)
	passed = true
	console.log(
		'Live acceptance passed: setup, plan, decisions, revise, approve, execute, accept, retest, same-session plan.'
	)
} finally {
	await app.close()
	saveMeasurements(workspace, measurements, passed)
}
