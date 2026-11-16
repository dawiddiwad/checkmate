import type { Reply, Store } from './store.ts'
import type { InstanceRecord, EntryPoint, RequestedTool, TargetRequest } from './targets.ts'
import type { Profile } from './types.ts'
import type { Field, GuideRole } from './guide.ts'
import type { BuildStatus, Gap, Issue } from './journal.ts'
import {
	busyReason,
	closeStore,
	completed,
	createStore,
	databasePath,
	isBusy,
	openReadOnlyStore,
	openStore,
} from './store.ts'
import { Refusal, refused, requireCondition, requireWellFormed } from './contracts.ts'
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
import { guideJournal, guideRoles } from './guide.ts'
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
import { operationLog } from './views.ts'
import { defaultRecorderTimeout, recordSession } from './recorder.ts'
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
	env: Io['env']
	script: string | undefined
}
type Printed = { facts?: Record<string, unknown>; lines?: unknown[][] }
type Command = {
	positionals: string[]
	flags?: Record<string, FlagKind>
	required?: string[]
	write?: boolean
	creates?: boolean
	stdin?: boolean
	readOnly?: boolean
	check?: (args: Args) => void
	run: (store: Store, args: Args, context: Context) => Reply
	print?: (reply: Reply) => Printed
}
export type Io = { cwd: string; env: Record<string, string | undefined>; stdin: () => string; script?: string }
export type Outcome = { code: number; output: string }

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

function short(sha256: unknown) {
	return typeof sha256 === 'string' ? sha256.slice(0, 8) : sha256
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
				? 'Run checkmate gaps again after you log entries.'
				: `Run checkmate gaps ${changeId} --build ${open.build} --all to see all of them.`,
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
		creates: true,
		run: (store) => completed('.checkmate/checkmate.db', { path: store.path }),
	},
	'target open': {
		positionals: ['targetId'],
		flags: { 'entry-point': 'repeat', capabilities: 'list', operations: 'list', tool: 'repeat' },
		required: ['entry-point', 'capabilities', 'operations'],
		write: true,
		creates: true,
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
		print: (reply) => ({ facts: { recorded: reply.data.recorded } }),
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
	open: {
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
	log: {
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
	gaps: {
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
	guide: {
		positionals: ['changeId?'],
		flags: { role: guideRoles, build: 'value' },
		check: (args) =>
			requireWellFormed(
				value(args, 'build') === undefined || value(args, 'role') === 'recorder',
				'--build is only for --role recorder.'
			),
		run: (store, args, { viewer }) =>
			guideJournal(
				store,
				value(args, 'changeId'),
				value(args, 'role') as GuideRole | undefined,
				viewer(),
				value(args, 'build')
			),
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
	record: {
		positionals: ['changeId'],
		flags: { build: 'value', session: 'value', timeout: { min: 1, max: 86400 } },
		write: true,
		run: (store, args, { actor, env, script }) =>
			recordSession(
				store,
				actor,
				{
					changeId: value(args, 'changeId')!,
					build: value(args, 'build'),
					session: value(args, 'session'),
					timeoutSeconds: integer(args, 'timeout') ?? defaultRecorderTimeout,
				},
				{ env, script }
			),
		print: (reply) => ({
			facts: {
				session: reply.data.session,
				recorder: reply.data.recorder,
				entries: reply.data.entries,
				costUsd: reply.data.costUsd,
				durationMs: reply.data.durationMs,
			},
			lines: Object.entries(reply.data.added as Record<string, number>).map(([kind, count]) => [
				'added',
				kind,
				count,
			]),
		}),
	},
	show: {
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
	answer: {
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
	accept: decisionCommand('accepted'),
	reject: decisionCommand('rejected'),
	merge: {
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
						? [['not_shown', hidden, `Run checkmate export ${reply.subject} --all to read all defects.`]]
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
	issues: {
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
	verify: {
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
	export: {
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
	operations: {
		positionals: [],
		flags: { subject: 'value', limit: { min: 1, max: 1000 }, after: { min: 0, max: Number.MAX_SAFE_INTEGER } },
		check: (args) => {
			const subject = value(args, 'subject')
			requireWellFormed(
				subject === undefined || /^(target|change):./.test(subject),
				`Invalid --subject: ${subject}. Use target:<targetId> or change:<changeId>.`
			)
		},
		run: (store, args) => {
			return completed('operations', {
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

function rationaleOf(input: unknown) {
	const rationale = (input as { rationale?: unknown }).rationale
	return typeof rationale === 'string' && rationale ? [rationale] : []
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
	return [
		[reply.status, reply.subject, ...(reply.refusal ? [`refusal=${reply.refusal}`] : []), ...facts].join(' '),
		...(printed.lines ?? []).map((line) => line.map(cell).join('\t')),
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
	const found = workspaceOf(io.cwd, value(args, 'workspace'), io.env)
	const { workspace } = found
	let store: Store | undefined
	try {
		if (!command.creates && !existsSync(databasePath(workspace))) throw missingStore(found)
		store = command.readOnly
			? openReadOnlyStore(workspace)
			: command.creates
				? createStore(workspace)
				: openStore(workspace)
		const actor = command.write ? (value(args, 'actor') ?? defaultActor(workspace, io.env)) : undefined
		const reply = command.run(store, args, {
			actor,
			stdin: () => readJson(io.stdin()),
			text: io.stdin,
			cwd: resolve(io.cwd),
			viewer: () => (args.all === true ? undefined : defaultActor(workspace, io.env)),
			env: io.env,
			script: io.script,
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

type Workspace = { workspace: string; from: '--workspace' | 'CHECKMATE_WORKSPACE' | 'search' }

function workspaceOf(cwd: string, given: string | undefined, env: Io['env']): Workspace {
	if (given !== undefined) return { workspace: resolve(cwd, given), from: '--workspace' }
	const named = env.CHECKMATE_WORKSPACE
	if (named) return { workspace: resolve(cwd, named), from: 'CHECKMATE_WORKSPACE' }
	for (let directory = resolve(cwd); ; directory = dirname(directory)) {
		if (existsSync(databasePath(directory))) return { workspace: directory, from: 'search' }
		if (dirname(directory) === directory) return { workspace: resolve(cwd), from: 'search' }
	}
}

function missingStore({ workspace, from }: Workspace) {
	const searched =
		from === 'search' ? `${workspace} and its parent directories` : `${workspace}, the directory that ${from} names`
	return new Refusal(
		'prohibited',
		`No Checkmate store in ${searched}. Nothing changed.`,
		'Run the command in the project directory, or set CHECKMATE_WORKSPACE to the project directory, or pass --workspace <path>.'
	)
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
	return { found: workspaceOf(cwd, values.workspace, process.env), port }
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
	const { workspace } = options.found
	if (!existsSync(databasePath(workspace))) {
		process.stdout.write(format(refused('rejected', 'ui', missingStore(options.found)), json) + '\n')
		process.exitCode = 1
		return
	}
	const ui = await startUi({ workspace, port: options.port })
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
		script: process.argv[1],
	})
	process.stdout.write(outcome.output + '\n')
	process.exitCode = outcome.code
}
