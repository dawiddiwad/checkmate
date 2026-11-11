import type { Finding, Gap, Plan, PlanCandidate, PlanDelta, PlanRequest, Profile, Response, Result } from './types.ts'
import { canonical } from './store.ts'
import * as validators from './validators.js'

export type Test = Plan['tests'][number]
export type Assertion = Test['assertions'][number]
export type ResultTest = Result['tests'][number]
export type AssertionResult = ResultTest['assertions'][number]['result']
export type Documents = {
	profile: Profile
	'plan-request': PlanRequest
	'plan-candidate': PlanCandidate
	'plan-delta': PlanDelta
	plan: Plan
	gap: Gap
	finding: Finding
	result: Result
	response: Response
}
export type PlanDraft = Omit<Plan, 'coverage' | 'tests'> & { tests: Array<Omit<Test, 'readiness' | 'gapIds'>> }

const identifier = /^[A-Za-z0-9][A-Za-z0-9_-]{0,95}$/

export function requireCondition(condition: unknown, message: string): asserts condition {
	if (!condition) throw new Error(message)
}

export function same(a: unknown, b: unknown) {
	return canonical(a) === canonical(b)
}

export function validate<K extends keyof Documents>(name: K, value: unknown): Documents[K] {
	const check = validators[name.replace(/-./g, (match) => match[1].toUpperCase()) as keyof typeof validators]
	const errors = () => (check.errors ?? []).map((error) => `${name}${error.instancePath} ${error.message}`).join(', ')
	requireCondition(check(value), `Invalid ${name}: ${errors()}`)
	return value as Documents[K]
}

export function requireIdentifier(value: unknown, name: string): string {
	requireCondition(
		typeof value === 'string' && identifier.test(value),
		`Invalid ${name}: ${String(value)}. Use 1 to 96 letters, digits, _ or -, starting with a letter or digit.`
	)
	return value
}

export function requireText(value: unknown, name: string): string {
	requireCondition(typeof value === 'string' && value.trim().length > 0, `Missing ${name}`)
	return value
}

export function requireChoice<T extends string>(value: unknown, choices: readonly T[], name: string): T {
	requireCondition(
		choices.includes(value as T),
		`Invalid ${name}: ${String(value)}. Use one of: ${choices.join(', ')}.`
	)
	return value as T
}

export function revisionReference(text: string, name: string) {
	const [id, revision, ...rest] = text.split('@')
	requireIdentifier(id, name)
	requireCondition(
		!rest.length && (revision === undefined || /^[1-9][0-9]*$/.test(revision)),
		`Invalid ${name}: ${text}. Use <id> or <id>@<revision>.`
	)
	return { id, revision: revision === undefined ? null : Number(revision) }
}

export function testReference(reference: string) {
	const [planId, testId] = reference.includes(':') ? reference.split(':') : [null, reference]
	return { planId, testId }
}

export function expectDigest(actual: string, expected: string | undefined, subject: string) {
	if (expected === undefined) return
	requireCondition(/^[a-f0-9]{8,64}$/.test(expected), `Invalid --expect-sha: ${expected}. Use 8 to 64 hex digits.`)
	requireCondition(
		actual.startsWith(expected),
		`${subject} has digest ${actual}, not ${expected}. Read it again before you decide.`
	)
}

export function index<T, K extends keyof T>(items: T[], key: K, name: string): Map<T[K], T> {
	const map = new Map<T[K], T>()
	for (const item of items) {
		requireCondition(!map.has(item[key]), `Duplicate ${name}: ${String(item[key])}`)
		map.set(item[key], item)
	}
	return map
}

export function references(ids: string[], map: ReadonlyMap<string, unknown>, name: string) {
	for (const id of ids) requireCondition(map.has(id), `Unknown ${name}: ${id}`)
}

export function profileCheck(value: unknown): Profile {
	const profile = validate('profile', value)
	const tools = index(profile.tooling, 'capability', 'tool capability')
	references(profile.capabilities, tools, 'tool for capability')
	for (const tool of profile.tooling)
		requireCondition(profile.capabilities.includes(tool.capability), `Unlisted tool capability: ${tool.capability}`)
	const url = new URL(profile.baseUrl)
	requireCondition(['http:', 'https:'].includes(url.protocol), 'Target must use HTTP or HTTPS')
	requireCondition(!url.username && !url.password, 'Use credential references, not URL credentials')
	for (const tool of profile.tooling)
		requireCondition(
			!/resolve-and-pin|unknown/i.test(tool.version),
			`Record the actual version of ${tool.executable}`
		)
	return profile
}

export function approvalPolicy(profile: Profile) {
	return profile.approvals ?? { plan: 'required', result: 'required' }
}

