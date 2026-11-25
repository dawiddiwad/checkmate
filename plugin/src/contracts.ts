import type {
	Finding,
	Gap,
	Instance,
	Plan,
	PlanCandidate,
	PlanDelta,
	PlanPatch,
	PlanRequest,
	Profile,
	Response,
	Result,
} from './types.ts'
import type { Reply } from './store.ts'
import { canonical, WorkspaceSchemaError } from './store.ts'
import { expectationError, expectationExample, expectationHint } from './expectation.ts'
import * as validators from './validators.js'
import buildSchema from '../contracts/build.schema.json' with { type: 'json' }
import { operationAllowed } from './targets.ts'
import { choiceText, givenBy, observeFromChoices, observeReading } from './recipes.ts'

export type Test = Plan['tests'][number]
export type Assertion = Test['assertions'][number]
export type ResultTest = Result['tests'][number]
export type AssertionResult = ResultTest['assertions'][number]['result']
export type Documents = {
	profile: Profile
	'plan-request': PlanRequest
	'plan-candidate': PlanCandidate
	'plan-delta': PlanDelta
	'plan-patch': PlanPatch
	plan: Plan
	gap: Gap
	instance: Instance
	finding: Finding
	result: Result
	response: Response
}
export type PlanDraft = Omit<Plan, 'coverage' | 'tests'> & { tests: Array<Omit<Test, 'readiness' | 'gapIds'>> }

const identifier = /^[A-Za-z0-9][A-Za-z0-9_-]{0,95}$/
function buildText(label: string, value: unknown) {
	const shown = JSON.stringify(String(value).slice(0, 60))
	return `${label} ${shown} must be nonblank text on one line, with no control characters and at most ${buildSchema.maxLength} characters.`
}

export function requireBuild(value: unknown, name = 'application build (--build)'): string {
	const build = typeof value === 'string' ? value.trim() : value
	requireWellFormed(typeof build === 'string' && validators.build(build), buildText(name, value))
	return build
}

// A word of a command line that a person or an agent copies. A word with a special character is quoted.
export function shellWord(word: string) {
	return /^[\w./:@-]+$/.test(word) ? word : `'${word.replaceAll("'", "'\\''")}'`
}

export type RefusalKind = 'malformed' | 'prohibited'

export class Refusal extends Error {
	kind: RefusalKind
	hint: string | undefined
	constructor(kind: RefusalKind, message: string, hint?: string) {
		super(message)
		this.kind = kind
		this.hint = hint
	}
}

export const refusalReasons: Record<RefusalKind, string> = {
	malformed: 'Refused: malformed request.',
	prohibited: 'Refused: prohibited in the current state.',
}

export function refused(status: 'invalid_request' | 'rejected', subject: string, error: unknown): Reply {
	const refusal = status === 'invalid_request' ? 'malformed' : error instanceof Refusal ? error.kind : 'prohibited'
	const hint = error instanceof Refusal ? error.hint : undefined
	const reason = error instanceof Error ? error.message : String(error)
	return {
		status,
		subject,
		reasons: error instanceof WorkspaceSchemaError ? [reason] : [refusalReasons[refusal], reason],
		refusal,
		...(hint ? { hint } : {}),
		data: {},
	}
}

export function requireCondition(condition: unknown, message: string, hint?: string): asserts condition {
	if (!condition) throw new Refusal('prohibited', message, hint)
}

export function requireWellFormed(condition: unknown, message: string, hint?: string): asserts condition {
	if (!condition) throw new Refusal('malformed', message, hint)
}

export function same(a: unknown, b: unknown) {
	return canonical(a) === canonical(b)
}

export type SchemaProblem = { field: string; text: string; unknown: boolean; choices?: string[] }

