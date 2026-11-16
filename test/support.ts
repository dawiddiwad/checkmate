import type { TestContext } from 'node:test'
import type { PlanCandidate, PlanRequest, Profile } from '../plugin/src/types.ts'
import type { Store } from '../plugin/src/store.ts'
import assert from 'node:assert/strict'
import { cpSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { closeStore, createStore, openStore } from '../plugin/src/store.ts'
import { addInstance, instanceList, openTarget, saveTarget } from '../plugin/src/targets.ts'
import { answerGap, approvePlan, openPlan, planRevision, revisePlan, savePlan } from '../plugin/src/plans.ts'
import {
	beginRun,
	checkAssertion,
	closeTest,
	finishRun,
	acceptResult,
	recordFinding,
	runState,
} from '../plugin/src/runs.ts'
import { run } from '../plugin/src/cli.ts'
import { planStatus } from '../plugin/src/views.ts'
import { minimumRules, stages } from '../cli/src/launcher.ts'
import { parseDelegate } from '../cli/src/main.ts'

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

export function copied(t: TestContext, template: string) {
	const workspace = directory(t)
	cpSync(template, workspace, { recursive: true })
	return workspace
}

export function store(t: TestContext, workspace = directory(t)): Store {
	const opened = createStore(workspace)
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
		entryPoints: [{ name: 'web', kind: 'url', purpose: 'Checkout web application and HTTP API.' }],
		capabilities: ['browser', 'http'],
		tools: [
			{
				name: 'playwright-cli',
				kind: 'cli',
				purpose: 'Drive the browser.',
				version: '0.1.23',
				reachable: true,
			},
			{ name: 'node', kind: 'cli', purpose: 'Send HTTP requests.', version: '24.12.0', reachable: true },
		],
		authentication: { kind: 'none', references: [] },
		allowedOperations: ['read_catalog', 'create_fixture_order', 'apply_fixture_discount'],
		startup: { owner: 'factory', command: null },
		cleanup: 'Close the run browser session. The fixture stores no records.',
		readyForLiveExecution: true,
		...overrides,
	}
}

export const webUrl = 'http://127.0.0.1:4173'

