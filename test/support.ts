import type { TestContext } from 'node:test'
import type {
	ExecuteRequest,
	Observation,
	Plan,
	PlanRequest,
	Profile,
	Reference,
	Response,
	ReviseRequest,
	SetupRequest,
} from '../plugin/src/types.ts'
import { schema, validate, type PlanCandidate } from '../plugin/src/contracts.ts'
import assert from 'node:assert/strict'
import { mkdtemp, readFile, writeFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { publish, readDocument, readReference } from '../plugin/src/files.ts'
import { worker } from '../plugin/src/launcher.ts'
import { hosts } from '../plugin/src/hosts.ts'
import { setup, savePlan, beginRun } from '../plugin/src/stages.ts'

export type Prepared = {
	profile: Profile
	target: Reference
	plan: Plan
	planRequest: PlanRequest
	setupRequest: SetupRequest
	base: Reference
}
export type Revised = { request: ReviseRequest; candidate: PlanCandidate; plan: Plan; reference: Reference }

export const root = fileURLToPath(new URL('..', import.meta.url))
// The artifact of a response that must have one.
export function artifact(response: Response): Reference {
	assert(response.artifact, JSON.stringify(response))
	return response.artifact
}
// A pinned document, read as a known contract type.
export async function load<T>(workspace: string, reference: Reference): Promise<T> {
	return (await readReference(workspace, reference)) as T
}
export async function sandbox(t?: TestContext) {
	const directory = await mkdtemp(join(tmpdir(), 'checkmate-test-'))
	t?.after(() => rm(directory, { recursive: true, force: true }))
	return directory
}
export async function fixtureJson<T>(name: string): Promise<T> {
	return JSON.parse(await readFile(new URL(`./fixtures/${name}.json`, import.meta.url), 'utf8')) as T
}
export async function prepare(workspace: string, baseUrl = 'http://127.0.0.1:4173'): Promise<Prepared> {
	const profile: Profile = {
		contractVersion: 'toolkit-2',
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
	const setupRequest: SetupRequest = {
		contractVersion: 'toolkit-2',
		requestId: 'setup-1',
		caller: 'test-caller',
		operation: 'setup',
		profilePath: 'profile.json',
		targetId: profile.targetId,
		baseUrl,
		capabilities: profile.capabilities,
		allowedOperations: profile.allowedOperations,
	}
	const target = artifact(await setup(workspace, setupRequest, profile))
	const plan = await fixtureJson<PlanCandidate>('plan')
	plan.target = target
	const planRequest = await fixtureJson<PlanRequest>('plan-request')
	planRequest.target = target
	const base = artifact(await savePlan(workspace, planRequest, plan))
	return { profile, target, plan: await load<Plan>(workspace, base), planRequest, setupRequest, base }
}
export async function revised(workspace: string, prepared: Prepared): Promise<Revised> {
	const decisions = await fixtureJson<ReviseRequest['decisions']>('decisions')
	const request: ReviseRequest = {
		contractVersion: 'toolkit-2',
		requestId: 'revise-1',
		caller: 'test-caller',
		operation: 'revise',
		basePlan: prepared.base,
		baseRevision: 1,
		decisions,
	}
	const { coverage, usage, ...plan } = structuredClone(prepared.plan)
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
	const reference = artifact(await savePlan(workspace, request, plan))
	return { request, candidate: plan, plan: await load<Plan>(workspace, reference), reference }
}
export function executeRequest(
	prepared: Prepared,
	revision: { reference: Reference },
	overrides: Partial<ExecuteRequest> = {}
): ExecuteRequest {
	return {
		contractVersion: 'toolkit-2',
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
export async function observation(
	workspace: string,
	request: ExecuteRequest,
	plan: PlanCandidate,
	total = 220,
	begin = true
): Promise<Observation> {
	if (begin) await beginRun(workspace, request)
	const { value } = await readDocument(workspace, `${request.outputDirectory}/invocation.json`)
	const invocation = value as { startedAt: string }
	const evidence: Observation['evidence'] = []
	const tests: Observation['tests'] = []
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
		contractVersion: 'toolkit-2',
		requestId: request.requestId,
		runId: request.runId,
		completion: 'completed',
		plan: request.plan,
		target: request.target,
		applicationBuild: request.applicationBuild,
		host: { name: 'test-host', version: '1.0.0', model: 'test-model' },
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
export async function write(workspace: string, name: string, value: unknown) {
	await writeFile(join(workspace, name), JSON.stringify(value, null, 2) + '\n')
}

export async function claudeSession(args: string[], options: { cwd: string; timeoutSeconds: number; prompt: string }) {
	const output = await worker(
		'claude',
		[
			'-p',
			'--plugin-dir',
			join(root, 'plugin'),
			'--output-format',
			'json',
			'--json-schema',
			JSON.stringify(schema('response')),
			'--permission-prompts',
			'none',
			'--no-session-persistence',
			...args,
		],
		{ cwd: options.cwd, timeoutSeconds: options.timeoutSeconds, stdin: options.prompt }
	)
	hosts.claude.read(output)
	return validate('response', JSON.parse(output).structured_output)
}
