import type { Instance, Profile } from './types.ts'
import type { Store } from './store.ts'
import { all, canonical, completed, digest, execute, one, removeTemporaryDirectory, write } from './store.ts'
import {
	profileCheck,
	requireChoice,
	requireCondition,
	requireIdentifier,
	requireText,
	revisionReference,
	same,
	approvalPolicy,
	validate,
} from './contracts.ts'

export type ToolKind = Profile['tools'][number]['kind']
export type RequestedTool = { name: string; kind: ToolKind; purpose: string }
export type EntryPoint = Profile['entryPoints'][number]
export type TargetRequest = {
	targetId: string
	entryPoints: EntryPoint[]
	capabilities: string[]
	allowedOperations: string[]
	tools: RequestedTool[]
}
export type InstanceRecord = {
	targetId: string
	instanceId: string
	entries: Record<string, string>
	environment: string | null
	references: string[]
	addedAt: string
	addedBy: string
	retired: { at: string; actor: string } | null
}

export const toolKinds = ['cli', 'mcp', 'skill'] as const
export const entryPointKinds = ['url', 'command', 'value'] as const
export type TargetRevision = { profile: Profile; revision: number; sha256: string }

export function openTarget(
	store: Store,
	actor: string | undefined,
	input: Omit<TargetRequest, 'tools'> & { tools?: RequestedTool[] }
) {
	return write(store, { actor, command: 'target open', subject: input.targetId, input }, (operationId) => {
		const request = targetRequestCheck(input)
		const existing = one<{ body: string }>(
			store,
			'SELECT body FROM target_requests WHERE target_id = ?',
			request.targetId
		)
		if (existing) {
			requireCondition(
				existing.body === canonical(request),
				`Target ${request.targetId} is open with other values. Use a new target ID for a different scope.`
			)
			return { reply: completed(request.targetId, { request, recorded: false }), subjects: [] }
		}
		execute(
			store,
			'INSERT INTO target_requests (target_id, body, operation_id) VALUES (?, ?, ?)',
			request.targetId,
			canonical(request),
			operationId
		)
		return {
			reply: completed(request.targetId, { request, recorded: true }),
			subjects: [`target:${request.targetId}`],
		}
	})
}

function targetRequestCheck(input: Omit<TargetRequest, 'tools'> & { tools?: RequestedTool[] }): TargetRequest {
	requireIdentifier(input.targetId, 'target ID')
	requireCondition(
		Array.isArray(input.entryPoints) && input.entryPoints.length > 0,
		'Missing entry points. Give one or more --entry-point <name>:<url|command|value>:<purpose>.'
	)
	const entryPoints = input.entryPoints.map(entryPointCheck)
	requireCondition(
		new Set(entryPoints.map((entry) => entry.name)).size === entryPoints.length,
		'Duplicate entry point name'
	)
	for (const [name, list] of [
		['capabilities', input.capabilities],
		['operations', input.allowedOperations],
	] as const) {
		requireCondition(Array.isArray(list) && list.length > 0, `Missing ${name}`)
		list.forEach((item) => requireIdentifier(item, name))
		requireCondition(new Set(list).size === list.length, `Duplicate item in ${name}`)
	}
	const tools = (input.tools ?? []).map((tool) => toolCheck(tool))
	requireCondition(new Set(tools.map((tool) => tool.name)).size === tools.length, 'Duplicate tool name')
	return {
		targetId: input.targetId,
		entryPoints,
		capabilities: input.capabilities,
		allowedOperations: input.allowedOperations,
		tools,
	}
}

function entryPointCheck(entry: EntryPoint): EntryPoint {
	const name = requireIdentifier(entry.name, 'entry point name')
	return {
		name,
		kind: requireChoice(entry.kind, entryPointKinds, `kind of entry point ${name}`),
		purpose: requireText(entry.purpose, `purpose of entry point ${name}`).trim(),
	}
}

export function toolCheck(tool: RequestedTool): RequestedTool {
	return {
		name: requireText(tool.name, 'tool name').trim(),
		kind: requireChoice(tool.kind, toolKinds, `kind of tool ${tool.name}`),
		purpose: requireText(tool.purpose, `purpose of tool ${tool.name}`),
	}
}

export function targetRequest(store: Store, targetId: string): TargetRequest {
	const row = one<{ body: string }>(store, 'SELECT body FROM target_requests WHERE target_id = ?', targetId)
	requireCondition(row, `Unknown target: ${targetId}. Run target open first.`)
	return JSON.parse(row.body)
}

