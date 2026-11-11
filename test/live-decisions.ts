import assert from 'node:assert/strict'
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { createServer } from 'node:http'
import type { AddressInfo } from 'node:net'
import { join } from 'node:path'
import type { Store } from '../plugin/src/store.ts'
import type { PlanCandidate, PlanRequest } from '../plugin/src/types.ts'
import type { Measurement } from './live-support.ts'
import { delegate, worker, workerArgs } from '../cli/src/launcher.ts'
import { answerGap, approvePlan, rejectPlan } from '../plugin/src/plans.ts'
import { beginRun, checkAssertion, closeTest, finishRun, rejectResult, runResult } from '../plugin/src/runs.ts'
import { closeStore, openStore } from '../plugin/src/store.ts'
import { evidenceBytes, planDetail, runDetail, runList } from '../plugin/src/views.ts'
import { actor, evidenceFile, plan, target } from './support.ts'
import { allowedTools, liveEnvironment, liveWorkspace, measure, pluginRoot, saveMeasurements } from './live-support.ts'

const rejection = 'Evidence should be fullpage screenshots'
const correction = 'Replace T1.A1 with an assertion that the page footer shows End of fixture.'
const assumption = 'The page footer says End of fixture.'
const assumptionRationale = 'Use the fixture copy as a provisional acceptance rule.'
const viewport = { width: 1280, height: 720 }
const pageHeight = 2400
const build = 'fixture-build-1'
const originalRun = 'evidence-original'
const retryRun = 'evidence-retry'

async function fixture() {
	let requests = 0
	const server = createServer((request, response) => {
		if (request.url === '/health') {
			response.setHeader('Content-Type', 'application/json')
			return response.end('{"ready":true}')
		}
		requests++
		if (request.url !== '/') {
			response.statusCode = 404
			return response.end('Not found')
		}
		response.setHeader('Content-Type', 'text/html')
		response.end(`<!doctype html><html lang="en"><meta charset="utf-8"><title>Evidence fixture</title>
<style>html,body{margin:0}body{height:${pageHeight}px;background:#eef2f6;font:24px sans-serif}
main{padding:40px}footer{position:absolute;top:2300px;left:40px}</style>
<main><h1>Evidence fixture</h1><p>Status: ready</p><p>This page extends beyond the browser viewport.</p></main>
<footer>End of fixture</footer></html>`)
	})
	await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
	return {
		baseUrl: `http://127.0.0.1:${(server.address() as AddressInfo).port}`,
		requests: () => requests,
		async close() {
			server.closeAllConnections()
			await new Promise<void>((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())))
		},
	}
}

function candidate(): PlanCandidate {
	return {
		tests: [
			{
				id: 'T1',
				title: 'Fixture page',
				requirementIds: ['R1'],
				capability: 'browser',
				operations: ['read_fixture'],
				dependsOn: [],
				preconditions: [],
				action: 'Open / and read the fixture page.',
				assertions: [{ id: 'A1', check: 'The page shows Status: ready.', oracleKind: 'agent_observation' }],
			},
		],
		gaps: [],
	}
}

const request: PlanRequest = {
	objective: 'Check the fixture page text.',
	requirements: [
		{ id: 'R1', text: 'The page shows Status: ready and a footer with End of fixture.', source: 'fixture-brief' },
	],
	sourceContext: [
		{ uri: 'fixture-brief', content: 'The page has status text at the top and a footer at the bottom.' },
	],
}

liveEnvironment()
const app = await fixture()
const workspace = liveWorkspace(app.baseUrl)
const measurements: Measurement[] = []
const configPath = join(workspace, '.playwright/cli.config.json')
const config = JSON.parse(readFileSync(configPath, 'utf8'))
config.browser.contextOptions = { viewport }
writeFileSync(configPath, JSON.stringify(config))
writeFileSync(
	join(workspace, 'AGENTS.md'),
	[
		'# Evidence fixture',
		'',
		`The caller owns the fixture at ${app.baseUrl}. Do not change its code or build identifier.`,
		'The only application page is /. It shows Status: ready and a footer with End of fixture.',
		'Use the caller-provided playwright-cli for browser actions with `.playwright/cli.config.json`.',
		'Keep its 1280 by 720 viewport. Use `open --idle-timeout=30000`. Close only sessions you create.',
		'Use only GET /health during setup or planning. The fixture stores no records and needs no record cleanup.',
		'',
	].join('\n')
)
console.log(`Decision workspace: ${workspace}`)

function inspect<T>(read: (store: Store) => T): T {
	const store = openStore(workspace)
	try {
		return read(store)
	} finally {
		closeStore(store)
	}
}

function stage(name: string, prompt: string, timeoutSeconds = 240) {
	return measure(measurements, name, () =>
		worker('claude', workerArgs(pluginRoot, allowedTools), {
			cwd: workspace,
			timeoutSeconds,
			env: { ...process.env, CHECKMATE_ACTOR: 'claude:decisions' },
			prompt,
		})
	)
}

