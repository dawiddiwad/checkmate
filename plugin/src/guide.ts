import type { Store } from './store.ts'
import { completed } from './store.ts'
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
	'journal-entry.schema.json': entrySchema as Schema,
	'journal-criterion.schema.json': criterionSchema as Schema,
	'journal-observation.schema.json': observationSchema as Schema,
	'journal-defect.schema.json': defectSchema as Schema,
	'journal-question.schema.json': questionSchema as Schema,
	'journal-verdict.schema.json': verdictSchema as Schema,
	'journal-note.schema.json': noteSchema as Schema,
	'journal-issue.schema.json': issueSchema as Schema,
}

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

const commonFields = ['kind', 'id', 'build', 'supersedes']
const teamKinds = ['issue']
const teamFields = ['confirms', 'refutes']
export const guideRoles = ['tester', 'recorder', 'merger', 'verifier'] as const
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

export function journalSchema() {
	const entry = files['journal-entry.schema.json']
	const kinds = entryKinds.filter((kind) => !teamKinds.includes(kind))
	return {
		about: entry.description!,
		common: commonSchema(kinds),
		kinds: kinds.map((kind) => kindSchema(kind, (field) => !teamFields.includes(field.path))),
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

function roleSteps(changeId: string, role: 'merger' | 'verifier') {
	if (role === 'merger')
		return [
			'Do not test. Merge what the testers found.',
			`Run checkmate merge ${changeId} --build <build> to read the defects of all testers.`,
			'Find the defects that two or more reports describe. The suggest lines are ideas, not rules.',
			'Check each defect that only one tester reported against the larger issues before you leave it alone.',
			'Do not combine two defects that have different expected results or different triggers.',
			`Log one issue for each of them: checkmate log ${changeId} --build <build>, with the JSON on standard input in a quoted heredoc.`,
			'A defect that is in no issue is its own issue. To change an issue, log it again with "supersedes".',
			`Run checkmate merge ${changeId} --build <build> again to read the suggestions that remain.`,
		]
	return [
		`Run checkmate verify ${changeId} --build <build> to read the items to verify.`,
		'Reproduce each item on the running application.',
		'Log one observation for each item, with "confirms" or "refutes" and "saw": what you saw.',
		'Do not explore beyond the list.',
	]
}

export function journalSteps(changeId: string) {
	return [
		`Log what you did and saw: checkmate log ${changeId} --build <build>, with one entry or a JSON array on standard input in a quoted heredoc.`,
		'With a repository or a merge request, log each changed area that you tested as a note with "area".',
		`Then run checkmate gaps ${changeId} --build <build>. Its lines are ideas, not rules. checkmate show ${changeId} prints the record.`,
	]
}

export function fieldText(fields: Field[], described: Set<string>) {
	return fields
		.map((field) => {
			const name = `${field.path}${field.type.includes('|') ? ` (${field.type})` : ''}${field.required ? ' (required)' : ''}`
			if (described.has(field.description)) return `${name}.`
			described.add(field.description)
			return `${name}: ${field.description}`
		})
		.join(' ')
}

function entryText() {
	const schema = journalSchema()
	const described = new Set<string>()
	return [
		`${schema.about} Every entry has: ${fieldText(schema.common, described)}`,
		...schema.kinds.map((kind) => `Kind ${kind.kind}: ${kind.about} ${fieldText(kind.fields, described)}`),
	].join('\n')
}

export function recordText(store: Store, changeId: string, viewer?: string) {
	const state = changeState(store, changeId, viewer)
	const lines = [
		...state.criteria.map((criterion) => `criterion ${criterion.id}: ${criterion.text}`),
		...state.defects.map(
			(defect) =>
				`defect ${defect.id} (${defect.build}, ${defect.severity}): ${defect.title}${defect.verdicts.length ? `. Verdicts: ${defect.verdicts.map((verdict) => `${verdict.build}=${verdict.result}`).join(', ')}` : ''}`
		),
		...state.questions.map(
			(question) =>
				`question ${question.id} (${question.status}): ${question.question}${question.answer ? ` Answer: ${question.answer}` : ''}`
		),
	]
	return lines.length ? lines.join('\n') : 'No criterion, defect, or question yet.'
}

export function recorderPrompt(
	changeId: string,
	build: string | undefined,
	record = '<the criteria, defects with verdicts, and questions with answers of this change>'
) {
	return [
		`Now record this session in Checkmate, the QA record of the team (change ${changeId}${build ? `, build ${build}` : ''}).`,
		'Record what you did and found, your questions for the PM, and the answers that you received. Do not test again for the record, and do not change the files of the project. Do not repeat what the record already holds.',
		`Reply with only one JSON array of the new entries, and nothing else. Use no tool. Checkmate logs your reply${build ? ` with build ${build}` : ''}.`,
		'Number the new entries freely, for example N1, O1, D1. Use an ID of the record only to point at an entry of the record.',
		'Evidence is the path of a file that already exists, as the tester saved it, from the directory of the session, or the text that you saw.',
		'',
		'The entries:',
		entryText(),
		'',
		'Example of a reply:',
		JSON.stringify(journalSchema().example),
		'',
		'The record already holds:',
		record,
	].join('\n')
}

export function repairPrompt(refusals: string[]) {
	return [
		'Checkmate refused these entries of your reply:',
		...refusals.map((refusal) => `- ${refusal}`),
		'Reply with only one JSON array of the corrected entries, and nothing else. Do not send the saved entries again. Use no tool.',
	].join('\n')
}

export function guideJournal(
	store: Store,
	changeId: string | undefined,
	role: GuideRole = 'tester',
	viewer?: string,
	build?: string
) {
	const change = changeId ?? '<changeId>'
	if (role === 'recorder') {
		if (changeId !== undefined) changeState(store, changeId)
		return completed(changeId ?? 'guide', { format: 'text', content: recorderPrompt(change, build) })
	}
	if (role !== 'tester') {
		if (changeId !== undefined) changeState(store, changeId)
		return completed(changeId ?? 'guide', {
			steps: roleSteps(change, role),
			...(role === 'merger' ? mergerSchema() : verifierSchema()),
			command: `checkmate log ${change} --build b1`,
			answers: [],
			openDefects: [],
		})
	}
	const state = changeId === undefined ? undefined : changeState(store, changeId, viewer)
	return completed(changeId ?? 'guide', {
		steps: journalSteps(change),
		...journalSchema(),
		command: `checkmate log ${change} --build b1`,
		answers: (state?.questions ?? []).filter((question) => question.answer !== null),
		openDefects: (state?.defects ?? []).filter((defect) => state!.openDefects.includes(defect.id)),
	})
}
