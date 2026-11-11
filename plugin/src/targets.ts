import type { Profile } from './types.ts'
import type { Store } from './store.ts'
import { canonical, completed, digest, execute, one, write } from './store.ts'
import {
	profileCheck,
	requireCondition,
	requireIdentifier,
	revisionReference,
	same,
	approvalPolicy,
} from './contracts.ts'

export type TargetRequest = {
	targetId: string
	baseUrl: string
	capabilities: string[]
	allowedOperations: string[]
	contextInstructions?: string
	toolInstructions?: string
}
export type TargetRevision = { profile: Profile; revision: number; sha256: string }

export function openTarget(store: Store, actor: string | undefined, input: TargetRequest) {
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

function targetRequestCheck(input: TargetRequest): TargetRequest {
	requireIdentifier(input.targetId, 'target ID')
	let url: URL
	try {
		url = new URL(input.baseUrl)
	} catch {
		throw new Error(`Invalid base URL: ${input.baseUrl}`)
	}
	requireCondition(['http:', 'https:'].includes(url.protocol), 'Target must use HTTP or HTTPS')
	for (const [name, list] of [
		['capabilities', input.capabilities],
		['operations', input.allowedOperations],
	] as const) {
		requireCondition(Array.isArray(list) && list.length > 0, `Missing ${name}`)
		list.forEach((item) => requireIdentifier(item, name))
		requireCondition(new Set(list).size === list.length, `Duplicate item in ${name}`)
	}
	for (const name of ['contextInstructions', 'toolInstructions'] as const)
		if (input[name] !== undefined)
			requireCondition(typeof input[name] === 'string' && input[name]!.trim().length > 0, `Invalid ${name}`)
	return {
		...(input.contextInstructions === undefined ? {} : { contextInstructions: input.contextInstructions }),
		...(input.toolInstructions === undefined ? {} : { toolInstructions: input.toolInstructions }),
		targetId: input.targetId,
		baseUrl: input.baseUrl,
		capabilities: input.capabilities,
		allowedOperations: input.allowedOperations,
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
	return write(store, { actor, command: 'target save', subject: input.targetId, input }, (operationId) => {
		const request = targetRequest(store, input.targetId)
		const profile = {
			...profileCheck(input.profile),
			...(request.contextInstructions === undefined ? {} : { contextInstructions: request.contextInstructions }),
			...(request.toolInstructions === undefined ? {} : { toolInstructions: request.toolInstructions }),
		}
		requireCondition(
			profile.targetId === request.targetId,
			`Profile targetId ${profile.targetId} differs from ${request.targetId}`
		)
		requireCondition(profile.baseUrl === request.baseUrl, `Profile baseUrl differs from the setup request`)
		requireCondition(
			same(profile.capabilities, request.capabilities),
			'Profile capabilities differ from the setup request'
		)
		requireCondition(
			same(profile.allowedOperations, request.allowedOperations),
			'Profile allowedOperations differ from the setup request'
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
			: ['Target prerequisites are not ready. Inspect the profile.']
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

export function showTarget(store: Store, reference: string) {
	const { id, revision } = revisionReference(reference, 'target reference')
	const target = targetRevision(store, id, revision)
	return completed(`${id}@${target.revision}`, {
		targetId: id,
		revision: target.revision,
		sha256: target.sha256,
		approvals: approvalPolicy(target.profile),
		profile: target.profile,
	})
}