// A gap applies to the tests it names, to every test of the requirements it names,
// and to every test when it names neither.
export function gapsAffecting(gaps: Gap[], test: Pick<Test, 'id' | 'requirementIds'>) {
	return gaps.filter(
		(gap) =>
			gap.testIds.includes(test.id) ||
			gap.requirementIds.some((id) => test.requirementIds.includes(id)) ||
			(gap.testIds.length === 0 && gap.requirementIds.length === 0)
	)
}

export function testReadiness(gaps: Gap[], test: Pick<Test, 'id' | 'requirementIds'>): Test['readiness'] {
	const affected = gapsAffecting(gaps, test)
	if (affected.some((gap) => gap.status === 'deferred')) return 'deferred'
	if (affected.some((gap) => gap.status === 'open' && gap.severity === 'blocking')) return 'blocked'
	return 'ready'
}

export function planCoverage(plan: Pick<Plan, 'requirements' | 'tests' | 'gaps'>): Plan['coverage'] {
	return plan.requirements.map((requirement) => {
		const tests = plan.tests.filter((test) => test.requirementIds.includes(requirement.id))
		const gaps = plan.gaps.filter(
			(gap) => gap.requirementIds.includes(requirement.id) || (!gap.requirementIds.length && !gap.testIds.length)
		)
		const status =
			gaps.some((gap) => gap.status === 'deferred') || tests.some((test) => test.readiness === 'deferred')
				? 'deferred'
				: gaps.some((gap) => gap.severity === 'blocking' && gap.status === 'open') ||
					  tests.some((test) => test.readiness === 'blocked') ||
					  tests.length === 0
					? 'blocked'
					: 'planned'
		return { requirementId: requirement.id, testIds: tests.map((test) => test.id), status }
	})
}

export function derivePlan(draft: PlanDraft): Plan {
	const tests = draft.tests.map((test) => ({
		...test,
		gapIds: gapsAffecting(draft.gaps, test).map((gap) => gap.id),
		readiness: testReadiness(draft.gaps, test),
	}))
	return { ...draft, tests, coverage: planCoverage({ ...draft, tests }) }
}

export function planCheck(value: unknown): Plan {
	const plan = validate('plan', value)
	const requirements = index(plan.requirements, 'id', 'requirement')
	const tests = index(plan.tests, 'id', 'test')
	const gaps = index(plan.gaps, 'id', 'gap')
	const decisions = index(plan.decisions, 'id', 'decision')
	index(plan.coverage, 'requirementId', 'coverage requirement')
	index(plan.assumptions, 'decisionId', 'assumption decision')
	const localReferences = (ids: string[]) =>
		ids.filter((id) => {
			const { planId } = testReference(id)
			requireCondition(planId !== plan.planId, `Use the local test ID, not ${id}`)
			return planId === null
		})
	for (const gap of plan.gaps) {
		references(gap.requirementIds, requirements, `requirement in gap ${gap.id}`)
		references(localReferences(gap.testIds), tests, `test in gap ${gap.id}`)
		if (gap.status === 'open') requireCondition(gap.decisionId === null, `Open gap ${gap.id} has a decision`)
		else {
			const decision = decisions.get(gap.decisionId ?? '')
			requireCondition(decision?.gapId === gap.id, `Gap ${gap.id} needs a matching decision`)
			requireCondition(
				(decision.kind === 'defer') === (gap.status === 'deferred'),
				`Gap ${gap.id} status conflicts with decision ${decision.id}`
			)
		}
	}
	for (const decision of plan.decisions) {
		requireCondition(
			gaps.get(decision.gapId)?.decisionId === decision.id,
			`Decision ${decision.id} does not resolve its gap`
		)
		if (decision.kind === 'clarify')
			requireCondition(decision.source, `Clarification ${decision.id} needs a source`)
		if (decision.kind === 'accept_assumption')
			requireCondition(
				plan.assumptions.some((a) => a.decisionId === decision.id && a.text === decision.value),
				`Accepted assumption ${decision.id} must stay visible`
			)
	}
	for (const assumption of plan.assumptions)
		requireCondition(
			decisions.get(assumption.decisionId)?.kind === 'accept_assumption',
			`Assumption ${assumption.decisionId} lacks caller acceptance`
		)
	for (const test of plan.tests) {
		references(test.requirementIds, requirements, `requirement in test ${test.id}`)
		references(test.gapIds, gaps, `gap in test ${test.id}`)
		references(localReferences(test.dependsOn), tests, `dependency of test ${test.id}`)
		index(test.assertions, 'id', `assertion in test ${test.id}`)
		requireCondition(
			same(
				test.gapIds,
				gapsAffecting(plan.gaps, test).map((gap) => gap.id)
			),
			`Test ${test.id} gapIds conflict with gap scope`
		)
		requireCondition(
			test.readiness === testReadiness(plan.gaps, test),
			`Test ${test.id} readiness conflicts with gaps`
		)
		if (test.readiness === 'ready')
			requireCondition(test.assertions.length > 0, `Ready test ${test.id} needs one or more assertions`)
	}
	for (const requirement of plan.requirements)
		requireCondition(
			plan.tests.some((test) => test.requirementIds.includes(requirement.id)) ||
				plan.gaps.some((gap) => gap.requirementIds.includes(requirement.id)),
			`Requirement ${requirement.id} has no test or gap`
		)
	requireCondition(same(plan.coverage, planCoverage(plan)), 'Plan coverage is inconsistent')
	return plan
}

