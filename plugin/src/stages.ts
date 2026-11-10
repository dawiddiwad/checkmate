import type { Request, Response, Plan, Reference, ExecuteRequest, Observation, Result } from './types.ts'
import type { Usage } from './hosts.ts'
import { readdir, mkdir, stat, readFile, unlink } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { randomUUID } from 'node:crypto'
import { confined, digest, publish, readDocument, readReference, requireCondition, same } from './files.ts'
import {
	validate,
	profileCheck,
	planCheck,
	planCoverage,
	testReadiness,
	index,
	references,
	requestCheck,
} from './contracts.ts'
import { renderPlan, renderResult } from './render.ts'

export function response(
	request: Request,
	status: Response['status'],
	artifact: Reference | null = null,
	reasons: string[] = []
): Response {
	return validate('response', {
		contractVersion: 'toolkit-2',
		requestId: request.requestId,
		operation: request.operation,
		status,
		artifact,
		reasons,
	})
}

export async function setup(workspace: string, input: unknown, candidate: unknown) {
	const request = validate('setup-request', input)
	const profile = profileCheck(candidate)
	requireCondition(
		profile.targetId === request.targetId && profile.baseUrl === request.baseUrl,
		'Setup target changed'
	)
	requireCondition(
		same(profile.capabilities, request.capabilities) && same(profile.allowedOperations, request.allowedOperations),
		'Setup scope changed'
	)
	let artifact
	try {
		const existing = await readDocument(workspace, request.profilePath)
		requireCondition(same(existing.value, profile), 'Profile exists. Use a new path and revision for changes')
		artifact = existing.reference
	} catch (error) {
		if (!(error instanceof Error && 'code' in error && error.code === 'ENOENT')) throw error
		artifact = await publish(workspace, request.profilePath, profile)
	}
	return response(
		request,
		profile.readyForLiveExecution ? 'completed' : 'needs_decision',
		artifact,
		profile.readyForLiveExecution ? [] : ['Target prerequisites are not ready. Inspect the profile.']
	)
}