export function target(store: Store, overrides: Partial<Profile> = {}, web = webUrl) {
	const value = profile(overrides)
	openTarget(store, actor, {
		targetId: value.targetId,
		entryPoints: value.entryPoints,
		capabilities: value.capabilities,
		allowedOperations: value.allowedOperations,
	})
	const saved = saveTarget(store, actor, { targetId: value.targetId, profile: value })
	addInstance(store, actor, {
		targetId: value.targetId,
		instanceId: 'local',
		instance: { entries: { web }, environment: 'local fixture' },
	})
	return saved
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
					{ id: 'A1', check: 'The confirmation shows 400 PLN.', checkKind: 'agent_observation' },
					{ id: 'A2', check: 'The order has one item.', checkKind: 'deterministic' },
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
				assertions: [{ id: 'A1', check: 'The response status is HTTP 200.', checkKind: 'deterministic' }],
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
				A2: { check: 'totalPLN equals 240.', checkKind: 'deterministic' as const },
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

export function regressionPlan(store: Store) {
	target(store)
	const value = candidate()
	value.tests[0].metadata = { type: 'regression' }
	value.tests[1].dependsOn = []
	plan(store, 'checkout', value)
	revised(store)
	approved(store)
}

export function defectRun(store: Store, runId: string, build: string, extra = {}) {
	begin(store, runId, ['T1', 'T2'], build, extra)
	for (const reference of ['T1.A1', 'T1.A2', 'T2.A1']) check(store, runId, reference, 'passed')
	closeTest(store, actor, { runId, testId: 'T1' })
	failT2(store, runId)
	closeTest(store, actor, { runId, testId: 'T2' })
	return finishRun(store, actor, { runId, completion: 'completed', cleanup: 'completed', cleanupReason: 'Closed.' })
}

export function accept(store: Store, runId: string) {
	return acceptResult(store, actor, { runId, rationale: 'Looks right.' })
}

export function followHints(
	t: TestContext,
	opened: Store,
	planId = 'checkout',
	fill: Record<string, string> = {},
	seen: string[] = [],
	depth = 2
) {
	const status = planStatus(opened, planId)
	const shape = (value: typeof status) =>
		JSON.stringify([value.state, value.why, value.openRuns.map((run) => run.runId)])
	assert(!seen.includes(shape(status)), `The hints of ${planId} go in a cycle: ${shape(status)}`)
	const plan = status.revision === null ? null : planRevision(opened, planId).plan
	const values: Record<string, string> = {
		'<runId>': `hint-run-${depth}`,
		'<new build>': `hint-build-${depth}`,
		'<build>': `hint-build-${depth}`,
		'<gapId>': status.gaps[0]?.gapId ?? 'none',
		'<kind>': 'defer',
		'<answer>': 'Hint answer.',
		'<source>': 'hints#1',
		'<why>': 'Hint rationale.',
		'<instanceId>': plan
			? instanceList(opened, plan.target.targetId).find((instance) => !instance.retired)!.instanceId
			: 'none',
		...fill,
	}
	for (const hint of status.next) {
		let command = hint.replace(/^Build a fix, then /, '')
		for (const [placeholder, value] of Object.entries(values)) command = command.split(placeholder).join(value)
		assert.doesNotMatch(command, /<[a-zA-Z ]+>/, command)
		const args = (command.match(/"[^"]*"|\S+/g) ?? []).map((token) => token.replace(/^"|"$/g, ''))
		assert.equal(args.shift(), 'checkmate', command)
		if (args[0] === 'delegate') {
			assert(stages.includes(args[1] as (typeof stages)[number]), command)
			const allow = args.slice(3).filter((_, i) => i % 2 === 1)
			assert.deepEqual(
				args.slice(3).filter((_, i) => i % 2 === 0),
				allow.map(() => '--allow'),
				command
			)
			assert(
				minimumRules.every((rule) => allow.includes(rule)),
				command
			)
			assert.deepEqual(parseDelegate(args.slice(1)).allow, allow, command)
			continue
		}
		const copy = directory(t)
		mkdirSync(join(copy, '.checkmate'))
		opened.db.exec(`VACUUM INTO '${join(copy, '.checkmate', 'checkmate.db')}'`)
		const stdin =
			args[0] === 'plan' && args[1] === 'edit'
				? { tests: { [plan!.tests[0].id]: { title: 'Hint title.' } } }
				: undefined
		const outcome = cli(copy, args, stdin)
		assert.equal(outcome.code, 0, `${command}\n${outcome.output}`)
		if (args[0] === 'run') assert.match(outcome.lines[0], /^completed /, `${command}\n${outcome.output}`)
		const copied = openStore(copy)
		try {
			if (args[0] === 'status') {
				assert(planStatus(copied, args[1]).next.length, `${command} leads to a plan with no next step`)
				continue
			}
			if (args[0] === 'run') passAll(copied, args[2])
			const after = shape(planStatus(copied, planId))
			assert.notEqual(after, shape(status), `${command} changes nothing`)
			if (depth > 1) followHints(t, copied, planId, fill, [...seen, shape(status)], depth - 1)
		} finally {
			closeStore(copied)
		}
	}
	return status
}

function passAll(opened: Store, runId: string) {
	const run = runState(opened, runId)
	for (const test of run.plan.tests.filter((item) => run.request.selectedTestIds.includes(item.id))) {
		for (const assertion of test.assertions) check(opened, runId, `${test.id}.${assertion.id}`, 'passed')
		closeTest(opened, actor, { runId, testId: test.id })
	}
	finishRun(opened, actor, { runId, completion: 'completed', cleanup: 'completed', cleanupReason: 'Closed.' })
}
