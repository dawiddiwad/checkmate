import type { TestContext } from 'node:test'
import type { PlanCandidate, PlanRequest, Profile } from '../plugin/src/types.ts'
import type { Store } from '../plugin/src/store.ts'
import assert from 'node:assert/strict'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { closeStore, openStore } from '../plugin/src/store.ts'
import { openTarget, saveTarget } from '../plugin/src/targets.ts'
import { answerGap, approvePlan, openPlan, revisePlan, savePlan } from '../plugin/src/plans.ts'
import { beginRun, checkAssertion, closeTest, finishRun, acceptResult, recordFinding } from '../plugin/src/runs.ts'
import { run } from '../plugin/src/cli.ts'

export const root = fileURLToPath(new URL('..', import.meta.url))
export const actor = 'tester'

export async function sandbox(t?: TestContext) {
	return directory(t)
}

export function directory(t?: TestContext) {
	const path = mkdtempSync(join(tmpdir(), 'checkmate-test-'))
	t?.after(() => rmSync(path, { recursive: true, force: true }))
	return path
}

export function store(t: TestContext, workspace = directory(t)): Store {
	const opened = openStore(workspace)
	t.after(() => {
		if (opened.db.isOpen) closeStore(opened)
	})
	return opened
}

export function cli(workspace: string, args: string[], stdin: unknown = undefined, env: Record<string, string> = {}) {
	const outcome = run([...args, '--workspace', workspace], {
		cwd: workspace,
		env: { CHECKMATE_ACTOR: actor, ...env },
		stdin: () => (stdin === undefined ? '' : typeof stdin === 'string' ? stdin : JSON.stringify(stdin)),
	})
	return { ...outcome, lines: outcome.output.split('\n') }
}

export function json(workspace: string, args: string[], stdin?: unknown) {
	const outcome = cli(workspace, [...args, '--json'], stdin)
	return { code: outcome.code, body: JSON.parse(outcome.output) }
}

export function profile(overrides: Partial<Profile> = {}): Profile {
	return {
		contractVersion: 'toolkit-2',
		targetId: 'checkout-local',
		revision: 1,
		baseUrl: 'http://127.0.0.1:4173',
		environment: 'local_fixture',
		capabilities: ['browser', 'http'],
		tooling: [
			{ capability: 'browser', executable: 'playwright-cli', version: '0.1.23' },
			{ capability: 'http', executable: 'node', version: '24.12.0' },
		],
		authentication: { kind: 'none', references: [] },
		allowedOperations: ['read_catalog', 'create_fixture_order', 'apply_fixture_discount'],
		startup: { owner: 'caller', command: null },
		cleanup: 'Close the run browser session. The fixture stores no records.',
		readyForLiveExecution: true,
		...overrides,
	}
}

export function target(store: Store, overrides: Partial<Profile> = {}) {
	const value = profile(overrides)
	openTarget(store, actor, {
		targetId: value.targetId,
		baseUrl: value.baseUrl,
		capabilities: value.capabilities,
		allowedOperations: value.allowedOperations,
	})
	return saveTarget(store, actor, { targetId: value.targetId, profile: value })
}

export function planRequest(): PlanRequest {
	return {
		objective: 'Verify checkout and identify missing acceptance decisions.',
		requirements: [
			{ id: 'R1', text: 'A standard order for a 400 PLN item has a total of 400 PLN.', source: 'brief#standard' },
			{ id: 'R2', text: 'A 40 percent promotion applies; stacking is unspecified.', source: 'brief#promotion' },
			{ id: 'R3', text: 'Refund eligibility is unspecified.', source: 'brief#refund' },
		],
		sourceContext: [{ uri: 'brief', content: 'One item at 400 PLN. Promotion is 40 percent.' }],
	}
}

export function candidate(): PlanCandidate {
	return {
		tests: [
			{
				id: 'T1',
				title: 'Standard order total',
				requirementIds: ['R1'],
				capability: 'browser',
				operations: ['create_fixture_order'],
				dependsOn: [],
				preconditions: ['Fresh cart with one 400 PLN item.'],
				action: 'Complete checkout and read the confirmation.',
				assertions: [
					{ id: 'A1', check: 'The confirmation shows 400 PLN.', oracleKind: 'agent_observation' },
					{ id: 'A2', check: 'The order has one item.', oracleKind: 'deterministic' },
				],
			},
			{
				id: 'T2',
				title: 'Promotion quote',
				requirementIds: ['R2'],
				capability: 'http',
				operations: ['apply_fixture_discount'],
				dependsOn: ['T1'],
				preconditions: ['Cart with 400 PLN and 20 PLN loyalty.'],
				action: 'Apply the promotion and read the quote.',
				assertions: [{ id: 'A1', check: 'The response status is HTTP 200.', oracleKind: 'deterministic' }],
			},
			{
				id: 'T3',
				title: 'Refund eligibility',
				requirementIds: ['R3'],
				capability: 'http',
				operations: ['read_catalog'],
				dependsOn: [],
				preconditions: [],
				action: 'Request a refund.',
				assertions: [],
			},
		],
		gaps: [
			{
				id: 'G1',
				severity: 'blocking',
				status: 'open',
				requirementIds: ['R2'],
				testIds: ['T2'],
				question: 'Does the promotion stack with loyalty?',
				consequence: 'No expected quote total.',
				decisionId: null,
			},
			{
				id: 'G2',
				severity: 'blocking',
				status: 'open',
				requirementIds: ['R3'],
				testIds: ['T3'],
				question: 'Which orders qualify for refunds?',
				consequence: 'Refund acceptance cannot be asserted.',
				decisionId: null,
			},
		],
	}
}

