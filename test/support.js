import { mkdtemp, readFile, writeFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { publish, readDocument, readReference } from '../plugin/src/files.ts'
import { setup, savePlan, beginRun } from '../plugin/src/stages.ts'

export const root = fileURLToPath(new URL('..', import.meta.url))
export async function sandbox(t) {
	const directory = await mkdtemp(join(tmpdir(), 'checkmate-test-'))
	t?.after(() => rm(directory, { recursive: true, force: true }))
	return directory
}
export async function fixtureJson(name) {
	return JSON.parse(await readFile(new URL(`./fixtures/${name}.json`, import.meta.url)))
}
export async function prepare(workspace, baseUrl = 'http://127.0.0.1:4173') {
	const profile = {
		contractVersion: 'toolkit-1',
		targetId: 'checkout-local',
		revision: 1,
		baseUrl,
		environment: 'local_fixture',
		capabilities: ['browser', 'http'],
		tooling: [
			{ capability: 'browser', executable: 'playwright-cli', version: '0.1.23' },
			{ capability: 'http', executable: 'node', version: process.version },
		],
		authentication: { kind: 'none', references: [] },
		allowedOperations: ['read_catalog', 'create_fixture_order', 'apply_fixture_discount'],
		startup: { owner: 'caller', command: null },
		cleanup: 'Close the run browser session. The fixture stores no records.',
		readyForLiveExecution: true,
	}
	const setupRequest = {
		contractVersion: 'toolkit-1',
		requestId: 'setup-1',
		caller: 'test-caller',
		operation: 'setup',
		profilePath: 'profile.json',
		targetId: profile.targetId,
		baseUrl,
		capabilities: profile.capabilities,
		allowedOperations: profile.allowedOperations,
	}
	const target = (await setup(workspace, setupRequest, profile)).artifact
	const plan = await fixtureJson('plan')
	plan.target = target
	const planRequest = await fixtureJson('plan-request')
	planRequest.target = target
	const saved = await savePlan(workspace, planRequest, plan)
	return {
		profile,
		target,
		plan: await readReference(workspace, saved.artifact),
		planRequest,
		setupRequest,
		base: saved.artifact,
	}
}
export async function revised(workspace, prepared) {
	const decisions = await fixtureJson('decisions')
	const request = {
		contractVersion: 'toolkit-1',
		requestId: 'revise-1',
		caller: 'test-caller',
		operation: 'revise',
		basePlan: prepared.base,
		baseRevision: 1,
		decisions,
	}
	const plan = structuredClone(prepared.plan)
	delete plan.coverage
	plan.revision = 2
	plan.previousRevision = 1
	plan.decisions = decisions
	plan.gaps[0].status = 'resolved'
	plan.gaps[0].decisionId = 'D1'
	plan.gaps[1].status = 'deferred'
	plan.gaps[1].decisionId = 'D2'
	plan.tests[1].readiness = 'ready'
	plan.tests[1].expected = 'HTTP 200 and totalPLN equals 240, with the loyalty discount replaced.'
	plan.tests[2].readiness = 'deferred'
	const saved = await savePlan(workspace, request, plan)
	return { request, candidate: plan, plan: await readReference(workspace, saved.artifact), reference: saved.artifact }
}
export function executeRequest(prepared, revision, overrides = {}) {
	return {
		contractVersion: 'toolkit-1',
		requestId: 'execute-1',
		caller: 'test-caller',
		operation: 'execute',
		runId: 'run-1',
		plan: revision.reference,
		target: prepared.target,
		selectedTestIds: ['T1', 'T2'],
		partialExecution: 'wait_for_resolution',
		timeoutSeconds: 180,
		onNewBlocker: 'return_to_caller',
		applicationBuild: 'fixture-build-1',
		outputDirectory: 'runs/run-1',
		...overrides,
	}
}
export async function observation(workspace, request, plan, total = 220) {
	await beginRun(workspace, request)
	const { value: invocation } = await readDocument(workspace, `${request.outputDirectory}/invocation.json`)
	const evidence = []
	const tests = []
	for (const test of plan.tests) {
		const selected = request.selectedTestIds.includes(test.id)
		const failed = test.id === 'T2' && total !== 240
		const observed = test.id === 'T1' ? 'Order confirmed: 400 PLN' : `HTTP 200; totalPLN = ${total}`
		if (selected) {
			await publish(workspace, `${request.outputDirectory}/evidence/${test.id}.txt`, observed)
			evidence.push({ id: `E-${test.id}`, kind: 'observation', path: `evidence/${test.id}.txt` })
		}
		tests.push({
			testId: test.id,
			outcome: selected ? (failed ? 'failed' : 'passed') : 'not_run',
			expected: test.expected,
			observed: selected ? observed : null,
			assertionKind: selected ? test.oracleKind : null,
			evidenceIds: selected ? [`E-${test.id}`] : [],
			reason: selected
				? failed
					? 'Observed total differs from expected total.'
					: null
				: 'Test was not selected or was deferred.',
		})
	}
	return {
		contractVersion: 'toolkit-1',
		requestId: request.requestId,
		runId: request.runId,
		completion: 'completed',
		plan: request.plan,
		target: request.target,
		applicationBuild: request.applicationBuild,
		selectedTestIds: request.selectedTestIds,
		startedAt: invocation.startedAt,
		tests,
		findings: tests.some((test) => test.outcome === 'failed')
			? [
					{
						id: 'F1',
						type: 'defect',
						severity: 'medium',
						testIds: ['T2'],
						requirementIds: ['R2'],
						title: 'Promotion stacks with loyalty',
						expected: '240 PLN',
						observed: `${total} PLN`,
						reproduction: [
							'Create a 400 PLN cart with 20 PLN loyalty.',
							'Apply a 40 percent promotion.',
							'Read the quote total.',
						],
						evidenceIds: ['E-T2'],
					},
				]
			: [],
		newGaps: [],
		evidence,
		cleanup: { status: 'completed', reason: 'No live resources in this unit fixture.' },
		...(request.retestOf ? { retestOf: request.retestOf } : {}),
	}
}
export async function write(workspace, name, value) {
	await writeFile(join(workspace, name), JSON.stringify(value, null, 2) + '\n')
}