export function schemaProblems(name: string, value: unknown, prefix = name): SchemaProblem[] {
	const check = validators[name.replace(/-./g, (match) => match[1].toUpperCase()) as keyof typeof validators]
	if (check(value)) return []
	return unionErrors(check.errors ?? [])
		.filter((error) => error.keyword !== 'propertyNames')
		.map((error) => ({
			field: String(
				error.instancePath.split('/')[1] ??
					error.params.missingProperty ??
					error.params.additionalProperty ??
					''
			),
			text: schemaError(`${prefix}${error.instancePath}`, error, value),
			unknown: error.keyword === 'additionalProperties',
			...(error.keyword === 'enum' ? { choices: (error.params.allowedValues ?? []).map(String) } : {}),
		}))
}

export function validate<K extends keyof Documents>(name: K, value: unknown): Documents[K] {
	const errors = schemaProblems(name, value).map((problem) => problem.text)
	requireWellFormed(
		!errors.length,
		`Invalid ${name}: ${errors.join(', ')}`,
		`Fix each named field and send the ${name} again. The schema is contracts/${name}.schema.json in the plugin.`
	)
	return value as Documents[K]
}

type SchemaError = NonNullable<validators.Validator['errors']>[number]

function unionErrors(errors: SchemaError[]): SchemaError[] {
	let kept = errors
	for (const union of errors.filter((error) => ['anyOf', 'oneOf'].includes(error.keyword))) {
		const misses = kept.filter(
			(error) =>
				error.keyword === 'type' &&
				error.instancePath === union.instancePath &&
				error.schemaPath.startsWith(union.schemaPath) &&
				/^\/[0-9]+\/type$/.test(error.schemaPath.slice(union.schemaPath.length))
		)
		const under = (error: SchemaError) =>
			error.instancePath === union.instancePath || error.instancePath.startsWith(`${union.instancePath}/`)
		const matched = kept.some((error) => error !== union && !misses.includes(error) && under(error))
		const merged = { ...misses[0], params: { type: misses.flatMap((error) => error.params.type ?? []) } }
		const replacement = matched ? [] : misses.length ? [merged] : [union]
		kept = kept.flatMap((error) => (error === union ? replacement : misses.includes(error) ? [] : [error]))
	}
	return kept
}

function typeList(types: string[]) {
	if (types.length < 3) return types.join(' or ')
	return `${types.slice(0, -1).join(', ')}, or ${types.at(-1)}`
}

function valueAt(document: unknown, instancePath: string) {
	return instancePath
		.split('/')
		.slice(1)
		.reduce<unknown>((value, key) => (value as Record<string, unknown> | undefined)?.[key], document)
}

function schemaError(path: string, error: SchemaError, document?: unknown) {
	if (
		['pattern', 'maxLength'].includes(error.keyword) &&
		['build', 'applicationBuild'].includes(path.split('/').at(-1)!)
	)
		return buildText(path, valueAt(document, error.instancePath))
	if (error.keyword === 'type') return `${path} must be ${typeList([error.params.type ?? []].flat())}`
	if (error.keyword === 'additionalProperties')
		return `${path} has unknown field "${error.params.additionalProperty}"`
	if (error.keyword === 'required')
		return `${path} needs field "${error.params.missingProperty}"${error.params.missingProperty === 'decisionId' ? ' (use null for an open gap)' : ''}`
	if (error.keyword === 'enum') return `${path} must be one of: ${error.params.allowedValues?.join(', ')}`
	if (error.propertyName !== undefined) return `${path} field name "${error.propertyName}" ${error.message}`
	return `${path} ${error.message}`
}

export function slugId(text: string) {
	return text
		.toLowerCase()
		.replace(/[^a-z0-9_-]+/g, '-')
		.replace(/^[^a-z0-9]+/, '')
		.replace(/-+$/, '')
		.slice(0, 96)
}

export function requireIdentifier(value: unknown, name: string): string {
	requireWellFormed(
		typeof value === 'string' && identifier.test(value),
		`Invalid ${name}: ${String(value)}. Use 1 to 96 letters, digits, _ or -, starting with a letter or digit.`
	)
	return value
}

// A bare word on a command line is an ID. "stdin" and "-" name the input, not a record.
export function requireNotInputWord(value: string | undefined, name: string, hint: string) {
	requireWellFormed(
		value !== 'stdin' && value !== '-',
		`${value} is not a valid ${name}. Checkmate reads standard input without a word for it.`,
		hint
	)
}