// usage is what the host reported for this stage. A plan written in the agent's own session has none.
export async function savePlan(workspace: string, input: unknown, candidate: unknown, usage: Usage | null = null) {
	const request = requestCheck(input)
	requireCondition(
		request.operation === 'plan' || request.operation === 'revise',
		'Expected a plan or revise request'
	)
	// Checkmate sets each test's readiness from the gaps, then the coverage from the tests and gaps.
	// A readiness value in the candidate is replaced.
	const draft = validate('plan-candidate', candidate)
	const tests = draft.tests.map((test) => ({ ...test, readiness: testReadiness(draft.gaps, test) }))
	const plan = planCheck({ ...draft, tests, coverage: planCoverage({ ...draft, tests }), usage })
	const target = profileCheck(await readReference(workspace, plan.target))
	requireCondition(plan.targetId === target.targetId, 'Plan target identity changed')
	for (const test of plan.tests.filter((test) => test.readiness === 'ready')) {
		requireCondition(target.capabilities.includes(test.capability), 'Missing capability must be a planning gap')
		requireCondition(
			test.operations.every((operation) => target.allowedOperations.includes(operation)),
			'Test operation is not permitted'
		)
	}
	let directory
	if (request.operation === 'plan') {
		requireCondition(
			plan.planId === request.outputPlanId && plan.revision === 1 && plan.previousRevision === null,
			'Invalid initial revision'
		)
		requireCondition(
			same(plan.target, request.target) && same(plan.requirements, request.requirements),
			'Plan scope or provenance changed'
		)
		requireCondition(
			plan.decisions.length === 0 && plan.assumptions.length === 0,
			'Initial plan cannot invent caller decisions'
		)
		directory = request.planDirectory
	} else {
		const base = planCheck(await readReference(workspace, request.basePlan))
		requireCondition(base.revision === request.baseRevision, 'Stale base revision')
		directory = dirname(request.basePlan.path)
		const names = await readdir(await confined(workspace, directory))
		requireCondition(
			!names.some((name) => /^v[0-9]+\.json$/.test(name) && Number(name.slice(1, -5)) > base.revision),
			'A newer revision exists'
		)
		requireCondition(
			plan.planId === base.planId &&
				plan.revision === base.revision + 1 &&
				plan.previousRevision === base.revision,
			'Invalid next revision'
		)
		requireCondition(
			same(plan.target, base.target) && same(plan.requirements, base.requirements),
			'Revision changed scope or provenance'
		)
		index(request.decisions, 'id')
		index(request.decisions, 'gapId')
		const changed = new Set(request.decisions.map((decision) => decision.gapId))
		for (const decision of request.decisions) {
			const gap = base.gaps.find((gap) => gap.id === decision.gapId)
			requireCondition(gap?.status === 'open', 'Decision must address an open base gap')
		}
		requireCondition(same(plan.decisions, [...base.decisions, ...request.decisions]), 'Decision history changed')
		requireCondition(
			same(
				plan.gaps.map((gap) => gap.id),
				base.gaps.map((gap) => gap.id)
			),
			'Revision changed gap inventory'
		)
		for (const old of base.gaps) {
			const next = plan.gaps.find((gap) => gap.id === old.id)
			if (!changed.has(old.id)) requireCondition(same(old, next), 'Unrelated gap changed')
			else
				requireCondition(
					same({ ...next, status: old.status, decisionId: old.decisionId }, old),
					'Gap scope changed'
				)
		}
		requireCondition(
			same(
				plan.tests.map((test) => test.id),
				base.tests.map((test) => test.id)
			),
			'Revision changed test inventory'
		)
		for (const old of base.tests) {
			const next = plan.tests.find((test) => test.id === old.id)
			const affected = base.gaps.some(
				(gap) =>
					changed.has(gap.id) &&
					(gap.testIds.includes(old.id) ||
						gap.requirementIds.some((id) => old.requirementIds.includes(id)) ||
						(!gap.testIds.length && !gap.requirementIds.length))
			)
			if (!affected) requireCondition(same(old, next), 'Unrelated test changed')
			else
				requireCondition(
					same(
						{
							...next,
							readiness: old.readiness,
							expected: old.expected,
							action: old.action,
							preconditions: old.preconditions,
							oracleKind: old.oracleKind,
						},
						old
					),
					'Revision changed test scope'
				)
		}
		requireCondition(
			base.assumptions.every((a) => plan.assumptions.some((b) => same(a, b))),
			'Prior assumption was removed'
		)
	}
	const artifact = await publish(workspace, join(directory, `v${plan.revision}.json`), plan)
	await publish(workspace, join(directory, `v${plan.revision}.md`), renderPlan(plan))
	const blockers = plan.gaps.filter((gap) => gap.status === 'open' && gap.severity === 'blocking')
	return response(
		request,
		blockers.length ? 'needs_decision' : 'completed',
		artifact,
		blockers.map((gap) => `${gap.id}: ${gap.question}`)
	)
}

