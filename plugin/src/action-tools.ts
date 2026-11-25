import { delegate, type Stage } from '../../cli/src/launcher.ts'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { defaultActor, requestOfEnv } from './actor.ts'
import { actionInput, actionRecovery, dispatchAction, toolName, type ActionName } from './actions.ts'
import type { Actions } from './types.ts'
import { Refusal, refused } from './contracts.ts'
import { explorationStatus } from './explorers.ts'
import { settleEnded } from './cleanups.ts'
import { selectedHarness } from './pi.ts'
import { ruleTokens, testerRulesText, workspaceEnv } from './settings.ts'
import { pluginRoot, type Env } from './sessions.ts'
import { busyReason, closeStore, isBusy, openReadOnlyStore, openStore, completed, type Reply } from './store.ts'

const readActions: ActionName[] = [
	'list_targets',
	'show_target',
	'read_plan_request',
	'read_pending',
	'test_status',
	'read_run',
	'status',
	'inbox',
]

const roles: Record<string, ActionName[]> = {
	setup: ['show_target'],
	plan: ['read_plan_request', 'show_target', 'save_plan'],
	revise: ['read_pending', 'revise_plan'],
	execute: ['show_target', 'read_run', 'record_check', 'close_test', 'record_finding', 'record_gap'],
	probe: ['show_target', 'record_finding'],
	explorer: [],
	clerk: [],
}

const workerWrites = new Set<ActionName>([
	'save_plan',
	'revise_plan',
	'record_check',
	'close_test',
	'record_finding',
	'record_gap',
	'finish_run',
])

function allowed(name: ActionName, env: Env) {
	const role = env.CHECKMATE_TOOL_ROLE
	return role === undefined ? !workerWrites.has(name) : (roles[role] ?? []).includes(name)
}

export function childActionTools(role: string) {
	return roles[role] ?? []
}

type Schema = { $ref?: string; description?: string; properties?: Record<string, Schema> }

function schemaFiles() {
	const files = new Map<string, Schema>()
	return (name: string) => {
		const cached = files.get(name)
		if (cached) return cached
		const parsed = JSON.parse(readFileSync(join(pluginRoot, 'contracts', name), 'utf8')) as Schema
		files.set(name, parsed)
		return parsed
	}
}

function inlineSchema(value: unknown, file: string, read: ReturnType<typeof schemaFiles>): unknown {
	if (Array.isArray(value)) return value.map((entry) => inlineSchema(entry, file, read))
	if (!value || typeof value !== 'object') return value
	const node = value as Schema
	if (node.$ref) {
		const [path, pointer] = node.$ref.split('#')
		const nextFile = path || file
		let target = read(nextFile)
		for (const key of (pointer ?? '').split('/').filter(Boolean)) target = (target as Record<string, Schema>)[key]
		return inlineSchema(target, nextFile, read)
	}
	return Object.fromEntries(
		Object.entries(value)
			.filter(([key]) => !['$id', '$schema', 'definitions'].includes(key))
			.map(([key, entry]) => [key, inlineSchema(entry, file, read)])
	)
}

export function actionToolDefinitions(env: Env = process.env) {
	const file = 'actions.schema.json'
	const read = schemaFiles()
	return Object.entries(read(file).properties ?? {}).flatMap(([key, schema]) => {
		const name = key as ActionName
		if (!allowed(name, env)) return []
		const { description, ...input } = schema
		return [
			{
				name: toolName(name),
				description: description ?? name,
				inputSchema: inlineSchema(input, file, read),
			},
		]
	})
}

// A wait reply names the call that moves the exploration on, so that the host does not stop.
const stepDoneAction = {
	action: 'tester_step_done' satisfies ActionName,
	instruction: `When a started agent finishes, call ${toolName('tester_step_done')} with its name, step, agentId, and replyLine. Then call ${toolName('next_tester_steps')} again.`,
}

function isWait(reply: Reply) {
	const actions = reply.data.actions as Array<{ action: string }> | undefined
	return actions?.length === 1 && actions[0].action === 'wait'
}

export function actionOutput(reply: Reply) {
	const { data, ...envelope } = reply
	return { ...envelope, ...data }
}