export function showTargetRequest(store: Store, targetId: string) {
	return completed(targetId, { request: targetRequest(store, targetId) })
}

export function saveTarget(store: Store, actor: string | undefined, input: { targetId: string; profile: unknown }) {
	const reply = save(store, actor, input)
	removeTemporaryDirectory(store, `setup-${input.targetId}`)
	return reply
}

function save(store: Store, actor: string | undefined, input: { targetId: string; profile: unknown }) {
	return write(store, { actor, command: 'target save', subject: input.targetId, input }, (operationId) => {
		const request = targetRequest(store, input.targetId)
		const profile = profileCheck(input.profile)
		requireCondition(
			profile.targetId === request.targetId,
			`Profile targetId ${profile.targetId} differs from ${request.targetId}`
		)
		requireCondition(
			same(profile.entryPoints, request.entryPoints),
			'Profile entryPoints differ from the setup request'
		)
		requireCondition(
			same(profile.capabilities, request.capabilities),
			'Profile capabilities differ from the setup request'
		)
		requireCondition(
			same(profile.allowedOperations, request.allowedOperations),
			'Profile allowedOperations differ from the setup request'
		)
		for (const requested of request.tools) {
			const tool = profile.tools.find((tool) => tool.name === requested.name)
			requireCondition(tool, `Profile has no entry for the requested tool ${requested.name}`)
			requireCondition(
				tool.kind === requested.kind,
				`Tool ${tool.name} is ${tool.kind} in the profile, not ${requested.kind}`
			)
		}
		const unreachable = profile.tools
			.filter((tool) => !tool.reachable && request.tools.some((requested) => requested.name === tool.name))
			.map((tool) => `Requested tool ${tool.name} (${tool.kind}) is not reachable`)
		requireCondition(
			!unreachable.length || !profile.readyForLiveExecution,
			`${unreachable.join('. ')}. Set readyForLiveExecution to false.`
		)
		const body = canonical(profile)
		const latest = one<{ revision: number; body: string }>(
			store,
			'SELECT revision, body FROM profiles WHERE target_id = ? ORDER BY revision DESC LIMIT 1',
			profile.targetId
		)
		const subject = `${profile.targetId}@${profile.revision}`
		const reasons = profile.readyForLiveExecution
			? []
			: [...unreachable, 'Target prerequisites are not ready. Inspect the profile.']
		const status = profile.readyForLiveExecution ? ('completed' as const) : ('needs_decision' as const)
		const data = { targetId: profile.targetId, revision: profile.revision, sha256: digest(body) }
		if (latest && latest.revision === profile.revision) {
			requireCondition(
				latest.body === body,
				`Profile ${subject} exists with other content. Save revision ${latest.revision + 1} for changes.`
			)
			return { reply: { status, subject, reasons, data: { ...data, recorded: false } }, subjects: [] }
		}
		const next = (latest?.revision ?? 0) + 1
		requireCondition(profile.revision === next, `Profile revision must be ${next}, not ${profile.revision}`)
		execute(
			store,
			'INSERT INTO profiles (target_id, revision, sha256, body, operation_id) VALUES (?, ?, ?, ?, ?)',
			profile.targetId,
			profile.revision,
			data.sha256,
			body,
			operationId
		)
		return {
			reply: { status, subject, reasons, data: { ...data, recorded: true } },
			subjects: [`target:${profile.targetId}`],
		}
	})
}

export function targetRevision(store: Store, targetId: string, revision: number | null = null): TargetRevision {
	const row = one<{ revision: number; sha256: string; body: string }>(
		store,
		revision === null
			? 'SELECT revision, sha256, body FROM profiles WHERE target_id = ? ORDER BY revision DESC LIMIT 1'
			: 'SELECT revision, sha256, body FROM profiles WHERE target_id = ? AND revision = ?',
		targetId,
		...(revision === null ? [] : [revision])
	)
	requireCondition(row, `Unknown target profile: ${targetId}${revision === null ? '' : `@${revision}`}`)
	return { profile: JSON.parse(row.body), revision: row.revision, sha256: row.sha256 }
}

