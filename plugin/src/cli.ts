import type { Reply, Store } from './store.ts'
import type { Plan } from './types.ts'
import { closeStore, completed, openReadOnlyStore, openStore } from './store.ts'
import { requireChoice, requireCondition, revisionReference } from './contracts.ts'
import { openTarget, saveTarget, showTarget, showTargetRequest } from './targets.ts'
import {
	answerGap,
	approvePlan,
	diffPlan,
	gate,
	openPlan,
	rejectPlan,
	revisePlan,
	savePlan,
	showPending,
	showPlanRequest,
} from './plans.ts'
import {
	acceptResult,
	beginRun,
	checkAssertion,
	closeTest,
	finishRun,
	recordFinding,
	recordGap,
	rejectResult,
	resumeRun,
} from './runs.ts'
import { evidenceBytes, operationLog, planDetail, planList, runDetail, runList } from './views.ts'
import { exportPlan, exportRun } from './render.ts'
import { startUi } from './ui/server.ts'
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'

type FlagKind = 'value' | 'list' | 'repeat' | 'switch'
type Args = Record<string, string | string[] | boolean>
type Context = { actor: string | undefined; stdin: () => unknown }
type Printed = { facts?: Record<string, unknown>; lines?: unknown[][] }
type Command = {
	positionals: string[]
	flags?: Record<string, FlagKind>
	required?: string[]
	write?: boolean
	stdin?: boolean
	readOnly?: boolean
	run: (store: Store, args: Args, context: Context) => Reply
	print?: (reply: Reply) => Printed
}
export type Io = { cwd: string; env: Record<string, string | undefined>; stdin: () => string }
export type Outcome = { code: number; output: string }

const testFields = [
	'title',
	'readiness',
	'capability',
	'operations',
	'requirementIds',
	'gapIds',
	'dependsOn',
	'preconditions',
	'action',
	'assertions',
]

function value(args: Args, name: string) {
	const found = args[name]
	return typeof found === 'string' ? found : undefined
}

function list(args: Args, name: string) {
	const found = args[name]
	return Array.isArray(found) ? found : undefined
}

function integer(args: Args, name: string) {
	const text = value(args, name)
	if (text === undefined) return undefined
	requireCondition(/^[0-9]+$/.test(text), `Invalid --${name}: ${text}. Use a whole number.`)
	return Number(text)
}

function short(sha256: unknown) {
	return typeof sha256 === 'string' ? sha256.slice(0, 8) : sha256
}

