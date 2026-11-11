import assert from 'node:assert/strict'
import { writeFileSync } from 'node:fs'
import { createServer } from 'node:http'
import type { AddressInfo } from 'node:net'
import { join } from 'node:path'
import type { Measurement } from './live-support.ts'
import { delegate } from '../cli/src/launcher.ts'
import { answerGap, rejectPlan } from '../plugin/src/plans.ts'
import { closeStore, openStore } from '../plugin/src/store.ts'
import { operationLog, planDetail, runList } from '../plugin/src/views.ts'
import { actor, approved, candidate, plan, planRequest, target } from './support.ts'
import { allowedTools, liveEnvironment, liveWorkspace, measure, pluginRoot, saveMeasurements } from './live-support.ts'

const objective = 'Verify standard checkout totals; defer refund coverage.'
const check = 'The confirmation shows Order confirmed.'
const rationale = `Change the objective to "${objective}" Replace T1.A2 with "${check}" Keep T1.A1 unchanged.`
const deferRationale = 'Refund acceptance is outside this release.'

liveEnvironment()
let requests = 0
const server = createServer((_request, response) => {
	requests++
	response.statusCode = 503
	response.end('This plan revision does not authorize application access.')
})
await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
const baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`
const workspace = liveWorkspace(baseUrl)
const measurements: Measurement[] = []
writeFileSync(
	join(workspace, 'AGENTS.md'),
	[
		'# Plan correction fixture',
		'',
		'This task authorizes plan changes only. Read the recorded request and caller decisions.',
		'Do not access the application, execute tests, or approve the new revision.',
		'',
	].join('\n')
)
console.log(`Mixed decision workspace: ${workspace}`)

let passed = false
try {
	const store = openStore(workspace)
	let original
	try {
		target(store, { baseUrl })
		const checkout = candidate()
		checkout.tests = checkout.tests.filter((test) => test.id !== 'T2')
		checkout.gaps = checkout.gaps.filter((gap) => gap.id === 'G2')
		const request = planRequest()
		request.requirements = request.requirements.filter((requirement) => requirement.id !== 'R2')
		request.sourceContext.push({
			uri: 'fixture-interface',
			content: 'The checkout confirmation includes the text Order confirmed followed by the total.',
		})
		plan(store, 'checkout', checkout, request)
		approved(store, 'checkout', 1)
		rejectPlan(store, actor, { reference: 'checkout@1', rationale })
		answerGap(store, actor, {
			planId: 'checkout',
			gapId: 'G2',
			kind: 'defer',
			value: 'Do not check refunds in this scope.',
			rationale: deferRationale,
		})
		original = planDetail(store, 'checkout')
		assert.equal(original.approval.state, 'rejected')
		assert.equal(original.pendingDecisions.length, 1)
		assert.deepEqual(runList(store), [])
	} finally {
		closeStore(store)
	}

	const revised = await measure(measurements, 'rejected-plan-with-unrelated-gap', () =>
		delegate(workspace, 'revise', 'checkout', { allowedTools, pluginRoot, timeoutSeconds: 300 })
	)
	assert(['completed', 'needs_decision'].includes(revised.status), JSON.stringify(revised))
	assert(revised.operation, 'The mixed correction did not save a verified revision')
	assert.equal(revised.subject, 'checkout@3', 'The response did not identify the final edited revision')

	const updated = openStore(workspace)
	try {
		const detail = planDetail(updated, 'checkout')
		assert.equal(detail.revision, 3)
		assert.equal(detail.approval.state, 'pending')
		assert.equal(detail.approval.latest, null)
		assert.equal(detail.plan.objective, objective)
		assert.equal(
			detail.plan.tests.find((test) => test.id === 'T1')?.assertions.find((item) => item.id === 'A2')?.check,
			check
		)
		assert.deepEqual(
			detail.plan.tests.find((test) => test.id === 'T1')?.assertions.find((item) => item.id === 'A1'),
			original.plan.tests.find((test) => test.id === 'T1')?.assertions.find((item) => item.id === 'A1')
		)
		assert.deepEqual(detail.pendingDecisions, [])
		assert.equal(detail.plan.gaps[0].id, 'G2')
		assert.equal(detail.plan.gaps[0].status, 'deferred')
		assert.equal(detail.plan.tests.find((test) => test.id === 'T3')?.readiness, 'deferred')
		assert.equal(detail.plan.decisions[0].kind, 'defer')
		assert.equal(detail.plan.decisions[0].rationale, deferRationale)
		assert.equal(detail.plan.decisions[0].value, original.pendingDecisions[0].value)
		const prior = planDetail(updated, 'checkout', 1)
		assert.deepEqual(prior.plan, original.plan)
		assert.equal(prior.sha256, original.sha256)
		assert.equal(prior.approval.state, 'rejected')
		assert.equal(prior.approval.latest?.rationale, rationale)
		const applied = planDetail(updated, 'checkout', 2)
		assert.equal(applied.plan.gaps[0].status, 'deferred')
		assert.equal(applied.plan.objective, original.plan.objective)
		assert.equal(applied.approval.state, 'pending')
		const writes = operationLog(updated)
			.filter(
				(operation) =>
					operation.status !== 'rejected' && ['plan revise', 'plan edit'].includes(operation.command)
			)
			.reverse()
		assert.deepEqual(
			writes.map((operation) => operation.command),
			['plan revise', 'plan edit']
		)
		assert.equal(writes.at(-1)?.id, revised.operation)
		assert.deepEqual(runList(updated), [])
	} finally {
		closeStore(updated)
	}
	assert.equal(requests, 0, 'A plan correction accessed the application')
	passed = true
	console.log(
		'Live mixed decision passed: unrelated gap applied, original rejection corrected, final revision pending.'
	)
} finally {
	server.closeAllConnections()
	await new Promise<void>((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())))
	saveMeasurements(workspace, measurements, passed)
}