export function showTarget(store: Store, reference: string, instanceId?: string) {
	const { id, revision } = revisionReference(reference, 'target reference')
	const target = targetRevision(store, id, revision)
	return completed(`${id}@${target.revision}`, {
		targetId: id,
		revision: target.revision,
		sha256: target.sha256,
		approvals: approvalPolicy(target.profile),
		profile: target.profile,
		instances: instanceList(store, id).filter((instance) => !instance.retired),
		...(instanceId === undefined ? {} : { instance: findInstance(store, id, instanceId) }),
	})
}

export function targetList(store: Store) {
	return all<{ target_id: string; revision: number | null; body: string; instances: number }>(
		store,
		`SELECT r.target_id, r.body, (SELECT max(revision) FROM profiles p WHERE p.target_id = r.target_id) AS revision,
			(SELECT count(*) FROM instances i WHERE i.target_id = r.target_id AND NOT EXISTS
				(SELECT 1 FROM instance_retirements x WHERE x.target_id = i.target_id AND x.instance_id = i.instance_id))
				AS instances
		FROM target_requests r ORDER BY r.target_id`
	).map((row) => {
		const request = JSON.parse(row.body) as TargetRequest
		return {
			targetId: row.target_id,
			revision: row.revision,
			capabilities: request.capabilities,
			entryPoints: request.entryPoints.map((entry) => entry.name),
			activeInstances: row.instances,
		}
	})
}

export function targetHistory(store: Store, targetId: string) {
	targetRequest(store, targetId)
	const rows = all<{ revision: number; sha256: string; body: string; at: string; actor: string }>(
		store,
		`SELECT p.revision, p.sha256, p.body, o.at, o.actor FROM profiles p JOIN operations o ON o.id = p.operation_id
		WHERE p.target_id = ? ORDER BY p.revision`,
		targetId
	)
	return rows.map((row, i) => {
		const profile = JSON.parse(row.body) as Record<string, unknown>
		const before = i ? (JSON.parse(rows[i - 1].body) as Record<string, unknown>) : null
		const keys = [...new Set([...Object.keys(profile), ...Object.keys(before ?? {})])].sort()
		return {
			revision: row.revision,
			sha256: row.sha256,
			at: row.at,
			actor: row.actor,
			changed: before
				? keys.filter((key) => key !== 'revision' && canonical(profile[key]) !== canonical(before[key]))
				: [],
		}
	})
}

export function instanceCheck(entryPoints: EntryPoint[], value: unknown): Instance {
	const instance = validate('instance', value)
	const names = Object.keys(instance.entries)
	const missing = entryPoints.filter((entry) => !names.includes(entry.name)).map((entry) => entry.name)
	const unknown = names.filter((name) => !entryPoints.some((entry) => entry.name === name))
	requireCondition(!missing.length, `Missing value for entry point: ${missing.join(', ')}`)
	requireCondition(
		!unknown.length,
		`Unknown entry point: ${unknown.join(', ')}. The target has: ${entryPoints.map((entry) => entry.name).join(', ')}.`
	)
	for (const entry of entryPoints) {
		const text = requireText(instance.entries[entry.name], `value for entry point ${entry.name}`)
		if (entry.kind !== 'url') continue
		let url: URL
		try {
			url = new URL(text)
		} catch {
			throw new Error(`Entry point ${entry.name} needs a valid URL, not ${text}`)
		}
		requireCondition(
			!url.username && !url.password,
			`Entry point ${entry.name} has URL credentials. Use authentication references instead.`
		)
	}
	return {
		entries: Object.fromEntries(entryPoints.map((entry) => [entry.name, instance.entries[entry.name]])),
		...(instance.environment === undefined
			? {}
			: { environment: requireText(instance.environment, 'environment') }),
		references: instance.references ?? [],
	}
}

export function addInstance(
	store: Store,
	actor: string | undefined,
	input: { targetId: string; instanceId: string; instance: unknown }
) {
	return write(store, { actor, command: 'target instance add', subject: input.targetId, input }, (operationId) => {
		const request = targetRequest(store, input.targetId)
		const instanceId = requireIdentifier(input.instanceId, 'instance ID')
		const instance = instanceCheck(request.entryPoints, input.instance)
		const subject = `${input.targetId}/${instanceId}`
		const existing = one<{ body: string }>(
			store,
			'SELECT body FROM instances WHERE target_id = ? AND instance_id = ?',
			input.targetId,
			instanceId
		)
		if (existing) {
			requireCondition(
				!retirement(store, input.targetId, instanceId),
				`Instance ${subject} is retired. Use a new instance ID.`
			)
			requireCondition(
				existing.body === canonical(instance),
				`Instance ${subject} exists. An instance does not change. Use a new instance ID.`
			)
			return { reply: completed(subject, { ...instance, instanceId, recorded: false }), subjects: [] }
		}
		execute(
			store,
			'INSERT INTO instances (target_id, instance_id, body, operation_id) VALUES (?, ?, ?, ?)',
			input.targetId,
			instanceId,
			canonical(instance),
			operationId
		)
		return {
			reply: completed(subject, { ...instance, instanceId, recorded: true }),
			subjects: [`target:${input.targetId}`],
		}
	})
}