const commands: Record<string, Command> = {
	init: {
		positionals: [],
		run: (store) => completed('.checkmate/checkmate.db', { path: store.path }),
	},
	'target open': {
		positionals: ['targetId'],
		flags: { 'base-url': 'value', capabilities: 'list', operations: 'list' },
		required: ['base-url', 'capabilities', 'operations'],
		write: true,
		run: (store, args, { actor }) =>
			openTarget(store, actor, {
				targetId: value(args, 'targetId')!,
				baseUrl: value(args, 'base-url')!,
				capabilities: list(args, 'capabilities') ?? [],
				allowedOperations: list(args, 'operations') ?? [],
			}),
		print: (reply) => ({ facts: { recorded: reply.data.recorded } }),
	},
	'target request': {
		positionals: ['targetId'],
		run: (store, args) => showTargetRequest(store, value(args, 'targetId')!),
		print: (reply) => {
			const request = reply.data.request as {
				baseUrl: string
				capabilities: string[]
				allowedOperations: string[]
			}
			return {
				lines: [
					['baseUrl', request.baseUrl],
					['capabilities', request.capabilities],
					['operations', request.allowedOperations],
				],
			}
		},
	},
	'target save': {
		positionals: ['targetId'],
		write: true,
		stdin: true,
		run: (store, args, { actor, stdin }) =>
			saveTarget(store, actor, { targetId: value(args, 'targetId')!, profile: stdin() }),
		print: (reply) => ({ facts: { sha256: short(reply.data.sha256), recorded: reply.data.recorded } }),
	},
	'target show': {
		positionals: ['reference'],
		run: (store, args) => showTarget(store, value(args, 'reference')!),
		print: (reply) => {
			const profile = reply.data.profile as {
				baseUrl: string
				environment: string
				capabilities: string[]
				allowedOperations: string[]
				readyForLiveExecution: boolean
			}
			const approvals = reply.data.approvals as { plan: string; result: string }
			return {
				facts: { sha256: short(reply.data.sha256), ready: profile.readyForLiveExecution },
				lines: [
					['baseUrl', profile.baseUrl],
					['environment', profile.environment],
					['capabilities', profile.capabilities],
					['operations', profile.allowedOperations],
					['approvals', `plan=${approvals.plan}`, `result=${approvals.result}`],
				],
			}
		},
	},
	'plan open': {
		positionals: ['planId'],
		flags: { target: 'value' },
		required: ['target'],
		write: true,
		stdin: true,
		run: (store, args, { actor, stdin }) =>
			openPlan(store, actor, {
				planId: value(args, 'planId')!,
				target: value(args, 'target')!,
				request: stdin(),
			}),
		print: (reply) => ({ facts: { target: reply.data.target, recorded: reply.data.recorded } }),
	},
	'plan request': {
		positionals: ['planId'],
		run: (store, args) => showPlanRequest(store, value(args, 'planId')!),
		print: (reply) => {
			const data = reply.data as {
				target: string
				objective: string
				requirements: Plan['requirements']
				sourceContext: Array<{ uri: string; content: string }>
				capabilities: string[]
				allowedOperations: string[]
			}
			return {
				facts: { target: data.target },
				lines: [
					['objective', data.objective],
					...data.requirements.map((requirement) => [requirement.id, requirement.text, requirement.source]),
					...data.sourceContext.map((context) => ['context', context.uri, context.content]),
					['capabilities', data.capabilities],
					['operations', data.allowedOperations],
				],
			}
		},
	},
	'plan save': {
		positionals: ['planId'],
		write: true,
		stdin: true,
		run: (store, args, { actor, stdin }) =>
			savePlan(store, actor, { planId: value(args, 'planId')!, candidate: stdin() }),
		print: (reply) => ({ facts: { sha256: short(reply.data.sha256) } }),
	},
	'plan show': {
		positionals: ['reference'],
		flags: { tests: 'list', fields: 'list', gaps: 'value' },
		run: (store, args) => showPlan(store, args),
		print: printPlan,
	},
	'plan list': {
		positionals: [],
		flags: { 'needs-decision': 'switch', 'awaiting-approval': 'switch', blocked: 'switch' },
		run: (store, args) => {
			const plans = planList(store).filter(
				(plan) =>
					(!args['needs-decision'] || plan.openBlockingGaps.length > 0) &&
					(!args['awaiting-approval'] || plan.approval === 'pending') &&
					(!args.blocked || plan.blocked.length > 0)
			)
			return completed('plans', { plans })
		},
		print: (reply) => ({
			facts: { count: (reply.data.plans as unknown[]).length },
			lines: (reply.data.plans as ReturnType<typeof planList>).map((plan) => [
				`${plan.planId}@${plan.revision}`,
				`gaps=${cell(plan.openBlockingGaps)}`,
				`approval=${plan.approval}`,
				`blocked=${cell(plan.blocked.map((block) => `${block.testId}<-${block.dependency}: ${block.cause}`))}`,
			]),
		}),
	},
	'plan diff': {
		positionals: ['planId', 'from', 'to'],
		run: (store, args) =>
			diffPlan(store, { planId: value(args, 'planId')!, from: value(args, 'from')!, to: value(args, 'to')! }),
		print: (reply) => {
			const patch = reply.data.patch as Array<{ op: string; path: string; value?: unknown }>
			return {
				facts: { operations: patch.length },
				lines: [
					...(reply.data.changes as string[]).map((change) => ['change', change]),
					...patch.map((operation) =>
						operation.op === 'remove'
							? [operation.op, operation.path]
							: [operation.op, operation.path, JSON.stringify(operation.value)]
					),
				],
			}
		},
	},
	'gap answer': {
		positionals: ['planId', 'gapId'],
		flags: { kind: 'value', value: 'value', source: 'value', rationale: 'value', 'expect-sha': 'value' },
		required: ['kind', 'value', 'rationale'],
		write: true,
		run: (store, args, { actor }) =>
			answerGap(store, actor, {
				planId: value(args, 'planId')!,
				gapId: value(args, 'gapId')!,
				kind: value(args, 'kind')!,
				value: value(args, 'value')!,
				source: value(args, 'source') ?? null,
				rationale: value(args, 'rationale')!,
				expectSha256: value(args, 'expect-sha'),
			}),
		print: (reply) => ({ facts: { decision: reply.data.decisionId, gap: reply.data.gapId } }),
	},
	'plan pending': {
		positionals: ['planId'],
		run: (store, args) => showPending(store, value(args, 'planId')!),
		print: (reply) => {
			const data = reply.data as ReturnType<typeof showPending>['data'] & {
				decisions: Plan['decisions']
				gaps: Plan['gaps']
				tests: Plan['tests']
			}
			return {
				facts: { sha256: short(data.sha256), decisions: data.decisions.length },
				lines: [
					...data.decisions.map((decision) => [decision.id, decision.gapId, decision.kind, decision.value]),
					...data.gaps.map((gap) => [gap.id, gap.severity, gap.status, gap.question]),
					...data.tests.flatMap(testLines),
				],
			}
		},
	},
	'plan revise': {
		positionals: ['planId'],
		flags: { 'expect-sha': 'value' },
		write: true,
		stdin: true,
		run: (store, args, { actor, stdin }) =>
			revisePlan(store, actor, {
				planId: value(args, 'planId')!,
				delta: stdin(),
				expectSha256: value(args, 'expect-sha'),
			}),
		print: (reply) => ({ facts: { sha256: short(reply.data.sha256) } }),
	},
	'plan approve': verdictCommand('reference', (store, actor, reference, rationale, expectSha256) =>
		approvePlan(store, actor, { reference, rationale, expectSha256 })
	),
	'plan reject': verdictCommand('reference', (store, actor, reference, rationale, expectSha256) =>
		rejectPlan(store, actor, { reference, rationale, expectSha256 })
	),
	'run gate': {
		positionals: ['reference'],
		flags: { tests: 'list', build: 'value', partial: 'value', 'retest-of': 'value' },
		required: ['tests', 'build'],
		run: (store, args) =>
			gate(store, {
				reference: value(args, 'reference')!,
				tests: list(args, 'tests') ?? [],
				build: value(args, 'build')!,
				partial: value(args, 'partial'),
				retestOf: value(args, 'retest-of') ?? null,
			}).reply,
		print: (reply) => ({ facts: { sha256: short(reply.data.sha256) } }),
	},
	'run begin': {
		positionals: ['runId', 'reference'],
		flags: {
			tests: 'list',
			build: 'value',
			partial: 'value',
			'on-new-blocker': 'value',
			timeout: 'value',
			'retest-of': 'value',
		},
		required: ['tests', 'build'],
		write: true,
		run: (store, args, { actor }) =>
			beginRun(store, actor, {
				runId: value(args, 'runId')!,
				reference: value(args, 'reference')!,
				tests: list(args, 'tests') ?? [],
				build: value(args, 'build')!,
				partial: value(args, 'partial'),
				onNewBlocker: value(args, 'on-new-blocker'),
				timeoutSeconds: integer(args, 'timeout'),
				retestOf: value(args, 'retest-of') ?? null,
			}),
		print: (reply) => ({
			facts: {
				startedAt: reply.data.startedAt,
				browserSession: reply.data.browserSession,
				deadlineSeconds: reply.data.deadlineSeconds,
				evidenceDirectory: reply.data.evidenceDirectory,
			},
		}),
	},
	'run check': {
		positionals: ['runId', 'testId', 'assertionId'],
		flags: { result: 'value', observed: 'value', reason: 'value', evidence: 'repeat' },
		required: ['result'],
		write: true,
		run: (store, args, { actor }) =>
			checkAssertion(store, actor, {
				runId: value(args, 'runId')!,
				testId: value(args, 'testId')!,
				assertionId: value(args, 'assertionId')!,
				result: value(args, 'result')!,
				observed: value(args, 'observed'),
				reason: value(args, 'reason'),
				evidence: list(args, 'evidence'),
			}),
		print: (reply) => ({
			facts: { [`${reply.data.testId}.${reply.data.assertionId}`]: reply.data.result },
			lines: (reply.data.evidenceIds as string[]).map((id) => [id, 'evidence']),
		}),
	},
	'run close': {
		positionals: ['runId', 'testId'],
		flags: { outcome: 'value', reason: 'value', evidence: 'repeat' },
		write: true,
		run: (store, args, { actor }) =>
			closeTest(store, actor, {
				runId: value(args, 'runId')!,
				testId: value(args, 'testId')!,
				outcome: value(args, 'outcome'),
				reason: value(args, 'reason'),
				evidence: list(args, 'evidence'),
			}),
		print: (reply) => ({
			facts: { [String(reply.data.testId)]: reply.data.outcome },
			lines: reply.data.reason ? [['reason', reply.data.reason]] : [],
		}),
	},
	'run finding': {
		positionals: ['runId'],
		write: true,
		stdin: true,
		run: (store, args, { actor, stdin }) =>
			recordFinding(store, actor, { runId: value(args, 'runId')!, finding: stdin() }),
		print: (reply) => ({ facts: { finding: reply.data.findingId, tests: reply.data.testIds } }),
	},
	'run gap': {
		positionals: ['runId'],
		write: true,
		stdin: true,
		run: (store, args, { actor, stdin }) => recordGap(store, actor, { runId: value(args, 'runId')!, gap: stdin() }),
		print: (reply) => ({ facts: { gap: reply.data.gapId } }),
	},
	'run finish': {
		positionals: ['runId'],
		flags: { completion: 'value', cleanup: 'value', 'cleanup-reason': 'value' },
		required: ['completion', 'cleanup', 'cleanup-reason'],
		write: true,
		run: (store, args, { actor }) =>
			finishRun(store, actor, {
				runId: value(args, 'runId')!,
				completion: value(args, 'completion')!,
				cleanup: value(args, 'cleanup')!,
				cleanupReason: value(args, 'cleanup-reason')!,
			}),
		print: (reply) => ({
			facts: { coverage: reply.data.coverage, sha256: short(reply.data.sha256) },
			lines: Object.entries(reply.data.counts as Record<string, number>),
		}),
	},
	'run resume': {
		positionals: ['runId'],
		flags: { error: 'list', reason: 'value' },
		write: true,
		run: (store, args, { actor }) =>
			resumeRun(store, actor, {
				runId: value(args, 'runId')!,
				error: list(args, 'error'),
				reason: value(args, 'reason'),
			}),
		print: (reply) => {
			const data = reply.data as {
				attempt: number
				browserSession: string
				evidenceDirectory: string
				closed: string[]
				tests: Array<{ testId: string; warning: string; assertions: Plan['tests'][number]['assertions'] }>
			}
			return {
				facts: {
					attempt: data.attempt,
					browserSession: data.browserSession,
					evidenceDirectory: data.evidenceDirectory,
				},
				lines: [
					...data.closed.map((id) => [id, 'error']),
					...data.tests.flatMap((test) => [
						[test.testId, 'unclosed', test.warning],
						...test.assertions.map((assertion) => [
							`${test.testId}.${assertion.id}`,
							assertion.oracleKind,
							assertion.check,
						]),
					]),
				],
			}
		},
	},
	'run show': {
		positionals: ['runId'],
		flags: { tests: 'list' },
		run: (store, args) => {
			const detail = runDetail(store, value(args, 'runId')!)
			const selected = list(args, 'tests')
			for (const id of selected ?? [])
				requireCondition(
					detail.tests.some((test) => test.testId === id),
					`Test ${id} is not selected in run ${detail.runId}`
				)
			const tests = detail.tests.filter((test) => !selected || selected.includes(test.testId))
			return completed(detail.runId, { ...detail, tests })
		},
		print: (reply) => {
			const detail = reply.data as ReturnType<typeof runDetail>
			return {
				facts: {
					state: detail.state,
					plan: `${detail.planId}@${detail.revision}`,
					build: detail.build,
					completion: detail.result?.completion,
					coverage: detail.result?.coverage.status,
					acceptance: detail.result?.acceptance,
				},
				lines: [
					...detail.tests.flatMap((test) => [
						[test.testId, test.outcome ?? 'open', test.title, ...(test.reason ? [test.reason] : [])],
						...test.assertions.map((assertion) => [
							`${test.testId}.${assertion.assertionId}`,
							assertion.result ?? 'unchecked',
							assertion.observed ?? assertion.check,
							...(assertion.reason ? [assertion.reason] : []),
						]),
					]),
					...detail.findings.map((finding) => [
						finding.id,
						finding.type,
						finding.severity,
						finding.assertionIds,
						finding.title,
					]),
					...detail.newGaps.map((gap) => [gap.id, gap.severity, gap.status, gap.question]),
				],
			}
		},
	},
	'run list': {
		positionals: [],
		flags: { plan: 'value', build: 'value' },
		run: (store, args) =>
			completed('runs', { runs: runList(store, { planId: value(args, 'plan'), build: value(args, 'build') }) }),
		print: (reply) => ({
			facts: { count: (reply.data.runs as unknown[]).length },
			lines: (reply.data.runs as ReturnType<typeof runList>).map((run) => [
				run.runId,
				`${run.planId}@${run.revision}`,
				run.build,
				run.state,
				run.completion,
				run.coverage,
				run.acceptance,
			]),
		}),
	},
	'result accept': verdictCommand('runId', (store, actor, runId, rationale, expectSha256) =>
		acceptResult(store, actor, { runId, rationale, expectSha256 })
	),
	'result reject': verdictCommand('runId', (store, actor, runId, rationale, expectSha256) =>
		rejectResult(store, actor, { runId, rationale, expectSha256 })
	),
	'evidence get': {
		positionals: ['evidenceId'],
		flags: { out: 'value' },
		required: ['out'],
		run: (store, args) => {
			const evidence = evidenceBytes(store, value(args, 'evidenceId')!)
			const out = writeOutput(store, value(args, 'out')!, evidence.bytes)
			const { bytes, ...data } = evidence
			return completed(evidence.id, { ...data, out })
		},
		print: (reply) => ({ facts: { out: reply.data.out, size: reply.data.size, mediaType: reply.data.mediaType } }),
	},
	'export plan': {
		positionals: ['reference'],
		flags: { format: 'value', out: 'value' },
		required: ['format', 'out'],
		run: (store, args) => {
			const reference = value(args, 'reference')!
			const out = writeOutput(store, value(args, 'out')!, exportPlan(store, reference, value(args, 'format')!))
			return completed(reference, { out, format: value(args, 'format') })
		},
		print: (reply) => ({ facts: { out: reply.data.out } }),
	},
	'export run': {
		positionals: ['runId'],
		flags: { format: 'value', out: 'value' },
		required: ['format', 'out'],
		run: (store, args) => {
			const runId = value(args, 'runId')!
			const out = writeOutput(store, value(args, 'out')!, exportRun(store, runId, value(args, 'format')!))
			return completed(runId, { out, format: value(args, 'format') })
		},
		print: (reply) => ({ facts: { out: reply.data.out } }),
	},
	log: {
		positionals: [],
		flags: { subject: 'value', limit: 'value' },
		run: (store, args) =>
			completed('log', {
				operations: operationLog(store, { subject: value(args, 'subject'), limit: integer(args, 'limit') }),
			}),
		print: (reply) => ({
			lines: (reply.data.operations as ReturnType<typeof operationLog>).map((operation) => [
				operation.id,
				operation.at,
				operation.actor,
				operation.command,
				operation.status,
				operation.subjects,
			]),
		}),
	},
	query: {
		positionals: ['sql'],
		readOnly: true,
		run: (store, args) => {
			const statement = store.db.prepare(value(args, 'sql')!)
			const columns = statement.columns().map((column) => column.name)
			const rows = statement.all().map((row) =>
				Object.fromEntries(
					columns.map((column) => {
						const field = row[column]
						return [column, field instanceof Uint8Array ? `<blob ${field.length} bytes>` : field]
					})
				)
			)
			return completed('query', { columns, rows })
		},
		print: (reply) => {
			const columns = reply.data.columns as string[]
			const rows = reply.data.rows as Array<Record<string, unknown>>
			return {
				facts: { rows: rows.length },
				lines: [columns, ...rows.map((row) => columns.map((name) => row[name]))],
			}
		},
	},
}

