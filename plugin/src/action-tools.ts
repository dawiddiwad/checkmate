import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { defaultActor, requestOfEnv } from './actor.ts'
import { actionRecovery, performAction, type ActionName } from './actions.ts'
import { refused } from './contracts.ts'
import { settleEnded } from './cleanups.ts'
import { pluginRoot, type Env } from './sessions.ts'
import { busyReason, closeStore, isBusy, openReadOnlyStore, openStore, type Reply } from './store.ts'

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

function allowed(name: ActionName, env: Env) {
	const role = env.CHECKMATE_TOOL_ROLE
	return role === undefined || (roles[role] ?? []).includes(name)
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
				name: `checkmate_${name}`,
				description: description ?? name,
				inputSchema: inlineSchema(input, file, read),
			},
		]
	})
}

export function actionOutput(reply: Reply) {
	const { data, ...envelope } = reply
	return { ...envelope, ...data }
}

export function callActionTool(tool: string, input: unknown, workspace: string, env: Env) {
	const name = tool.replace(/^checkmate_/, '') as ActionName
	if (!allowed(name, env) || !actionToolDefinitions(env).some((definition) => definition.name === tool))
		return actionOutput(refused('rejected', tool, Error('This tool is unavailable in this Checkmate role.')))
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
		store = readActions.includes(name) ? openReadOnlyStore(workspace) : openStore(workspace)
		store.via = requestOfEnv(env)
		if (name === 'begin_run' || name === 'start_test') settleEnded(store)
		const reply = performAction(store, name, input, { actor: defaultActor(workspace, env), env })
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