export function retireInstance(
	store: Store,
	actor: string | undefined,
	input: { targetId: string; instanceId: string }
) {
	return write(store, { actor, command: 'target instance retire', subject: input.targetId, input }, (operationId) => {
		const instance = findInstance(store, input.targetId, input.instanceId)
		const subject = `${input.targetId}/${input.instanceId}`
		if (instance.retired)
			return {
				reply: completed(subject, { instanceId: input.instanceId, recorded: false }),
				subjects: [],
			}
		execute(
			store,
			'INSERT INTO instance_retirements (target_id, instance_id, operation_id) VALUES (?, ?, ?)',
			input.targetId,
			input.instanceId,
			operationId
		)
		return {
			reply: completed(subject, { instanceId: input.instanceId, recorded: true }),
			subjects: [`target:${input.targetId}`],
		}
	})
}

function retirement(store: Store, targetId: string, instanceId: string) {
	return one<{ at: string; actor: string }>(
		store,
		`SELECT o.at, o.actor FROM instance_retirements x JOIN operations o ON o.id = x.operation_id
		WHERE x.target_id = ? AND x.instance_id = ?`,
		targetId,
		instanceId
	)
}

type InstanceRow = { instance_id: string; body: string; at: string; actor: string }

function instanceRecord(store: Store, targetId: string, row: InstanceRow): InstanceRecord {
	const body = JSON.parse(row.body) as Instance
	const order = targetRequest(store, targetId).entryPoints.map((entry) => entry.name)
	const retired = retirement(store, targetId, row.instance_id)
	return {
		targetId,
		instanceId: row.instance_id,
		entries: Object.fromEntries(order.map((name) => [name, body.entries[name]])),
		environment: body.environment ?? null,
		references: body.references ?? [],
		addedAt: row.at,
		addedBy: row.actor,
		retired: retired ? { at: retired.at, actor: retired.actor } : null,
	}
}

export function instanceList(store: Store, targetId: string): InstanceRecord[] {
	targetRequest(store, targetId)
	return all<InstanceRow>(
		store,
		`SELECT i.instance_id, i.body, o.at, o.actor FROM instances i JOIN operations o ON o.id = i.operation_id
		WHERE i.target_id = ? ORDER BY i.rowid`,
		targetId
	).map((row) => instanceRecord(store, targetId, row))
}

export function findInstance(store: Store, targetId: string, instanceId: string): InstanceRecord {
	targetRequest(store, targetId)
	const row = one<InstanceRow>(
		store,
		`SELECT i.instance_id, i.body, o.at, o.actor FROM instances i JOIN operations o ON o.id = i.operation_id
		WHERE i.target_id = ? AND i.instance_id = ?`,
		targetId,
		instanceId
	)
	requireCondition(row, `Unknown instance: ${targetId}/${instanceId}. Run target instance list ${targetId}.`)
	return instanceRecord(store, targetId, row)
}

export function runInstance(store: Store, targetId: string, instanceId: string | undefined): InstanceRecord {
	if (instanceId !== undefined) {
		const instance = findInstance(store, targetId, instanceId)
		requireCondition(
			!instance.retired,
			`Instance ${targetId}/${instanceId} is retired. A retired instance cannot start a run.`
		)
		return instance
	}
	const active = instanceList(store, targetId).filter((instance) => !instance.retired)
	requireCondition(
		active.length,
		`Target ${targetId} has no active instance. Add one with target instance add ${targetId} <instanceId>.`
	)
	requireCondition(
		active.length === 1,
		`Target ${targetId} has ${active.length} active instances: ${active.map((instance) => instance.instanceId).join(', ')}. Name one with --instance.`
	)
	return active[0]
}
