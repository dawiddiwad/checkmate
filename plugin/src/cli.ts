import type { Reply, Store } from './store.ts'
import type { Plan, Profile } from './types.ts'
import type { EntryPoint, InstanceRecord, RequestedTool, TargetRequest } from './targets.ts'
import type { Approval, PlanTool } from './plans.ts'
import type { EvidenceInput } from './runs.ts'
import { busyReason, closeStore, completed, databasePath, isBusy, openReadOnlyStore, openStore } from './store.ts'
import {
	Refusal,
	dependencyWarnings,
	refused,
	requireChoice,
	requireCondition,
	requireWellFormed,
	revisionReference,
} from './contracts.ts'
import {
	addInstance,
	entryPointKinds,
	instanceList,
	openTarget,
	retireInstance,
	saveTarget,
	showTarget,
	showTargetRequest,
	targetList,
} from './targets.ts'
import {
	adoptGaps,
	answerGap,
	approvePlan,
	diffPlan,
	editPlan,
	gate,
	openPlan,
	patchPlan,
	rejectPlan,
	revisePlan,
	savePlan,
	showPending,
	showPlanRequest,
	decisionKinds,
	partialModes,
} from './plans.ts'
import {
	assertionResults,
	cleanupStatuses,
	closeCauses,
	closeOutcomes,
	completions,
	interruptCauses,
	newBlockerPolicies,
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
import {
	evidenceBytes,
	findingList,
	inbox,
	operationLog,
	planDetail,
	planList,
	planStatus,
	roles,
	runDetail,
	runList,
} from './views.ts'
import { recordBuild, recordChecklist, showLite } from './lite.ts'
import type { Field } from './guide.ts'
import type { GuideRole } from './guide.ts'
import { guideJournal, guideLite, guideRoles } from './guide.ts'
import type { BuildStatus, Gap, Issue } from './journal.ts'
import {
	answerQuestion,
	changeGaps,
	changeIssues,
	changeState,
	decideBuild,
	exportChange,
	issueStatus,
	logEntries,
	mergeBuild,
	openChange,
	readEntries,
	showChange,
	verifyBuild,
} from './journal.ts'
import { exportPlan, exportRun, formats, runFormats } from './render.ts'
import { startUi } from './ui/server.ts'
import { defaultActor } from './actor.ts'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { constants } from 'node:sqlite'

type FlagKind = 'value' | 'list' | 'repeat' | 'switch' | readonly string[] | { min: number; max: number }
type Args = Record<string, string | string[] | boolean>
type Context = {
	actor: string | undefined
	stdin: () => unknown
	text: () => string
	cwd: string
	viewer: () => string | undefined
}
type Printed = { facts?: Record<string, unknown>; lines?: unknown[][] }
type Command = {
	positionals: string[]
	flags?: Record<string, FlagKind>
	required?: string[]
	write?: boolean
	stdin?: boolean
	readOnly?: boolean
	check?: (args: Args) => void
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
	return text === undefined ? undefined : Number(text)
}

function optionValue(token: string, kind: FlagKind, text: string) {
	if (Array.isArray(kind))
		requireWellFormed(kind.includes(text), `Invalid ${token}: ${text}. Use one of: ${kind.join(', ')}.`)
	else if (typeof kind === 'object' && 'min' in kind)
		requireWellFormed(
			/^[0-9]+$/.test(text) && Number(text) >= kind.min && Number(text) <= kind.max,
			`Invalid ${token}: ${text}. Use a whole number from ${kind.min} to ${kind.max}.`
		)
}

function evidence(args: Args, context: Context): EvidenceInput[] | undefined {
	return list(args, 'evidence')?.map((spec) => {
		const match = /^-(?::(.+))?$/.exec(spec)
		return match ? { text: context.text(), kind: match[1] } : spec
	})
}

function toolSpec(spec: string): RequestedTool {
	const match = /^(.+?):(cli|mcp|skill):(.+)$/.exec(spec)
	requireWellFormed(match, `Invalid --tool: ${spec}. Use <name>:<cli|mcp|skill>:<purpose>.`)
	return { name: match[1], kind: match[2] as RequestedTool['kind'], purpose: match[3] }
}

function entryPointSpec(spec: string): EntryPoint {
	const match = /^([^:]+):([^:]+):(.+)$/.exec(spec)
	requireWellFormed(
		match && (entryPointKinds as readonly string[]).includes(match[2]),
		`Invalid --entry-point: ${spec}. Use <name>:<url|command|value>:<purpose>.`
	)
	return { name: match[1], kind: match[2] as EntryPoint['kind'], purpose: match[3] }
}

function instanceInput(args: Args, stdin: () => unknown) {
	const entries = list(args, 'entry')
	const environment = value(args, 'environment')
	const references = list(args, 'reference')
	if (entries === undefined) {
		requireWellFormed(
			environment === undefined && !references,
			'Give --entry with --environment and --reference, or send the instance on standard input'
		)
		return stdin()
	}
	const values: Record<string, string> = {}
	for (const entry of entries) {
		const at = entry.indexOf('=')
		requireWellFormed(at > 0, `Invalid --entry: ${entry}. Use <entryPoint>=<value>.`)
		const name = entry.slice(0, at)
		requireWellFormed(!(name in values), `Entry point ${name} is given twice`)
		values[name] = entry.slice(at + 1)
	}
	return {
		entries: values,
		...(environment === undefined ? {} : { environment }),
		...(references ? { references } : {}),
	}
}

function instanceLines(instance: InstanceRecord) {
	return [
		...Object.entries(instance.entries).map(([name, entry]) => ['entry', name, entry]),
		...(instance.environment ? [['environment', instance.environment]] : []),
		...instance.references.map((reference) => ['reference', reference]),
	]
}

function planRequestInput(args: Args, stdin: () => unknown) {
	const objective = value(args, 'objective')
	const sources = list(args, 'source')
	const instructions = value(args, 'instructions')
	if (objective === undefined) {
		requireWellFormed(
			!sources && instructions === undefined,
			'Give --objective with --source and --instructions, or send the request on standard input'
		)
		return stdin()
	}
	return { objective, context: { sources: sources ?? [], ...(instructions === undefined ? {} : { instructions }) } }
}

function leftOutLines(reply: Reply) {
	const leftOut = (reply.data.leftOut ?? []) as Array<{ testId: string; reason: string }>
	return leftOut.map((item) => [item.testId, 'left_out', item.reason])
}

function short(sha256: unknown) {
	return typeof sha256 === 'string' ? sha256.slice(0, 8) : sha256
}

type LiteState = {
	sha256?: string
	items: Plan['requirements']
	repeat: Array<{ item: string; steps: string; value: string; from: string }>
	uncovered: Array<{ area: string; source: string }>
	questions: Array<{ id: string; status: string; question: string; kind: string | null; answer: string | null }>
	runs: Array<{ runId: string; build: string; coverage: string | null; acceptance: string | null }>
	defects: Array<{ runId: string; id: string; severity: string; title: string; items: string[] }>
	next: string[]
}

function liteLines(data: LiteState, sources = true) {
	return [
		...data.items.map((item) => ['item', item.id, item.text, ...(sources ? [item.source] : [])]),
		...data.repeat.map((line) => [
			'repeat',
			line.item,
			`steps=${line.steps}`,
			`reference=${line.value} (${line.from})`,
		]),
		...data.uncovered.map((change) => [
			'suggest',
			change.area,
			change.source,
			'No item covers this changed area. You can add an item or a baseline.',
		]),
		...data.questions.map((question) => [
			'question',
			question.id,
			question.status,
			question.question,
			...(question.answer ? [question.kind, question.answer] : []),
		]),
		...data.runs.map((run) => ['run', run.runId, run.build, run.coverage, run.acceptance]),
		...data.defects.map((defect) => [
			'open_defect',
			defect.id,
			defect.runId,
			defect.severity,
			defect.items,
			defect.title,
		]),
	]
}

type ChangeState = ReturnType<typeof changeState>

type OpenItems = { build: string; total: number; counts: Record<string, number>; gaps: Gap[]; tester: boolean }
type MergeData = {
	build: string
	total: number
	command: string
	example: unknown
	defects: Array<{
		id: string
		severity: string
		title: string
		expected: string
		actual: string
		criteria: string[]
	}>
	groups: Array<{ reports: string[]; reason: string }>
	candidates: Array<{ report: string; into: string; reason: string }>
	issues: Array<{ id: string; title: string; reports: string[] }>
	ungrouped: string[]
}

function gapLines(gaps: Gap[], build: string, total = gaps.length) {
	return [
		...gaps.map((gap) => ['gap', gap.kind, gap.subject, gap.idea]),
		['count', total, `open items on ${build}: things your record does not show yet.`],
	]
}

function kindCounts(counts: Record<string, number>) {
	return Object.entries(counts)
		.filter(([, count]) => count)
		.map(([kind, count]) => `${kind} ${count}`)
		.join(', ')
}

function notShownLines(changeId: string, open: OpenItems) {
	const cut = { ...open.counts }
	for (const gap of open.gaps) cut[gap.kind]--
	const count = open.total - open.gaps.length
	if (!count) return []
	return [
		[
			'not_shown',
			count,
			kindCounts(cut),
			open.tester
				? 'Run checkmate journal gaps again after you log entries.'
				: `Run checkmate journal gaps ${changeId} --build ${open.build} --all to see all of them.`,
		],
	]
}

function fieldText(fields: Field[], described: Set<string>) {
	return fields
		.map((field) => {
			const name = `${field.path}${field.type.includes('|') ? ` (${field.type})` : ''}${field.required ? ' (required)' : ''}`
			if (described.has(field.description)) return `${name}.`
			described.add(field.description)
			return `${name}: ${field.description}`
		})
		.join(' ')
}

function cellText(cell: { ok: number; wrong: number; seen: number }) {
	const parts = Object.entries(cell).filter(([, count]) => count)
	return parts.length ? parts.map(([name, count]) => `${name}${count}`).join(',') : '-'
}

function statusText(on: BuildStatus) {
	if (on.basis === 'none') return on.status
	if (on.basis === 'verified') return `${on.status} (verified)`
	const votes = on.status === 'fixed' ? on.votes.fixed : on.votes.not_fixed
	const mark = on.basis === 'majority' ? '' : `, ${on.basis}`
	return `${on.status} (${votes} of ${on.votes.fixed + on.votes.not_fixed}${mark})`
}

function nextLines(next: string[]) {
	return next.map((line) => [`next: ${line}`])
}

const commands: Record<string, Command> = {
	init: {
		positionals: [],
		run: (store) => completed('.checkmate/checkmate.db', { path: store.path }),
	},
	inbox: {
		positionals: [],
		run: (store) => completed('inbox', inbox(store)),
		print: (reply) => {
			const waiting = reply.data as ReturnType<typeof inbox>
			return {
				facts: {
					gaps: waiting.gaps.length,
					plans: waiting.plans.length,
					results: waiting.results.length,
					requests: waiting.requests.length,
				},
				lines: [
					...waiting.gaps.map((gap) =>
						gap.runId
							? [
									`${gap.planId}@${gap.revision}/${gap.gapId}`,
									'run_gap',
									gap.severity,
									gap.runId,
									gap.question,
								]
							: [`${gap.planId}@${gap.revision}/${gap.gapId}`, 'gap', gap.severity, gap.question]
					),
					...waiting.plans.map((plan) => [
						`${plan.planId}@${plan.revision}`,
						'plan',
						short(plan.sha256),
						plan.summary,
					]),
					...waiting.results.map((result) => [
						result.runId,
						'result',
						`${result.planId}@${result.revision}`,
						result.build,
						result.coverage,
						Object.entries(result.counts).map(([outcome, count]) => `${outcome}=${count}`),
					]),
					...waiting.requests.map((request) => [
						request.planId,
						'requested',
						request.target,
						request.objective,
					]),
				],
			}
		},
	},
	status: {
		positionals: ['planId'],
		run: (store, args) => {
			const planId = value(args, 'planId')!
			return completed(planId, planStatus(store, planId))
		},
		print: (reply) => {
			const status = reply.data as ReturnType<typeof planStatus>
			return {
				facts: {
					state: status.state,
					waitsOn: status.waitsOn,
					revision: status.revision ?? undefined,
					approval: status.approval ?? undefined,
					run: status.latestRun?.runId,
				},
				lines: [
					...status.why.map((line) => ['why', line]),
					...status.next.map((line) => ['next', line]),
					...status.openRuns.map((run) => [
						run.runId,
						'started',
						`build=${run.build}`,
						`instance=${run.instanceId}`,
					]),
					...status.gaps.map((gap) =>
						gap.runId
							? [gap.gapId, 'run_gap', gap.severity, gap.runId, gap.question]
							: [gap.gapId, 'gap', gap.severity, gap.question]
					),
					...status.pendingDecisions.map((decision) => [
						decision.id,
						'pending',
						decision.gapId,
						decision.kind,
					]),
					...status.defects.map((defect) => [
						defect.findingId,
						'defect',
						defect.runId,
						defect.severity,
						defect.assertionIds,
						defect.title,
					]),
					...(status.retest?.verdicts ?? []).map((item) => [
						`${item.runId}/${item.findingId}`,
						'retest',
						status.retest!.runId,
						item.verdict,
						item.title,
					]),
				],
			}
		},
	},
	'target open': {
		positionals: ['targetId'],
		flags: { 'entry-point': 'repeat', capabilities: 'list', operations: 'list', tool: 'repeat' },
		required: ['entry-point', 'capabilities', 'operations'],
		write: true,
		run: (store, args, { actor }) =>
			openTarget(store, actor, {
				targetId: value(args, 'targetId')!,
				entryPoints: (list(args, 'entry-point') ?? []).map(entryPointSpec),
				capabilities: list(args, 'capabilities') ?? [],
				allowedOperations: list(args, 'operations') ?? [],
				tools: (list(args, 'tool') ?? []).map(toolSpec),
			}),
		print: (reply) => ({ facts: { recorded: reply.data.recorded } }),
	},
	'target request': {
		positionals: ['targetId'],
		run: (store, args) => showTargetRequest(store, value(args, 'targetId')!),
		print: (reply) => {
			const request = reply.data.request as TargetRequest
			return {
				lines: [
					...request.entryPoints.map((entry) => ['entryPoint', entry.name, entry.kind, entry.purpose]),
					['capabilities', request.capabilities],
					['operations', request.allowedOperations],
					...request.tools.map((tool) => ['tool', tool.name, tool.kind, tool.purpose]),
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
	'target list': {
		positionals: [],
		run: (store) => completed('targets', { targets: targetList(store) }),
		print: (reply) => ({
			facts: { count: (reply.data.targets as unknown[]).length },
			lines: (reply.data.targets as ReturnType<typeof targetList>).map((target) => [
				target.revision === null ? target.targetId : `${target.targetId}@${target.revision}`,
				`capabilities=${cell(target.capabilities)}`,
				`instances=${target.activeInstances}`,
			]),
		}),
	},
	'target show': {
		positionals: ['reference'],
		flags: { instance: 'value' },
		run: (store, args) => showTarget(store, value(args, 'reference')!, value(args, 'instance')),
		print: (reply) => {
			const profile = reply.data.profile as Profile
			const approvals = reply.data.approvals as { plan: string; result: string }
			const instance = reply.data.instance as InstanceRecord | undefined
			return {
				facts: {
					sha256: short(reply.data.sha256),
					ready: profile.readyForLiveExecution,
					instance: instance?.instanceId,
					retired: instance ? Boolean(instance.retired) : undefined,
				},
				lines: [
					...profile.entryPoints.map((entry) => ['entryPoint', entry.name, entry.kind, entry.purpose]),
					['authentication', profile.authentication.kind, profile.authentication.references],
					['capabilities', profile.capabilities],
					['operations', profile.allowedOperations],
					['approvals', `plan=${approvals.plan}`, `result=${approvals.result}`],
					['startup', profile.startup.owner, ...(profile.startup.command ?? [null])],
					['cleanup', profile.cleanup],
					...(profile.reset ? [['reset', profile.reset.owner, ...(profile.reset.command ?? [null])]] : []),
					...profile.tools.map((tool) => [
						'tool',
						tool.name,
						tool.kind,
						tool.version ?? '-',
						tool.reachable ? 'reachable' : 'unreachable',
						tool.purpose,
					]),
					...(reply.data.instances as InstanceRecord[]).map((item) => [
						'instance',
						item.instanceId,
						item.environment ?? '-',
					]),
					...(instance ? instanceLines(instance) : []),
				],
			}
		},
	},
	'target instance add': {
		positionals: ['targetId', 'instanceId'],
		flags: { entry: 'repeat', environment: 'value', reference: 'repeat' },
		write: true,
		stdin: true,
		run: (store, args, { actor, stdin }) =>
			addInstance(store, actor, {
				targetId: value(args, 'targetId')!,
				instanceId: value(args, 'instanceId')!,
				instance: instanceInput(args, stdin),
			}),
		print: (reply) => ({
			facts: { recorded: reply.data.recorded },
			lines: Object.entries(reply.data.entries as Record<string, string>).map(([name, entry]) => [
				'entry',
				name,
				entry,
			]),
		}),
	},
	'target instance retire': {
		positionals: ['targetId', 'instanceId'],
		write: true,
		run: (store, args, { actor }) =>
			retireInstance(store, actor, {
				targetId: value(args, 'targetId')!,
				instanceId: value(args, 'instanceId')!,
			}),
		print: (reply) => {
			const started = (reply.data.startedRuns ?? []) as string[]
			return {
				facts: { recorded: reply.data.recorded },
				lines: started.length
					? [['warning', `Started runs use this instance: ${started.join(', ')}. Its sandbox may be gone.`]]
					: [],
			}
		},
	},
	'target instance list': {
		positionals: ['targetId'],
		run: (store, args) => {
			const targetId = value(args, 'targetId')!
			return completed(targetId, { instances: instanceList(store, targetId) })
		},
		print: (reply) => ({
			facts: { count: (reply.data.instances as unknown[]).length },
			lines: (reply.data.instances as InstanceRecord[]).map((instance) => [
				instance.instanceId,
				instance.retired ? 'retired' : 'active',
				instance.environment ?? '-',
				{
					preformatted: Object.entries(instance.entries)
						.map(([name, entry]) => `${name}=${/[\s,="\\]/.test(entry) ? JSON.stringify(entry) : entry}`)
						.join(','),
				},
			]),
		}),
	},
	'plan open': {
		positionals: ['planId'],
		flags: { target: 'value', objective: 'value', source: 'repeat', instructions: 'value' },
		required: ['target'],
		write: true,
		stdin: true,
		run: (store, args, { actor, stdin }) =>
			openPlan(store, actor, {
				planId: value(args, 'planId')!,
				target: value(args, 'target')!,
				request: planRequestInput(args, stdin),
			}),
		print: (reply) => ({ facts: { target: reply.data.target, recorded: reply.data.recorded } }),
	},
	'plan request': {
		positionals: ['planId'],
		run: (store, args) => showPlanRequest(store, value(args, 'planId')!),
		print: (reply) => {
			const data = reply.data as ReturnType<typeof showPlanRequest>['data'] & {
				target: string
				objective: string
				requirements: Plan['requirements']
				sourceContext: Array<{ uri: string; content: string }>
				context: { sources: string[]; instructions?: string }
				tools: PlanTool[]
				capabilities: string[]
				allowedOperations: string[]
			}
			return {
				facts: { target: data.target },
				lines: [
					['objective', data.objective],
					...data.requirements.map((requirement) => [requirement.id, requirement.text, requirement.source]),
					...data.context.sources.map((source) => ['source', source]),
					...(data.context.instructions ? [['instructions', data.context.instructions]] : []),
					...data.sourceContext.map((context) => ['context', context.uri, context.content]),
					...data.tools.map((tool) => ['tool', tool.name, tool.kind, tool.purpose]),
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
		flags: { tests: 'list', fields: 'list', gaps: ['open', 'all'] },
		run: (store, args) => showPlan(store, args),
		print: printPlan,
	},
	'plan list': {
		positionals: [],
		flags: { 'needs-decision': 'switch', 'awaiting-approval': 'switch', blocked: 'switch', 'waits-on': roles },
		run: (store, args) => {
			const waitsOn = value(args, 'waits-on')
			const plans = planList(store).filter(
				(plan) =>
					(!args['needs-decision'] || plan.openBlockingGaps.length > 0) &&
					(!args['awaiting-approval'] || plan.approval === 'pending') &&
					(!args.blocked || plan.blocked.length > 0) &&
					(waitsOn === undefined || plan.loop.waitsOn === waitsOn)
			)
			return completed('plans', { plans })
		},
		print: (reply) => ({
			facts: { count: (reply.data.plans as unknown[]).length },
			lines: (reply.data.plans as ReturnType<typeof planList>).map((plan) =>
				plan.status === 'requested'
					? [plan.planId, 'status=requested', `state=${plan.loop.state}`, `waitsOn=${plan.loop.waitsOn}`]
					: [
							`${plan.planId}@${plan.revision}`,
							`gaps=${cell(plan.openBlockingGaps)}`,
							`approval=${plan.approval}`,
							`blocked=${cell(plan.blocked.map((block) => `${block.testId}<-${block.dependency}: ${block.cause}`))}`,
							`state=${plan.loop.state}`,
							`waitsOn=${plan.loop.waitsOn}`,
						]
			),
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
		flags: { kind: decisionKinds, value: 'value', source: 'value', rationale: 'value', 'expect-sha': 'value' },
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
		print: (reply) => {
			const adopted = reply.data.adopted as { runId: string; revision: number; edit: string } | undefined
			return {
				facts: {
					decision: reply.data.decisionId,
					gap: reply.data.gapId,
					from: adopted?.runId,
					revision: adopted?.revision,
					edit: adopted?.edit,
				},
			}
		},
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
					...data.decisions.map((decision) => [
						decision.id,
						decision.gapId,
						decision.kind,
						decision.value,
						decision.rationale,
					]),
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
	'plan edit': {
		positionals: ['reference'],
		flags: { patch: 'switch', 'expect-sha': 'value' },
		write: true,
		stdin: true,
		run: (store, args, { actor, stdin }) => {
			const reference = value(args, 'reference')!
			const expectSha256 = value(args, 'expect-sha')
			return args.patch
				? patchPlan(store, actor, { reference, patch: stdin(), expectSha256 })
				: editPlan(store, actor, { reference, candidate: stdin(), expectSha256 })
		},
		print: (reply) => ({ facts: { sha256: short(reply.data.sha256), edit: reply.data.edit } }),
	},
	'plan adopt-gaps': {
		positionals: ['reference'],
		flags: { run: 'value', gaps: 'list', 'expect-sha': 'value' },
		required: ['run'],
		write: true,
		run: (store, args, { actor }) =>
			adoptGaps(store, actor, {
				reference: value(args, 'reference')!,
				runId: value(args, 'run')!,
				gapIds: list(args, 'gaps'),
				expectSha256: value(args, 'expect-sha'),
			}),
		print: (reply) => ({
			facts: { sha256: short(reply.data.sha256), edit: reply.data.edit, adopted: reply.data.adopted },
		}),
	},
	'plan approve': verdictCommand('reference', (store, actor, reference, rationale, expectSha256) =>
		approvePlan(store, actor, { reference, rationale, expectSha256 })
	),
	'plan reject': verdictCommand('reference', (store, actor, reference, rationale, expectSha256) =>
		rejectPlan(store, actor, { reference, rationale, expectSha256 })
	),
	'lite checklist': {
		positionals: ['planId'],
		flags: { target: 'value' },
		required: ['target'],
		write: true,
		stdin: true,
		run: (store, args, { actor, stdin }) =>
			recordChecklist(store, actor, {
				planId: value(args, 'planId')!,
				target: value(args, 'target')!,
				checklist: stdin(),
			}),
		print: (reply) => ({ facts: { sha256: short(reply.data.sha256), questions: reply.data.questions } }),
	},
	'lite guide': {
		positionals: ['planId?'],
		run: (store, args) => guideLite(store, value(args, 'planId')),
		print: (reply) => {
			const data = reply.data as LiteState & {
				step: string
				steps?: string[]
				command: string
				about: string
				fields: Field[]
				example?: unknown
				need?: Array<[string, string[], string]>
			}
			return {
				facts: { step: data.step, ...(data.sha256 ? { sha256: short(data.sha256) } : {}) },
				lines: [
					...(data.steps ?? []).map((step) => ['step', step]),
					['about', data.about],
					...data.fields.map((field) => [
						'field',
						field.path,
						...(field.required ? ['required'] : []),
						field.description,
					]),
					data.example === undefined
						? ['command', `${data.command} <<'EOF'`, 'the JSON payload, then EOF']
						: [
								'example',
								{ preformatted: `${data.command} <<'EOF'\n${JSON.stringify(data.example)}\nEOF` },
							],
					...(data.items ? liteLines(data, false) : []),
					...(data.need ?? []).map((need) => ['need', ...need]),
					...nextLines(data.next),
				],
			}
		},
	},
	'lite show': {
		positionals: ['planId'],
		run: (store, args) => showLite(store, value(args, 'planId')!),
		print: (reply) => {
			const data = reply.data as LiteState
			return { facts: { sha256: short(data.sha256) }, lines: [...liteLines(data), ...nextLines(data.next)] }
		},
	},
	'lite record': {
		positionals: ['planId'],
		flags: { build: 'value', instance: 'value', draft: 'switch' },
		required: ['build'],
		write: true,
		stdin: true,
		run: (store, args, { actor, stdin }) =>
			recordBuild(store, actor, {
				planId: value(args, 'planId')!,
				build: value(args, 'build')!,
				instance: value(args, 'instance'),
				...(args.draft ? { draft: true } : {}),
				record: stdin(),
			}),
		print: (reply) =>
			reply.data.draft
				? {
						facts: { draft: reply.data.build, parts: reply.data.parts },
						lines: [
							...Object.entries(reply.data.counts as Record<string, number>).filter(([, count]) => count),
							...(reply.data.missing as string[]).map((reason) => ['missing', reason]),
							['next', 'Add parts with --draft. Complete the build with a last call without --draft.'],
						],
					}
				: {
						facts: {
							plan: reply.data.plan,
							coverage: reply.data.coverage,
							sha256: short(reply.data.sha256),
						},
						lines: [
							...Object.entries(reply.data.counts as Record<string, number>),
							...(reply.data.defects as string[]).map((id) => ['defect', id]),
							...(reply.data.retest as Array<{ runId: string; findingId: string; verdict: string }>).map(
								(item) => ['retest', `${item.runId}/${item.findingId}`, item.verdict]
							),
							...(reply.data.questions as string[]).map((id) => ['question', id]),
						],
					},
	},
	'journal open': {
		positionals: ['changeId'],
		flags: { target: 'value', instance: 'value' },
		required: ['target'],
		write: true,
		run: (store, args, { actor }) =>
			openChange(store, actor, {
				changeId: value(args, 'changeId')!,
				target: value(args, 'target')!,
				instance: value(args, 'instance'),
			}),
		print: (reply) => ({
			facts: { target: reply.data.targetId, instance: reply.data.instanceId },
			lines: nextLines(reply.data.next as string[]),
		}),
	},
	'journal log': {
		positionals: ['changeId'],
		flags: { build: 'value' },
		write: true,
		stdin: true,
		run: (store, args, { actor, text, cwd }) =>
			logEntries(store, actor, {
				changeId: value(args, 'changeId')!,
				build: value(args, 'build'),
				entries: readEntries(text()),
				cwd,
			}),
		print: (reply) => {
			const saved = reply.data.saved as Array<{ id: string }>
			const refused = reply.data.refused as Array<{
				field: string
				reason: string
				hint?: string
				fix?: unknown
			}>
			const ids = saved.map((entry) => entry.id)
			if (!refused.length) return { facts: { saved: ids } }
			return {
				facts: { saved: ids, refused: refused.length },
				lines: [
					...refused.map((entry) => [
						'refused',
						entry.field,
						entry.reason,
						...(entry.fix ? [`send: ${JSON.stringify(entry.fix)}`] : []),
						entry.hint,
					]),
					...nextLines(['Fix each refused entry. Send only those entries again. The saved entries stay.']),
				],
			}
		},
	},
	'journal gaps': {
		positionals: ['changeId'],
		flags: { build: 'value', all: 'switch' },
		run: (store, args, { viewer }) => changeGaps(store, value(args, 'changeId')!, value(args, 'build'), viewer()),
		print: (reply) => {
			const open = reply.data as unknown as OpenItems
			return {
				facts: { build: open.build },
				lines: [...gapLines(open.gaps, open.build, open.total), ...notShownLines(reply.subject, open)],
			}
		},
	},
	'journal guide': {
		positionals: ['changeId?'],
		flags: { role: guideRoles },
		run: (store, args, { viewer }) =>
			guideJournal(store, value(args, 'changeId'), value(args, 'role') as GuideRole | undefined, viewer()),
		print: (reply) => {
			const data = reply.data as {
				steps: string[]
				about: string
				common: Field[]
				kinds: Array<{ kind: string; about: string; fields: Field[] }>
				command: string
				example: unknown
				answers: Array<{ id: string; question: string; answer: string }>
				openDefects: Array<{ id: string; build: string; severity: string; title: string }>
			}
			const described = new Set<string>()
			return {
				lines: [
					...data.steps.map((step) => ['step', step]),
					['entries', `${data.about} Every entry has: ${fieldText(data.common, described)}`],
					...data.kinds.map((kind) => [
						'kind',
						kind.kind,
						`${kind.about} ${fieldText(kind.fields, described)}`,
					]),
					['example', { preformatted: `${data.command} <<'EOF'\n${JSON.stringify(data.example)}\nEOF` }],
					...data.answers.map((answer) => ['answer', answer.id, answer.question, answer.answer]),
					...data.openDefects.map((defect) => [
						'open_defect',
						defect.id,
						defect.build,
						defect.severity,
						defect.title,
					]),
				],
			}
		},
	},
	'journal show': {
		positionals: ['changeId'],
		flags: { all: 'switch' },
		run: (store, args, { viewer }) => showChange(store, value(args, 'changeId')!, viewer()),
		print: (reply) => {
			const data = reply.data as ChangeState
			return {
				facts: { target: data.targetId, instance: data.instanceId, builds: data.builds },
				lines: [
					...data.criteria.map((criterion) => [
						'criterion',
						criterion.id,
						criterion.text,
						criterion.source ?? '-',
					]),
					...data.matrix.map((row) => [
						'matrix',
						row.about,
						...data.builds.map((build) => `${build}=${cellText(row.cells[build])}`),
					]),
					...data.defects.map((defect) => [
						defect.suspected ? 'suspected_defect' : 'defect',
						defect.id,
						defect.build,
						defect.severity,
						defect.title,
						defect.verdicts.map((verdict) => `${verdict.build}=${verdict.result}`),
					]),
					...data.questions.map((question) => [
						'question',
						question.id,
						question.status,
						question.question,
						...(question.answer ? [question.answer] : []),
					]),
					...data.decisions.map((decision) => [
						'decision',
						decision.id,
						decision.build,
						decision.decision,
						decision.rationale,
						`gaps=${decision.gaps}`,
					]),
				],
			}
		},
	},
	'journal answer': {
		positionals: ['changeId', 'questionId'],
		flags: { answer: 'value' },
		required: ['answer'],
		write: true,
		run: (store, args, { actor }) =>
			answerQuestion(store, actor, {
				changeId: value(args, 'changeId')!,
				questionId: value(args, 'questionId')!,
				answer: value(args, 'answer')!,
			}),
		print: (reply) => ({ facts: { id: reply.data.id, question: reply.data.question } }),
	},
	'journal accept': decisionCommand('accepted'),
	'journal reject': decisionCommand('rejected'),
	'journal merge': {
		positionals: ['changeId'],
		flags: { build: 'value' },
		required: ['build'],
		run: (store, args) => mergeBuild(store, value(args, 'changeId')!, value(args, 'build')!),
		print: (reply) => {
			const data = reply.data as unknown as MergeData
			const hidden = data.total - data.defects.length
			const again = data.issues.length > 0
			const suggestions = [
				...data.groups.map((group) => ['suggest', group.reports.join(','), group.reason]),
				...(data.candidates.length ? [['singles that may belong to a larger issue']] : []),
				...data.candidates.map((item) => ['may_belong', item.report, item.into, item.reason]),
			]
			const checks = [
				['check', `${data.ungrouped.length} defects are in no issue: ${data.ungrouped.join(',') || '-'}`],
				['check', `${data.groups.length} suggest lines are not logged as issues`],
				['check', `${data.candidates.length} singles may belong to a larger issue`],
			]
			if (again)
				return {
					facts: { build: data.build, defects: data.total, issues: data.issues.length },
					lines: [...suggestions, ...checks],
				}
			return {
				facts: { build: data.build, defects: data.total },
				lines: [
					...data.defects.map((defect) => [
						'defect',
						defect.id,
						defect.severity,
						defect.title,
						`expected: ${defect.expected}`,
						`actual: ${defect.actual}`,
						`criteria: ${defect.criteria.join(',') || '-'}`,
					]),
					...(hidden > 0
						? [
								[
									'not_shown',
									hidden,
									`Run checkmate journal export ${reply.subject} --all to read all defects.`,
								],
							]
						: []),
					...suggestions,
					...nextLines([
						'The suggest and may_belong lines are ideas from the same criterion, words, steps, or path. Read the defects and decide.',
						'Log one issue for each defect that two or more reports describe. A defect that is in no issue is its own issue.',
						'To change an issue, log it again with "supersedes".',
					]),
					['example', { preformatted: `${data.command} <<'EOF'\n${JSON.stringify(data.example)}\nEOF` }],
					...checks,
				],
			}
		},
	},
	'journal issues': {
		positionals: ['changeId'],
		flags: { build: 'value' },
		run: (store, args) => changeIssues(store, value(args, 'changeId')!, value(args, 'build')),
		print: (reply) => {
			const issues = reply.data.issues as Issue[]
			return {
				facts: { issues: issues.length, confirmed: issues.filter((issue) => issue.confirmed).length },
				lines: issues.map((issue) => [
					'issue',
					issue.id,
					issue.severity,
					issue.title,
					`reporters=${issue.reporters}`,
					issue.actors.join(','),
					...Object.entries(issue.statuses).map(([build, status]) => `${build}=${statusText(status)}`),
					issueStatus(issue),
				]),
			}
		},
	},
	'journal verify': {
		positionals: ['changeId'],
		flags: { build: 'value' },
		required: ['build'],
		run: (store, args) => verifyBuild(store, value(args, 'changeId')!, value(args, 'build')!),
		print: (reply) => {
			const items = reply.data.items as Array<Issue & { reason: string }>
			return {
				facts: { build: reply.data.build, items: items.length },
				lines: [
					...items.flatMap((issue) => [
						['verify', issue.id, issue.severity, issue.title, issue.reason],
						['steps', [issue.steps ?? '-'].flat().join(' ')],
						['expected', issue.expected],
						['actual', issue.actual],
						...issue.evidence.map((item) => ['evidence', 'path' in item ? item.path : item.text]),
					]),
					...nextLines([
						'Reproduce each item on the running application.',
						'Log one observation for each item: "confirms" when you see the defect, "refutes" when you do not, and "saw" with what you saw.',
						'Do not explore beyond the list.',
					]),
					[
						'example',
						{
							preformatted: `${reply.data.command} <<'EOF'\n${JSON.stringify(reply.data.example)}\nEOF`,
						},
					],
				],
			}
		},
	},
	'journal export': {
		positionals: ['changeId'],
		flags: { out: 'value', all: 'switch' },
		run: (store, args, { viewer }) => {
			const changeId = value(args, 'changeId')!
			const content = exportChange(store, changeId, viewer())
			const out = value(args, 'out')
			if (out === undefined) return completed(changeId, { format: 'json', content })
			return completed(changeId, { format: 'json', out: writeOutput(store, out, content) })
		},
		print: (reply) => ({ facts: { out: reply.data.out } }),
	},
	'run gate': {
		positionals: ['reference'],
		flags: { tests: 'list', build: 'value', partial: partialModes, 'retest-of': 'value' },
		required: ['build'],
		run: (store, args) =>
			gate(store, {
				reference: value(args, 'reference')!,
				tests: list(args, 'tests'),
				build: value(args, 'build')!,
				partial: value(args, 'partial'),
				retestOf: value(args, 'retest-of') ?? null,
			}).reply,
		print: (reply) => ({
			facts: { sha256: short(reply.data.sha256), tests: reply.data.tests },
			lines: leftOutLines(reply),
		}),
	},
	'run begin': {
		positionals: ['runId', 'reference'],
		flags: {
			tests: 'list',
			build: 'value',
			instance: 'value',
			partial: partialModes,
			'on-new-blocker': newBlockerPolicies,
			timeout: { min: 1, max: 3600 },
			'retest-of': 'value',
		},
		required: ['build'],
		write: true,
		run: (store, args, { actor }) =>
			beginRun(store, actor, {
				runId: value(args, 'runId')!,
				reference: value(args, 'reference')!,
				tests: list(args, 'tests'),
				build: value(args, 'build')!,
				instance: value(args, 'instance'),
				partial: value(args, 'partial'),
				onNewBlocker: value(args, 'on-new-blocker'),
				timeoutSeconds: integer(args, 'timeout'),
				retestOf: value(args, 'retest-of') ?? null,
			}),
		print: (reply) => ({
			facts: {
				instance: reply.data.instanceId,
				tests: reply.data.tests,
				startedAt: reply.data.startedAt,
				browserSession: reply.data.browserSession,
				deadlineSeconds: reply.data.deadlineSeconds,
				deadline: reply.data.deadline,
				evidenceDirectory: reply.data.evidenceDirectory,
			},
			lines: leftOutLines(reply),
		}),
	},
	'run check': {
		positionals: ['runId', 'testId', 'assertionId'],
		flags: { result: assertionResults, observed: 'value', reason: 'value', evidence: 'repeat' },
		required: ['result'],
		write: true,
		run: (store, args, context) =>
			checkAssertion(store, context.actor, {
				runId: value(args, 'runId')!,
				testId: value(args, 'testId')!,
				assertionId: value(args, 'assertionId')!,
				result: value(args, 'result')!,
				observed: value(args, 'observed'),
				reason: value(args, 'reason'),
				evidence: evidence(args, context),
			}),
		print: (reply) => ({
			facts: { [`${reply.data.testId}.${reply.data.assertionId}`]: reply.data.result },
			lines: (reply.data.evidenceIds as string[]).map((id) => [id, 'evidence']),
		}),
	},
	'run close': {
		positionals: ['runId', 'testId'],
		flags: { outcome: closeOutcomes, cause: closeCauses, reason: 'value', evidence: 'repeat' },
		write: true,
		run: (store, args, context) =>
			closeTest(store, context.actor, {
				runId: value(args, 'runId')!,
				testId: value(args, 'testId')!,
				outcome: value(args, 'outcome'),
				cause: value(args, 'cause'),
				reason: value(args, 'reason'),
				evidence: evidence(args, context),
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
		flags: {
			completion: completions,
			cause: interruptCauses,
			reason: 'value',
			cleanup: cleanupStatuses,
			'cleanup-reason': 'value',
		},
		required: ['completion', 'cleanup', 'cleanup-reason'],
		write: true,
		run: (store, args, { actor }) =>
			finishRun(store, actor, {
				runId: value(args, 'runId')!,
				completion: value(args, 'completion')!,
				cause: value(args, 'cause'),
				reason: value(args, 'reason'),
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
				deadline: string
				evidenceDirectory: string
				closed: string[]
				tests: Array<{ testId: string; warning: string; assertions: Plan['tests'][number]['assertions'] }>
			}
			return {
				facts: {
					attempt: data.attempt,
					browserSession: data.browserSession,
					deadline: data.deadline,
					evidenceDirectory: data.evidenceDirectory,
				},
				lines: [
					...data.closed.map((id) => [id, 'error']),
					...data.tests.flatMap((test) => [
						[test.testId, 'unclosed', test.warning],
						...test.assertions.map((assertion) => [
							`${test.testId}.${assertion.id}`,
							assertion.checkKind,
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
				requireWellFormed(
					detail.tests.some((test) => test.testId === id),
					`Test ${id} is not selected in run ${detail.runId}`,
					`Use one of: ${detail.tests.map((test) => test.testId).join(', ')}.`
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
					instance: detail.instance.instanceId,
					completion: detail.result?.completion,
					cause: detail.result?.completionCause ?? undefined,
					coverage: detail.result?.coverage.status,
					acceptance: detail.result?.acceptance,
				},
				lines: [
					[
						'time',
						`deadline=${detail.clock.deadline}`,
						`elapsed=${detail.clock.elapsedSeconds}s`,
						`remaining=${detail.clock.remainingSeconds}s`,
					],
					...detail.tests.flatMap((test) => [
						[
							test.testId,
							test.outcome ?? 'open',
							test.title,
							...(test.cause ? [`cause=${test.cause}`] : []),
							...(test.reason ? [test.reason] : []),
						],
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
					...detail.retest.map((item) => [
						`${item.runId}/${item.findingId}`,
						'retest',
						item.verdict,
						item.testIds,
						item.title,
					]),
					...detail.newGaps.map((gap) => [gap.id, gap.severity, gap.status, gap.question]),
					...decisionLines(detail.result?.latestDecision),
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
				run.instanceId,
				run.state,
				run.completion,
				run.coverage,
				run.acceptance,
			]),
		}),
	},
	'finding list': {
		positionals: [],
		flags: { plan: 'value', open: 'switch' },
		run: (store, args) =>
			completed('findings', {
				findings: findingList(store, { planId: value(args, 'plan'), open: Boolean(args.open) }),
			}),
		print: (reply) => ({
			facts: { count: (reply.data.findings as unknown[]).length },
			lines: (reply.data.findings as ReturnType<typeof findingList>).map((finding) => [
				`${finding.runId}/${finding.findingId}`,
				`${finding.planId}@${finding.revision}`,
				finding.build,
				finding.instanceId,
				finding.type,
				finding.severity,
				finding.testIds,
				Object.entries(finding.metadata)
					.map(([key, field]) => `${key}=${field}`)
					.join('; ') || null,
				finding.title,
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
	'export plan': exportCommand('reference', formats, exportPlan),
	'export run': exportCommand('runId', runFormats, exportRun),
	log: {
		positionals: [],
		flags: { subject: 'value', limit: { min: 1, max: 1000 }, after: { min: 0, max: Number.MAX_SAFE_INTEGER } },
		check: (args) => {
			const subject = value(args, 'subject')
			requireWellFormed(
				subject === undefined || subject === 'inbox' || /^(target|plan|run|change):./.test(subject),
				`Invalid --subject: ${subject}. Use target:<targetId>, plan:<planId>, run:<runId>, change:<changeId>, or inbox.`
			)
		},
		run: (store, args) => {
			return completed('log', {
				operations: operationLog(store, {
					subject: value(args, 'subject'),
					limit: integer(args, 'limit'),
					after: integer(args, 'after'),
				}),
			})
		},
		print: (reply) => ({
			lines: (reply.data.operations as ReturnType<typeof operationLog>).map((operation) => [
				operation.id,
				operation.at,
				operation.actor,
				operation.command,
				operation.status,
				operation.subjects,
				...rationaleOf(operation.arguments),
				operation.rowid,
			]),
		}),
	},
	query: {
		positionals: ['sql'],
		readOnly: true,
		run: (store, args) => {
			const statement = queryStatement(store, value(args, 'sql')!)
			const columns = statement.columns().map((column) => column.name)
			const rows = readOnly(() => statement.all()).map((row) =>
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

const readOnlyReason = 'query is read-only. Use the Checkmate commands to change the record.'
const readPragmas = [
	'table_info',
	'table_xinfo',
	'table_list',
	'index_list',
	'index_info',
	'index_xinfo',
	'foreign_key_list',
	'foreign_key_check',
	'integrity_check',
	'quick_check',
]

function readOnly<T>(read: () => T): T {
	try {
		return read()
	} catch (error) {
		if (isBusy(error) || !(error instanceof Error) || !('errcode' in error)) throw error
		if ([8, 23].includes(Number(error.errcode))) throw new Refusal('prohibited', readOnlyReason)
		throw new Refusal('malformed', `SQL error: ${error.message}`, 'Send one valid SQLite SELECT statement.')
	}
}

function queryStatement(store: Store, sql: string) {
	store.db.setAuthorizer((action, name, argument) =>
		action === constants.SQLITE_PRAGMA && argument !== null && !readPragmas.includes(name!)
			? constants.SQLITE_DENY
			: constants.SQLITE_OK
	)
	const statement = readOnly(() => store.db.prepare(sql))
	requireCondition(statement.columns().length > 0, readOnlyReason)
	const rest = sql.slice(statement.sourceSQL.length)
	requireWellFormed(
		/^(\s|--[^\n]*|\/\*[\s\S]*?\*\/)*$/.test(rest),
		'query runs one SQL statement. Send each statement in its own query.'
	)
	return statement
}

function exportCommand(
	positional: string,
	choices: readonly string[],
	render: (store: Store, subject: string, format: string) => string
): Command {
	return {
		positionals: [positional],
		flags: { format: choices, out: 'value' },
		required: ['format'],
		run: (store, args) => {
			const subject = value(args, positional)!
			const format = value(args, 'format')!
			const content = render(store, subject, format)
			const out = value(args, 'out')
			if (out === undefined) return completed(subject, { format, content })
			return completed(subject, { format, out: writeOutput(store, out, content) })
		},
		print: (reply) => ({ facts: { out: reply.data.out } }),
	}
}

function decisionCommand(decision: 'accepted' | 'rejected'): Command {
	return {
		positionals: ['changeId'],
		flags: { build: 'value', rationale: 'value' },
		required: ['build', 'rationale'],
		write: true,
		run: (store, args, { actor }) =>
			decideBuild(store, actor, {
				changeId: value(args, 'changeId')!,
				build: value(args, 'build')!,
				decision,
				rationale: value(args, 'rationale')!,
			}),
		print: (reply) => ({
			facts: { decision: reply.data.decision, build: reply.data.build },
			lines: gapLines(reply.data.gaps as Gap[], String(reply.data.build)),
		}),
	}
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
	const warnings = dependencyWarnings(detail.plan)
	const warned = warnings.length ? { warnings } : {}
	if (!tests && !fields) {
		const plan = {
			...detail.plan,
			gaps: detail.plan.gaps.filter((gap) => gaps === 'all' || gap.status === 'open'),
		}
		return completed(subject, { ...detail, plan, ...warned })
	}
	for (const test of tests ?? [])
		requireWellFormed(
			detail.plan.tests.some((item) => item.id === test),
			`Unknown test in ${subject}: ${test}`,
			`Use one of: ${detail.plan.tests.map((item) => item.id).join(', ')}.`
		)
	for (const field of fields ?? [])
		requireWellFormed(testFields.includes(field), `Unknown field: ${field}. Use: ${testFields.join(', ')}`)
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
		...warned,
	})
}

function decisionLines(decision: Approval | null | undefined) {
	return decision ? [['decision', decision.verdict, decision.actor, decision.at, decision.rationale]] : []
}

function rationaleOf(input: unknown) {
	const rationale = (input as { rationale?: unknown }).rationale
	return typeof rationale === 'string' && rationale ? [rationale] : []
}

function testLines(test: Plan['tests'][number]) {
	return [
		[test.id, test.readiness, test.capability, test.title],
		[test.id, 'action', test.action],
		...test.preconditions.map((precondition) => [test.id, 'precondition', precondition]),
		...test.assertions.map((assertion) => [`${test.id}.${assertion.id}`, assertion.checkKind, assertion.check]),
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
							assertion.checkKind,
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
			...plan.decisions.map((decision) => [
				decision.id,
				decision.gapId,
				decision.kind,
				decision.value,
				decision.rationale,
			]),
			...detail.pendingDecisions.map((decision) => [
				decision.id,
				decision.gapId,
				`pending ${decision.kind}`,
				decision.value,
				decision.rationale,
			]),
			...decisionLines(detail.approval.latest),
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
	if (typeof field === 'object' && 'preformatted' in field) return String(field.preformatted)
	if (typeof field === 'object') return JSON.stringify(field)
	return String(field).replace(/\\/g, '\\\\').replace(/\t/g, '\\t').replace(/\r/g, '\\r').replace(/\n/g, '\\n')
}

function compact(reply: Reply, printed: Printed) {
	const facts = Object.entries(printed.facts ?? {})
		.filter(([, field]) => field !== undefined)
		.map(([key, field]) => `${key}=${cell(field)}`)
	const warnings = (reply.data.warnings ?? []) as string[]
	return [
		[reply.status, reply.subject, ...(reply.refusal ? [`refusal=${reply.refusal}`] : []), ...facts].join(' '),
		...(printed.lines ?? []).map((line) => line.map(cell).join('\t')),
		...warnings.map((warning) => `warning\t${cell(warning)}`),
		...reply.reasons.map((reason) => `reason: ${cell(reason)}`),
		...(reply.hint ? [`hint: ${cell(reply.hint)}`] : []),
	].join('\n')
}

function format(reply: Reply, json: boolean, print?: Command['print']) {
	if (json)
		return JSON.stringify({
			status: reply.status,
			subject: reply.subject,
			reasons: reply.reasons,
			...(reply.refusal ? { refusal: reply.refusal } : {}),
			...(reply.hint ? { hint: reply.hint } : {}),
			...reply.data,
		})
	return compact(reply, print ? print(reply) : {})
}

export function formatReply(name: string, reply: Reply, json: boolean) {
	return format(reply, json, commands[name]?.print)
}

const globalFlags: Record<string, FlagKind> = { workspace: 'value', json: 'switch' }

function commandName(argv: string[]) {
	const words: string[] = []
	for (const word of argv.slice(0, 3)) {
		if (word.startsWith('--')) break
		words.push(word)
	}
	for (let count = words.length; count > 0; count--)
		if (commands[words.slice(0, count).join(' ')]) return words.slice(0, count).join(' ')
	throw unknownCommand(words)
}

function unknownCommand(words: string[]) {
	const groups = words.map((_, i) => {
		const prefix = words.slice(0, words.length - i).join(' ')
		return Object.keys(commands).filter((name) => name.startsWith(`${prefix} `))
	})
	const names = groups.find((group) => group.length) ?? [
		...new Set([...Object.keys(commands).map((name) => name.split(' ')[0]), 'ui']),
	]
	return new Refusal(
		'malformed',
		`Unknown command: ${words.join(' ') || '(none)'}`,
		`Use one of: ${names.join(', ')}. Run checkmate --help for the usage of each command.`
	)
}

function parse(name: string, tokens: string[]) {
	const command = commands[name]
	const flags: Record<string, FlagKind> = {
		...globalFlags,
		...command.flags,
		...(command.write ? { actor: 'value' as const } : {}),
	}
	const wrong = (message: string) => new Refusal('malformed', message, usage(name))
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
		if (!kind) throw wrong(`Unknown option ${token} for ${name}`)
		if (kind === 'switch') {
			args[flag] = true
			continue
		}
		const next = tokens[++i]
		if (next === undefined || next.startsWith('--')) throw wrong(`Missing value for ${token}`)
		optionValue(token, kind, next)
		if (kind !== 'list' && kind !== 'repeat') {
			if (flag in args) throw wrong(`Option ${token} is given twice`)
			args[flag] = next
		} else if (kind === 'list') {
			if (flag in args) throw wrong(`Option ${token} is given twice`)
			args[flag] = next
				.split(',')
				.map((item) => item.trim())
				.filter(Boolean)
		} else args[flag] = [...((args[flag] as string[] | undefined) ?? []), next]
	}
	const needed = command.positionals.filter((positional) => !positional.endsWith('?')).length
	if (positionals.length < needed || positionals.length > command.positionals.length)
		throw wrong(
			`${name} needs ${needed === command.positionals.length ? needed : `${needed} to ${command.positionals.length}`} argument(s), not ${positionals.length}: ${command.positionals.map(positionalUsage).join(' ') || 'none'}`
		)
	for (const flag of command.required ?? []) if (!(flag in args)) throw wrong(`Missing --${flag}`)
	positionals.forEach((positional, i) => (args[command.positionals[i].replace(/\?$/, '')] = positional))
	command.check?.(args)
	return args
}

function positionalUsage(positional: string) {
	return positional.endsWith('?') ? `[<${positional.slice(0, -1)}>]` : `<${positional}>`
}

function placeholder(kind: FlagKind) {
	if (Array.isArray(kind)) return kind.join('|')
	if (typeof kind === 'object') return 'n'
	return kind === 'list' ? 'a,b' : 'value'
}

function usage(name: string) {
	const command = commands[name]
	const flags = Object.entries(command.flags ?? {}).map(([flag, kind]) => {
		const text = kind === 'switch' ? `--${flag}` : `--${flag} <${placeholder(kind)}>`
		return command.required?.includes(flag) ? text : `[${text}]`
	})
	return [
		'Usage: checkmate',
		name,
		...command.positionals.map(positionalUsage),
		...flags,
		...(command.write ? ['[--actor <name>]'] : []),
		...(command.stdin ? ["<<'EOF' <json> EOF"] : []),
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

function commandHelp(argv: string[]): Reply {
	const words = argv.slice(
		0,
		argv.findIndex((word) => word.startsWith('--'))
	)
	for (let count = words.length; count > 0; count--) {
		const prefix = words.slice(0, count).join(' ')
		if (prefix === 'ui') return completed('ui', { usage: [uiUsage.replace('Usage: ', '')] })
		const names = Object.keys(commands).filter((name) => name === prefix || name.startsWith(`${prefix} `))
		if (names.length) return completed(prefix, { usage: names.map((name) => usage(name).replace('Usage: ', '')) })
	}
	return { ...refused('invalid_request', 'checkmate', unknownCommand(words)), data: { usage: [] } }
}

function version() {
	return JSON.parse(readFileSync(new URL('../.claude-plugin/plugin.json', import.meta.url), 'utf8')).version as string
}

function readJson(text: string) {
	requireWellFormed(
		text.trim().length > 0,
		'Missing JSON payload on standard input',
		"Send the JSON payload on standard input, in a quoted heredoc: checkmate <command> <arguments> <<'EOF', the JSON, then EOF"
	)
	try {
		return JSON.parse(text) as unknown
	} catch (error) {
		throw new Refusal(
			'malformed',
			`Standard input is not valid JSON: ${(error as Error).message}`,
			'Send one JSON object on standard input. Use double quotes for keys and strings, and no trailing commas.'
		)
	}
}

export function run(argv: string[], io: Io): Outcome {
	if (argv[0] === '--version') return { code: 0, output: version() }
	if (!argv.length || argv[0] === '--help') return { code: 0, output: help() }
	const json = argv.includes('--json')
	if (argv.includes('--help')) {
		const reply = commandHelp(argv)
		const code = reply.status === 'completed' ? 0 : 1
		return {
			code,
			output: format(reply, json, (help) => ({ lines: (help.data.usage as string[]).map((line) => [line]) })),
		}
	}
	let name = 'checkmate'
	let args: Args
	try {
		name = commandName(argv)
		args = parse(name, argv.slice(name.split(' ').length))
	} catch (error) {
		return { code: 1, output: format(refused('invalid_request', name, error), json) }
	}
	const command = commands[name]
	const first = command.positionals[0]?.replace(/\?$/, '')
	const subject = first && name !== 'query' ? String(args[first] ?? name) : name
	const workspace = workspaceOf(io.cwd, value(args, 'workspace'))
	let store: Store | undefined
	try {
		store = command.readOnly ? openReadOnlyStore(workspace) : openStore(workspace)
		const actor = command.write ? (value(args, 'actor') ?? defaultActor(workspace, io.env)) : undefined
		const reply = command.run(store, args, {
			actor,
			stdin: () => readJson(io.stdin()),
			text: io.stdin,
			cwd: resolve(io.cwd),
			viewer: () => (args.all === true ? undefined : defaultActor(workspace, io.env)),
		})
		const code = reply.status === 'completed' || reply.status === 'needs_decision' ? 0 : 1
		if (!json && typeof reply.data.content === 'string')
			return { code, output: reply.data.content.replace(/\n$/, '') }
		return { code, output: format(reply, json, command.print) }
	} catch (error) {
		const reply: Reply = isBusy(error)
			? { status: 'operational_error', subject, reasons: [(error as Error).message, busyReason], data: {} }
			: refused('rejected', subject, error)
		return { code: 1, output: format(reply, json) }
	} finally {
		if (store) closeStore(store)
	}
}

function workspaceOf(cwd: string, given: string | undefined) {
	if (given !== undefined) return resolve(cwd, given)
	for (let directory = resolve(cwd); ; directory = dirname(directory)) {
		if (existsSync(databasePath(directory))) return directory
		if (dirname(directory) === directory) return resolve(cwd)
	}
}

function uiOptions(tokens: string[], cwd: string) {
	const values: Record<string, string> = {}
	for (let i = 0; i < tokens.length; i++) {
		const token = tokens[i]
		if (token === '--json') continue
		const flag = token.startsWith('--') ? token.slice(2) : ''
		if (!['workspace', 'port'].includes(flag))
			throw new Refusal('malformed', `Unknown argument ${token} for ui`, uiUsage)
		const next = tokens[++i]
		if (next === undefined || next.startsWith('--'))
			throw new Refusal('malformed', `Missing value for ${token}`, uiUsage)
		if (flag in values) throw new Refusal('malformed', `Option ${token} is given twice`, uiUsage)
		values[flag] = next
	}
	const port = values.port === undefined ? undefined : Number(values.port)
	requireWellFormed(
		port === undefined || (/^[0-9]+$/.test(values.port) && port <= 65535),
		`Invalid --port: ${values.port}. Use 0 to 65535.`
	)
	return { workspace: workspaceOf(cwd, values.workspace), port }
}

export async function serveUi(tokens: string[]) {
	const json = tokens.includes('--json')
	let options: ReturnType<typeof uiOptions>
	try {
		options = uiOptions(tokens, process.cwd())
	} catch (error) {
		process.stdout.write(format(refused('invalid_request', 'ui', error), json) + '\n')
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
	if (argv[0] === 'ui' && !argv.includes('--help')) return serveUi(argv.slice(1))
	const outcome = run(argv, {
		cwd: process.cwd(),
		env: process.env,
		stdin: () => readFileSync(0, 'utf8'),
	})
	process.stdout.write(outcome.output + '\n')
	process.exitCode = outcome.code
}