function verdictCommand(
	positional: string,
	decide: (
		store: Store,
		actor: string | undefined,
		subject: string,
		rationale: string,
		expectSha256: string | undefined
	) => Reply
): Command {
	return {
		positionals: [positional],
		flags: { rationale: 'value', 'expect-sha': 'value' },
		required: ['rationale'],
		write: true,
		run: (store, args, { actor }) =>
			decide(store, actor, value(args, positional)!, value(args, 'rationale')!, value(args, 'expect-sha')),
		print: (reply) => ({ facts: { verdict: reply.data.verdict, sha256: short(reply.data.sha256) } }),
	}
}

function showPlan(store: Store, args: Args) {
	const { id, revision } = revisionReference(value(args, 'reference')!, 'plan reference')
	const detail = planDetail(store, id, revision)
	const subject = `${id}@${detail.revision}`
	const tests = list(args, 'tests')
	const fields = list(args, 'fields')
	const gaps = requireChoice(value(args, 'gaps') ?? 'all', ['open', 'all'] as const, 'gaps filter (--gaps)')
	if (!tests && !fields) {
		const plan = {
			...detail.plan,
			gaps: detail.plan.gaps.filter((gap) => gaps === 'all' || gap.status === 'open'),
		}
		return completed(subject, { ...detail, plan })
	}
	for (const test of tests ?? [])
		requireCondition(
			detail.plan.tests.some((item) => item.id === test),
			`Unknown test in ${subject}: ${test}`
		)
	for (const field of fields ?? [])
		requireCondition(testFields.includes(field), `Unknown field: ${field}. Use: ${testFields.join(', ')}`)
	const picked = detail.plan.tests
		.filter((test) => !tests || tests.includes(test.id))
		.map((test) =>
			Object.fromEntries([
				['id', test.id],
				...(fields ?? ['readiness', 'capability', 'title']).map((field) => [
					field,
					test[field as keyof typeof test],
				]),
			])
		)
	return completed(subject, {
		planId: id,
		revision: detail.revision,
		sha256: detail.sha256,
		fields: fields ?? ['readiness', 'capability', 'title'],
		tests: picked,
	})
}