export function requireText(value: unknown, name: string): string {
	requireWellFormed(typeof value === 'string' && value.trim().length > 0, `Missing ${name}`)
	return value
}

export function requireChoice<T extends string>(value: unknown, choices: readonly T[], name: string): T {
	requireWellFormed(
		choices.includes(value as T),
		`Invalid ${name}: ${String(value)}. Use one of: ${choices.join(', ')}.`
	)
	return value as T
}

export function revisionReference(text: string, name: string) {
	const [id, revision, ...rest] = text.split('@')
	requireIdentifier(id, name)
	requireWellFormed(
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
	requireWellFormed(/^[a-f0-9]{8,64}$/.test(expected), `Invalid --expect-sha: ${expected}. Use 8 to 64 hex digits.`)
	requireCondition(
		actual.startsWith(expected),
		`${subject} has digest ${actual}, not ${expected}. Read it again before you decide.`
	)
}

export function index<T, K extends keyof T>(items: T[], key: K, name: string): Map<T[K], T> {
	const map = new Map<T[K], T>()
	for (const item of items) {
		requireWellFormed(!map.has(item[key]), `Duplicate ${name}: ${String(item[key])}`)
		map.set(item[key], item)
	}
	return map
}

export function references(ids: string[], map: ReadonlyMap<string, unknown>, name: string) {
	for (const id of ids) requireWellFormed(map.has(id), `Unknown ${name}: ${id}`)
}

export function profileCheck(value: unknown): Profile {
	const profile = validate('profile', value)
	index(profile.tools, 'name', 'tool')
	index(profile.entryPoints, 'name', 'entry point')
	for (const tool of profile.tools)
		requireWellFormed(
			tool.version === undefined || !/resolve-and-pin|unknown/i.test(tool.version),
			`Record the actual version of ${tool.name}, or leave version out`
		)
	return profile
}

export function approvalPolicy(profile: Profile) {
	return profile.approvals ?? { plan: 'none', result: 'none' }
}

export function gapsAffecting(gaps: Gap[], test: Pick<Test, 'id' | 'requirementIds'>) {
	return gaps.filter(
		(gap) =>
			gap.testIds.includes(test.id) ||
			gap.requirementIds.some((id) => test.requirementIds.includes(id)) ||
			(gap.testIds.length === 0 && gap.requirementIds.length === 0)
	)
}

// A defect that the test observed is ready to record. Its open gaps stay on the test and status shows them.
// A planned test waits for every gap that affects it.
export function testReadiness(gaps: Gap[], test: Pick<Test, 'id' | 'requirementIds' | 'metadata'>): Test['readiness'] {
	if (test.metadata?.harvestedFrom) return 'ready'
	const affected = gapsAffecting(gaps, test)
	if (affected.some((gap) => gap.status === 'deferred' && gap.severity === 'blocking')) return 'deferred'
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
			gaps.some((gap) => gap.status === 'deferred' && gap.severity === 'blocking') ||
			tests.some((test) => test.readiness === 'deferred')
				? 'deferred'
				: gaps.some((gap) => gap.severity === 'blocking' && gap.status === 'open') ||
					  tests.some((test) => test.readiness === 'blocked') ||
					  tests.length === 0
					? 'blocked'
					: 'planned'
		return { requirementId: requirement.id, testIds: tests.map((test) => test.id), status }
	})
}

export function withoutEmptyMetadata<T extends { metadata?: object }>(item: T): T {
	if (!item.metadata || Object.keys(item.metadata).length) return item
	const { metadata, ...rest } = item
	return rest as T
}

export function derivePlan(draft: PlanDraft): Plan {
	const tests = draft.tests.map((test) => ({
		...withoutEmptyMetadata(test),
		gapIds: gapsAffecting(draft.gaps, test).map((gap) => gap.id),
		readiness: testReadiness(draft.gaps, test),
	}))
	const requirements = draft.requirements.map(withoutEmptyMetadata)
	return { ...draft, requirements, tests, coverage: planCoverage({ ...draft, requirements, tests }) }
}

