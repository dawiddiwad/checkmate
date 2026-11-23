import type { Reply, Store } from './store.ts'
import type { Plan, Profile } from './types.ts'
import type { EntryPoint, InstanceRecord, RequestedTool, TargetRequest } from './targets.ts'
import type { Approval, PlanTool } from './plans.ts'
import type { EvidenceInput } from './runs.ts'
import { busyReason, closeStore, completed, isBusy, openReadOnlyStore, openStore } from './store.ts'
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
	setupTarget,
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
	planRequest,
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
	beginPermanentRun,
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
	runGate,
} from './views.ts'
import { exportExploration, exportPlan, exportRun, explorationFormats, formats, runFormats } from './render.ts'
import { startUi } from './ui/server.ts'
import { contactUi, withUiStartupLock } from './ui/lifecycle.ts'
import { defaultActor, requestOfEnv } from './actor.ts'
import { explorationModes, openExploration } from './explorations.ts'
import type { Claim } from './journal.ts'
import { decideClaim, handOffClaims, logEntries, planClaims, readEntries } from './journal.ts'
import { defaultRecorderTimeout, recordSession } from './recorder.ts'
import { checkClaudeArgs, liveUi, pluginRoot } from './sessions.ts'
import { selectedHarness } from './pi.ts'
import { workspaceEnv } from './settings.ts'
import { decidePermission, explorationPermissions, permissionDecisions } from './permissions.ts'
import { inputLine } from './ui/hooks.ts'
import {
	driveExploration,
	endInBackground,
	driveFollow,
	explorationReport,
	explorationStatus,
	finishExploration,
	startExploration,
	startFollow,
	stopExploration,
	waitExploration,
} from './explorers.ts'
import { doneSteps, nextActions, pauseRun, stepDone, stepsStarted } from './agents.ts'
import { levelNames, testLevels } from './levels.ts'
import { runTest, testModes } from './modes.ts'
import { harvestExploration } from './harvest.ts'
import { planPromotions, promotePlan } from './promotion.ts'
import { specFinding, specHandoff, specReview, specStatus } from './spec.ts'
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { constants } from 'node:sqlite'
import { piCopyWarnings, versionLines } from './build.ts'
import { storeExplorationFindings } from './findingsRun.ts'
import { settleEnded } from './cleanups.ts'
import { owedCleanups, settleCleanups } from './resets.ts'