function testLines(test: Plan['tests'][number]) {
	return [
		[test.id, test.readiness, test.capability, test.title],
		[test.id, 'action', test.action],
		...test.preconditions.map((precondition) => [test.id, 'precondition', precondition]),
		...test.assertions.map((assertion) => [`${test.id}.${assertion.id}`, assertion.oracleKind, assertion.check]),
	]
}

function printPlan(reply: Reply): Printed {
	const facts = { sha256: short(reply.data.sha256) }
	if (reply.data.fields) {
		const fields = reply.data.fields as string[]
		const tests = reply.data.tests as Array<Record<string, unknown>>
		return {
			facts,
			lines: tests.flatMap((test) => [
				[test.id, ...fields.filter((field) => field !== 'assertions').map((field) => test[field])],
				...(fields.includes('assertions')
					? (test.assertions as Plan['tests'][number]['assertions']).map((assertion) => [
							`${test.id}.${assertion.id}`,
							assertion.oracleKind,
							assertion.check,
						])
					: []),
			]),
		}
	}
	const detail = reply.data as ReturnType<typeof planDetail>
	const { plan } = detail
	const coverage = new Map(plan.coverage.map((row) => [row.requirementId, row.status]))
	return {
		facts: {
			...facts,
			approval: detail.approval.state,
			...(detail.latestRevision !== detail.revision ? { latest: detail.latestRevision } : {}),
		},
		lines: [
			...plan.requirements.map((requirement) => [requirement.id, coverage.get(requirement.id), requirement.text]),
			...plan.tests.map((test) => [test.id, test.readiness, test.capability, test.title]),
			...plan.gaps.map((gap) => [gap.id, gap.severity, gap.status, gap.question]),
			...plan.decisions.map((decision) => [decision.id, decision.gapId, decision.kind, decision.value]),
			...detail.pendingDecisions.map((decision) => [
				decision.id,
				decision.gapId,
				`pending ${decision.kind}`,
				decision.value,
			]),
		],
	}
}

