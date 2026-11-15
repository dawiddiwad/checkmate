import type { Store } from './store.ts'
import { completed, one } from './store.ts'
import { targetList } from './targets.ts'
import { checklistNext, recordNext, showLite } from './lite.ts'
import checklistSchema from '../contracts/lite-checklist.schema.json' with { type: 'json' }
import recordSchema from '../contracts/lite-record.schema.json' with { type: 'json' }

type Schema = {
	$ref?: string
	description?: string
	type?: string
	enum?: string[]
	items?: Schema
	properties?: Record<string, Schema>
	required?: string[]
	examples?: unknown[]
}
export type Field = { path: string; type: string; required: boolean; description: string }

const files: Record<string, Schema> = {
	'lite-checklist.schema.json': checklistSchema as Schema,
	'lite-record.schema.json': recordSchema as Schema,
}

export const liteSteps = [
	'1. Before the build, while the base app runs: lite checklist records the items, the baselines, and the questions.',
	'2. On the first build: lite show, free testing, then one lite record.',
	'3. On each later build: the same, with retest verdicts.',
	'Use only the lite commands. Send each JSON payload on standard input in a quoted heredoc.',
]

function resolved(node: Schema, file: string): [Schema, string] {
	if (!node.$ref) return [node, file]
	const [path, pointer] = node.$ref.split('#')
	const target = path || file
	let found = files[target] as unknown as Record<string, unknown>
	for (const key of pointer.split('/').filter(Boolean)) found = found[key] as Record<string, unknown>
	const [inner, at] = resolved(found as Schema, target)
	const { $ref, ...own } = node
	return [{ ...inner, ...own }, at]
}

function fieldsOf(node: Schema, file: string, prefix: string): Field[] {
	return Object.entries(node.properties ?? {}).flatMap(([name, child]) => {
		const [field, at] = resolved(child, file)
		const [items, itemsAt] = field.items ? resolved(field.items, at) : [undefined, at]
		const path = `${prefix}${name}`
		const type = field.enum
			? field.enum.join('|')
			: items
				? `${items.properties ? 'object' : (items.type ?? 'entry')}[]`
				: (field.type ?? 'value')
		const row = {
			path,
			type,
			required: Boolean(node.required?.includes(name)),
			description: field.description ?? '',
		}
		const nested = items?.properties
			? fieldsOf(items, itemsAt, `${path}[].`)
			: field.properties
				? fieldsOf(field, at, `${path}.`)
				: []
		return [row, ...nested]
	})
}

export function liteSchema(name: 'lite-checklist' | 'lite-record') {
	const file = `${name}.schema.json`
	const schema = files[file]
	return { about: schema.description!, fields: fieldsOf(schema, file, ''), example: schema.examples![0] }
}

function targetOf(store: Store, planId: string | undefined) {
	const opened =
		planId &&
		one<{ target_id: string; target_revision: number }>(
			store,
			'SELECT target_id, target_revision FROM plan_requests WHERE plan_id = ?',
			planId
		)
	if (opened) return `${opened.target_id}@${opened.target_revision}`
	const saved = targetList(store).filter((target) => target.revision !== null)
	return saved.length === 1 ? `${saved[0].targetId}@${saved[0].revision}` : '<targetId@revision>'
}

export function guideLite(store: Store, planId: string | undefined) {
	const plan = planId ?? '<planId>'
	const recorded = planId !== undefined && one(store, 'SELECT 1 FROM latest_plans WHERE plan_id = ?', planId)
	if (!recorded) {
		const target = targetOf(store, planId)
		return completed(planId ?? 'lite guide', {
			step: 'checklist',
			steps: liteSteps,
			command: `checkmate lite checklist ${plan} --target ${target}`,
			...liteSchema('lite-checklist'),
			next: checklistNext(plan, target),
		})
	}
	const state = showLite(store, planId).data
	const record = liteSchema('lite-record')
	const items = state.items as Array<{ id: string; metadata?: Record<string, unknown> }>
	const open = (state.defects as Array<{ id: string }>).map((defect) => defect.id)
	const ids = (keep: (item: (typeof items)[number]) => boolean) => items.filter(keep).map((item) => item.id)
	const need = [
		['checks[].item', ids(() => true), 'one or more checks for each item'],
		['checks[].result', ids((item) => item.metadata?.criterion !== undefined), 'passed, failed, or blocked'],
		[
			'checks[].value',
			ids((item) => item.metadata?.baselineValue !== undefined),
			'the value after the baseline steps',
		],
		['retests[].defect', open, 'a verdict with evidence'],
	].filter(([, list]) => list.length)
	return completed(planId, {
		...state,
		step: 'record',
		steps: liteSteps,
		command: `checkmate lite record ${planId} --build <build>`,
		...record,
		fields: open.length ? record.fields : record.fields.filter((field) => !field.path.startsWith('retests')),
		need,
		next: recordNext(planId, open),
	})
}
