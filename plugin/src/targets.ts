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
	slugId,
	approvalPolicy,
	validate,
} from './contracts.ts'
import { executableOnPath } from './sessions.ts'
import { changesData, resetCommand } from './resets.ts'
import { spawnSync } from 'node:child_process'

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
	requireCondition(
		row,
		`Unknown target profile: ${targetId}${revision === null ? '' : `@${revision}`}`,
		'Create the target with checkmate setup --url <url>, or list the targets with checkmate target list.'
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

export function targetWebUrl(store: Store, targetId: string) {
	return instanceList(store, targetId).find((instance) => !instance.retired)?.entries.web ?? '<url>'
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
		`Add the build with checkmate target instance add ${targetId} ${instanceId} --entry web=<URL of that build>, then run again. A run that can change data also needs the data kind of ${targetId}: ask the person for it, and do not write a reset command, a policy, or a hook.`
	)
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

export type SetupInput = {
	url: string
	targetId?: string
	instanceId?: string
	operations?: string[]
	environment?: string
	reset?: string
	data?: string
	policy?: string
	policyFile?: string
	cleanup?: string
	hookTimeout?: number
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

function urlAnswers(url: string) {
	if (!/^https?:\/\//i.test(url)) return true
	const check = spawnSync(
		process.execPath,
		[
			'-e',
			'fetch(process.argv[1], { signal: AbortSignal.timeout(5000) }).then((r) => process.exit(r.status < 500 ? 0 : 1), () => process.exit(2))',
			url,
		],
		{ timeout: 8000 }
	)
	return check.status === 0
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
	}
	if (!input.data) {
		requireCondition(
			!Object.keys(hooks).length || input.reset,
			'--cleanup and --hook-timeout apply to a reset or a data kind.',
			'Give --reset "<command>" or --data environment|isolation with --policy.'
		)
		return input.reset
			? { owner: 'checkmate', command: resetCommand(input.reset), policy: null, ...hooks }
			: undefined
	}
	requireCondition(
		input.data === 'environment' || input.data === 'isolation',
		`Unknown data kind ${input.data}.`,
		'Use --data environment or --data isolation.'
	)
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

export function setupAssumptions(input: SetupInput) {
	const assumed: string[] = []
	const url = requireText(input.url, 'application URL (--url)')
	const targetId = input.targetId ?? urlTargetId(url)
	if (!input.targetId) assumed.push(`target=${targetId} (the host of the URL)`)
	const instanceId = input.instanceId ?? 'local'
	if (!input.instanceId) assumed.push('instance=local')
	const browser = executableOnPath('playwright-cli', input.env)
	const capabilities = browser ? ['browser', 'http'] : ['http']
	assumed.push(
		'entry point=web (url)',
		`capabilities=${capabilities.join(',')} (${browser ? 'playwright-cli is on PATH' : 'no browser tool on PATH'})`
	)
	const allowedOperations = input.operations?.length ? input.operations : [anyTestOperation]
	if (!input.operations?.length) assumed.push(`operations=${anyTestOperation}: ${anyTestOperationText}`)
	assumed.push('authentication=none')
	return { url, targetId, instanceId, browser, capabilities, allowedOperations, assumed }
}

export function setupTarget(store: Store, actor: string | undefined, input: SetupInput) {
	const { url, targetId, instanceId, browser, capabilities, allowedOperations, assumed } = setupAssumptions(input)
	requireCondition(
		input.operations?.length || !isProduction(instanceId, input.environment),
		`Instance ${instanceId} is a production instance. ${anyTestOperation} is not permitted on it.`,
		productionHint
	)
	const tools = [
		{
			name: 'node',
			kind: 'cli' as const,
			purpose: 'Send HTTP requests.',
			version: process.version.slice(1),
			reachable: true,
		},
		...(browser
			? [
					{
						name: 'playwright-cli',
						kind: 'cli' as const,
						purpose: 'Drive the browser.',
						...(toolVersion(browser) ? { version: toolVersion(browser) } : {}),
						reachable: true,
					},
				]
			: []),
	]
	const entryPoints = [{ name: 'web', kind: 'url' as const, purpose: 'The application.' }]
	const known = one(store, 'SELECT 1 FROM target_requests WHERE target_id = ?', targetId)
	if (!known) openTarget(store, actor, { targetId, entryPoints, capabilities, allowedOperations, tools: [] })
	const request = targetRequest(store, targetId)
	const saved = one<{ revision: number }>(
		store,
		'SELECT revision FROM profiles WHERE target_id = ? ORDER BY revision DESC LIMIT 1',
		targetId
	)
	const reachable = input.answered ?? urlAnswers(url)
	if (!reachable && !saved) assumed.push(`ready=false (${url} did not answer)`)
	const reset = dataOf(input)
	if (!saved)
		saveTarget(store, actor, {
			targetId,
			profile: {
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
			},
		})
	else if (reset && JSON.stringify(targetRevision(store, targetId).profile.reset) !== JSON.stringify(reset)) {
		const latest = targetRevision(store, targetId)
		saveTarget(store, actor, {
			targetId,
			profile: { ...latest.profile, revision: latest.revision + 1, reset },
		})
	}
	const instance = addInstance(store, actor, {
		targetId,
		instanceId,
		instance: { entries: { web: url }, ...(input.environment ? { environment: input.environment } : {}) },
	})
	if (instance.status !== 'completed') return instance
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
	return completed(targetId, {
		targetId,
		revision: latest.revision,
		instanceId,
		url,
		capabilities: latest.profile.capabilities,
		allowedOperations: latest.profile.allowedOperations,
		ready: latest.profile.readyForLiveExecution,
		instanceReachable: reachable,
		...(needsReset
			? {
					next: `Ask the person for the data policy. Give the command that restores the seed data: checkmate setup --url ${url} --reset "<command>". Or give --data environment|isolation with --policy "<text>". Do not write them yourself.`,
				}
			: !latest.profile.readyForLiveExecution
				? {
						next: `Recheck the target prerequisites and save a new profile: checkmate delegate setup ${targetId}`,
					}
				: {}),
		created: !known,
		assumed: known ? [] : assumed,
	})
}