function writeOutput(store: Store, out: string, content: string | Uint8Array) {
	const path = resolve(store.workspace, out)
	mkdirSync(dirname(path), { recursive: true })
	try {
		writeFileSync(path, content, { flag: 'wx' })
	} catch (error) {
		if (error instanceof Error && 'code' in error && error.code === 'EEXIST')
			throw new Error(`Output file exists: ${out}. Choose a new path.`, { cause: error })
		throw error
	}
	return out
}

function cell(field: unknown): string {
	if (field === null || field === undefined) return '-'
	if (Array.isArray(field)) return field.length ? field.map(cell).join(',') : '-'
	if (typeof field === 'object') return JSON.stringify(field)
	return String(field).replace(/\\/g, '\\\\').replace(/\t/g, '\\t').replace(/\r/g, '\\r').replace(/\n/g, '\\n')
}

function compact(reply: Reply, printed: Printed) {
	const facts = Object.entries(printed.facts ?? {})
		.filter(([, field]) => field !== undefined)
		.map(([key, field]) => `${key}=${cell(field)}`)
	return [
		[reply.status, reply.subject, ...facts].join(' '),
		...(printed.lines ?? []).map((line) => line.map(cell).join('\t')),
		...reply.reasons.map((reason) => `reason: ${cell(reason)}`),
	].join('\n')
}

