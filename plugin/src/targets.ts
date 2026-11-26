import type { Actions, Instance, Profile } from './types.ts'
import type { Change, Store } from './store.ts'
import { hostSession } from './actor.ts'
import { all, canonical, completed, digest, execute, one, removeTemporaryDirectory, write } from './store.ts'
import {
	Refusal,
	profileCheck,
	requireChoice,
	requireCondition,
	requireIdentifier,
	shellWord,
	requireNotInputWord,
	requireText,
	requireWellFormed,
	revisionReference,
	same,
	slugId,
	approvalPolicy,
	validate,
} from './contracts.ts'
import { executableOnPath } from './sessions.ts'
import { changesData, resetCommand } from './resets.ts'
import {
	declaredEntryPoints,
	fitsEntries,
	recipes,
	requireValidRecipes,
	requiredRecipeFields,
	toolExecutable,
	type ReachCheck,
	type Recipe,
} from './recipes.ts'
import { spawnSync } from 'node:child_process'
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

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
	// The build this instance serves, when the person declared it. Undeclared, any run may name any build.
	build: string | null
	addedAt: string
	addedBy: string
	retired: { at: string; actor: string } | null
}

export const anyTestOperation = 'any_test_operation'
export const readOnlyOperation = 'read_only'
export const readOnlyOperationText = 'You can only read. Do not create, change, or delete data in the application.'
export const anyTestOperationText =
	'You can do any action that the application offers to a test user, on test data, in this instance.'

export function operationAllowed(profile: Pick<Profile, 'allowedOperations'>, operation: string) {
	return profile.allowedOperations.includes(operation) || profile.allowedOperations.includes(anyTestOperation)
}

export function isProduction(instanceId: string, environment: string | null | undefined) {
	return /^prod/i.test(instanceId) || /^prod/i.test(environment ?? '')
}

const productionHint =
	'Give the allowed operations as an explicit list for a production instance, for example --operations read_catalog. Save a new profile revision with that list.'

export const toolKinds = ['cli', 'mcp', 'skill'] as const
export const entryPointKinds = ['url', 'command', 'value'] as const
export type TargetRevision = { profile: Profile; revision: number; sha256: string }

export function openTarget(
	store: Store,
	actor: string | undefined,
	input: Omit<TargetRequest, 'tools'> & { tools?: RequestedTool[] }
) {
	return write(store, { actor, command: 'target open', subject: input.targetId, input }, (operationId) =>
		insertRequest(store, operationId, input)
	)
}

