import type { Store } from './store.ts'
import type { Plan, PlanPatch } from './types.ts'
import { canonical, execute, one } from './store.ts'
import { requireCondition, requireWellFormed } from './contracts.ts'
import { newFields, patchList, planRequest } from './plans.ts'
import { readFileSync, realpathSync, statSync } from 'node:fs'
import { resolve, sep } from 'node:path'

export type Rule = { id: string; text: string; source: string; area?: string }
export type RuleOrigin = 'revision' | 'request' | 'derived' | 'corrected'
export type RuleSource = { name: string; text: string | null }

export const outsideRule = 'outside'
export const defaultArea = 'Rules'
export const maxAreaCharacters = 40
const maxAreas = 9
const maxSourceCharacters = 40000
const ruleId = /^R[1-9][0-9]{0,3}$/

export function storedRules(store: Store, planId: string) {
	const row = one<{ origin: 'derived' | 'corrected'; body: string }>(
		store,
		'SELECT origin, body FROM plan_rules WHERE plan_id = ? ORDER BY rowid DESC LIMIT 1',
		planId
	)
	return row ? { rules: JSON.parse(row.body) as Rule[], origin: row.origin } : null
}

export function planRules(store: Store, planId: string): { rules: Rule[]; origin: RuleOrigin | null } {
	const latest = one<{ body: string }>(store, 'SELECT body FROM latest_plans WHERE plan_id = ?', planId)
	const plain = (items: Plan['requirements']) =>
		items.map(({ id, text, source, area }) => ({ id, text, source, ...(area ? { area } : {}) }))
	if (latest) return { rules: plain((JSON.parse(latest.body) as Plan).requirements), origin: 'revision' }
	const { request } = planRequest(store, planId)
	if (request.requirements?.length) return { rules: plain(request.requirements), origin: 'request' }
	return storedRules(store, planId) ?? { rules: [], origin: null }
}

export function explorationRules(store: Store, explorationId: string) {
	const row = one<{ plan_id: string; charter: string }>(
		store,
		'SELECT plan_id, charter FROM explorations WHERE exploration_id = ?',
		explorationId
	)
	if (!row) return []
	const given = (JSON.parse(row.charter) as { requirements: Array<{ id: string; text: string }> }).requirements
	if (given.length) return given
	return (storedRules(store, row.plan_id)?.rules ?? []).map(({ id, text }) => ({ id, text }))
}

function sourceText(store: Store, name: string) {
	try {
		const path = realpathSync(resolve(store.workspace, name.split('#')[0]))
		if (!path.startsWith(realpathSync(store.workspace) + sep) || !statSync(path).isFile()) return null
		const text = readFileSync(path, 'utf8')
		return text.length > maxSourceCharacters
			? `${text.slice(0, maxSourceCharacters)}\n(The rest of the file is left out.)`
			: text
	} catch {
		return null
	}
}

export function ticketFile(store: Store, typed: string) {
	const name = typed.trim()
	const workspace = realpathSync(store.workspace)
	const inside = (path: string) => path.startsWith(workspace + sep)
	const wanted = resolve(store.workspace, name)
	requireCondition(
		wanted.startsWith(resolve(store.workspace) + sep) || inside(wanted),
		`The ticket ${name} is outside the workspace.`,
		`Give a file inside ${workspace}, or paste the text of the ticket.`
	)
	let path = ''
	try {
		path = realpathSync(wanted)
	} catch {}
	requireCondition(
		path !== '',
		`The ticket file ${name} does not exist.`,
		'Check the path, or paste the text of the ticket.'
	)
	requireCondition(
		inside(path),
		`The ticket ${name} is outside the workspace.`,
		`Give a file inside ${workspace}, or paste the text of the ticket.`
	)
	requireCondition(statSync(path).isFile(), `The ticket ${name} is not a file.`, 'Give the path of a file.')
	return path.slice(workspace.length + 1)
}

export function ruleSources(store: Store, planId: string): RuleSource[] {
	const { request } = planRequest(store, planId)
	return (request.context?.sources ?? []).map((name) => ({ name, text: sourceText(store, name) }))
}

export function rulesNeeded(store: Store, planId: string) {
	return !planRules(store, planId).rules.length && ruleSources(store, planId).some((source) => source.text !== null)
}