function format(reply: Reply, json: boolean, print?: Command['print']) {
	if (json)
		return JSON.stringify({ status: reply.status, subject: reply.subject, reasons: reply.reasons, ...reply.data })
	return compact(reply, print ? print(reply) : {})
}

const globalFlags: Record<string, FlagKind> = { workspace: 'value', json: 'switch' }

function commandName(argv: string[]) {
	const words = argv.slice(0, 2).filter((word) => !word.startsWith('--'))
	if (words.length === 2 && commands[words.join(' ')]) return words.join(' ')
	if (commands[words[0]]) return words[0]
	throw new Error(`Unknown command: ${words.join(' ') || '(none)'}. Run checkmate --help.`)
}

function parse(name: string, tokens: string[]) {
	const command = commands[name]
	const flags: Record<string, FlagKind> = {
		...globalFlags,
		...command.flags,
		...(command.write ? { actor: 'value' as const } : {}),
	}
	const args: Args = {}
	const positionals: string[] = []
	for (let i = 0; i < tokens.length; i++) {
		const token = tokens[i]
		if (!token.startsWith('--')) {
			positionals.push(token)
			continue
		}
		const flag = token.slice(2)
		const kind = flags[flag]
		if (!kind) throw new Error(`Unknown option ${token} for ${name}. ${usage(name)}`)
		if (kind === 'switch') {
			args[flag] = true
			continue
		}
		const next = tokens[++i]
		if (next === undefined || next.startsWith('--')) throw new Error(`Missing value for ${token}`)
		if (kind === 'value') {
			if (flag in args) throw new Error(`Option ${token} is given twice`)
			args[flag] = next
		} else if (kind === 'list') {
			if (flag in args) throw new Error(`Option ${token} is given twice`)
			args[flag] = next
				.split(',')
				.map((item) => item.trim())
				.filter(Boolean)
		} else args[flag] = [...((args[flag] as string[] | undefined) ?? []), next]
	}
	if (positionals.length !== command.positionals.length) throw new Error(usage(name))
	for (const flag of command.required ?? []) if (!(flag in args)) throw new Error(`Missing --${flag}. ${usage(name)}`)
	command.positionals.forEach((positional, i) => (args[positional] = positionals[i]))
	return args
}