let passed = false
try {
	const original = inspect((store) => {
		target(store, {
			baseUrl: app.baseUrl,
			capabilities: ['browser'],
			tooling: [{ capability: 'browser', executable: 'playwright-cli', version: '0.1.23' }],
			allowedOperations: ['read_fixture'],
		})
		for (const planId of ['evidence-review', 'plan-review', 'delegated-review']) {
			plan(store, planId, candidate(), request)
			approvePlan(store, actor, { reference: `${planId}@1`, rationale: 'Reviewed fixture scope.' })
		}
		rejectPlan(store, actor, { reference: 'plan-review@1', rationale: correction })
		rejectPlan(store, actor, { reference: 'delegated-review@1', rationale: correction })
		assert.equal(
			beginRun(store, actor, {
				runId: originalRun,
				reference: 'evidence-review@1',
				tests: ['T1'],
				build,
			}).status,
			'completed'
		)
		checkAssertion(store, actor, {
			runId: originalRun,
			testId: 'T1',
			assertionId: 'A1',
			result: 'passed',
			observed: 'The page shows Status: ready.',
			evidence: [evidenceFile(store, originalRun, 'T1-A1.txt', 'Status: ready')],
		})
		closeTest(store, actor, { runId: originalRun, testId: 'T1' })
		finishRun(store, actor, {
			runId: originalRun,
			completion: 'completed',
			cleanup: 'completed',
			cleanupReason: 'Seeded observation has no browser session.',
		})
		rejectResult(store, actor, { runId: originalRun, rationale: rejection })

		const gapCandidate = candidate()
		gapCandidate.tests[0].assertions = []
		gapCandidate.gaps = [
			{
				id: 'G1',
				severity: 'blocking',
				status: 'open',
				requirementIds: ['R1'],
				testIds: ['T1'],
				question: 'What is the accepted footer copy?',
				consequence: 'The footer text cannot be asserted.',
				decisionId: null,
			},
		]
		plan(store, 'gap-review', gapCandidate, request)
		answerGap(store, actor, {
			planId: 'gap-review',
			gapId: 'G1',
			kind: 'accept_assumption',
			value: assumption,
			rationale: assumptionRationale,
		})
		return {
			run: runDetail(store, originalRun),
			result: runResult(store, originalRun),
			plan: planDetail(store, 'plan-review', 1),
		}
	})

	const summary = await stage(
		'rejected-result-summary',
		`I rejected run ${originalRun}. Use checkmate:report to summarize its current review state and the recorded reviewer rationale. Include the rationale in your response reasons. This request is only for a summary.`
	)
	assert.match(summary.reasons.join(' '), /full.?page/i, JSON.stringify(summary))
	assert.match(summary.reasons.join(' '), /screenshot/i, JSON.stringify(summary))
	assert.deepEqual(
		inspect((store) => runDetail(store, originalRun)),
		original.run
	)
	assert.deepEqual(
		inspect((store) => runList(store).map((run) => run.runId)),
		[originalRun]
	)
	assert.equal(existsSync(join(workspace, 'reports')), false)
	assert.equal(app.requests(), 0, 'A summary accessed the application')

	const corrected = await stage(
		'rejected-plan-correction',
		'I rejected plan-review. Use checkmate:revise in this session to make the correction I recorded in its rejection reason. Save the corrected revision. This is not a delegated stage. Do not execute tests.'
	)
	assert.equal(corrected.status, 'completed', JSON.stringify(corrected))
	const correctedPlan = inspect((store) => planDetail(store, 'plan-review'))
	assert.equal(correctedPlan.revision, 2)
	assert.equal(correctedPlan.approval.state, 'pending')
	assert.equal(correctedPlan.approval.latest, null)
	assert.match(correctedPlan.plan.tests[0].assertions[0].check, /End of fixture/)
	assert.match(correctedPlan.plan.tests[0].assertions[0].check, /footer/i)
	assert.deepEqual(
		inspect((store) => planDetail(store, 'plan-review', 1).plan),
		original.plan.plan
	)
	assert.equal(
		inspect((store) => planDetail(store, 'plan-review', 1).approval.latest?.rationale),
		correction
	)
	assert.equal(app.requests(), 0, 'A plan correction accessed the application')
	assert.deepEqual(
		inspect((store) => runList(store).map((run) => run.runId)),
		[originalRun]
	)

	const delegated = await measure(measurements, 'delegated-rejected-plan-correction', () =>
		delegate(workspace, 'revise', 'delegated-review', { allowedTools, pluginRoot, timeoutSeconds: 240 })
	)
	assert(['completed', 'needs_decision'].includes(delegated.status), JSON.stringify(delegated))
	assert(delegated.operation, 'The delegated correction did not save a verified revision')
	const delegatedPlan = inspect((store) => planDetail(store, 'delegated-review'))
	assert.equal(delegatedPlan.revision, 2)
	assert.equal(delegatedPlan.approval.state, 'pending')
	assert.match(delegatedPlan.plan.tests[0].assertions[0].check, /End of fixture/)
	assert.match(delegatedPlan.plan.tests[0].assertions[0].check, /footer/i)
	assert.equal(
		inspect((store) => planDetail(store, 'delegated-review', 1).approval.latest?.rationale),
		correction
	)
	assert.equal(app.requests(), 0, 'A delegated plan correction accessed the application')
	assert.deepEqual(
		inspect((store) => runList(store).map((run) => run.runId)),
		[originalRun]
	)

	const revised = await stage(
		'accepted-assumption-revision',
		'Use checkmate:revise to apply my pending gap decision for gap-review. Save the next revision and read it back. Do not execute tests.'
	)
	assert.equal(revised.status, 'completed', JSON.stringify(revised))
	const revisedPlan = inspect((store) => planDetail(store, 'gap-review'))
	assert.equal(revisedPlan.revision, 2)
	assert.equal(revisedPlan.approval.state, 'pending')
	assert.deepEqual(revisedPlan.pendingDecisions, [])
	assert.equal(revisedPlan.plan.gaps[0].status, 'resolved')
	assert.equal(revisedPlan.plan.decisions[0].kind, 'accept_assumption')
	assert.equal(revisedPlan.plan.decisions[0].value, assumption)
	assert.equal(revisedPlan.plan.decisions[0].rationale, assumptionRationale)
	assert.equal(revisedPlan.plan.assumptions[0].text, assumption)
	assert.match(revisedPlan.plan.tests[0].assertions.map((assertion) => assertion.check).join(' '), /End of fixture/)
	assert.equal(revisedPlan.plan.tests[0].readiness, 'ready')
	assert.equal(app.requests(), 0, 'A gap revision accessed the application')

	const retry = await stage(
		'rejected-result-retry',
		`I rejected run ${originalRun}, try again. Use checkmate:execute in this session. The application is unchanged at build ${build}. Name the new run ${retryRun}.`,
		420
	)
	assert.equal(retry.status, 'completed', JSON.stringify(retry))
	const replacement = inspect((store) => runDetail(store, retryRun))
	assert.equal(replacement.state, 'finalized')
	assert.equal(replacement.request.retestOf, originalRun)
	assert.equal(replacement.build, build)
	assert.equal(replacement.planSha256, original.run.planSha256)
	assert.equal(replacement.result?.acceptance, 'pending')
	assert.equal(replacement.tests[0].outcome, 'passed')
	assert.deepEqual(
		inspect((store) => runResult(store, originalRun)),
		original.result
	)
	assert.deepEqual(
		inspect((store) => runDetail(store, originalRun)),
		original.run
	)
	assert.deepEqual(
		inspect((store) => runList(store).map((run) => run.runId)),
		[originalRun, retryRun]
	)
	assert(app.requests() > 0, 'The retry did not open the application')
	const evidence = replacement.tests[0].assertions[0].evidence
	assert(evidence.length > 0, 'No replacement evidence was recorded')
	for (const item of evidence) {
		assert.equal(item.mediaType, 'image/png', 'The retry repeated the rejected text-only evidence')
		assert.equal(item.kind, 'screenshot')
		const bytes = Buffer.from(inspect((store) => evidenceBytes(store, item.id).bytes))
		assert.deepEqual(bytes.subarray(0, 8), Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))
		assert.equal(bytes.readUInt32BE(16), viewport.width)
		assert.equal(bytes.readUInt32BE(20), pageHeight, 'The screenshot did not capture the full page')
		assert(bytes.readUInt32BE(20) > viewport.height)
		console.log(JSON.stringify({ evidenceId: item.id, width: viewport.width, height: pageHeight }))
	}

	const requestsBeforeAcceptance = app.requests()
	const accepted = await stage(
		'explicit-approval-and-acceptance',
		`I approve plan-review@2 with rationale "The footer assertion now matches my review." I accept result ${retryRun} with rationale "The full-page evidence satisfies my review." Record these decisions, read both records back, and summarize their current decision states in your response reasons. Do not execute tests.`
	)
	assert.equal(accepted.status, 'completed', JSON.stringify(accepted))
	const decisions = inspect((store) => ({ plan: planDetail(store, 'plan-review'), run: runDetail(store, retryRun) }))
	assert.equal(decisions.plan.approval.state, 'approved')
	assert.equal(decisions.plan.approval.latest?.rationale, 'The footer assertion now matches my review.')
	assert.equal(decisions.run.result?.acceptance, 'approved')
	assert.equal(decisions.run.result?.latestDecision?.rationale, 'The full-page evidence satisfies my review.')
	assert.equal(decisions.run.result?.sha256, replacement.result?.sha256)
	assert.equal(app.requests(), requestsBeforeAcceptance, 'Accepting decisions re-executed the application')
	assert.deepEqual(
		inspect((store) => runList(store).map((run) => run.runId)),
		[originalRun, retryRun]
	)
	assert.equal(
		inspect((store) => runDetail(store, originalRun).result?.acceptance),
		'rejected'
	)
	passed = true
	console.log(
		'Live decision paths passed: summary, rejected-plan correction, assumption, full-page retry, approval, acceptance.'
	)
} finally {
	await app.close()
	saveMeasurements(workspace, measurements, passed)
}