export function checkedRules(reply: unknown[] | undefined, sources: string[]) {
	if (!reply) return { rules: [], refusals: ['The reply has no JSON array of rules.'] }
	const rules: Rule[] = []
	const refusals: string[] = []
	const areas = new Map<string, string>()
	for (const [index, raw] of reply.entries()) {
		const item = (raw && typeof raw === 'object' ? raw : {}) as Partial<Record<keyof Rule, unknown>>
		const text = typeof item.text === 'string' ? item.text.trim() : ''
		const source = typeof item.source === 'string' ? item.source.trim() : ''
		const area = typeof item.area === 'string' ? item.area.trim() : ''
		const problem =
			typeof item.id !== 'string' || !ruleId.test(item.id)
				? `"id" must be R1, R2, and so on`
				: rules.some((rule) => rule.id === item.id)
					? `the ID ${item.id} is in use`
					: !text
						? `"text" is missing`
						: !sources.some((name) => source.startsWith(name))
							? `"source" must start with one of: ${sources.join(', ')}`
							: !area
								? `"area" is missing`
								: area.length > maxAreaCharacters
									? `"area" must have at most ${maxAreaCharacters} characters`
									: undefined
		if (problem) {
			refusals.push(`[${index}] ${problem}.`)
			continue
		}
		const key = area.toLowerCase()
		if (!areas.has(key)) areas.set(key, area)
		rules.push({ id: item.id as string, text, source, area: areas.get(key)! })
	}
	if (areas.size > maxAreas)
		refusals.push(`The rules have ${areas.size} areas. Use at most ${maxAreas} areas for the plan.`)
	if (!rules.length && !refusals.length) refusals.push('The reply has no rule.')
	return { rules, refusals }
}

export function saveRules(
	store: Store,
	operationId: string,
	planId: string,
	rules: Rule[],
	origin: 'derived' | 'corrected'
) {
	execute(
		store,
		'INSERT INTO plan_rules (plan_id, origin, body, operation_id) VALUES (?, ?, ?, ?)',
		planId,
		origin,
		canonical(rules),
		operationId
	)
}

export function patchRules(store: Store, operationId: string, planId: string, patch: PlanPatch) {
	requireWellFormed(
		!one(store, 'SELECT 1 FROM plan_revisions WHERE plan_id = ?', planId),
		`Name the plan revision: ${planId}@<revision>`
	)
	const stored = storedRules(store, planId)
	requireCondition(
		stored,
		`Plan ${planId} has no revision and no derived rules. There is nothing to edit.`,
		`Run checkmate test ${planId} to derive the rules from the sources.`
	)
	requireWellFormed(
		!patch.tests && !patch.gaps,
		`Plan ${planId} has no revision. A patch of its derived rules has only "requirements".`
	)
	const rules = patchList(stored.rules, patch.requirements, 'rule', (item, id, change) => {
		requireWellFormed(!change.metadata, `A derived rule has no metadata: ${id}`)
		return item ? { ...item, ...change } : { id, ...newFields(`rule ${id}`, change, ['text', 'source']) }
	}) as Rule[]
	requireWellFormed(rules.length, `Keep at least one rule of plan ${planId}.`)
	const areas = new Set<string>()
	for (const rule of rules) {
		requireWellFormed(rule.text.trim(), `The rule ${rule.id} needs text.`)
		areas.add((rule.area ?? defaultArea).toLowerCase())
	}
	requireWellFormed(
		areas.size <= maxAreas,
		`The rules have ${areas.size} areas. Use at most ${maxAreas} areas for the plan.`
	)
	saveRules(store, operationId, planId, rules, 'corrected')
	return {
		reply: {
			status: 'completed' as const,
			subject: planId,
			reasons: [],
			data: { planId, edit: 'rules', origin: 'corrected', rules: rules.map((rule) => rule.id) },
		},
		subjects: [`plan:${planId}`, 'inbox'],
	}
}

export function rulesLine(store: Store, planId: string) {
	const { rules, origin } = planRules(store, planId)
	if (origin !== 'derived' && origin !== 'corrected') return null
	return `${rules.length} rules were derived from the sources${origin === 'corrected' ? ' and corrected' : ''}. Correct them with checkmate plan edit ${planId} --patch.`
}