function usage(name: string) {
	const command = commands[name]
	const flags = Object.entries(command.flags ?? {}).map(([flag, kind]) => {
		const text = kind === 'switch' ? `--${flag}` : `--${flag} <${kind === 'list' ? 'a,b' : 'value'}>`
		return command.required?.includes(flag) ? text : `[${text}]`
	})
	return [
		'Usage: checkmate',
		name,
		...command.positionals.map((positional) => `<${positional}>`),
		...flags,
		...(command.write ? ['[--actor <name>]'] : []),
		...(command.stdin ? ['< payload.json'] : []),
	].join(' ')
}

const uiUsage = 'Usage: checkmate ui [--port <value>]'

function help() {
	return [
		...Object.keys(commands).map((name) => usage(name).replace('Usage: ', '')),
		uiUsage.replace('Usage: ', ''),
		'Options for every command: --workspace <path>, --json',
	].join('\n')
}

function version() {
	return JSON.parse(readFileSync(new URL('../.claude-plugin/plugin.json', import.meta.url), 'utf8')).version as string
}

function readJson(text: string) {
	requireCondition(text.trim().length > 0, 'Missing JSON payload on standard input')
	try {
		return JSON.parse(text) as unknown
	} catch (error) {
		throw new Error(`Standard input is not valid JSON: ${(error as Error).message}`, { cause: error })
	}
}