export function planTargetCheck(plan: Plan, profile: Profile) {
	for (const test of plan.tests.filter((test) => test.readiness === 'ready')) {
		requireCondition(
			profile.capabilities.includes(test.capability),
			`Test ${test.id} needs capability ${test.capability}, which the target lacks. Record a planning gap.`
		)
		for (const operation of test.operations)
			requireCondition(
				profile.allowedOperations.includes(operation),
				`Test ${test.id} uses operation ${operation}, which the target does not permit`
			)
	}
}

// Each cross-plan reference must name a test in the latest revision of that plan,
// and the test graph of the latest revision of every plan must have no cycle.
export function dependencyCheck(plan: Plan, latest: ReadonlyMap<string, Plan>) {
	const plans = new Map(latest).set(plan.planId, plan)
	const crossReferences = [...plans.values()]
		.flatMap((current) => [
			...current.tests.flatMap((test) => test.dependsOn),
			...current.gaps.flatMap((gap) => gap.testIds),
		])
		.filter((id) => id.includes(':'))
	for (const reference of crossReferences) {
		const { planId, testId } = testReference(reference)
		const other = plans.get(planId!)
		requireCondition(other, `Unknown plan in ${reference}: ${planId}`)
		requireCondition(
			other.tests.some((test) => test.id === testId),
			`Unknown test in ${reference}: ${testId} is not in ${planId}@${other.revision}`
		)
	}
	const edges = new Map<string, string[]>()
	for (const [planId, other] of plans)
		for (const test of other.tests)
			edges.set(
				`${planId}:${test.id}`,
				test.dependsOn.map((id) => (id.includes(':') ? id : `${planId}:${id}`))
			)
	const visiting: string[] = []
	const visited = new Set<string>()
	function visit(node: string) {
		const start = visiting.indexOf(node)
		requireCondition(start < 0, `Test dependency cycle: ${[...visiting.slice(start), node].join(' -> ')}`)
		if (visited.has(node)) return
		visiting.push(node)
		for (const next of edges.get(node) ?? []) visit(next)
		visiting.pop()
		visited.add(node)
	}
	for (const node of edges.keys()) visit(node)
}

export function testOutcome(results: AssertionResult[]): 'passed' | 'failed' | 'error' | 'inconclusive' {
	if (results.includes('failed')) return 'failed'
	if (results.includes('not_checked')) return 'error'
	if (results.includes('inconclusive')) return 'inconclusive'
	return 'passed'
}

export function resultCoverage(plan: Plan, tests: ResultTest[], newGaps: Gap[]): Result['coverage'] {
	const outcomes = new Map(tests.map((test) => [test.testId, test.outcome]))
	const requirements = plan.requirements.map((requirement) => {
		const planned = plan.tests.filter((test) => test.requirementIds.includes(requirement.id))
		const seen = planned.map((test) => outcomes.get(test.id))
		const unresolved = [...plan.gaps, ...newGaps].some(
			(gap) =>
				(gap.requirementIds.includes(requirement.id) || (!gap.requirementIds.length && !gap.testIds.length)) &&
				(gap.status === 'deferred' || (gap.status === 'open' && gap.severity === 'blocking'))
		)
		const tested =
			planned.length > 0 && !unresolved && seen.every((outcome) => outcome === 'passed' || outcome === 'failed')
		return {
			requirementId: requirement.id,
			status: tested ? ('tested' as const) : ('uncovered' as const),
			testIds: planned.map((test) => test.id),
			reason: tested
				? null
				: seen.includes('inconclusive')
					? 'An assertion is inconclusive.'
					: 'At least one required check or decision is missing.',
		}
	})
	const executed = ['passed', 'failed', 'error', 'inconclusive']
	return {
		status: requirements.every((row) => row.status === 'tested')
			? 'complete'
			: tests.some((test) => executed.includes(test.outcome))
				? 'partial'
				: 'not_executed',
		requirements,
	}
}