export function plan(store: Store, planId = 'checkout', value: PlanCandidate = candidate(), request = planRequest()) {
	openPlan(store, actor, { planId, target: 'checkout-local@1', request })
	return savePlan(store, actor, { planId, candidate: value })
}

export const promotionDelta = {
	tests: {
		T2: {
			assertions: {
				A2: { check: 'totalPLN equals 240.', oracleKind: 'deterministic' as const },
			},
		},
	},
}

export function revised(store: Store, planId = 'checkout') {
	answerGap(store, actor, {
		planId,
		gapId: 'G1',
		kind: 'clarify',
		value: 'Promotion replaces loyalty. Expected total is 240 PLN.',
		source: 'decisions#promotion',
		rationale: 'Product decision.',
	})
	answerGap(store, actor, {
		planId,
		gapId: 'G2',
		kind: 'defer',
		value: 'Do not check refunds in this scope.',
		rationale: 'Out of scope.',
	})
	return revisePlan(store, actor, { planId, delta: promotionDelta })
}

export function approved(store: Store, planId = 'checkout', revision = 2) {
	return approvePlan(store, actor, { reference: `${planId}@${revision}`, rationale: 'Reviewed.' })
}

export function ready(store: Store, overrides: Partial<Profile> = {}) {
	target(store, overrides)
	plan(store)
	revised(store)
	approved(store)
}

export function evidenceFile(store: Store, runId: string, name: string, content: string | Uint8Array = name) {
	const directory = join(store.workspace, '.checkmate', 'tmp', runId)
	mkdirSync(directory, { recursive: true })
	writeFileSync(join(directory, name), content)
	return `.checkmate/tmp/${runId}/${name}`
}

export function begin(store: Store, runId = 'run-1', tests = ['T1', 'T2'], build = 'build-1', extra = {}) {
	const reply = beginRun(store, actor, { runId, reference: 'checkout@2', tests, build, ...extra })
	assert.equal(reply.status, 'completed', reply.reasons.join('; '))
	return reply
}

export function check(
	store: Store,
	runId: string,
	reference: string,
	result: 'passed' | 'failed' | 'inconclusive' | 'not_checked',
	extra: { reason?: string; observed?: string } = {}
) {
	const [testId, assertionId] = reference.split('.')
	const withEvidence = result !== 'not_checked'
	return checkAssertion(store, actor, {
		runId,
		testId,
		assertionId,
		result,
		observed: withEvidence ? (extra.observed ?? `Observed ${reference}`) : extra.observed,
		reason: extra.reason ?? (result === 'inconclusive' || result === 'not_checked' ? 'Reason given.' : undefined),
		evidence: withEvidence ? [evidenceFile(store, runId, `${reference}-${Math.random()}.txt`)] : [],
	})
}

export function passRun(store: Store, runId: string, build: string, tests = ['T1']) {
	begin(store, runId, tests, build)
	for (const testId of tests) {
		for (const assertionId of ['A1', 'A2']) check(store, runId, `${testId}.${assertionId}`, 'passed')
		closeTest(store, actor, { runId, testId })
	}
	return finishRun(store, actor, {
		runId,
		completion: 'completed',
		cleanup: 'completed',
		cleanupReason: 'Closed the browser.',
	})
}

export function failT2(store: Store, runId: string) {
	const reply = check(store, runId, 'T2.A2', 'failed', { observed: 'totalPLN is 220' })
	recordFinding(store, actor, {
		runId,
		finding: {
			id: 'F1',
			type: 'defect',
			severity: 'medium',
			assertionIds: ['T2.A2'],
			requirementIds: ['R2'],
			title: 'Promotion stacks with loyalty',
			expected: '240 PLN',
			observed: '220 PLN',
			reproduction: ['Apply the promotion.'],
			evidenceIds: reply.data.evidenceIds as string[],
		},
	})
	return reply
}

export function accept(store: Store, runId: string) {
	return acceptResult(store, actor, { runId, rationale: 'Looks right.' })
}