type FlagKind = 'value' | 'list' | 'repeat' | 'switch' | readonly string[] | { min: number; max: number }
type Args = Record<string, string | string[] | boolean>
type Context = {
	actor: string | undefined
	stdin: () => unknown
	text: () => string
	cwd: string
	env: Record<string, string | undefined>
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

function explorationLines(reply: Reply): Printed {
	const status = reply.data as Partial<ReturnType<typeof explorationStatus>> & { outcome?: string; next?: string[] }
	if (!status.explorers) return {}
	return {
		facts: {
			state: status.state,
			outcome: status.outcome,
			plan: status.planId,
			build: status.build,
			level: status.level ?? undefined,
			explorers: status.explorerCount ?? undefined,
			model: status.model ?? undefined,
			modelFrom: status.modelFrom ?? undefined,
			costUsd: status.costUsd ?? undefined,
			costPartial: status.costPartial ? true : undefined,
			verifier: status.verifier ?? undefined,
			since: status.since ?? undefined,
			until: status.until ?? undefined,
			studySeconds: status.studySeconds ?? undefined,
			testSeconds: status.testSeconds ?? undefined,
			workFolder: status.workFolder ?? undefined,
			follow: status.follow ?? undefined,
			followReason: status.followReason ?? undefined,
			path: status.path === 'session' ? 'session' : undefined,
			target: status.targetId,
			instance: status.instanceId,
		},
		lines: [
			...(status.next ?? []).map((command) => ['next', command]),
			...status.explorers.map((item) => [
				item.explorer,
				status.path === 'session' ? `agent=${item.session ?? '-'}` : (item.session ?? '-'),
				`ended=${item.ended ?? '-'}`,
				`recorded=${item.recorded ?? '-'}`,
				`saved=${item.saved}`,
				...(item.observedModels?.length ? [`model=${item.observedModels.join(',')}`] : []),
				...(item.costUsd === null ? [] : [`costUsd=${item.costUsd}`]),
				...(item.costPartial ? ['costPartial=true'] : []),
				...(typeof item.reason === 'string' && item.reason ? [`reason=${item.reason}`] : []),
			]),
			...(status.paused ? [['paused', status.paused, 'waits_on=oracle']] : []),
			...(status.phases ?? [])
				.filter(
					(item) =>
						item.step === 'done' && (item.detail.findingsRun !== undefined || item.detail.findingsReason)
				)
				.map((item) => [
					'findings',
					item.detail.findingsRun ? 'stored' : 'not_stored',
					String(item.detail.findingsRun ?? item.detail.findingsReason),
				]),
			...status.explorers.flatMap((item) => item.stderr.map((line) => [item.explorer, 'stderr', line])),
			...(status.phases ?? []).map((item) => [
				item.step,
				item.status,
				...(item.detail.answers ? [`answers=${(item.detail.answers as string[]).length}`] : []),
				...(item.detail.reason ? [item.detail.reason] : []),
				...((item.detail.skipped ?? []) as string[]),
				...(status.phases ?? []).flatMap((item) =>
					((item.detail.stderr ?? []) as string[]).map((line) => [item.step, 'stderr', line])
				),
			]),
		],
	}
}

function short(sha256: unknown) {
	return typeof sha256 === 'string' ? sha256.slice(0, 8) : sha256
}

const commands: Record<string, Command> = {
	init: {
		positionals: [],
		run: (store) => completed('.checkmate/checkmate.db', { path: store.path }),
	},
	inbox: {
		positionals: [],
		readOnly: true,
		run: (store) => completed('inbox', inbox(store)),
		print: (reply) => {
			const waiting = reply.data as ReturnType<typeof inbox>
			return {
				facts: {
					gaps: waiting.gaps.length,
					plans: waiting.plans.length,
					results: waiting.results.length,
					claims: waiting.claims.length || undefined,
					requests: waiting.requests.length,
				},
				lines: [
					...waiting.gaps.map((gap) =>
						gap.explorationId
							? [`${gap.planId}/${gap.gapId}`, 'question', gap.severity, gap.explorationId, gap.question]
							: gap.runId
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
					...waiting.claims.map((claim) => [
						`${claim.planId}/${claim.claimId}`,
						'claim',
						claim.state,
						claim.severity,
						claim.title,
						...(claim.reason ? [claim.reason] : []),
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
		flags: { 'fail-on-blocked': 'switch' },
		readOnly: true,
		run: (store, args, { env }) => {
			const planId = value(args, 'planId')!
			return completed(planId, planStatus(store, planId, selectedHarness(workspaceEnv(store, env))))
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
					...(status.data.policy ? [[`data policy: ${status.data.policy}`]] : []),
					...status.why.map((line) => ['why', line]),
					...(status.rules ? [['rules', status.rules]] : []),
					...status.next.map((line) => ['next', line]),
					...legacyLine(status.legacyChecks, reply.subject),
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
					...status.explorations.map((item) => [item.explorationId, 'exploration', item.build, item.state]),
					...status.questions.map((question) => [
						question.id,
						'question',
						question.explorationId,
						question.question,
					]),
					...status.claims.map((claim) => [
						claim.claimId,
						'claim',
						claim.state,
						claim.severity,
						claim.title,
						...(claim.reason ? [claim.reason] : []),
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
		readOnly: true,
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
		readOnly: true,
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
		readOnly: true,
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
		readOnly: true,
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
		readOnly: true,
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
				data: { kind: string; policy: string | null }
			}
			return {
				facts: { target: data.target, data: data.data.kind },
				lines: [
					...(data.data.policy ? [['data policy', data.data.policy]] : []),
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
	'plan promote': {
		positionals: ['reference'],
		flags: { run: 'value', build: 'value', rationale: 'value' },
		required: ['run', 'build', 'rationale'],
		write: true,
		run: (store, args, { actor }) =>
			promotePlan(store, actor, {
				reference: value(args, 'reference')!,
				runId: value(args, 'run')!,
				build: value(args, 'build')!,
				rationale: value(args, 'rationale')!,
			}),
		print: (reply) => ({
			facts: {
				build: reply.data.build,
				run: reply.data.runId,
				tests: reply.data.tests,
				recorded: reply.data.recorded,
			},
		}),
	},
	'plan promotions': {
		positionals: ['planId'],
		readOnly: true,
		run: (store, args) =>
			completed(value(args, 'planId')!, { promotions: planPromotions(store, value(args, 'planId')!) }),
		print: (reply) => ({
			lines: (reply.data.promotions as ReturnType<typeof planPromotions>).map((item) => [
				`${item.planId}@${item.revision}`,
				`source=${item.sourceRevision}`,
				`build=${item.build}`,
				`run=${item.runId}`,
				`sha256=${short(item.resultSha256)}`,
				`accepted=${item.accepted}`,
				`tests=${item.tests.join(',')}`,
				`actor=${item.actor}`,
				item.at,
				item.rationale,
			]),
		}),
	},
	'plan show': {
		positionals: ['reference'],
		flags: { tests: 'list', fields: 'list', gaps: ['open', 'all'] },
		readOnly: true,
		run: (store, args) => showPlan(store, args),
		print: printPlan,
	},
	'plan list': {
		positionals: [],
		flags: { 'needs-decision': 'switch', 'awaiting-approval': 'switch', blocked: 'switch', 'waits-on': roles },
		readOnly: true,
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
		readOnly: true,
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
					answer: reply.data.answerId,
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
		readOnly: true,
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
		flags: { patch: 'switch', 'expect-sha': 'value', rationale: 'value' },
		write: true,
		stdin: true,
		run: (store, args, { actor, stdin }) => {
			const reference = value(args, 'reference')!
			const expectSha256 = value(args, 'expect-sha')
			const rationale = value(args, 'rationale')
			return args.patch
				? patchPlan(store, actor, { reference, patch: stdin(), expectSha256, rationale })
				: editPlan(store, actor, { reference, candidate: stdin(), expectSha256, rationale })
		},
		print: (reply) => ({
			facts: { sha256: short(reply.data.sha256), edit: reply.data.edit, removed: reply.data.removed },
		}),
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
	'run gate': {
		positionals: ['reference'],
		flags: { tests: 'list', build: 'value', partial: partialModes, 'retest-of': 'value' },
		required: ['build'],
		readOnly: true,
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
	'run permanent': {
		positionals: ['runId', 'planId'],
		flags: { build: 'value', instance: 'value', promotion: 'value', timeout: { min: 1, max: 3600 } },
		required: ['build'],
		write: true,
		run: (store, args, { actor }) =>
			beginPermanentRun(store, actor, {
				runId: value(args, 'runId')!,
				planId: value(args, 'planId')!,
				build: value(args, 'build')!,
				instance: value(args, 'instance'),
				promotion: value(args, 'promotion'),
				timeoutSeconds: integer(args, 'timeout'),
			}),
		print: (reply) => ({
			facts: {
				plan: reply.data.plan,
				build: reply.data.build,
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
		write: true,
		run: (store, args, context) =>
			checkAssertion(store, context.actor, {
				runId: value(args, 'runId')!,
				testId: value(args, 'testId')!,
				assertionId: value(args, 'assertionId')!,
				result: value(args, 'result'),
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
			if (reply.status !== 'completed') return {}
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
		flags: { tests: 'list', gate: 'switch' },
		readOnly: true,
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
			const gate = args.gate ? runGate(store, detail.runId) : undefined
			return completed(detail.runId, { ...detail, tests, ...(gate ? { gate } : {}) })
		},
		print: (reply) => {
			const detail = reply.data as ReturnType<typeof runDetail>
			return {
				facts: {
					state: detail.state,
					gate: (reply.data.gate as { state: string } | undefined)?.state,
					unverified:
						(reply.data.gate as { unverified?: string[] } | undefined)?.unverified?.join(',') || undefined,
					judgedByAgent: (reply.data.gate as { judgedByAgent?: number } | undefined)?.judgedByAgent,
					mode: detail.request.permanent ? 'permanent' : undefined,
					data: detail.data.kind,
					plan: `${detail.planId}@${detail.revision}`,
					build: detail.build,
					instance: detail.instance.instanceId,
					completion: detail.result?.completion,
					cause: detail.result?.completionCause ?? undefined,
					coverage: detail.result?.coverage.status,
					acceptance: detail.result?.acceptance,
				},
				lines: [
					...gateReasonLines(reply.data.gate as GateReason | undefined, detail.planId),
					...(detail.data.policy ? [[`data policy: ${detail.data.policy}`]] : []),
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
		readOnly: true,
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
		readOnly: true,
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
		readOnly: true,
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
	'export exploration': exportCommand('explorationId', explorationFormats, exportExploration),
	'claim list': {
		positionals: ['planId'],
		flags: { all: 'switch' },
		readOnly: true,
		run: (store, args) => {
			const planId = value(args, 'planId')!
			planRequest(store, planId)
			const claims = planClaims(store, planId).filter((claim) => args.all === true || claim.open)
			return completed(planId, { claims })
		},
		print: (reply) => {
			const claims = reply.data.claims as Claim[]
			return {
				facts: { claims: claims.length },
				lines: claims.map((claim) => [
					claim.id,
					claim.state,
					claim.severity,
					`${claim.explorationId}@${claim.build}`,
					claim.title,
					`expected=${claim.expected}`,
					`actual=${claim.actual}`,
					...(claim.latestRetest === 'disputed' ? ['retest=disputed'] : []),
					...(claim.handoff ? [`handed=${claim.handoff.to}`] : []),
				]),
			}
		},
	},
	'claim handoff': {
		positionals: ['planId', 'claimIds...'],
		flags: { to: 'value', undo: 'switch' },
		write: true,
		run: (store, args, { actor }) =>
			handOffClaims(store, actor, {
				planId: value(args, 'planId')!,
				claimIds: args.claimIds as string[],
				to: value(args, 'to'),
				undo: args.undo === true,
			}),
		print: (reply) => ({ facts: { claims: reply.data.claims, to: reply.data.to ?? undefined } }),
	},
	'claim accept': claimCommand('approved'),
	'claim reject': claimCommand('rejected'),
	harvest: {
		positionals: ['explorationId'],
		flags: { observations: 'switch' },
		write: true,
		run: (store, args, { actor }) =>
			harvestExploration(store, actor, {
				explorationId: value(args, 'explorationId')!,
				observations: args.observations === true,
			}),
		print: (reply) => ({
			facts: {
				tests: reply.data.tests,
				attached: (reply.data.attached as Array<{ test: string; rule: string }>).map(
					(item) => `${item.test}:${item.rule}`
				),
				rules_with_tests: `${reply.data.rulesWithTests}/${reply.data.rules}`,
				skipped: reply.data.skipped || undefined,
				edit: reply.data.edit,
			},
		}),
	},
	setup: {
		positionals: [],
		flags: {
			url: 'value',
			target: 'value',
			instance: 'value',
			operations: 'list',
			environment: 'value',
			reset: 'value',
			data: 'value',
			policy: 'value',
			'policy-file': 'value',
			cleanup: 'value',
			'hook-timeout': { min: 1, max: 3600 },
		},
		required: ['url'],
		write: true,
		run: (store, args, { actor, env }) =>
			setupTarget(store, actor, {
				url: value(args, 'url')!,
				targetId: value(args, 'target'),
				instanceId: value(args, 'instance'),
				operations: list(args, 'operations'),
				environment: value(args, 'environment'),
				reset: value(args, 'reset'),
				data: value(args, 'data'),
				policy: value(args, 'policy'),
				policyFile: value(args, 'policy-file'),
				cleanup: value(args, 'cleanup'),
				hookTimeout: integer(args, 'hook-timeout'),
				env,
			}),
		print: (reply) => ({
			facts: {
				revision: reply.data.revision,
				instance: reply.data.instanceId,
				capabilities: reply.data.capabilities,
				operations: reply.data.allowedOperations,
				profile_ready: reply.data.ready,
				instance_reachable: reply.data.instanceReachable,
			},
			lines: reply.data.next ? [[reply.data.next]] : [],
		}),
	},
	test: {
		positionals: ['planId'],
		flags: {
			build: 'value',
			mode: testModes,
			level: levelNames,
			explorers: { min: 1, max: 10 },
			minutes: { min: 1, max: 240 },
			instance: 'value',
			allow: 'repeat',
			'claude-arg': 'repeat',
			timeout: { min: 60, max: 7200 },
			objective: 'value',
			target: 'value',
			source: 'repeat',
			instructions: 'value',
			since: 'value',
			until: 'value',
			scope: 'list',
			url: 'value',
			reset: 'value',
			data: 'value',
			policy: 'value',
			'policy-file': 'value',
			cleanup: 'value',
			'hook-timeout': { min: 1, max: 3600 },
			repo: 'value',
			session: 'switch',
		},
		write: true,
		run: (store, args, { actor, env }) =>
			runTest(
				store,
				actor,
				{
					planId: value(args, 'planId')!,
					build: value(args, 'build'),
					mode: value(args, 'mode'),
					level: value(args, 'level'),
					explorers: integer(args, 'explorers'),
					minutes: integer(args, 'minutes'),
					instance: value(args, 'instance'),
					allow: list(args, 'allow') ?? [],
					claudeArgs: list(args, 'claude-arg') ?? [],
					timeoutSeconds: integer(args, 'timeout'),
					objective: value(args, 'objective'),
					target: value(args, 'target'),
					sources: list(args, 'source'),
					instructions: value(args, 'instructions'),
					since: value(args, 'since'),
					until: value(args, 'until'),
					scope: list(args, 'scope'),
					url: value(args, 'url'),
					reset: value(args, 'reset'),
					data: value(args, 'data'),
					policy: value(args, 'policy'),
					policyFile: value(args, 'policy-file'),
					cleanup: value(args, 'cleanup'),
					hookTimeout: integer(args, 'hook-timeout'),
					repo: value(args, 'repo'),
					session: args.session === true,
				},
				env
			),
		print: (reply) => {
			const run = reply.data.run as { runId: string; tests: string[] } | null
			return {
				facts: {
					plan: reply.data.planId,
					build: reply.data.build,
					mode: reply.data.mode,
					level: reply.data.level,
					explorers: reply.data.explorers,
					model: reply.data.model ?? undefined,
					verifier: reply.data.verifier,
					path: reply.data.path === 'session' ? 'session' : undefined,
					run: run?.runId,
					tests: run?.tests,
				},
				lines: [
					...(reply.data.storedTests ? [['stored_tests', reply.data.storedTests]] : []),
					...(reply.data.checkSkipped as string[]).map((line) => ['check_skipped', line]),
					...(reply.data.next as string[]).map((line) => ['next', line]),
				],
			}
		},
	},
	'explore open': {
		positionals: ['planId'],
		flags: { build: 'value', instance: 'value', mode: explorationModes },
		required: ['build'],
		write: true,
		run: (store, args, { actor }) =>
			openExploration(store, actor, {
				planId: value(args, 'planId')!,
				build: value(args, 'build')!,
				instance: value(args, 'instance'),
				mode: value(args, 'mode'),
			}),
		print: (reply) => ({
			facts: { plan: reply.data.planId, build: reply.data.build, instance: reply.data.instanceId },
			lines: (reply.data.next as string[]).map((line) => ['next', line]),
		}),
	},
	'explore start': {
		positionals: ['planId'],
		flags: {
			build: 'value',
			level: levelNames,
			explorers: { min: 1, max: 10 },
			minutes: { min: 1, max: 240 },
			instance: 'value',
			mode: explorationModes,
			since: 'value',
			until: 'value',
			repo: 'value',
			allow: 'repeat',
			'claude-arg': 'repeat',
			timeout: { min: 60, max: 7200 },
		},
		required: ['build'],
		write: true,
		run: (store, args, { actor, env }) =>
			startExploration(
				store,
				actor,
				{
					planId: value(args, 'planId')!,
					build: value(args, 'build')!,
					instance: value(args, 'instance'),
					mode: value(args, 'mode'),
					level: value(args, 'level'),
					explorers: integer(args, 'explorers'),
					minutes: integer(args, 'minutes'),
					since: value(args, 'since'),
					until: value(args, 'until'),
					repo: value(args, 'repo'),
					allow: list(args, 'allow') ?? [],
					claudeArgs: list(args, 'claude-arg') ?? [],
					timeoutSeconds: integer(args, 'timeout'),
				},
				env
			),
		print: (reply) => ({
			facts: {
				plan: reply.data.planId,
				build: reply.data.build,
				level: reply.data.level,
				explorers: reply.data.explorers,
				model: reply.data.model,
				verifier: reply.data.verifier,
			},
			lines: (reply.data.next as string[]).map((line) => ['next', line]),
		}),
	},
	'explore finish': {
		positionals: ['explorationId'],
		flags: { level: levelNames, allow: 'repeat', 'claude-arg': 'repeat', timeout: { min: 60, max: 7200 } },
		write: true,
		run: (store, args, { actor, env }) =>
			finishExploration(
				store,
				actor,
				{
					explorationId: value(args, 'explorationId')!,
					level: value(args, 'level'),
					allow: list(args, 'allow') ?? [],
					claudeArgs: list(args, 'claude-arg') ?? [],
					timeoutSeconds: integer(args, 'timeout'),
				},
				env
			),
		print: (reply) => ({
			facts: {
				plan: reply.data.planId,
				build: reply.data.build,
				level: reply.data.level,
				verifier: reply.data.verifier,
			},
			lines: (reply.data.next as string[]).map((line) => ['next', line]),
		}),
	},
	'explore follow': {
		positionals: ['explorationId'],
		flags: { allow: 'repeat', 'claude-arg': 'repeat', timeout: { min: 60, max: 7200 } },
		write: true,
		run: (store, args, { actor, env }) =>
			startFollow(
				store,
				actor,
				{
					explorationId: value(args, 'explorationId')!,
					allow: list(args, 'allow') ?? [],
					claudeArgs: list(args, 'claude-arg') ?? [],
					timeoutSeconds: integer(args, 'timeout'),
				},
				env
			),
		print: (reply) => ({
			facts: {
				plan: reply.data.planId,
				build: reply.data.build,
				answers: reply.data.answers,
				followSeconds: reply.data.followSeconds,
			},
			lines: (reply.data.next as string[]).map((line) => ['next', line]),
		}),
	},
	'explore next': {
		positionals: ['explorationId'],
		write: true,
		run: (store, args, { actor }) => nextActions(store, actor, value(args, 'explorationId')!),
		print: (reply) => ({
			lines: ((reply.data.actions ?? []) as Array<{ line: string }>).map((item) => [item.line]),
		}),
	},
	'explore done': {
		positionals: ['explorationId', 'name', 'step'],
		flags: { agent: 'value', failed: 'value', activity: 'value', 'reply-line': 'value' },
		write: true,
		check: (args) => {
			requireChoice(value(args, 'step'), doneSteps, 'step')
		},
		run: (store, args, { actor }) =>
			stepDone(store, actor, {
				explorationId: value(args, 'explorationId')!,
				name: value(args, 'name')!,
				step: value(args, 'step')!,
				agent: value(args, 'agent'),
				failed: value(args, 'failed'),
				activity: value(args, 'activity'),
				replyLine: value(args, 'reply-line'),
			}),
		print: (reply) => ({
			facts: {
				name: reply.data.name,
				event: reply.data.event,
				state: reply.data.state,
				saved: reply.data.saved,
				refused: reply.data.refused,
			},
			lines: (reply.data.next as string[]).map((line) => ['next', line]),
		}),
	},
	'explore started': {
		positionals: ['explorationId', 'names...'],
		write: true,
		run: (store, args, { actor }) =>
			stepsStarted(store, actor, value(args, 'explorationId')!, args.names as string[]),
		print: (reply) => ({ facts: { started: reply.data.started } }),
	},
	'explore findings': {
		positionals: ['explorationId'],
		write: true,
		run: (store, args, { actor }) => storeExplorationFindings(store, actor, value(args, 'explorationId')!),
		print: (reply) => ({ facts: { run: reply.data.runId ?? '-', reason: reply.data.reason ?? '-' } }),
	},
	'explore pause': {
		positionals: ['explorationId'],
		flags: { reason: 'value' },
		required: ['reason'],
		write: true,
		run: (store, args, { actor }) => pauseRun(store, actor, value(args, 'explorationId')!, value(args, 'reason')!),
		print: (reply) => ({ facts: { reason: reply.data.reason, waitsOn: reply.data.waitsOn } }),
	},
	'explore stop': {
		positionals: ['explorationId'],
		flags: { explorer: 'value', reason: 'value' },
		write: true,
		run: (store, args, { actor }) =>
			stopExploration(store, actor, {
				explorationId: value(args, 'explorationId')!,
				explorer: value(args, 'explorer'),
				reason: value(args, 'reason'),
			}),
		print: (reply) => ({
			facts: {
				explorer: reply.data.explorer ?? undefined,
				was: reply.data.was,
				reason: reply.data.reason || undefined,
				workFolder: reply.data.workFolder ?? undefined,
				note: reply.data.note,
			},
			lines: [
				...((reply.data.left as number[]) ?? []).map((pid) => ['alive', pid]),
				...(reply.data.next as string[]).map((line) => ['next', line]),
			],
		}),
	},
	'explore permit': {
		positionals: ['explorationId', 'requestId'],
		flags: {
			allow: 'switch',
			'allow-kind': 'switch',
			'allow-tool': 'switch',
			always: 'switch',
			deny: 'switch',
			stop: 'switch',
			reason: 'value',
		},
		write: true,
		check: (args) =>
			requireWellFormed(
				permissionDecisions.filter((name) => args[name] === true).length === 1,
				'Give one of --allow, --allow-kind, --allow-tool, --always, --deny, --stop.'
			),
		run: (store, args, { actor }) => {
			requireCondition(
				liveUi(store.workspace),
				'No UI server runs for this folder, so no tester waits for an answer. Nothing changed.',
				'Run checkmate ui in this folder.'
			)
			const explorationId = value(args, 'explorationId')!
			return decidePermission(
				store,
				actor,
				{
					askerId: explorationId,
					requestId: value(args, 'requestId')!,
					decision: permissionDecisions.find((name) => args[name] === true)!,
					reason: value(args, 'reason'),
				},
				(explorer, reason) =>
					stopExploration(store, actor, { explorationId, explorer, reason: reason || undefined })
			)
		},
		print: (reply) => ({ facts: { request: reply.data.requestId, decision: reply.data.decision } }),
	},
	'explore permissions': {
		positionals: ['explorationId'],
		readOnly: true,
		run: (store, args) => {
			const explorationId = value(args, 'explorationId')!
			return completed(explorationId, { permissions: explorationPermissions(store, explorationId) })
		},
		print: (reply) => ({
			lines: (reply.data.permissions as ReturnType<typeof explorationPermissions>).map((item) => [
				item.id,
				item.decision ? item.decision.text : 'open',
				item.who,
				item.tool,
				inputLine(item.input),
				...(item.rule ? [`rule=${item.rule}`] : []),
			]),
		}),
	},
	'explore show': {
		positionals: ['explorationId'],
		readOnly: true,
		run: (store, args) => {
			const explorationId = value(args, 'explorationId')!
			return completed(explorationId, explorationReport(store, explorationId))
		},
		print: (reply) => {
			const report = reply.data as ReturnType<typeof explorationReport>
			const status = explorationLines(reply)
			return {
				facts: status.facts,
				lines: [
					...(status.lines ?? []),
					...report.claims.map((claim) => [
						claim.id,
						'claim',
						claim.state,
						claim.severity,
						claim.actors.join(','),
						claim.title,
						...(claim.reason ? [claim.reason] : []),
						...(claim.handoff ? [`handed=${claim.handoff.to}`] : []),
					]),
					...report.questions.map((question) => [
						question.id,
						'question',
						question.answer === null ? 'open' : 'answered',
						question.question,
						...(question.members.length > 1 ? [`members=${question.members.join(',')}`] : []),
					]),
					...report.retests.map((entry) => [
						entry.id,
						'verdict',
						entry.defect,
						entry.result,
						...(entry.saw ? [entry.saw] : []),
					]),
					...report.criteria.map((criterion) => [criterion.id, 'criterion', criterion.text]),
					...report.files.map((file) => [file.explorer, 'file', file.phase, file.name, `${file.size} bytes`]),
				],
			}
		},
	},
	'explore status': {
		positionals: ['explorationId'],
		readOnly: true,
		run: (store, args) => {
			const explorationId = value(args, 'explorationId')!
			return completed(explorationId, explorationStatus(store, explorationId))
		},
		print: explorationLines,
	},
	'explore wait': {
		positionals: ['explorationId'],
		flags: { timeout: { min: 1, max: 86400 } },
		readOnly: true,
		run: (store, args) => waitExploration(store, value(args, 'explorationId')!, integer(args, 'timeout') ?? 3600),
		print: explorationLines,
	},
	'explore levels': {
		positionals: [],
		readOnly: true,
		run: () => completed('levels', { levels: testLevels }),
		print: (reply) => ({
			lines: Object.entries(reply.data.levels as typeof testLevels).map(([name, level]) => [
				name,
				`explorers=${level.explorers}`,
				`model=${level.model}`,
				`verifier=${level.verifier}`,
				`studySeconds=${level.studySeconds}`,
				`testSeconds=${level.testSeconds}`,
				`followSeconds=${level.followSeconds}`,
			]),
		}),
	},
	'explore log': {
		positionals: ['explorationId'],
		write: true,
		stdin: true,
		run: (store, args, { actor, text, cwd }) =>
			logEntries(store, actor, {
				explorationId: value(args, 'explorationId')!,
				entries: readEntries(text()),
				cwd,
			}),
		print: (reply) => ({
			facts: {
				saved: (reply.data.saved as unknown[]).length,
				refused: (reply.data.refused as unknown[]).length,
			},
			lines: [
				...(reply.data.saved as Array<{ id: string; kind: string }>).map((item) => [
					item.id,
					'saved',
					item.kind,
				]),
				...(reply.data.refused as Array<{ index: number; reason: string }>).map((item) => [
					`[${item.index}]`,
					'refused',
					item.reason,
				]),
			],
		}),
	},
	record: {
		positionals: ['explorationId'],
		flags: {
			explorer: 'value',
			session: 'value',
			timeout: { min: 1, max: 86400 },
			'claude-arg': 'repeat',
		},
		required: ['explorer', 'session'],
		write: true,
		run: (store, args, { actor, cwd, env }) =>
			recordSession(
				store,
				actor,
				{
					explorationId: value(args, 'explorationId')!,
					explorer: value(args, 'explorer')!,
					session: value(args, 'session')!,
					timeoutSeconds: integer(args, 'timeout') ?? defaultRecorderTimeout,
					claudeArgs: checkClaudeArgs(list(args, 'claude-arg') ?? []),
				},
				workspaceEnv(store, env),
				cwd
			),
		print: (reply) => ({
			facts: {
				explorer: reply.data.explorer,
				session: reply.data.session,
				recorder: reply.data.recorder,
				saved: reply.data.saved,
				refused: reply.data.refused,
				evidenceMissing: reply.data.evidenceMissing || undefined,
				referencesDropped: reply.data.referencesDropped || undefined,
				costUsd: reply.data.costUsd,
				durationMs: reply.data.durationMs,
			},
			lines: Object.entries((reply.data.added ?? {}) as Record<string, number>).map(([kind, count]) => [
				'added',
				kind,
				count,
			]),
		}),
	},
	log: {
		positionals: [],
		readOnly: true,
		flags: { subject: 'value', limit: { min: 1, max: 1000 }, after: { min: 0, max: Number.MAX_SAFE_INTEGER } },
		check: (args) => {
			const subject = value(args, 'subject')
			requireWellFormed(
				subject === undefined || subject === 'inbox' || /^(target|plan|run|chat):./.test(subject),
				`Invalid --subject: ${subject}. Use target:<targetId>, plan:<planId>, run:<runId>, chat:<chatId>, or inbox.`
			)
		},
		run: (store, args) => {
			return completed('log', {
				operations: operationLog(store, {
					display: args.json !== true,
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
				operation.subjects.map((subject) =>
					subject.startsWith('chat:') ? `/chats/${subject.slice(5)}` : subject
				),
				...rationaleOf(operation.arguments),
				operation.rowid,
			]),
		}),
	},
	'spec finding': {
		positionals: ['reference', 'gapId'],
		flags: { kind: ['question', 'gap', 'defect'], source: 'value', evidence: 'value', 'expect-sha': 'value' },
		required: ['kind', 'source', 'evidence', 'expect-sha'],
		write: true,
		run: (store, args, { actor }) =>
			specFinding(store, actor, {
				reference: value(args, 'reference')!,
				gapId: value(args, 'gapId')!,
				kind: value(args, 'kind')!,
				source: value(args, 'source')!,
				evidence: value(args, 'evidence')!,
				sha256: value(args, 'expect-sha')!,
			}),
	},
	'spec review': {
		positionals: ['reference'],
		flags: { source: 'value', evidence: 'value', rationale: 'value', 'expect-sha': 'value' },
		required: ['source', 'evidence', 'rationale', 'expect-sha'],
		write: true,
		run: (store, args, { actor }) =>
			specReview(store, actor, {
				reference: value(args, 'reference')!,
				source: value(args, 'source')!,
				evidence: value(args, 'evidence')!,
				rationale: value(args, 'rationale')!,
				sha256: value(args, 'expect-sha')!,
			}),
	},
	'spec status': {
		positionals: ['reference'],
		readOnly: true,
		run: (store, args) => {
			const status = specStatus(store, value(args, 'reference')!)
			return {
				status: status.ready ? 'completed' : 'needs_decision',
				subject: value(args, 'reference')!,
				reasons: status.reasons,
				data: status,
			}
		},
		print: (reply) => ({ facts: { ready: reply.data.ready, sha256: reply.data.sha256 } }),
	},
	'spec handoff': {
		positionals: ['reference'],
		flags: { rationale: 'value', 'expect-sha': 'value' },
		required: ['rationale', 'expect-sha'],
		write: true,
		run: (store, args, { actor }) =>
			specHandoff(store, actor, {
				reference: value(args, 'reference')!,
				rationale: value(args, 'rationale')!,
				sha256: value(args, 'expect-sha')!,
			}),
		print: (reply) => ({ facts: { ready: reply.data.ready, sha256: reply.data.sha256 } }),
	},
	cleanup: {
		positionals: ['ownerId'],
		write: true,
		run: (store, args) => {
			const id = value(args, 'ownerId')!
			const owed = owedCleanups(store).some((item) => item.id === id)
			requireCondition(
				owed,
				`No cleanup is owed by ${id}.`,
				'Run checkmate status <planId> to see the owed cleanups.'
			)
			const failures = settleCleanups(store, [id])
			return failures.length
				? refused('rejected', id, new Error(failures.join('. ')))
				: completed(id, { cleanup: 'ran', owner: id })
		},
		print: (reply) => ({
			facts: { owner: reply.data.owner ?? reply.subject, cleanup: reply.data.cleanup ?? 'failed' },
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
		readOnly: true,
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

function claimCommand(verdict: 'approved' | 'rejected'): Command {
	return {
		positionals: ['planId', 'claimId'],
		flags: { rationale: 'value' },
		required: ['rationale'],
		write: true,
		run: (store, args, { actor }) =>
			decideClaim(store, actor, {
				planId: value(args, 'planId')!,
				claimId: value(args, 'claimId')!,
				verdict,
				rationale: value(args, 'rationale')!,
			}),
		print: (reply) => ({ facts: { claim: reply.data.claimId, verdict: reply.data.verdict } }),
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
	const rationale = (input as { rationale?: unknown } | null)?.rationale
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
			...legacyLine(detail.legacyChecks, plan.planId),
		],
	}
}

type GateReason = { unverified: string[] }

// A run that has a deterministic check without an expected value is not green: name the checks and the revise command.
function gateReasonLines(gate: GateReason | undefined, planId: string) {
	return gate && gate.unverified.length > 0
		? [
				[
					'reason',
					`deterministic checks without an expected value: ${gate.unverified.join(' ')}`,
					`revise with: checkmate delegate revise ${planId}`,
				],
			]
		: []
}

function legacyLine(checks: string[], planId: string) {
	return checks.length > 0 ? [['legacy', checks.join(' '), `revise with: checkmate plan revise ${planId}`]] : []
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
		...((reply.data.assumed ?? []) as string[]).map((value) => `assumed: ${cell(value)}`),
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

// People say "run accept" or "run reject" for the result of a run. The command is "result accept" or "result reject".
const movedCommands: Record<string, string> = { 'run accept': 'result accept', 'run reject': 'result reject' }

function unknownCommand(words: string[]) {
	const moved = movedCommands[words.slice(0, 2).join(' ')]
	if (moved)
		return new Refusal(
			'malformed',
			`Unknown command: ${words.join(' ')}`,
			`Use ${moved} <runId> --rationale "<why>". Run checkmate --help for the usage of each command.`
		)
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
		if (next === undefined || (next.startsWith('--') && flag !== 'claude-arg'))
			throw wrong(`Missing value for ${token}`)
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
	const rest = command.positionals.at(-1)?.endsWith('...') ? command.positionals.at(-1)! : undefined
	if (rest && positionals.length >= command.positionals.length) {
		args[rest.slice(0, -3)] = positionals.splice(command.positionals.length - 1)
		positionals.push('')
	}
	if (positionals.length !== command.positionals.length)
		throw wrong(
			`${name} needs ${command.positionals.length} argument(s), not ${positionals.length}: ${command.positionals.map((positional) => `<${positional}>`).join(' ') || 'none'}`
		)
	for (const flag of command.required ?? []) if (!(flag in args)) throw wrong(`Missing --${flag}`)
	command.positionals.forEach((positional, i) => {
		if (positional !== rest) args[positional] = positionals[i]
	})
	command.check?.(args)
	return args
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
		...command.positionals.map((positional) => `<${positional}>`),
		...flags,
		...(command.write ? ['[--actor <name>]'] : []),
		...(command.stdin ? ["<<'EOF' <json> EOF"] : []),
	].join(' ')
}

const uiUsage = 'Usage: checkmate ui [--port <value>] [--new-hook-token]'
const uiStopUsage = 'checkmate ui --stop'

function help() {
	return [
		...Object.keys(commands).map((name) => usage(name).replace('Usage: ', '')),
		uiUsage.replace('Usage: ', ''),
		uiStopUsage,
		'Options for every command: --workspace <path>, --json',
	]
}

function commandHelp(argv: string[]): Reply {
	const words = argv.slice(
		0,
		argv.findIndex((word) => word.startsWith('--'))
	)
	for (let count = words.length; count > 0; count--) {
		const prefix = words.slice(0, count).join(' ')
		if (prefix === 'ui') return completed('ui', { usage: [uiUsage.replace('Usage: ', ''), uiStopUsage] })
		const names = Object.keys(commands).filter((name) => name === prefix || name.startsWith(`${prefix} `))
		if (names.length) return completed(prefix, { usage: names.map((name) => usage(name).replace('Usage: ', '')) })
	}
	return { ...refused('invalid_request', 'checkmate', unknownCommand(words)), data: { usage: [] } }
}

function version() {
	const manifest = JSON.parse(readFileSync(join(pluginRoot, '.claude-plugin', 'plugin.json'), 'utf8'))
	return versionLines(manifest.version as string, import.meta.url, process.env).join('\n')
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
	const json = argv.includes('--json')
	if (!argv.length || argv[0] === '--help' || (argv[0] === '--json' && argv[1] === '--help')) {
		const usage = help()
		return { code: 0, output: json ? format(completed('checkmate', { usage }), true) : usage.join('\n') }
	}
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
	const subject = command.positionals.length && name !== 'query' ? String(args[command.positionals[0]]) : name
	const workspace = resolve(io.cwd, value(args, 'workspace') ?? '.')
	let store: Store | undefined
	try {
		store = command.readOnly ? openReadOnlyStore(workspace) : openStore(workspace)
		store.via = requestOfEnv(io.env)
		const actor = command.write ? (value(args, 'actor') ?? defaultActor(workspace, io.env)) : undefined
		if (['run begin', 'explore start', 'test'].includes(name)) settleEnded(store)
		const reply = command.run(store, args, {
			actor,
			stdin: () => readJson(io.stdin()),
			text: io.stdin,
			cwd: io.cwd,
			env: io.env,
		})
		const code = exitCodeOf(name, args, reply)
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

export const blockedOnDecisionExitCode = 3

function exitCodeOf(name: string, args: Args, reply: Reply) {
	if (name === 'run show' && args.gate && reply.status === 'completed')
		return (reply.data.gate as { code: number }).code
	if (name === 'status' && args['fail-on-blocked'] && reply.status === 'completed') {
		const status = reply.data as ReturnType<typeof planStatus>
		const blocking = status.gaps.some((gap) => gap.severity === 'blocking')
		if (status.waitsOn === 'oracle' || blocking) return blockedOnDecisionExitCode
	}
	return reply.status === 'completed' || reply.status === 'needs_decision' ? 0 : 1
}

export function uiOptions(tokens: string[], cwd: string) {
	const values: Record<string, string> = {}
	let newHookToken = false
	let stop = false
	for (let i = 0; i < tokens.length; i++) {
		const token = tokens[i]
		if (token === '--json') continue
		if (token === '--stop') {
			stop = true
			continue
		}
		if (token === '--new-hook-token') {
			newHookToken = true
			continue
		}
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
	requireWellFormed(!stop || (port === undefined && !newHookToken), 'Use --stop with --workspace or --json only.')
	return { workspace: resolve(cwd, values.workspace ?? '.'), port, newHookToken, stop }
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
	const fromPi = process.env.CHECKMATE_PI_UI === '1'
	if (fromPi) delete process.env.CHECKMATE_PI_UI
	try {
		const data = await withUiStartupLock(options.workspace, async (workspace) => {
			const action = options.stop ? 'stop' : fromPi ? 'open-pi' : 'status'
			const active = await contactUi(workspace, action)
			if (options.stop) return { stopped: Boolean(active) }
			if (active) {
				if (fromPi) return active
				throw new Error(
					`The Checkmate UI already runs at ${active.url} Use checkmate ui --stop before starting it again.`
				)
			}
			const ui = await startUi({
				...options,
				workspace,
				env: fromPi ? { ...process.env, CHECKMATE_HARNESS: 'pi' } : process.env,
			})
			const stop = async () => {
				await ui.close()
				process.exit(0)
			}
			process.once('SIGINT', stop)
			process.once('SIGTERM', stop)
			if (!fromPi) return { url: ui.url }
			try {
				const started = await contactUi(workspace, 'status')
				if (!started) throw new Error('The new Checkmate UI did not respond.')
				return started
			} catch (error) {
				await ui.close()
				throw error
			}
		})
		process.stdout.write(format(completed('ui', data), json, (reply) => ({ facts: reply.data })) + '\n')
	} catch (error) {
		process.stdout.write(format(refused('rejected', 'ui', error), json) + '\n')
		process.exitCode = 1
	}
}

export async function main(argv: string[]) {
	if (argv[0] === 'ui' && !argv.includes('--help')) return serveUi(argv.slice(1))
	if (argv[0] === 'explore' && argv[1] === 'end' && argv[3] === '--workspace')
		return endInBackground(argv[4], argv[2], argv[5] === '--explorer' ? argv[6] : undefined, process.env)
	if (argv[0] === 'explore' && argv[1] === 'drive' && argv[3] === '--workspace')
		return argv[5] === '--follow'
			? driveFollow(argv[4], argv[2], process.env)
			: driveExploration(argv[4], argv[2], process.env)
	const outcome = run(argv, {
		cwd: process.cwd(),
		env: process.env,
		stdin: () => readFileSync(0, 'utf8'),
	})
	process.stdout.write(outcome.output + '\n')
	for (const line of piCopyWarnings(import.meta.url, process.env, process.cwd())) process.stderr.write(line + '\n')
	process.exitCode = outcome.code
}