// A deterministic check compares a value, so code decides it from the observed item and the expected value.
// A deterministic check without an expected value is not verified by code: it is a legacy check.
export function unverifiedCheck(assertion: { checkKind: string; expected?: string }) {
	return assertion.checkKind === 'deterministic' && assertion.expected === undefined
}

export function compoundCheck(check: string) {
	const clauses = check.split(/\band\b|;/i)
	return clauses.filter((clause) => /\d/.test(clause)).length > 1
}

// A gap may cover this many requirements without naming each one in its question.
const maxGapRequirements = 2

// A refusal of a request also passes when the route is missed. A test that expects one needs a 2xx control in the same test.
// Returns the refusal assertion of a test that has none, else undefined.
export function uncontrolledRefusal(test: {
	action: string
	assertions: Array<{ id: string; expected?: string; check: string }>
}) {
	const httpAction = /\b(GET|POST|PUT|PATCH|DELETE)\b/.test(test.action)
	const refusal = test.assertions.find(
		(assertion) =>
			/^4\d\d$/.test(assertion.expected ?? '') || (httpAction && /^absent:/.test(assertion.expected ?? ''))
	)
	const control = test.assertions.some((assertion) => /^2\d\d$/.test(assertion.expected ?? ''))
	return refusal && !control ? refusal : undefined
}

// A range on an input names the input value it tests, for example "quantity 0", so that a build that accepts an
// out-of-range value fails the check. "quantity outside 1 to 10" names no input value. A count of output is not an input.
export function rangeWithoutInput(check: string) {
	const range = /\b(outside|between|at most|at least|from -?\d+(\.\d+)? to -?\d+)/i.test(check)
	const named =
		/\b(?!(?:outside|between|above|below|under|over|least|most|than|to|and|or|from|of|is|returns?|http|status|at)\b)[a-z][a-z-]*\s+-?\d+(\.\d+)?\b/i.test(
			check
		)
	const input = /\b(quantity|amount|value|price|size|length|page|limit|input|number)\b/i.test(check)
	return range && input && !named
}

// A state-changing action is shown only by a check that reads the state from its source. A test whose checks are all
// explicitly view-only (page, or a view value of a recipe) is flagged; a test that does not say observeFrom is left alone.
export function pageOnlyStateChange(test: { action: string; assertions: Array<{ observeFrom?: string }> }) {
	const changes = /\b(add|apply|clear|delete|remove|save|update)\b/i.test(test.action)
	return (
		changes &&
		test.assertions.length > 0 &&
		test.assertions.every(
			(assertion) => assertion.observeFrom !== undefined && observeReading(assertion.observeFrom) === 'view'
		)
	)
}

// A test serves one requirement or a small related group. One test with many requirements hides which one fails.
const maxRequirementsPerTest = 3

// A criterion that names required fields needs one check per field that leaves that field empty and names the refusal.
// The fields are the parenthesised list, or the parts joined by "and". A test with fewer such checks than fields is flagged.
function requiredFieldCount(text: string) {
	const list = text.match(/\(([^)]*)\)/)?.[1]
	if (list) return list.split(/,|\band\b/i).filter((part) => part.trim()).length
	return text.split(/\band\b/i).length
}

export function missingOmitChecks(test: Plan['tests'][number], requirements: Plan['requirements']) {
	const required = requirements.filter(
		(requirement) =>
			test.requirementIds.includes(requirement.id) && /\b(required|mandatory)\b/i.test(requirement.text)
	)
	if (!required.length) return false
	const fields = Math.max(...required.map((requirement) => requiredFieldCount(requirement.text)))
	const omits = test.assertions.filter((assertion) =>
		/\b(empty|missing|blank|without|omit\w*)\b/i.test(assertion.check)
	).length
	return omits < fields
}