function insertRequest(
	store: Store,
	operationId: string,
	input: Omit<TargetRequest, 'tools'> & { tools?: RequestedTool[] }
): Change {
	const request = targetRequestCheck(input)
	requireValidRecipes(
		store.workspace,
		request.tools.map((tool) => tool.name)
	)
	const existing = currentRequest(store, request.targetId)
	if (existing) {
		requireCondition(
			same(existing, request),
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

function toolName(value: unknown): string {
	const name = typeof value === 'string' ? value.trim() : value
	requireCondition(
		typeof name === 'string' && /^[A-Za-z0-9][A-Za-z0-9_-]{0,95}(:[A-Za-z0-9][A-Za-z0-9_-]{0,95})?$/.test(name),
		`Invalid tool name: ${String(name)}. Use 1 to 96 letters, digits, _ or -, starting with a letter or digit, with an optional <plugin>: prefix.`
	)
	return name
}

export function toolCheck(tool: RequestedTool): RequestedTool {
	return {
		name: toolName(tool.name),
		kind: requireChoice(tool.kind, toolKinds, `kind of tool ${tool.name}`),
		purpose: requireText(tool.purpose, `purpose of tool ${tool.name}`),
	}
}

const currentRequestBody = `coalesce(
	(SELECT body FROM target_request_corrections WHERE target_id = r.target_id ORDER BY rowid DESC LIMIT 1),
	r.body
)`

function currentRequest(store: Store, targetId: string): TargetRequest | undefined {
	const row = one<{ body: string }>(
		store,
		`SELECT ${currentRequestBody} AS body FROM target_requests r WHERE r.target_id = ?`,
		targetId
	)
	return row && JSON.parse(row.body)
}

export function targetRequest(store: Store, targetId: string): TargetRequest {
	const request = currentRequest(store, targetId)
	requireCondition(request, `Unknown target: ${targetId}. Run target open first.`)
	return request
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
	return write(store, { actor, command: 'target save', subject: input.targetId, input }, (operationId) =>
		insertProfile(store, operationId, input)
	)
}

function insertProfile(store: Store, operationId: string, input: { targetId: string; profile: unknown }): Change {
	const request = targetRequest(store, input.targetId)
	const profile = profileCheck(input.profile)
	requireValidRecipes(
		store.workspace,
		profile.tools.map((tool) => tool.name)
	)
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
	if (profile.allowedOperations.includes(anyTestOperation)) {
		const production = instanceList(store, profile.targetId).filter(
			(instance) => !instance.retired && isProduction(instance.instanceId, instance.environment)
		)
		requireCondition(
			!production.length,
			`Target ${profile.targetId} has the production instance ${production[0]?.instanceId}. ${anyTestOperation} is not permitted with it.`,
			productionHint
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
	requireCondition(
		row,
		`Unknown target profile: ${targetId}${revision === null ? '' : `@${revision}`}`,
		'Create the target with checkmate setup --url <url> or checkmate setup --entry <name>=<value>, or list the targets with checkmate target list.'
	)
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
		`SELECT r.target_id, ${currentRequestBody} AS body, (SELECT max(revision) FROM profiles p WHERE p.target_id = r.target_id) AS revision,
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
	const entries: Record<string, string> = {}
	for (const entry of entryPoints) {
		const text = requireText(instance.entries[entry.name], `value for entry point ${entry.name}`).trim()
		entries[entry.name] = text
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
	const references = (instance.references ?? []).map((reference) => requireText(reference, 'reference').trim())
	const repeated = references.find((reference, i) => references.indexOf(reference) !== i)
	requireCondition(repeated === undefined, `Reference ${repeated} is given twice`)
	return {
		entries,
		...(instance.environment === undefined
			? {}
			: { environment: requireText(instance.environment, 'environment').trim() }),
		references,
		...(instance.build === undefined ? {} : { build: instance.build.trim() }),
	}
}

export function addInstance(
	store: Store,
	actor: string | undefined,
	input: { targetId: string; instanceId: string; instance: unknown }
) {
	return write(store, { actor, command: 'target instance add', subject: input.targetId, input }, (operationId) =>
		insertInstance(store, operationId, input)
	)
}

function insertInstance(
	store: Store,
	operationId: string,
	input: { targetId: string; instanceId: string; instance: unknown }
): Change {
	const request = targetRequest(store, input.targetId)
	requireNotInputWord(
		input.instanceId,
		'instance ID',
		"Give a name for the instance, for example local or staging: checkmate target instance add <targetId> <instanceId> <<'EOF'."
	)
	const instanceId = requireIdentifier(input.instanceId, 'instance ID')
	const instance = instanceCheck(request.entryPoints, input.instance)
	const subject = `${input.targetId}/${instanceId}`
	const latest = one<{ body: string }>(
		store,
		'SELECT body FROM profiles WHERE target_id = ? ORDER BY revision DESC LIMIT 1',
		input.targetId
	)
	const operations = latest ? (JSON.parse(latest.body) as Profile).allowedOperations : request.allowedOperations
	requireCondition(
		!isProduction(instanceId, instance.environment) || !operations.includes(anyTestOperation),
		`Instance ${subject} is a production instance. ${anyTestOperation} is not permitted on it.`,
		productionHint
	)
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
}

export function retireInstance(
	store: Store,
	actor: string | undefined,
	input: { targetId: string; instanceId: string }
) {
	return write(store, { actor, command: 'target instance retire', subject: input.targetId, input }, (operationId) =>
		insertRetirement(store, operationId, input)
	)
}

function insertRetirement(store: Store, operationId: string, input: { targetId: string; instanceId: string }): Change {
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
	const startedRuns = all<{ run_id: string }>(
		store,
		'SELECT r.run_id FROM runs r LEFT JOIN results s ON s.run_id = r.run_id WHERE r.target_id = ? AND r.instance_id = ? AND s.run_id IS NULL ORDER BY r.rowid',
		input.targetId,
		input.instanceId
	).map((row) => row.run_id)
	return {
		reply: completed(subject, { instanceId: input.instanceId, recorded: true, startedRuns }),
		subjects: [`target:${input.targetId}`],
	}
}

export function replaceInstance(
	store: Store,
	actor: string | undefined,
	input: { targetId: string; instanceId: string; instance: unknown }
) {
	return write(store, { actor, command: 'target instance replace', subject: input.targetId, input }, (operationId) =>
		insertReplacement(store, operationId, input)
	)
}

function insertReplacement(
	store: Store,
	operationId: string,
	input: { targetId: string; instanceId: string; instance: unknown }
): Change {
	const old = findInstance(store, input.targetId, input.instanceId)
	const request = targetRequest(store, input.targetId)
	const instance = instanceCheck(request.entryPoints, input.instance)
	const suffix = digest(canonical({ instanceId: old.instanceId, instance })).slice(0, 20)
	const instanceId = `${old.instanceId.slice(0, 74)}-${suffix}`
	const replacement = insertInstance(store, operationId, { targetId: input.targetId, instanceId, instance })
	requireCondition(
		!old.retired || !replacement.reply.data.recorded,
		`Instance ${input.targetId}/${old.instanceId} is retired and was not replaced with these values.`,
		'List the active instances and replace the one that has the wrong values.'
	)
	const retired = insertRetirement(store, operationId, input)
	return {
		reply: completed(replacement.reply.subject, {
			...replacement.reply.data,
			replaced: old.instanceId,
			startedRuns: retired.reply.data.startedRuns ?? [],
		}),
		subjects: replacement.subjects,
	}
}

// A replacement and its retirement share an operation. Map only the web
// entries explicitly replaced by the selected instance, never every retired URL.
export function correctedEntryText(store: Store, targetId: string, instanceId: string) {
	const rows = all<{ before: string; after: string; instance_id: string; predecessor: string }>(
		store,
		`WITH RECURSIVE chain(instance_id, body, operation_id) AS (
			SELECT instance_id, body, operation_id FROM instances WHERE target_id = ? AND instance_id = ?
			UNION ALL
			SELECT old.instance_id, old.body, old.operation_id FROM chain
			JOIN instance_retirements r ON r.operation_id = chain.operation_id AND r.target_id = ?
			JOIN instances old ON old.target_id = r.target_id AND old.instance_id = r.instance_id
		)
		SELECT json_extract(old.body, '$.entries.web') AS before,
			json_extract(new.body, '$.entries.web') AS after, new.instance_id, old.instance_id AS predecessor
		FROM chain new JOIN instance_retirements r ON r.operation_id = new.operation_id AND r.target_id = ?
		JOIN chain old ON old.instance_id = r.instance_id`,
		targetId,
		instanceId,
		targetId,
		targetId
	)
	const endpoint = rows.find((row) => row.instance_id === instanceId)?.after
	const replaced = rows
		.map((row) => row.before)
		.filter((url): url is string => Boolean(url && url !== endpoint))
		.sort((a, b) => b.length - a.length)
	if (!endpoint || !replaced.length) return (value: string) => value
	const alternatives = replaced.map((url) => url.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|')
	// A named port is part of the entry, so :444 must not match :4444.
	const entries = new RegExp(`(?:${alternatives})(?![A-Za-z0-9:-]|\\.[A-Za-z0-9])`, 'g')
	return (value: string) => value.replace(entries, () => endpoint)
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
		build: body.build ?? null,
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

// How a prompt names the entries of an instance. A target with one url entry keeps "the url entry";
// any other target names its entries from its profile, for example "the app and device entries".
export function entriesWords(entryPoints: Array<Pick<EntryPoint, 'name' | 'kind'>>) {
	if (entryPoints.length === 1 && entryPoints[0].kind === 'url') return 'the url entry'
	const names = entryPoints.map((entry) => entry.name)
	return names.length === 1 ? `the ${names[0]} entry` : `the ${listText(names)} entries`
}

// What an entry value is called in a prompt: the URL of a web target, the entries of any other.
export function entryNoun(entryPoints: Array<Pick<EntryPoint, 'kind'>>) {
	return entryPoints.length === 1 && entryPoints[0].kind === 'url' ? 'URL' : 'entries'
}

// The flags of checkmate setup that name an application again. A web application has the short form --url.
export function entryFlags(entries: Record<string, string>) {
	const names = Object.keys(entries)
	if (names.length === 1 && names[0] === 'web') return `--url ${entries.web}`
	return names.map((name) => `--entry ${name}=${entries[name]}`).join(' ')
}

// The same flags for the first active instance of a target. A target without one gets placeholders.
export function targetEntryFlags(store: Store, targetId: string) {
	const entries = instanceList(store, targetId).find((instance) => !instance.retired)?.entries
	return entryFlags(entries ?? placeholderEntries(targetRequest(store, targetId).entryPoints))
}

// The setup flags that record a data policy. A web target keeps --url; any other target is named with --target.
export function dataFlags(store: Store, targetId: string) {
	const web = instanceList(store, targetId).find((instance) => !instance.retired)?.entries.web
	return web ? `--url ${web}` : `--target ${targetId}`
}

function placeholderEntries(entryPoints: EntryPoint[]) {
	return Object.fromEntries(
		entryPoints.map((entry) => [entry.name, entry.kind === 'url' ? '<url>' : `<${entry.name}>`])
	)
}

// What a person gives for an entry of a build: the placeholder of the command that adds an instance.
function buildEntryFlags(entryPoints: EntryPoint[], build: string) {
	return entryPoints
		.map((entry) => `--entry ${entry.name}=<${entry.kind === 'url' ? 'URL' : entry.name} of ${build}>`)
		.join(' ')
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
	requireCondition(
		row,
		`Unknown instance: ${targetId}/${instanceId}. Run target instance list ${targetId}.`,
		`Add the build with checkmate target instance add ${targetId} ${instanceId} ${buildEntryFlags(targetRequest(store, targetId).entryPoints, 'that build')}, then run again. A run that can change data also needs the data kind of ${targetId}: ask the person for it, and do not write a reset command, a policy, or a hook.`
	)
	return instanceRecord(store, targetId, row)
}

function instanceForBuildHint(store: Store, targetId: string, build: string): string {
	const serving = instanceList(store, targetId).filter((instance) => !instance.retired && instance.build === build)
	if (serving.length)
		return `Run on an instance that serves ${build}: ${serving.map((instance) => `--instance ${instance.instanceId}`).join(' or ')}.`
	const word = shellWord(build)
	// A build with a special character stays out of the placeholders, so no placeholder holds it unquoted.
	const entries = buildEntryFlags(targetRequest(store, targetId).entryPoints, word === build ? word : 'that build')
	return `Add an instance for ${build}: checkmate target instance add ${targetId} <name> ${entries} --build ${word}.`
}

export function runInstance(
	store: Store,
	targetId: string,
	instanceId: string | undefined,
	build: string
): InstanceRecord {
	const instance = selectInstance(store, targetId, instanceId)
	if (instance.build && instance.build !== build)
		throw new Refusal(
			'prohibited',
			`Instance ${instance.targetId}/${instance.instanceId} serves build ${instance.build}, not ${build}.`,
			instanceForBuildHint(store, instance.targetId, build)
		)
	return instance
}

function selectInstance(store: Store, targetId: string, instanceId: string | undefined): InstanceRecord {
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

type SetupInput = NonNullable<Actions['setup']> & {
	env: Record<string, string | undefined>
	answered?: boolean
}

export function urlTargetId(url: string) {
	const parsed = URL.canParse(url) ? new URL(url) : null
	const host = parsed ? [parsed.hostname, parsed.port].filter(Boolean).join('-') : ''
	return slugId(host) || 'app'
}

export function isLocalAddress(url: string) {
	if (!URL.canParse(url)) return false
	const host = new URL(url).hostname.replace(/^\[|\]$/g, '').toLowerCase()
	if (host === 'localhost' || host.endsWith('.localhost') || host === '::1') return true
	const octets = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(host)?.slice(1).map(Number)
	if (!octets || octets.some((octet) => octet > 255)) return false
	const [first, second] = octets
	return (
		first === 127 ||
		first === 10 ||
		(first === 192 && second === 168) ||
		(first === 172 && second >= 16 && second <= 31)
	)
}

function toolVersion(path: string) {
	const run = spawnSync(path, ['--version'], { encoding: 'utf8', timeout: 5000 })
	const line = run.status === 0 ? run.stdout.trim().split('\n')[0] : ''
	return /[0-9]+(\.[0-9]+)+/.exec(line)?.[0]
}

const browserConfig = join('.playwright', 'cli.config.json')

// playwright-cli launches a browser of its own when the config names no executable. A person who
// names one gets it checked, so that a wrong path fails here and not in the middle of a run.
function browserExecutable(workspace: string) {
	const path = join(workspace, browserConfig)
	const config = existsSync(path) ? JSON.parse(readFileSync(path, 'utf8')) : {}
	const executable: unknown = config.browser?.launchOptions?.executablePath
	if (typeof executable !== 'string' || executable === '') return undefined
	const run = spawnSync(executable, ['--version'], { timeout: 10000 })
	requireCondition(
		run.status === 0,
		`The browser executable ${executable} in ${browserConfig} does not run with --version.`,
		`Ask the person for a different path, or remove executablePath so that playwright-cli uses its own browser. Do not write ${browserConfig} yourself, and do not pick a browser yourself.`
	)
	return executable
}

// The next command that clears a profile saved while the application was not answering.
export function readinessHint(store: Store, targetId: string) {
	return `Clear it with checkmate setup ${targetEntryFlags(store, targetId)} --target ${targetId} while the application answers, then run again.`
}

// One GET that follows redirects. Any answer below 500 counts: a 403 from bot protection still means
// that the application is up. Node takes HTTP_PROXY and HTTPS_PROXY only with NODE_USE_ENV_PROXY, and
// a sandbox or a company network often allows no other route. Returns why the check failed, or null.
const urlCheckSeconds = 10
const urlCheckScript = `
fetch(process.argv[1], { signal: AbortSignal.timeout(${urlCheckSeconds * 1000}) }).then(
	(r) => { if (r.status < 500) process.exit(0); console.log('HTTP ' + r.status); process.exit(1) },
	(e) => { console.log(e.name === 'TimeoutError' ? 'no answer in ${urlCheckSeconds} seconds' : (e.cause?.code ?? e.name) + ': ' + (e.cause?.message ?? e.message)); process.exit(1) }
)`

function urlFailure(url: string, env: SetupInput['env']): string | null {
	if (!/^https?:\/\//i.test(url)) return null
	const check = spawnSync(process.execPath, ['-e', urlCheckScript, url], {
		env: { ...env, NODE_USE_ENV_PROXY: '1' },
		encoding: 'utf8',
		timeout: (urlCheckSeconds + 5) * 1000,
	})
	if (check.status === 0) return null
	return check.stdout.trim() || check.stderr.trim().split('\n').pop() || 'the check did not finish'
}

const commandCheckSeconds = 20

// One command of a recipe. {<entry name>} in the arguments and the texts stands for the value of that entry.
function commandFailure(
	workspace: string,
	recipe: Recipe,
	check: Extract<ReachCheck, { check: 'command' }>,
	entries: Record<string, string>,
	env: SetupInput['env']
): string | null {
	const fill = (text: string) =>
		Object.entries(entries).reduce((out, [name, value]) => out.replaceAll(`{${name}}`, value), text)
	const run = check.run.map(fill)
	const shown = run.join(' ')
	const result = spawnSync(run[0], run.slice(1), {
		cwd: workspace,
		env: { ...env, ...recipe.environment },
		encoding: 'utf8',
		timeout: commandCheckSeconds * 1000,
	})
	if (result.error) return `${shown} did not start: ${result.error.message}`
	if (result.status !== 0) return `${shown} exited with code ${result.status}`
	const missing = (check.contains ?? []).map(fill).filter((text) => !result.stdout.includes(text))
	return missing.length ? `${shown} did not list ${missing.join(', ')}` : null
}

// Runs the reachability checks that the recipes of the fitting tools give. Returns why the instance does not
// answer, or null when it does, or undefined when no recipe gives a check.
function instanceFailure(
	workspace: string,
	fitting: Array<{ recipe: Recipe }>,
	entries: Record<string, string>,
	env: SetupInput['env']
) {
	const checked = fitting.flatMap(({ recipe }) => (recipe.reachable ?? []).map((check) => ({ recipe, check })))
	if (!checked.length) return undefined
	for (const { recipe, check } of checked) {
		const failure =
			check.check === 'http'
				? urlFailure(entries[check.entry], env)
				: commandFailure(workspace, recipe, check, entries, env)
		if (failure) return failure
	}
	return null
}

export async function urlReachable(url: string) {
	if (!/^https?:\/\//i.test(url)) return true
	try {
		const response = await fetch(url, { signal: AbortSignal.timeout(5000) })
		return response.status < 500
	} catch {
		return false
	}
}

export function requireAnswer(answered: boolean, url: string) {
	requireCondition(
		answered,
		`The application did not answer at ${url}.`,
		'Start the application, or check the address. Then set up the target again.'
	)
}

// The data kind of a target. A reset command runs before each run (kind checkmate). Environment and
// isolation keep data safe without a reset by Checkmate, so they need a policy that the person gives.
export function dataOf(input: SetupInput): Profile['reset'] | undefined {
	requireCondition(
		input.reset !== 'external',
		'The value external is no longer accepted.',
		'Use --data environment or --data isolation with --policy "<text>" or --policy-file <path>.'
	)
	const hooks = {
		...(input.cleanup ? { cleanup: resetCommand(input.cleanup) } : {}),
		...(input.hookTimeout ? { timeoutSeconds: input.hookTimeout } : {}),
		...(input.resetPerTest === 'off' ? { perTest: false } : {}),
	}
	if (!input.data) {
		requireCondition(
			!Object.keys(hooks).length || input.reset,
			'--cleanup, --hook-timeout and --reset-per-test apply to a reset or a data kind.',
			'Give --reset "<command>" or --data environment|isolation with --policy.'
		)
		return input.reset
			? { owner: 'checkmate', command: resetCommand(input.reset), policy: null, ...hooks }
			: undefined
	}
	requireCondition(
		Boolean(input.policy || input.policyFile),
		`Data kind ${input.data} needs a data policy.`,
		'Give the policy text with --policy "<text>", or the path of your own file with --policy-file <path>.'
	)
	return {
		owner: input.data,
		command: input.reset ? resetCommand(input.reset) : null,
		policy: input.policy ? { text: input.policy } : { path: input.policyFile! },
		...hooks,
	}
}

// What the person gave. --url is the short form of the entry web, and it comes first.
export function givenEntries(input: Pick<SetupInput, 'url' | 'entries'>) {
	const entries = Object.fromEntries(Object.entries(input.entries ?? {}).map(([name, value]) => [name, value.trim()]))
	if (input.url === undefined) return entries
	const url = input.url.trim()
	requireCondition(
		entries.web === undefined || entries.web === url,
		`The entry web is given twice with other values: ${url} and ${entries.web}.`,
		'Give the web address with --url or with --entry web=<url>, not both.'
	)
	return { web: url, ...entries }
}

export function listText(words: string[]) {
	return words.length < 2 ? words.join('') : `${words.slice(0, -1).join(', ')} and ${words.at(-1)}`
}

// The installed tools whose recipes fit the entries, and the entry points of the profile. A tool whose recipe
// needs an entry that the person did not give is not recorded. Each entry that the person gave must be used.
function fitEntries(
	workspace: string,
	catalog: Recipe[],
	entries: Record<string, string>,
	detected: Array<{ recipe: Recipe; path: string }>
) {
	const names = Object.keys(entries)
	const declared = declaredEntryPoints(catalog)
	const unknown = names.filter((name) => !declared.has(name))
	requireWellFormed(
		!unknown.length,
		`Unknown entry ${unknown.join(', ')}. Entry names come from recipes. Workspace searched: ${workspace}. Known entries: ${[...declared.keys()].join(', ')}.`,
		[
			'If the tool needed for this test has no recipe, add one as part of setup.',
			`Copy an example from checkmate recipe list --json. Include ${requiredRecipeFields.join(', ')}, and include entryPoints for a target that needs inputs such as a file or alias. Each entry needs name, kind and purpose. For a CLI, use its executable name with kind cli and detect path. For MCP, include server and tools.`,
			`Write the JSON and its usage Markdown file side by side. Run checkmate recipe add --workspace ${shellWord(workspace)} --file <recipe.json>. Verify the workspace in the reply and retry setup with the declared entries.`,
			'Use --replace to correct an installed custom recipe with the same name. Pass the receipt line that starts with “Report to the person:” to the person.',
		].join(' ')
	)
	for (const name of names) {
		const pattern = declared.get(name)?.pattern
		requireCondition(
			!pattern || new RegExp(pattern).test(entries[name]),
			`Entry ${name} must match ${pattern}, not ${entries[name]}.`,
			`${declared.get(name)?.purpose}`
		)
	}
	const fitting = detected.filter(({ recipe }) => fitsEntries(recipe, names))
	const covered = new Set(fitting.flatMap(({ recipe }) => (recipe.entryPoints ?? []).map((entry) => entry.name)))
	const uncovered = names.filter((name) => !covered.has(name))
	if (uncovered.length) {
		const needing = catalog.filter((recipe) => recipe.entryPoints?.some((entry) => uncovered.includes(entry.name)))
		const installed = needing.filter((recipe) => detected.some((tool) => tool.recipe === recipe))
		requireCondition(
			!installed.length,
			installed
				.map((recipe) => {
					const own = (recipe.entryPoints ?? []).map((entry) => entry.name)
					return `${recipe.name} needs the entries ${listText(own)}. Missing: ${listText(own.filter((name) => !names.includes(name)))}.`
				})
				.join(' '),
			'Give every entry that the tool needs.'
		)
		requireCondition(
			false,
			`No tool that is installed fits the entries ${uncovered.join(', ')}. ${listText(needing.map((recipe) => `${recipe.name} (${recipe.capability})`))} ${needing.length === 1 ? 'needs them and is' : 'need them and are'} not on PATH.`,
			'Install the tool, or give other entries.'
		)
	}
	const entryPoints = names.map((name) => {
		const { kind, purpose } = declared.get(name)!
		return { name, kind, purpose }
	})
	return { fitting, entryPoints }
}

function detectedTools(catalog: Recipe[], env: SetupInput['env']) {
	return catalog.flatMap((recipe) => {
		const path = recipe.detect === 'runtime' ? process.execPath : executableOnPath(toolExecutable(recipe), env)
		return path ? [{ recipe, path }] : []
	})
}

const noEntriesText =
	'Give the application: --url <url> for a web application, or --entry <name>=<value> for another one. To record the data policy of a target that is set up, give --target <id>.'

export function setupAssumptions(workspace: string, input: SetupInput) {
	const assumed: string[] = []
	const entries = givenEntries(input)
	requireCondition(Object.keys(entries).length, 'Missing application entries.', noEntriesText)
	const targetId =
		input.targetId ?? (entries.web ? urlTargetId(entries.web) : slugId(Object.values(entries)[0]) || 'app')
	if (!input.targetId)
		assumed.push(
			`target=${targetId} (${entries.web ? 'the host of the URL' : `the value of the entry ${Object.keys(entries)[0]}`})`
		)
	const instanceId = input.instanceId ?? 'local'
	if (!input.instanceId) assumed.push('instance=local')
	const catalog = recipes(workspace)
	const { fitting: detected, entryPoints } = fitEntries(
		workspace,
		catalog,
		entries,
		detectedTools(catalog, input.env)
	)
	const capabilities = [...new Set(detected.map(({ recipe }) => recipe.capability))].sort()
	assumed.push(
		entryPoints.length === 1
			? `entry point=${entryPoints[0].name} (${entryPoints[0].kind})`
			: `entry points=${entryPoints.map((entry) => `${entry.name} (${entry.kind})`).join(', ')}`,
		`capabilities=${capabilities.join(',')} (${pathTools(
			catalog,
			detected,
			entryPoints.map((entry) => entry.name)
		)})`
	)
	const allowedOperations = input.operations?.length ? input.operations : [anyTestOperation]
	if (!input.operations?.length) assumed.push(`operations=${anyTestOperation}: ${anyTestOperationText}`)
	assumed.push('authentication=none')
	return { entries, entryPoints, targetId, instanceId, detected, capabilities, allowedOperations, assumed }
}

function pathTools(catalog: Recipe[], detected: Array<{ recipe: Recipe }>, entryNames: string[]) {
	const found = [
		...new Set(
			detected.filter(({ recipe }) => recipe.detect === 'path').map(({ recipe }) => toolExecutable(recipe))
		),
	]
	if (found.length) return `${found.join(' and ')} ${found.length === 1 ? 'is' : 'are'} on PATH`
	const missing = catalog.filter((recipe) => recipe.detect === 'path' && fitsEntries(recipe, entryNames))
	return `no ${[...new Set(missing.map((recipe) => recipe.capability))].join(' or ')} tool on PATH`
}

function sameSet(a: string[], b: string[]) {
	return same([...a].sort(), [...b].sort())
}

// A setup of a known target changes nothing that the request or an instance fixes. Refuse each such input before any write.
function requireNoSetupConflict(
	store: Store,
	input: SetupInput,
	setup: { entries: Record<string, string>; targetId: string; instanceId: string },
	stored: TargetRequest | null
) {
	const { entries, targetId, instanceId } = setup
	const flags = `${entryFlags(entries)} --target <new-target-id>`
	if (stored && input.operations?.length && !input.correct)
		requireCondition(
			sameSet(input.operations, stored.allowedOperations),
			`Request conflict: target ${targetId} was opened with the operations ${stored.allowedOperations.join(', ')}. --operations asks for ${input.operations.join(', ')}. A request does not change.`,
			`To correct this target, retry setup with correct enabled (--correct). To keep its scope, omit operations. To open another target, use checkmate setup ${flags} --operations ${input.operations.join(',')}`
		)
	const operations =
		(input.correct ? input.operations : undefined) ??
		stored?.allowedOperations ??
		(input.operations?.length ? input.operations : [anyTestOperation])
	requireCondition(
		!isProduction(instanceId, input.environment) || !operations.includes(anyTestOperation),
		`${stored ? `Request conflict: target ${targetId} allows ${anyTestOperation}, and ` : ''}Instance ${instanceId} is a production instance. ${anyTestOperation} is not permitted on it.`,
		stored
			? `The request of target ${targetId} does not change. Open another target with an explicit list: checkmate setup ${flags} --instance ${instanceId} --operations <a,b>`
			: productionHint
	)
	if (!stored || input.correct) return
	const wanted = instanceCheck(stored.entryPoints, {
		entries,
		...(input.environment ? { environment: input.environment } : {}),
		...(input.build ? { build: input.build } : {}),
	})
	const existing = one<{ body: string }>(
		store,
		'SELECT body FROM instances WHERE target_id = ? AND instance_id = ?',
		targetId,
		instanceId
	)
	if (!existing) return
	const subject = `${targetId}/${instanceId}`
	const next = `To replace this instance, retry setup with correct enabled (--correct). To add a separate instance, give it a new ID: checkmate setup ${entryFlags(entries)} --target ${targetId} --instance <new-instance-id>`
	requireCondition(!retirement(store, targetId, instanceId), `Instance conflict: ${subject} is retired.`, next)
	requireCondition(
		existing.body === canonical(wanted),
		`Instance conflict: ${subject} exists with other values (${instanceChange(JSON.parse(existing.body), wanted)}). An instance does not change. Nothing was saved.`,
		`${next}. To read the stored instance: checkmate target show ${targetId} --instance ${instanceId}`
	)
}

function instanceChange(stored: Instance, wanted: Instance) {
	const changed = [
		...Object.keys(wanted.entries).filter((name) => stored.entries[name] !== wanted.entries[name]),
		...(stored.environment === wanted.environment ? [] : ['environment']),
		...(stored.build === wanted.build ? [] : ['build']),
	]
	return `changed: ${changed.join(', ')}`
}

// One transaction holds the request, the profile revision, and the instance. A refusal saves none of them.
export function setupTarget(store: Store, actor: string | undefined, input: SetupInput) {
	if (!Object.keys(givenEntries(input)).length) return recordData(store, actor, input)
	const setup = setupAssumptions(store.workspace, input)
	const { entries, entryPoints, targetId, instanceId, detected, capabilities, allowedOperations, assumed } = setup
	const reset = dataOf(input)
	const where = entries.web && Object.keys(entries).length === 1 ? entries.web : `the entries ${entryList(entries)}`
	const flags = entryFlags(entries)
	const tools = detected.map(({ recipe, path }) => {
		const version = recipe.detect === 'runtime' ? process.version.slice(1) : toolVersion(path)
		const executable = recipe.name === 'playwright-cli' ? browserExecutable(store.workspace) : undefined
		return {
			name: recipe.name,
			kind: recipe.kind,
			purpose: recipe.purpose,
			...(version ? { version } : {}),
			...(executable ? { executable } : {}),
			reachable: true,
		}
	})
	const checked =
		input.answered === undefined ? instanceFailure(store.workspace, detected, entries, input.env) : undefined
	const failure = input.answered === undefined ? (checked ?? null) : input.answered ? null : 'not reachable'
	const reachable = failure === null
	const notChecked = input.answered === undefined && checked === undefined
	if (notChecked) assumed.push('reachability=not checked: the tools of this target give no check')
	const host = hostSession(input.env)
	const recorded = { ...input, env: undefined }
	let savedProfile = false
	const reply = write(store, { actor, command: 'setup', subject: targetId, input: recorded }, (operationId) => {
		const known = currentRequest(store, targetId)
		requireCondition(
			!input.correct || known,
			`No target named ${targetId} exists to correct.`,
			'List the targets and retry with the existing target ID. To create a target, use setup without correct.'
		)
		const existing = input.correct
			? one<{ body: string }>(
					store,
					'SELECT body FROM instances WHERE target_id = ? AND instance_id = ?',
					targetId,
					instanceId
				)
			: undefined
		const previous: Instance | undefined = existing && JSON.parse(existing.body)
		const environment = input.environment ?? previous?.environment
		const build = input.build ?? previous?.build
		requireNoSetupConflict(store, { ...input, environment }, setup, known ?? null)
		const subjects: string[] = []
		if (!known) {
			const opened = insertRequest(store, operationId, {
				targetId,
				entryPoints,
				capabilities,
				allowedOperations,
				tools: [],
			})
			subjects.push(...opened.subjects)
		}
		let request = targetRequest(store, targetId)
		const corrected = Boolean(
			input.correct && input.operations && !sameSet(input.operations, request.allowedOperations)
		)
		if (corrected) {
			request = targetRequestCheck({ ...request, allowedOperations })
			execute(
				store,
				'INSERT INTO target_request_corrections (target_id, body, operation_id) VALUES (?, ?, ?)',
				targetId,
				canonical(request),
				operationId
			)
		}
		const saved = one<{ revision: number }>(
			store,
			'SELECT revision FROM profiles WHERE target_id = ? ORDER BY revision DESC LIMIT 1',
			targetId
		)
		if (!reachable && !saved) assumed.push(`ready=false (${where} did not answer: ${failure})`)
		let profile: unknown = null
		if (!saved)
			profile = {
				contractVersion: 'toolkit-2',
				targetId,
				revision: 1,
				entryPoints: request.entryPoints,
				capabilities: request.capabilities,
				tools,
				authentication: { kind: 'none', references: [] },
				allowedOperations: request.allowedOperations,
				startup: { owner: 'factory', command: null },
				cleanup: 'Leave the test data. Remove it only when the application offers a way.',
				readyForLiveExecution: reachable,
				...(reset ? { reset } : {}),
			}
		else {
			// A profile saved while the application was down stays not ready until setup sees it answer.
			const latest = targetRevision(store, targetId)
			const resetChanged = Boolean(reset) && canonical(latest.profile.reset) !== canonical(reset)
			const becameReady = reachable && !latest.profile.readyForLiveExecution
			if (resetChanged || becameReady || corrected)
				profile = {
					...latest.profile,
					revision: latest.revision + 1,
					...(resetChanged ? { reset } : {}),
					allowedOperations: request.allowedOperations,
					readyForLiveExecution: latest.profile.readyForLiveExecution || reachable,
				}
		}
		if (profile) {
			subjects.push(...insertProfile(store, operationId, { targetId, profile }).subjects)
			savedProfile = true
		}
		const wanted = {
			entries,
			...(environment ? { environment } : {}),
			...(build ? { build } : {}),
			...(previous?.references ? { references: previous.references } : {}),
		}
		const instanceInput = { targetId, instanceId, instance: wanted }
		const instance =
			previous && !same(previous, instanceCheck(request.entryPoints, wanted))
				? insertReplacement(store, operationId, instanceInput)
				: insertInstance(store, operationId, instanceInput)
		subjects.push(...instance.subjects)
		const latest = targetRevision(store, targetId)
		const needsReset = !latest.profile.reset && latest.profile.allowedOperations.some(changesData)
		if (needsReset)
			assumed.push('data=none recorded: testers may change data, so a run or an exploration needs a data policy.')
		const kind = latest.profile.reset
		if (kind)
			assumed.push(
				kind.owner === 'checkmate'
					? `data=reset command: Checkmate runs ${kind.command?.join(' ')} before each run and exploration.`
					: `data=${kind.owner}: Checkmate does not reset data. ${kind.owner === 'isolation' ? 'Testers work by isolation under the data policy.' : 'The environment gives each run fresh data.'}`
			)
		return {
			reply: completed(targetId, {
				targetId,
				revision: latest.revision,
				instanceId: instance.reply.data.instanceId,
				...(entries.web ? { url: entries.web } : {}),
				entries,
				capabilities: latest.profile.capabilities,
				allowedOperations: latest.profile.allowedOperations,
				ready: latest.profile.readyForLiveExecution,
				instanceReachable: notChecked ? null : reachable,
				...(!reachable
					? {
							next: host
								? `The application did not answer at ${where}: ${failure}. Confirm ${entries.web ? 'the URL' : 'the entries'} or make the application reachable.`
								: `The application did not answer at ${where}: ${failure}. Fix the ${entries.web ? 'address or the network' : 'entries or the device'}, then run checkmate setup ${flags} --target ${targetId} again. A rerun with the same cause changes nothing.`,
						}
					: needsReset
						? {
								next: host
									? 'The target needs a data policy. Ask how test data is reset or isolated.'
									: `Ask the person for the data policy. Give the command that restores the seed data: checkmate setup ${dataFlagsOf(entries, targetId)} --reset "<command>". Or give --data environment|isolation with --policy "<text>". Do not write them yourself.`,
							}
						: !latest.profile.readyForLiveExecution
							? {
									next: host
										? 'The target profile is incomplete. Check the prerequisites and complete setup.'
										: `Recheck the target prerequisites and save a new profile: checkmate delegate setup ${targetId}`,
								}
							: {}),
				created: !known,
				assumed: known ? [] : assumed,
			}),
			subjects,
		}
	})
	if (savedProfile) removeTemporaryDirectory(store, `setup-${targetId}`)
	return reply
}

function entryList(entries: Record<string, string>) {
	return listText(Object.entries(entries).map(([name, value]) => `${name}=${value}`))
}

// The setup flags that record a data kind for an application that setup has just named.
function dataFlagsOf(entries: Record<string, string>, targetId: string) {
	return entries.web && Object.keys(entries).length === 1 ? `--url ${entries.web}` : `--target ${targetId}`
}

// A setup with no entries records the data kind of a target that is set up. Its instances stay as they are.
function recordData(store: Store, actor: string | undefined, input: SetupInput) {
	const targetId = input.targetId
	requireCondition(targetId, 'Missing application entries.', noEntriesText)
	requireCondition(
		!input.correct && !input.operations?.length && !input.environment && !input.build && !input.instanceId,
		'--correct, --operations, --environment, --build and --instance apply to an instance.',
		noEntriesText
	)
	const reset = dataOf(input)
	requireCondition(
		reset,
		'Nothing to record.',
		'Give --reset "<command>", or --data environment|isolation with --policy "<text>".'
	)
	let savedProfile = false
	const reply = write(
		store,
		{ actor, command: 'setup', subject: targetId, input: { ...input, env: undefined } },
		(operationId) => {
			requireCondition(
				currentRequest(store, targetId),
				`Target ${targetId} is not set up. Give its entries: --url <url> for a web application, or --entry <name>=<value>.`
			)
			const latest = targetRevision(store, targetId)
			const subjects: string[] = []
			if (canonical(latest.profile.reset) !== canonical(reset)) {
				subjects.push(
					...insertProfile(store, operationId, {
						targetId,
						profile: { ...latest.profile, revision: latest.revision + 1, reset },
					}).subjects
				)
				savedProfile = true
			}
			const revision = targetRevision(store, targetId)
			return {
				reply: completed(targetId, {
					targetId,
					revision: revision.revision,
					capabilities: revision.profile.capabilities,
					allowedOperations: revision.profile.allowedOperations,
					ready: revision.profile.readyForLiveExecution,
					instanceReachable: null,
					created: false,
					assumed: [],
				}),
				subjects,
			}
		}
	)
	if (savedProfile) removeTemporaryDirectory(store, `setup-${targetId}`)
	return reply
}