export async function gate(workspace: string, input: unknown) {
	const request = validate('execute-request', input)
	const plan = planCheck(await readReference(workspace, request.plan))
	const target = profileCheck(await readReference(workspace, request.target))
	requireCondition(
		same(plan.target, request.target) && plan.targetId === target.targetId,
		'Execution target differs from plan'
	)
	const tests = index(plan.tests, 'id')
	references(request.selectedTestIds, tests, 'selected test')
	if (request.retestOf) {
		const previous = validate('result', await readReference(workspace, request.retestOf))
		requireCondition(
			previous.runId !== request.runId && previous.applicationBuild !== request.applicationBuild,
			'Retest needs a new run and build'
		)
		const priorPlan = planCheck(await readReference(workspace, previous.plan))
		requireCondition(
			priorPlan.planId === plan.planId && same(previous.target, request.target),
			'Retest scope changed'
		)
	}
	const reasons = []
	if (!target.readyForLiveExecution) reasons.push('Target prerequisites are not ready')
	if ((request.partialExecution ?? 'wait_for_resolution') === 'wait_for_resolution') {
		for (const gap of plan.gaps)
			if (gap.status === 'open' && gap.severity === 'blocking') reasons.push(`Open blocking gap: ${gap.id}`)
	}
	for (const id of request.selectedTestIds) {
		const test = tests.get(id)!
		if (test.readiness !== 'ready') reasons.push(`Test is not ready: ${id}`)
		if (!target.capabilities.includes(test.capability)) reasons.push(`Missing capability: ${test.capability}`)
		if (!test.operations.every((operation) => target.allowedOperations.includes(operation)))
			reasons.push(`Operation is not permitted: ${id}`)
		for (const dependency of test.dependsOn)
			if (!request.selectedTestIds.includes(dependency)) reasons.push(`Missing prerequisite: ${dependency}`)
	}
	return { ...response(request, reasons.length ? 'needs_decision' : 'completed', null, reasons), plan, target }
}

// The host that produced a result. The launcher knows it; an agent in its own session declares it.
export type Host = Result['host']
// The launcher records the worker host when it reserves the run. It learns the model later.
export type LaunchedHost = Omit<Host, 'model' | 'source'>

// deadlineSeconds is the deadline the launcher applies. It defaults to the request's timeoutSeconds.
// host is the worker host that the launcher starts. A run in the current session has none.
export async function beginRun(
	workspace: string,
	input: unknown,
	deadlineSeconds?: number,
	host: LaunchedHost | null = null
) {
	const request = validate('execute-request', input)
	const checked = await gate(workspace, request)
	if (checked.status !== 'completed') return response(request, checked.status, null, checked.reasons)
	const directory = await confined(workspace, request.outputDirectory)
	await mkdir(directory, { recursive: true })
	const startedAt = new Date().toISOString()
	const reservation = `.checkmate/run-ids/${request.runId}.json`
	await publish(workspace, reservation, { requestId: request.requestId, outputDirectory: request.outputDirectory })
	let artifact
	try {
		artifact = await publish(workspace, join(request.outputDirectory, 'invocation.json'), {
			request,
			startedAt,
			browserSession: `cm-${randomUUID()}`,
			deadlineSeconds: deadlineSeconds ?? request.timeoutSeconds,
			host,
		})
	} catch (error) {
		// No run started, so release the run ID for a later attempt.
		await unlink(await confined(workspace, reservation))
		throw error
	}
	await mkdir(await confined(directory, 'evidence'), { recursive: true })
	return response(request, 'completed', artifact)
}

export function resultCoverage(plan: Plan, result: Observation): import('./types.ts').Result['coverage'] {
	const outcomes = index(result.tests, 'testId')
	const requirements: import('./types.ts').Result['coverage']['requirements'] = plan.requirements.map(
		(requirement) => {
			const tests = plan.tests.filter((test) => test.requirementIds.includes(requirement.id))
			const unresolved = [...plan.gaps, ...result.newGaps].some(
				(gap) =>
					(gap.requirementIds.includes(requirement.id) ||
						(!gap.requirementIds.length && !gap.testIds.length)) &&
					(gap.status === 'deferred' || (gap.status === 'open' && gap.severity === 'blocking'))
			)
			const tested =
				tests.length > 0 &&
				!unresolved &&
				tests.every((test) => ['passed', 'failed'].includes(outcomes.get(test.id)?.outcome ?? ''))
			return {
				requirementId: requirement.id,
				status: tested ? 'tested' : 'uncovered',
				testIds: tests.map((test) => test.id),
				reason: tested ? null : 'At least one required check or decision is missing.',
			}
		}
	)
	const count = requirements.filter((row) => row.status === 'tested').length
	return {
		status:
			count === requirements.length
				? 'complete'
				: result.tests.some((test) => ['passed', 'failed', 'error'].includes(test.outcome))
					? 'partial'
					: 'not_executed',
		requirements,
	}
}