// A requirement with no test and no gap is not covered. Save-then-flag: the plan saves, and status names the requirement.
export function uncoveredRequirements(plan: Pick<Plan, 'requirements' | 'tests' | 'gaps'>) {
	return plan.requirements
		.filter(
			(requirement) =>
				!plan.tests.some((test) => test.requirementIds.includes(requirement.id)) &&
				!plan.gaps.some((gap) => gap.requirementIds.includes(requirement.id))
		)
		.map((requirement) => requirement.id)
}

// The soft rules refuse a first save and save the test as not ready on the next attempt. Each names its reason.
export function softProblems(test: Plan['tests'][number], requirements: Plan['requirements']) {
	const problems: Array<{
		id: string
		reason: 'needs_control' | 'needs_source_check' | 'needs_input' | 'needs_required' | 'needs_split'
		check: string
	}> = []
	const refusal = uncontrolledRefusal(test)
	if (refusal) problems.push({ id: refusal.id, reason: 'needs_control', check: refusal.check })
	if (pageOnlyStateChange(test))
		problems.push({ id: test.assertions[0].id, reason: 'needs_source_check', check: test.action })
	for (const assertion of test.assertions)
		if (rangeWithoutInput(assertion.check))
			problems.push({ id: assertion.id, reason: 'needs_input', check: assertion.check })
	if (test.requirementIds.length > maxRequirementsPerTest)
		problems.push({
			id: test.assertions[0]?.id ?? '',
			reason: 'needs_split',
			check: test.requirementIds.join(', '),
		})
	if (missingOmitChecks(test, requirements))
		problems.push({ id: test.assertions[0]?.id ?? '', reason: 'needs_required', check: 'a required field' })
	return problems
}