export function run(argv: string[], io: Io): Outcome {
	if (argv[0] === '--version') return { code: 0, output: version() }
	if (!argv.length || argv[0] === '--help') return { code: 0, output: help() }
	const json = argv.includes('--json')
	let name = 'checkmate'
	let args: Args
	try {
		name = commandName(argv)
		args = parse(name, argv.slice(name.split(' ').length))
	} catch (error) {
		const reply: Reply = { status: 'invalid_request', subject: name, reasons: [(error as Error).message], data: {} }
		return { code: 1, output: format(reply, json) }
	}
	const command = commands[name]
	const subject = command.positionals.length && name !== 'query' ? String(args[command.positionals[0]]) : name
	const workspace = resolve(io.cwd, value(args, 'workspace') ?? '.')
	let store: Store | undefined
	try {
		store = command.readOnly ? openReadOnlyStore(workspace) : openStore(workspace)
		const actor = value(args, 'actor') ?? io.env.CHECKMATE_ACTOR
		const reply = command.run(store, args, { actor, stdin: () => readJson(io.stdin()) })
		const code = reply.status === 'completed' || reply.status === 'needs_decision' ? 0 : 1
		return { code, output: format(reply, json, command.print) }
	} catch (error) {
		const reply: Reply = { status: 'rejected', subject, reasons: [(error as Error).message], data: {} }
		return { code: 1, output: format(reply, json) }
	} finally {
		if (store) closeStore(store)
	}
}

function uiOptions(tokens: string[], cwd: string) {
	const values: Record<string, string> = {}
	for (let i = 0; i < tokens.length; i++) {
		const token = tokens[i]
		if (token === '--json') continue
		const flag = token.startsWith('--') ? token.slice(2) : ''
		if (!['workspace', 'port'].includes(flag)) throw new Error(`Unknown argument ${token} for ui. ${uiUsage}`)
		const next = tokens[++i]
		if (next === undefined || next.startsWith('--')) throw new Error(`Missing value for ${token}`)
		if (flag in values) throw new Error(`Option ${token} is given twice`)
		values[flag] = next
	}
	const port = values.port === undefined ? undefined : Number(values.port)
	requireCondition(
		port === undefined || (/^[0-9]+$/.test(values.port) && port <= 65535),
		`Invalid --port: ${values.port}. Use 0 to 65535.`
	)
	return { workspace: resolve(cwd, values.workspace ?? '.'), port }
}

export async function serveUi(tokens: string[]) {
	const json = tokens.includes('--json')
	let options: ReturnType<typeof uiOptions>
	try {
		options = uiOptions(tokens, process.cwd())
	} catch (error) {
		const reply: Reply = { status: 'invalid_request', subject: 'ui', reasons: [(error as Error).message], data: {} }
		process.stdout.write(format(reply, json) + '\n')
		process.exitCode = 1
		return
	}
	const ui = await startUi(options)
	process.stdout.write(
		format(completed('ui', { url: ui.url }), json, (reply) => ({ facts: { url: reply.data.url } })) + '\n'
	)
	const stop = async () => {
		await ui.close()
		process.exit(0)
	}
	process.once('SIGINT', stop)
	process.once('SIGTERM', stop)
}

export async function main(argv: string[]) {
	if (argv[0] === 'ui') return serveUi(argv.slice(1))
	const outcome = run(argv, {
		cwd: process.cwd(),
		env: process.env,
		stdin: () => readFileSync(0, 'utf8'),
	})
	process.stdout.write(outcome.output + '\n')
	process.exitCode = outcome.code
}