// The launcher passes the host it ran. Otherwise the result keeps the host that the observation declares.
export async function finalize(
	workspace: string,
	input: unknown,
	candidate: unknown,
	host?: Host,
	usage: Usage | null = null
) {
	const request = validate('execute-request', input)
	const observation = validate('observation', candidate)
	const checked = await gate(workspace, request)
	requireCondition(checked.status === 'completed', 'Execution gate rejected finalization')
	const { plan } = checked
	const directory = await confined(workspace, request.outputDirectory)
	const invocation = await readInvocation(workspace, request)
	requireCondition(same(invocation.request, request), 'Run invocation changed')
	for (const key of [
		'requestId',
		'runId',
		'plan',
		'target',
		'applicationBuild',
		'selectedTestIds',
		'retestOf',
	] as const)
		requireCondition(same(observation[key], request[key]), `Result changed ${key}`)
	requireCondition(observation.startedAt === invocation.startedAt, 'Run start time changed')

	// The observation must list each selected test. Checkmate adds each omitted
	// unselected test as not_run, so the result lists every planned test once.
	const listed = index(observation.tests, 'testId')
	references([...listed.keys()], index(plan.tests, 'id'), 'result test')
	for (const id of request.selectedTestIds)
		requireCondition(listed.has(id), `Selected test is missing from the observation: ${id}`)
	const tests = plan.tests.map(
		(test) =>
			listed.get(test.id) ?? {
				testId: test.id,
				outcome: 'not_run' as const,
				expected: test.expected,
				observed: null,
				assertionKind: null,
				evidenceIds: [],
				reason: 'Test was not selected.',
			}
	)
	const outcomes = index(tests, 'testId')
	const evidence = index(observation.evidence, 'id')
	index(observation.findings, 'id')
	index(observation.newGaps, 'id')
	// The observation lists evidence paths. Checkmate records the digest of each file.
	const evidenceRoot = await confined(directory, 'evidence')
	const recordedEvidence = []
	for (const entry of observation.evidence) {
		requireCondition(
			entry.path.startsWith('evidence/'),
			`Evidence path must be relative to the output directory and start with evidence/: ${entry.path}`
		)
		const path = await confined(evidenceRoot, entry.path.slice('evidence/'.length))
		requireCondition((await stat(path)).isFile(), 'Evidence must be a file')
		recordedEvidence.push({ ...entry, sha256: digest(await readFile(path)) })
	}
	for (const gap of observation.newGaps) {
		requireCondition(
			gap.status === 'open' && gap.decisionId === null && !plan.gaps.some((old) => old.id === gap.id),
			'Runtime gap must be new and open'
		)
		references(gap.testIds, index(plan.tests, 'id'), 'gap test')
		references(gap.requirementIds, index(plan.requirements, 'id'), 'gap requirement')
	}
	for (const test of plan.tests) {
		const outcome = outcomes.get(test.id)!
		references(outcome.evidenceIds, evidence, 'evidence')
		const executed = ['passed', 'failed', 'error'].includes(outcome.outcome)
		if (executed)
			requireCondition(
				request.selectedTestIds.includes(test.id) && test.readiness === 'ready',
				'Unselected or blocked test was executed'
			)
		if (['passed', 'failed'].includes(outcome.outcome)) {
			requireCondition(
				outcome.expected === test.expected && outcome.assertionKind === test.oracleKind,
				'Assertion differs from plan'
			)
			requireCondition(
				outcome.observed && outcome.evidenceIds.length > 0,
				'Verdict needs an observation and evidence'
			)
			for (const dependency of test.dependsOn)
				requireCondition(outcomes.get(dependency)!.outcome === 'passed', 'Prerequisite did not pass')
		} else requireCondition(outcome.reason, 'Unexecuted or erroneous test needs a reason')
		if (!request.selectedTestIds.includes(test.id))
			requireCondition(['not_run', 'blocked'].includes(outcome.outcome), 'Omitted test has a verdict')
		if (outcome.outcome === 'failed')
			requireCondition(
				observation.findings.some((finding) => finding.type === 'defect' && finding.testIds.includes(test.id)),
				'Failed assertion needs a defect finding'
			)
	}
	for (const finding of observation.findings) {
		references(finding.testIds, outcomes, 'finding test')
		references(finding.requirementIds, index(plan.requirements, 'id'), 'finding requirement')
		references(finding.evidenceIds, evidence, 'finding evidence')
		for (const id of finding.testIds) {
			requireCondition(
				finding.requirementIds.every((req) =>
					plan.tests.find((test) => test.id === id)!.requirementIds.includes(req)
				),
				'Finding requirement differs from its test'
			)
			requireCondition(
				finding.evidenceIds.every((ref) => outcomes.get(id)!.evidenceIds.includes(ref)),
				'Finding evidence differs from its test'
			)
			if (finding.type === 'defect')
				requireCondition(outcomes.get(id)!.outcome === 'failed', 'Defect needs a failed assertion')
		}
	}
	if (observation.completion === 'completed') {
		requireCondition(
			!tests.some((test) => test.outcome === 'error') && observation.cleanup.status !== 'failed',
			'Operational failure cannot be completed'
		)
		for (const test of plan.tests.filter((test) => request.selectedTestIds.includes(test.id))) {
			const outcome = outcomes.get(test.id)!
			if (['not_run', 'blocked'].includes(outcome.outcome))
				requireCondition(
					test.dependsOn.some((id) => outcomes.get(id)!.outcome !== 'passed') ||
						observation.newGaps.some((gap) => gap.severity === 'blocking'),
					'Selected test was not executed'
				)
		}
	}
	const result = {
		...observation,
		host: host ?? { ...observation.host, source: 'declared', permissions: 'session' },
		tests,
		evidence: recordedEvidence,
		finishedAt: new Date().toISOString(),
		coverage: resultCoverage(plan, { ...observation, tests }),
		usage,
	}
	validate('result', result)
	const artifact = await publish(workspace, join(request.outputDirectory, 'result.json'), result)
	await reports(workspace, artifact)
	return response(request, observation.completion === 'completed' ? 'completed' : observation.completion, artifact)
}