// A check that code cannot decide yet, named by its assertion ID and reason: legacy checks and soft problems.
export function unverifiedAssertions(test: Plan['tests'][number], requirements: Plan['requirements']) {
	return [
		...test.assertions.filter((assertion) => unverifiedCheck(assertion)).map((assertion) => assertion.id),
		...softProblems(test, requirements).map((problem) => `${problem.id} ${problem.reason}`),
	]
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
			requireWellFormed(planId !== plan.planId, `Use the local test ID, not ${id}`)
			return planId === null
		})
	for (const gap of plan.gaps) {
		// One question for several requirements hides the criteria that need a test. Each one must be named.
		const namesEach = gap.requirementIds.every((id) => new RegExp(`(?<![\\w-])${id}(?![\\w-])`).test(gap.question))
		requireWellFormed(
			gap.requirementIds.length <= maxGapRequirements || namesEach,
			`Gap ${gap.id} covers ${gap.requirementIds.length} requirements with one question. Write tests for ${gap.requirementIds.join(', ')}; raise a gap only where you can state the missing fact for each one.`,
			`Name each requirement in the question, for example "${gap.requirementIds[0]}: <the missing fact>", or give each requirement its own gap.`
		)
		references(gap.requirementIds, requirements, `requirement in gap ${gap.id}`)
		references(localReferences(gap.testIds), tests, `test in gap ${gap.id}`)
		if (gap.status === 'open') requireWellFormed(gap.decisionId === null, `Open gap ${gap.id} has a decision`)
		else if (gap.status === 'not_needed')
			requireWellFormed(
				gap.decisionId === null || decisions.get(gap.decisionId)?.gapId === gap.id,
				`Gap ${gap.id} needs a matching decision`
			)
		else {
			const decision = decisions.get(gap.decisionId ?? '')
			requireWellFormed(decision?.gapId === gap.id, `Gap ${gap.id} needs a matching decision`)
			requireWellFormed(
				(decision.kind === 'defer') === (gap.status === 'deferred'),
				`Gap ${gap.id} status conflicts with decision ${decision.id}`
			)
		}
	}
	for (const decision of plan.decisions) {
		requireWellFormed(
			gaps.get(decision.gapId)?.decisionId === decision.id,
			`Decision ${decision.id} does not resolve its gap`
		)
		if (decision.kind === 'clarify')
			requireWellFormed(decision.source, `Clarification ${decision.id} needs a source`)
		if (decision.kind === 'accept_assumption')
			requireWellFormed(
				plan.assumptions.some((a) => a.decisionId === decision.id && a.text === decision.value),
				`Accepted assumption ${decision.id} must stay visible`
			)
	}
	for (const assumption of plan.assumptions)
		requireWellFormed(
			decisions.get(assumption.decisionId)?.kind === 'accept_assumption',
			`Assumption ${assumption.decisionId} lacks oracle acceptance`
		)
	for (const test of plan.tests) {
		references(test.requirementIds, requirements, `requirement in test ${test.id}`)
		references(test.gapIds, gaps, `gap in test ${test.id}`)
		references(localReferences(test.dependsOn), tests, `dependency of test ${test.id}`)
		index(test.assertions, 'id', `assertion in test ${test.id}`)
		for (const assertion of test.assertions)
			requireWellFormed(
				!compoundCheck(assertion.check),
				`Assertion ${test.id}.${assertion.id} checks more than one value.`,
				`Split it into one assertion for each value, for example {"id": "A2", "check": "<second expected value>", "checkKind": "deterministic"}. Keep one expected value in each check.`
			)
		for (const assertion of test.assertions)
			requireWellFormed(
				assertion.expected === undefined || !expectationError(assertion.expected),
				`Assertion ${test.id}.${assertion.id} has an expected value that code cannot compare. ${assertion.expected === undefined ? '' : expectationError(assertion.expected)}`,
				expectationHint(assertion.check)
			)
		for (const assertion of test.assertions)
			requireWellFormed(
				!unverifiedCheck(assertion),
				`Assertion ${test.id}.${assertion.id} is a deterministic check without an observed item and an expected value: ${assertion.check}`,
				`Working example for this check: ${expectationExample(assertion.check)}. A value that no source states is {"checkKind": "agent_observation"}, which the agent judges and the report says so.`
			)
		requireWellFormed(
			same(
				test.gapIds,
				gapsAffecting(plan.gaps, test).map((gap) => gap.id)
			),
			`Test ${test.id} gapIds conflict with gap scope`
		)
		requireWellFormed(
			test.readiness === testReadiness(plan.gaps, test),
			`Test ${test.id} readiness conflicts with gaps`
		)
		if (test.readiness === 'ready')
			requireWellFormed(
				test.assertions.length > 0,
				`Ready test ${test.id} needs one or more assertions`,
				`Add an assertion to ${test.id}, for example {"id": "A1", "check": "<expected result>", "checkKind": "deterministic"}. If the expected result is unknown, record an open blocking gap for ${test.id}.`
			)
	}
	requireWellFormed(same(plan.coverage, planCoverage(plan)), 'Plan coverage is inconsistent')
	return plan
}

export function planTargetCheck(plan: Plan, profile: Profile) {
	const observeFrom = observeFromChoices(profile.tools.map((tool) => tool.name))
	for (const test of plan.tests) {
		for (const { id, observeFrom: value } of test.assertions)
			if (value !== undefined && !observeFrom.some((choice) => choice.value === value))
				requireWellFormed(
					false,
					`Test ${test.id} assertion ${id} observes from ${value}, which no tool of target ${profile.targetId} gives (${givenBy(value)}). Allowed values: ${choiceText(observeFrom)}.`,
					observeFrom.length
						? `Use an allowed value, omit observeFrom, or add the tool that gives ${value} to the target.`
						: `Omit observeFrom or add the tool that gives ${value} to the target.`
				)
		if (test.readiness !== 'ready') continue
		requireCondition(
			profile.capabilities.includes(test.capability),
			`Test ${test.id} needs capability ${test.capability}, which the target lacks. Record a planning gap.`
		)
		for (const operation of test.operations)
			requireCondition(
				operationAllowed(profile, operation),
				`Test ${test.id} uses operation ${operation}, which the target does not permit`
			)
	}
}

