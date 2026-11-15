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
import issueSchema from '../contracts/journal-issue.schema.json' with { type: 'json' }
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
	'journal-issue.schema.json': issueSchema as Schema,
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
const teamKinds = ['issue']
const teamFields = ['confirms', 'refutes']
export const guideRoles = ['tester', 'merger', 'verifier', 'lead', 'debrief'] as const
export type GuideRole = (typeof guideRoles)[number]

function kindSchema(kind: string, keep: (field: Field) => boolean) {
	const own = `journal-${kind}.schema.json`
	return {
		kind,
		about: files[own].description!,
		fields: fieldsOf(files[own], own, '').filter((field) => !commonFields.includes(field.path) && keep(field)),
	}
}

function commonSchema(kinds: string[]) {
	const file = 'journal-entry.schema.json'
	return fieldsOf(files[file], file, '').map((field) =>
		field.path === 'kind' ? { ...field, type: kinds.join('|') } : field
	)
}

export function journalSchema(open = false) {
	const entry = files['journal-entry.schema.json']
	const kinds = entryKinds.filter((kind) => !teamKinds.includes(kind))
	const hidden = open ? ['refutes', 'assign'] : [...teamFields, 'to', 'assign']
	return {
		about: entry.description!,
		common: commonSchema(kinds),
		kinds: kinds.map((kind) => kindSchema(kind, (field) => !hidden.includes(field.path))),
		example: entry.examples![0],
	}
}

export function mergerSchema() {
	return {
		about: files['journal-entry.schema.json'].description!,
		common: commonSchema(['issue']),
		kinds: [kindSchema('issue', () => true)],
		example: issueSchema.examples[0],
	}
}

export function verifierSchema() {
	const kept = ['about', 'steps', 'saw', 'via', 'evidence', ...teamFields]
	return {
		about: files['journal-entry.schema.json'].description!,
		common: commonSchema(['observation']),
		kinds: [kindSchema('observation', (field) => kept.includes(field.path))],
		example: observationSchema.examples[0],
	}
}

export function leadSchema() {
	return {
		about: files['journal-entry.schema.json'].description!,
		common: commonSchema(['note']),
		kinds: [kindSchema('note', (field) => ['text', 'area', 'assign'].includes(field.path))],
		example: noteSchema.examples[0],
	}
}

const roleSchemas = { merger: mergerSchema, verifier: verifierSchema, lead: leadSchema }

function roleSteps(changeId: string, role: keyof typeof roleSchemas) {
	if (role === 'lead')
		return [
			'Read the ticket, the docs, and the diff.',
			'Split the work into one part for each tester. Together, the parts must cover the change and what the change can break.',
			`Log one note with "assign", "area", and "text" for each part: checkmate journal log ${changeId}, with the JSON on standard input in a quoted heredoc.`,
			'Do not test.',
		]
	if (role === 'merger')
		return [
			'Do not test. Merge what the testers found.',
			`Run checkmate journal merge ${changeId} --build <build> to read the defects of all testers.`,
			'Find the defects that two or more reports describe. The suggest lines are ideas, not rules.',
			'Check each defect that only one tester reported against the larger issues before you leave it alone.',
			'Do not combine two defects that have different expected results or different triggers.',
			`Log one issue for each of them: checkmate journal log ${changeId} --build <build>, with the JSON on standard input in a quoted heredoc.`,
			'A defect that is in no issue is its own issue. To change an issue, log it again with "supersedes".',
			`Run checkmate journal merge ${changeId} --build <build> again to read the suggestions that remain.`,
		]
	return [
		`Run checkmate journal verify ${changeId} --build <build> to read the items to verify.`,
		'Reproduce each item on the running application.',
		'Log one observation for each item, with "confirms" or "refutes" and "saw": what you saw.',
		'Do not explore beyond the list.',
	]
}

export function journalSteps(changeId: string) {
	return [
		'Test the way you would test without this tool. Checkmate does not limit what you test, or how.',
		`Log what you see as you go, and at the latest before your turn ends: checkmate journal log ${changeId} --build <build>, with one entry or a JSON array on standard input in a quoted heredoc.`,
		'With a repository or a merge request, read the diff and follow its leads. Log each changed area as a note with "area".',
		`When you think that you are done, run checkmate journal gaps ${changeId} --build <build>. Its lines are ideas, not rules. checkmate journal show ${changeId} prints the record.`,
	]
}

export function teamSteps(changeId: string) {
	return [
		'Your teammates log in the same record.',
		`Run checkmate journal show ${changeId} to see what they found and where they are.`,
		'Log a note that says where you go next, so that you do not test the same thing as a teammate.',
		'When a teammate found a defect, do not log it again. You can log an observation with "confirms" and the ID of the defect.',
	]
}

export function debriefSteps(changeId: string) {
	return [
		`Run checkmate journal debrief ${changeId} --build <build> to read what the team found and what it did not cover.`,
		'Test what the team as a whole did not cover, and anything else that you find.',
		`Log what you see: checkmate journal log ${changeId} --build <build>, with one entry or a JSON array on standard input in a quoted heredoc.`,
		'Do not test or log again what the team already confirmed.',
	]
}

export function guideJournal(store: Store, changeId: string | undefined, role: GuideRole = 'tester', viewer?: string) {
	const change = changeId ?? '<changeId>'
	if (role !== 'tester' && role !== 'debrief') {
		if (changeId !== undefined) changeState(store, changeId)
		return completed(changeId ?? 'journal guide', {
			assignments: [],
			steps: roleSteps(change, role),
			team: [],
			...roleSchemas[role](),
			command: role === 'lead' ? `checkmate journal log ${change}` : `checkmate journal log ${change} --build b1`,
			answers: [],
			openDefects: [],
		})
	}
	const state = changeId === undefined ? undefined : changeState(store, changeId, viewer)
	const open = state?.team === 'open'
	return completed(changeId ?? 'journal guide', {
		assignments: state?.assignments ?? [],
		steps: role === 'debrief' ? debriefSteps(change) : journalSteps(change),
		team: open && role === 'tester' ? teamSteps(change) : [],
		...journalSchema(open),
		command: `checkmate journal log ${change} --build b1`,
		answers: (state?.questions ?? []).filter((question) => question.answer !== null),
		openDefects: (state?.defects ?? []).filter((defect) => state!.openDefects.includes(defect.id)),
	})
}