// The plan revisions that led to a result, oldest first. Each saved revision keeps the usage of its stage.
async function planChain(workspace: string, reference: Reference) {
	const chain = [planCheck(await readReference(workspace, reference))]
	while (chain[0].previousRevision !== null) {
		const path = join(dirname(reference.path), `v${chain[0].previousRevision}.json`)
		chain.unshift(planCheck((await readDocument(workspace, path)).value))
	}
	return chain
}

export async function reports(workspace: string, reference: Reference) {
	const result = validate('result', await readReference(workspace, reference))
	const rendered = renderResult(result, await planChain(workspace, result.plan))
	for (const [extension, text] of Object.entries(rendered)) {
		const path = join(dirname(reference.path), `report.${extension}`)
		try {
			await publish(workspace, path, text)
		} catch (error) {
			if (!(error instanceof Error && 'code' in error && error.code === 'EEXIST')) throw error
			requireCondition(
				(await readFile(await confined(workspace, path), 'utf8')) === text,
				'Existing report differs from result'
			)
		}
	}
	return result
}

export async function readInvocation(workspace: string, request: ExecuteRequest) {
	const { value } = await readDocument(workspace, join(request.outputDirectory, 'invocation.json'))
	requireCondition(
		typeof value === 'object' &&
			value !== null &&
			'request' in value &&
			'startedAt' in value &&
			'browserSession' in value,
		'Invalid invocation record'
	)
	requireCondition(
		typeof value.startedAt === 'string' &&
			Number.isFinite(Date.parse(value.startedAt)) &&
			typeof value.browserSession === 'string',
		'Invalid invocation metadata'
	)
	return {
		request: validate('execute-request', value.request),
		startedAt: value.startedAt,
		browserSession: value.browserSession,
	}
}