export function dependencyCheck(plan: Plan, latest: ReadonlyMap<string, Plan>) {
	const plans = new Map(latest).set(plan.planId, plan)
	const crossReferences = [...plans.values()]
		.flatMap((other) => [
			...other.tests.flatMap((test) => test.dependsOn),
			...other.gaps.flatMap((gap) => gap.testIds),
		])
		.filter((id) => id.includes(':'))
	for (const reference of crossReferences) {
		const { planId, testId } = testReference(reference)
		const other = plans.get(planId!)
		requireWellFormed(other, `Unknown plan in ${reference}: ${planId}`)
		requireWellFormed(
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
		requireWellFormed(start < 0, `Test dependency cycle: ${[...visiting.slice(start), node].join(' -> ')}`)
		if (visited.has(node)) return
		visiting.push(node)
		for (const next of edges.get(node) ?? []) visit(next)
		visiting.pop()
		visited.add(node)
	}
	for (const node of edges.keys()) visit(node)
}

export function unusedId(prefix: string, used: string[]) {
	let number = 1
	while (used.includes(`${prefix}${number}`)) number++
	return `${prefix}${number}`
}

export const dependsOnAdvice =
	'Use dependsOn only when a test uses data that another test creates. Make the other tests independent.'

export function dependencyWarnings(plan: Pick<Plan, 'tests'>) {
	const local = new Map(plan.tests.map((test) => [test.id, test.dependsOn.filter((id) => !id.includes(':'))]))
	const chains = new Map<string, string[]>()
	const longer = (a: string[], b: string[]) => (b.length > a.length ? b : a)
	const chain = (id: string): string[] => {
		if (!chains.has(id)) chains.set(id, [id, ...(local.get(id) ?? []).map(chain).reduce(longer, [])])
		return chains.get(id)!
	}
	const longest = plan.tests.map((test) => chain(test.id)).reduce(longer, [])
	const dependent = plan.tests.filter((test) => local.get(test.id)!.length).map((test) => test.id)
	const warnings: string[] = []
	if (longest.length > 3)
		warnings.push(
			`dependsOn chain of ${longest.length} tests: ${longest.join(' -> ')}. Each test depends on the next. One failure blocks every test before it in the chain.`
		)
	if (dependent.length * 2 > plan.tests.length)
		warnings.push(`${dependent.length} of ${plan.tests.length} tests have dependsOn: ${dependent.join(', ')}.`)
	return warnings.length ? [...warnings, dependsOnAdvice] : []
}

export function testOutcome(results: AssertionResult[]): 'passed' | 'failed' | 'error' | 'inconclusive' {
	if (results.includes('failed')) return 'failed'
	if (results.includes('not_checked')) return 'error'
	if (results.includes('inconclusive')) return 'inconclusive'
	return 'passed'
}

export function resultCoverage(plan: Plan, tests: ResultTest[], newGaps: Gap[]): Result['coverage'] {
	const outcomes = new Map(tests.map((test) => [test.testId, test.outcome]))
	const conclusive = (test: Plan['tests'][number]) => ['passed', 'failed'].includes(outcomes.get(test.id) ?? '')
	const requirements = plan.requirements.map((requirement) => {
		const planned = plan.tests.filter((test) => test.requirementIds.includes(requirement.id))
		const gaps = [...plan.gaps, ...newGaps].filter(
			(gap) => gap.requirementIds.includes(requirement.id) || (!gap.requirementIds.length && !gap.testIds.length)
		)
		const blocking = gaps.some((gap) => gap.status === 'open' && gap.severity === 'blocking')
		const deferredGap = gaps.some((gap) => gap.status === 'deferred' && gap.severity === 'blocking')
		const tested = planned.length > 0 && !blocking && !deferredGap && planned.every(conclusive)
		const deferred =
			!tested &&
			!blocking &&
			(deferredGap || planned.some((test) => test.readiness === 'deferred')) &&
			planned.every((test) => test.readiness === 'deferred' || conclusive(test))
		return {
			requirementId: requirement.id,
			status: tested ? ('tested' as const) : deferred ? ('deferred' as const) : ('uncovered' as const),
			testIds: planned.map((test) => test.id),
			reason: tested
				? null
				: deferred
					? 'An oracle decision deferred the missing checks.'
					: planned.some((test) => outcomes.get(test.id) === 'inconclusive')
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
