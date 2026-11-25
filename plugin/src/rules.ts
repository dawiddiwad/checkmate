import type { Store } from './store.ts'
import type { Plan, PlanPatch, WorkerRule } from './types.ts'
import { canonical, execute, one } from './store.ts'
import { requireCondition, requireWellFormed, schemaProblems } from './contracts.ts'
import { newFields, patchList, planRequest } from './plans.ts'
import { readFileSync, realpathSync, statSync } from 'node:fs'
import { resolve, sep } from 'node:path'

export type Rule = { id: string; text: string; source: string; area?: string }
export type RuleOrigin = 'revision' | 'request' | 'derived' | 'corrected' | 'harvested'
export type RuleSource = { name: string; text: string | null }

export const outsideRule = 'outside'
export const defaultArea = 'Rules'
export const maxAreaCharacters = 40
const maxSourceCharacters = 40000

export function storedRules(store: Store, planId: string) {
	const row = one<{ origin: 'derived' | 'corrected' | 'harvested'; body: string }>(
		store,
		'SELECT origin, body FROM plan_rules WHERE plan_id = ? ORDER BY rowid DESC LIMIT 1',
		planId
	)
	return row ? { rules: JSON.parse(row.body) as Rule[], origin: row.origin } : null
}

function plainRules(items: Plan['requirements']): Rule[] {
	return items.map(({ id, text, source, area }) => ({ id, text, source, ...(area ? { area } : {}) }))
}

function withHeldRules(derived: Rule[], held: Rule[]) {
	const known = new Set(derived.map((rule) => rule.id))
	return [
		...derived.map((rule) => held.find((item) => item.id === rule.id) ?? rule),
		...held.filter((rule) => !known.has(rule.id)),
	]
}

export function planRules(store: Store, planId: string): { rules: Rule[]; origin: RuleOrigin | null } {
	const latest = one<{ body: string }>(store, 'SELECT body FROM latest_plans WHERE plan_id = ?', planId)
	if (latest) {
		const held = plainRules((JSON.parse(latest.body) as Plan).requirements)
		const stored = storedRules(store, planId)
		return stored?.origin === 'harvested'
			? { rules: withHeldRules(stored.rules, held), origin: 'harvested' }
			: { rules: held, origin: 'revision' }
	}
	const { request } = planRequest(store, planId)
	if (request.requirements?.length) return { rules: plainRules(request.requirements), origin: 'request' }
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
		const path = `rules[${index}]`
		const problems = schemaProblems('worker-rule', raw, path)
		if (problems.length) {
			refusals.push(...problems.map(({ text }) => `${text}.`))
			continue
		}
		const item = raw as WorkerRule
		const source = item.source.trim()
		if (!sources.some((name) => source === name || source.startsWith(`${name}#`))) {
			refusals.push(`${path}/source ${JSON.stringify(source)} must name one of ${sources.join(', ')}.`)
			continue
		}
		const area = item.area.trim()
		const key = area.toLowerCase()
		if (!areas.has(key)) areas.set(key, area)
		rules.push({ id: `R${rules.length + 1}`, text: item.text.trim(), source, area: areas.get(key)! })
	}
	if (!rules.length && !refusals.length) refusals.push('The reply has no rule.')
	return { rules, refusals }
}

export function saveRules(
	store: Store,
	operationId: string,
	planId: string,
	rules: Rule[],
	origin: 'derived' | 'corrected' | 'harvested'
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

function heldRules(store: Store, planId: string) {
	const latest = one<{ revision: number; body: string }>(
		store,
		'SELECT revision, body FROM latest_plans WHERE plan_id = ?',
		planId
	)
	if (!latest) return null
	const rules = plainRules((JSON.parse(latest.body) as Plan).requirements)
	return { revision: latest.revision, rules, ids: new Set(rules.map((rule) => rule.id)) }
}

export function storedTestCounts(store: Store, planId: string) {
	const latest = one<{ body: string }>(store, 'SELECT body FROM latest_plans WHERE plan_id = ?', planId)
	const counts = new Map<string, number>()
	const tests = latest ? (JSON.parse(latest.body) as Plan).tests : []
	for (const test of tests)
		if (test.metadata?.origin === 'harvest')
			for (const id of test.requirementIds) counts.set(id, (counts.get(id) ?? 0) + 1)
	return counts
}

export function requireHeldRules(store: Store, plan: Plan, patch: PlanPatch) {
	const stored = storedRules(store, plan.planId)
	if (stored?.origin !== 'harvested') return
	for (const id of Object.keys(patch.requirements ?? {}))
		requireWellFormed(
			plan.requirements.some((rule) => rule.id === id) || !stored.rules.some((rule) => rule.id === id),
			`Rule ${id} has no stored test, so it is not in revision ${plan.revision}. Correct it with checkmate plan edit ${plan.planId} --patch.`
		)
}

export function patchRules(store: Store, operationId: string, planId: string, patch: PlanPatch) {
	const held = heldRules(store, planId)
	const stored = storedRules(store, planId)
	requireWellFormed(!held || stored?.origin === 'harvested', `Name the plan revision: ${planId}@<revision>`)
	requireCondition(
		stored,
		`Plan ${planId} has no revision and no derived rules. There is nothing to edit.`,
		`Run checkmate test ${planId} to derive the rules from the sources.`
	)
	requireWellFormed(
		!patch.tests && !patch.gaps,
		`A patch of the derived rules of plan ${planId} has only "requirements".`
	)
	for (const id of Object.keys(patch.requirements ?? {}))
		requireWellFormed(
			!held?.ids.has(id),
			`Rule ${id} has a stored test, so it belongs to revision ${held?.revision}. Correct it with checkmate plan edit ${planId}@${held?.revision} --patch.`
		)
	const rules = patchList(stored.rules, patch.requirements, 'rule', (item, id, change) => {
		requireWellFormed(!change.metadata, `A derived rule has no metadata: ${id}`)
		return item ? { ...item, ...change } : { id, ...newFields(`rule ${id}`, change, ['text', 'source']) }
	}) as Rule[]
	requireWellFormed(rules.length, `Keep at least one rule of plan ${planId}.`)
	for (const rule of rules) requireWellFormed(rule.text.trim(), `The rule ${rule.id} needs text.`)
	const origin = stored.origin === 'harvested' ? 'harvested' : 'corrected'
	saveRules(store, operationId, planId, rules, origin)
	return {
		reply: {
			status: 'completed' as const,
			subject: planId,
			reasons: [],
			data: { planId, edit: 'rules', origin, rules: rules.map((rule) => rule.id) },
		},
		subjects: [`plan:${planId}`, 'inbox'],
	}
}

export function rulesLine(store: Store, planId: string) {
	const { rules, origin } = planRules(store, planId)
	const held = heldRules(store, planId)
	if (origin === 'harvested' && held)
		return `${rules.length} rules were derived from the sources. ${rules.filter((rule) => held.ids.has(rule.id)).length} have a stored test and belong to revision ${held.revision}. Correct the others with checkmate plan edit ${planId} --patch.`
	if (origin !== 'derived' && origin !== 'corrected') return null
	return `${rules.length} rules were derived from the sources${origin === 'corrected' ? ' and corrected' : ''}. Correct them with checkmate plan edit ${planId} --patch.`
}
