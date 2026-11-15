import type { Store } from './store.ts'
import { completed, one } from './store.ts'
import { targetList } from './targets.ts'
import { checklistNext, showLite } from './lite.ts'
import checklistSchema from '../contracts/lite-checklist.schema.json' with { type: 'json' }
import recordSchema from '../contracts/lite-record.schema.json' with { type: 'json' }
import entrySchema from '../contracts/journal-entry.schema.json' with { type: 'json' }
import criterionSchema from '../contracts/journal-criterion.schema.json' with { type: 'json' }
import observationSchema from '../contracts/journal-observation.schema.json' with { type: 'json' }
import defectSchema from '../contracts/journal-defect.schema.json' with { type: 'json' }
import questionSchema from '../contracts/journal-question.schema.json' with { type: 'json' }
import verdictSchema from '../contracts/journal-verdict.schema.json' with { type: 'json' }
import noteSchema from '../contracts/journal-note.schema.json' with { type: 'json' }
import { changeState, entryKinds } from './journal.ts'

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
	'journal-entry.schema.json': entrySchema as Schema,
	'journal-criterion.schema.json': criterionSchema as Schema,
	'journal-observation.schema.json': observationSchema as Schema,
	'journal-defect.schema.json': defectSchema as Schema,
	'journal-question.schema.json': questionSchema as Schema,
	'journal-verdict.schema.json': verdictSchema as Schema,
	'journal-note.schema.json': noteSchema as Schema,
}

export const liteSteps = [
	'1. Before the build, while the base app runs: lite checklist records the items, the baselines, and the questions.',
	'2. On the first build: lite show, then free testing. Save a first lite record with --draft early, and add parts with --draft while you test. A last lite record without --draft completes the build.',
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

function brief(fields: Field[], names: string[]) {
	const parent = (field: Field) =>
		names.find((name) => field.path.startsWith(`${name}[].`) || field.path.startsWith(`${name}.`))
	const list = (name: string, required: boolean) =>
		fields
			.filter((field) => parent(field) === name && field.required === required)
			.map((field) => ({ field, own: field.path.slice(field.path.indexOf('.', name.length) + 1) }))
			.filter(({ own }) => !own.includes('.'))
			.map(({ field, own }) => (field.type.includes('|') ? `${own} (${field.type})` : own))
			.join(', ')
	const summary = (name: string) =>
		[
			list(name, true) && `Required fields: ${list(name, true)}.`,
			list(name, false) && `Optional fields: ${list(name, false)}.`,
		]
			.filter(Boolean)
			.join(' ')
	return fields
		.filter((field) => !parent(field))
		.map((field) =>
			names.includes(field.path)
				? { ...field, description: `${field.description} ${summary(field.path)}` }
				: field
		)
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
	const need = [
		[
			'checks[].result',
			items.filter((item) => item.metadata?.criterion !== undefined).map((item) => item.id),
			'passed, failed, or blocked',
		],
		['retests[].defect', open, 'a verdict with evidence'],
	].filter(([, list]) => list.length)
	const later = (state.runs as unknown[]).length > 0
	const fields = record.fields
		.filter((field) => open.length || !field.path.startsWith('retests'))
		.filter((field) => !later || /^(checks|retests)\b/.test(field.path))
	return completed(planId, {
		...state,
		...(later
			? {
					items: [],
					questions: (state.questions as Array<{ status: string }>).filter(
						(question) => question.status !== 'resolved'
					),
				}
			: {}),
		step: 'record',
		command: `checkmate lite record ${planId} --build <build>`,
		about: record.about,
		fields: brief(fields, ['items', 'defects', 'retests', 'questions', 'changes', ...(later ? ['checks'] : [])]),
		...(later ? {} : { example: record.example }),
		need,
		next: [],
	})
}

const commonFields = ['kind', 'id', 'build', 'supersedes']

export function journalSchema() {
	const file = 'journal-entry.schema.json'
	const entry = files[file]
	return {
		about: entry.description!,
		common: fieldsOf(entry, file, ''),
		kinds: entryKinds.map((kind) => {
			const own = `journal-${kind}.schema.json`
			return {
				kind,
				about: files[own].description!,
				fields: fieldsOf(files[own], own, '').filter((field) => !commonFields.includes(field.path)),
			}
		}),
		example: entry.examples![0],
	}
}

export function journalSteps(changeId: string) {
	return [
		'Test the way you would test without this tool. Checkmate does not limit what you test, or how.',
		`Log what you see as you go, and at the latest before your turn ends: checkmate journal log ${changeId} --build <build>, with one entry or a JSON array on standard input in a quoted heredoc.`,
		'With a repository or a merge request, read the diff and follow its leads. Log each changed area as a note with "area".',
		`When you think that you are done, run checkmate journal gaps ${changeId} --build <build>. Its lines are ideas, not rules. checkmate journal show ${changeId} prints the record.`,
	]
}

export function guideJournal(store: Store, changeId: string | undefined) {
	const change = changeId ?? '<changeId>'
	const state = changeId === undefined ? undefined : changeState(store, changeId)
	return completed(changeId ?? 'journal guide', {
		steps: journalSteps(change),
		...journalSchema(),
		command: `checkmate journal log ${change} --build b1`,
		answers: (state?.questions ?? []).filter((question) => question.answer !== null),
		openDefects: (state?.defects ?? []).filter((defect) => state!.openDefects.includes(defect.id)),
	})
}