async function startWorker(
	workspace: string,
	env: Env,
	allowedTools: string[],
	stage: Stage,
	subject: string
): Promise<Reply> {
	try {
		const { status, reasons, data, operation, usageWarning, costUsd, costPartial, observedModels, modelFallback } =
			await delegate(workspace, stage, subject, {
				env,
				allowedTools,
				nativeTools: true,
			})
		return {
			status,
			subject,
			reasons,
			data: { ...data, operation, usageWarning, costUsd, costPartial, observedModels, modelFallback },
		}
	} catch (error) {
		return refused('rejected', subject, error)
	}
}

export async function callActionTool(tool: string, input: unknown, workspace: string, env: Env) {
	const name = tool.replace(/^checkmate_/, '') as ActionName
	if (!allowed(name, env) || !actionToolDefinitions(env).some((definition) => definition.name === tool))
		return actionOutput(
			actionRecovery(
				workerWrites.has(name) && env.CHECKMATE_TOOL_ROLE === undefined ? 'delegate_work' : name,
				refused(
					'rejected',
					tool,
					new Refusal(
						'prohibited',
						'This tool is unavailable in this Checkmate role.',
						workerWrites.has(name)
							? 'Start the assigned Checkmate worker for this stage.'
							: 'Choose a tool that is exposed to this session.'
					)
				)
			)
		)
	let store
	try {
		const supplied = input as { planId?: unknown; runId?: unknown } | null
		const bound = env.CHECKMATE_TOOL_SUBJECT
		if (bound && (supplied?.runId ?? supplied?.planId ?? bound) !== bound)
			return actionOutput(
				actionRecovery(name, refused('rejected', tool, Error(`This session is assigned to ${bound}.`)))
			)
		const test = env.CHECKMATE_TOOL_TEST
		const suppliedTest = (input as { testId?: unknown } | null)?.testId
		if (test && suppliedTest !== undefined && suppliedTest !== test)
			return actionOutput(
				actionRecovery(name, refused('rejected', tool, Error(`This session is assigned to test ${test}.`)))
			)
		const parsed = actionInput(name, input)
		store = readActions.includes(name) ? openReadOnlyStore(workspace) : openStore(workspace)
		store.via = requestOfEnv(env)
		if (name === 'delegate_work') {
			const request = parsed as NonNullable<Actions['delegate_work']>
			const harness = selectedHarness(workspaceEnv(store, env))
			const tools = harness === 'claude' ? ruleTokens(testerRulesText(store, harness)) : []
			closeStore(store)
			store = undefined
			return actionOutput(
				actionRecovery(name, await startWorker(workspace, env, tools, request.stage, request.subject))
			)
		}
		if (name === 'test_status') {
			const { explorationId, waitSeconds } = parsed as NonNullable<Actions['test_status']>
			if (waitSeconds !== undefined) {
				const status = explorationStatus(store, explorationId)
				if (
					status.path === 'session' &&
					!status.paused &&
					!['completed', 'failed', 'stopped', 'interrupted', 'open'].includes(status.state)
				)
					return actionOutput(
						completed(explorationId, {
							...status,
							nextAction: {
								action: 'next_tester_steps',
								instruction:
									'Call checkmate_next_tester_steps and dispatch its actions with the Agent tool. A session exploration runs only when you dispatch its steps.',
							},
						})
					)
			}
		}
		if (name === 'begin_run' || name === 'start_test') settleEnded(store)
		const reply = dispatchAction(store, name, parsed as NonNullable<Actions[typeof name]>, {
			actor: defaultActor(workspace, env),
			env,
		})
		if (name === 'answer_gap' && reply.status === 'completed' && reply.data.decisionId) {
			const harness = selectedHarness(workspaceEnv(store, env))
			const tools = harness === 'claude' ? ruleTokens(testerRulesText(store, harness)) : []
			closeStore(store)
			store = undefined
			const revision = await startWorker(workspace, env, tools, 'revise', reply.subject)
			return actionOutput({
				...reply,
				data: { ...reply.data, revision: actionOutput(actionRecovery('delegate_work', revision)) },
			})
		}
		if (name === 'next_tester_steps' && isWait(reply))
			return actionOutput({ ...reply, data: { ...reply.data, nextAction: stepDoneAction } })
		return actionOutput(actionRecovery(name, reply))
	} catch (error) {
		const reply: Reply = isBusy(error)
			? { status: 'operational_error', subject: tool, reasons: [busyReason], data: {} }
			: refused('rejected', tool, error)
		return actionOutput(actionRecovery(name, reply))
	} finally {
		if (store) closeStore(store)
	}
}
