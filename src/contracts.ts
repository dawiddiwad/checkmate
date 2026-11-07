import type {
	Profile,
	Plan,
	SetupRequest,
	PlanRequest,
	ReviseRequest,
	ExecuteRequest,
	ReportRequest,
	Observation,
	Result,
	Response,
} from './types.ts'
import { Ajv, type AnySchema, type ValidateFunction } from 'ajv'
import addFormats from 'ajv-formats'
import { readFileSync } from 'node:fs'
import { requireCondition, same } from './files.ts'

const ajv = new Ajv({ allErrors: true })
addFormats.default(ajv)
export type Documents = {
	profile: Profile
	plan: Plan
	'setup-request': SetupRequest
	'plan-request': PlanRequest
	'revise-request': ReviseRequest
	'execute-request': ExecuteRequest
	'report-request': ReportRequest
	observation: Observation
	result: Result
	response: Response
}
const validators = new Map<string, ValidateFunction>()
export function schema(name: string): AnySchema {
	requireCondition(
		/^(profile|plan|result|observation|response|setup-request|plan-request|revise-request|execute-request|report-request)$/.test(
			name
		),
		'Unknown schema'
	)
	return JSON.parse(readFileSync(new URL(`../contracts/${name}.schema.json`, import.meta.url), 'utf8'))
}
export function validate<K extends keyof Documents>(name: K, value: unknown): Documents[K] {
	if (!validators.has(name)) validators.set(name, ajv.compile(schema(name)))
	const check = validators.get(name)!
	requireCondition(check(value), `Invalid ${name}: ${ajv.errorsText(check.errors, { dataVar: name })}`)
	return value as Documents[K]
}
export function requestCheck(value: unknown) {
	requireCondition(typeof value === 'object' && value !== null && 'operation' in value, 'Missing operation')
	switch (value.operation) {
		case 'setup':
			return validate('setup-request', value)
		case 'plan':
			return validate('plan-request', value)
		case 'revise':
			return validate('revise-request', value)
		case 'execute':
			return validate('execute-request', value)
		case 'report':
			return validate('report-request', value)
		default:
			throw new Error('Unknown operation')
	}
}
export function index<T, K extends keyof T>(items: T[], key: K): Map<T[K], T> {
	const map = new Map(items.map((item) => [item[key], item]))
	requireCondition(map.size === items.length, `Duplicate ${String(key)}`)
	return map
}
export function references(ids: string[], map: ReadonlyMap<string, unknown>, name: string) {
	requireCondition(
		ids.every((id) => map.has(id)),
		`Unknown ${name} reference`
	)
}
export function profileCheck(value: unknown): Profile {
	const profile = validate('profile', value)
	const tools = index(profile.tooling, 'capability')
	references(profile.capabilities, tools, 'tool')
	requireCondition(
		profile.tooling.every((tool) => profile.capabilities.includes(tool.capability)),
		'Unlisted tool capability'
	)
	requireCondition(['http:', 'https:'].includes(new URL(profile.baseUrl).protocol), 'Target must use HTTP or HTTPS')
	requireCondition(
		!new URL(profile.baseUrl).username && !new URL(profile.baseUrl).password,
		'Use credential references, not URL credentials'
	)
	requireCondition(
		profile.tooling.every((tool) => !/resolve-and-pin|unknown/i.test(tool.version)),
		'Record actual tool versions'
	)
	return profile
}
export function planCoverage(plan: Plan): Plan['coverage'] {
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
export function planCheck(value: unknown): Plan {
	const plan = validate('plan', value)
	const requirements = index(plan.requirements, 'id')
	const tests = index(plan.tests, 'id')
	const gaps = index(plan.gaps, 'id')
	const decisions = index(plan.decisions, 'id')
	index(plan.coverage, 'requirementId')
	index(plan.assumptions, 'decisionId')
	for (const gap of plan.gaps) {
		references(gap.requirementIds, requirements, 'requirement')
		references(gap.testIds, tests, 'test')
		if (gap.status === 'open') requireCondition(gap.decisionId === null, 'Open gap has a decision')
		else {
			const decision = decisions.get(gap.decisionId ?? '')
			requireCondition(decision?.gapId === gap.id, 'Gap needs a matching decision')
			requireCondition(
				(decision.kind === 'defer') === (gap.status === 'deferred'),
				'Gap disposition conflicts with decision'
			)
		}
	}
	for (const decision of plan.decisions) {
		requireCondition(gaps.get(decision.gapId)?.decisionId === decision.id, 'Decision does not resolve its gap')
		if (decision.kind === 'clarify') requireCondition(decision.source, 'Clarification needs a source')
		if (decision.kind === 'accept_assumption')
			requireCondition(
				plan.assumptions.some((a) => a.decisionId === decision.id && a.text === decision.value),
				'Accepted assumption must stay visible'
			)
	}
	for (const assumption of plan.assumptions)
		requireCondition(
			decisions.get(assumption.decisionId)?.kind === 'accept_assumption',
			'Assumption lacks caller acceptance'
		)
	const visiting = new Set()
	const visited = new Set()
	function visit(id: string) {
		requireCondition(!visiting.has(id), 'Test dependency cycle')
		if (visited.has(id)) return
		visiting.add(id)
		for (const dependency of tests.get(id)!.dependsOn) visit(dependency)
		visiting.delete(id)
		visited.add(id)
	}
	for (const test of plan.tests) {
		references(test.requirementIds, requirements, 'requirement')
		references(test.gapIds, gaps, 'gap')
		references(test.dependsOn, tests, 'dependency')
		const affected = plan.gaps.filter(
			(gap) =>
				gap.testIds.includes(test.id) ||
				gap.requirementIds.some((id) => test.requirementIds.includes(id)) ||
				(gap.testIds.length === 0 && gap.requirementIds.length === 0)
		)
		requireCondition(
			test.gapIds.every((id) => affected.some((gap) => gap.id === id)),
			'Test gap has no matching scope'
		)
		const deferred = affected.some((gap) => gap.status === 'deferred')
		const blocked = affected.some((gap) => gap.status === 'open' && gap.severity === 'blocking')
		const expectedReadiness = deferred ? 'deferred' : blocked ? 'blocked' : 'ready'
		requireCondition(test.readiness === expectedReadiness, 'Test readiness conflicts with gaps')
		if (test.readiness === 'ready')
			requireCondition(test.expected?.trim(), 'Ready test needs an explicit expected result')
	}
	for (const test of plan.tests) visit(test.id)
	for (const requirement of plan.requirements)
		requireCondition(
			plan.tests.some((test) => test.requirementIds.includes(requirement.id)) ||
				plan.gaps.some((gap) => gap.requirementIds.includes(requirement.id)),
			'Requirement has no test or gap'
		)
	requireCondition(same(plan.coverage, planCoverage(plan)), 'Plan coverage is inconsistent')
	return plan
}
