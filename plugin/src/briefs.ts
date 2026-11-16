import type { Charter } from './explorations.ts'
import entrySchema from '../contracts/journal-entry.schema.json' with { type: 'json' }
import criterionSchema from '../contracts/journal-criterion.schema.json' with { type: 'json' }
import observationSchema from '../contracts/journal-observation.schema.json' with { type: 'json' }
import defectSchema from '../contracts/journal-defect.schema.json' with { type: 'json' }
import questionSchema from '../contracts/journal-question.schema.json' with { type: 'json' }
import verdictSchema from '../contracts/journal-verdict.schema.json' with { type: 'json' }
import noteSchema from '../contracts/journal-note.schema.json' with { type: 'json' }
import issueSchema from '../contracts/journal-issue.schema.json' with { type: 'json' }

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
type Field = { path: string; type: string; required: boolean; description: string }

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
const commonFields = ['kind', 'id', 'build', 'supersedes']
const teamFields = ['confirms', 'refutes']
const recordedKinds = ['criterion', 'observation', 'defect', 'question', 'verdict', 'note']

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

function fieldText(fields: Field[], described: Set<string>) {
	return fields
		.map((field) => {
			const name = `${field.path}${field.type.includes('|') ? ` (${field.type})` : ''}${field.required ? ' (required)' : ''}`
			if (described.has(field.description)) return `${name}.`
			described.add(field.description)
			return `${name}: ${field.description}`
		})
		.join(' ')
}

function kindText(kind: string, keep: (field: Field) => boolean, described: Set<string>) {
	const file = `journal-${kind}.schema.json`
	const fields = fieldsOf(files[file], file, '').filter((field) => !commonFields.includes(field.path) && keep(field))
	return `Kind ${kind}: ${files[file].description} ${fieldText(fields, described)}`
}

function commonText(kinds: string[], described: Set<string>) {
	const file = 'journal-entry.schema.json'
	const fields = fieldsOf(files[file], file, '')
		.filter((field) => field.path !== 'build')
		.map((field) => (field.path === 'kind' ? { ...field, type: kinds.join('|') } : field))
	return `${files[file].description} Every entry has: ${fieldText(fields, described)}`
}

export function entryText(
	kinds = recordedKinds,
	keep: (field: Field) => boolean = (field) => !teamFields.includes(field.path)
) {
	const described = new Set<string>()
	return [commonText(kinds, described), ...kinds.map((kind) => kindText(kind, keep, described))].join('\n')
}

export function recorderPrompt(build: string, record: string) {
	return [
		`Now write the record of this test session for the QA record of the team (build ${build}).`,
		'Record what you did and found, your questions for the product owner, and the answers that you received. Do not test again for the record, and do not change the files of the project. Do not repeat what the record already holds.',
		'Reply with only one JSON array of the new entries, and nothing else. Use no tool.',
		'Number the new entries freely, for example N1, O1, D1. Use an ID of the record only to point at an entry of the record.',
		'Evidence is the path of a file that already exists, as the tester saved it, from the directory of the session, or the text that you saw.',
		'',
		'The entries:',
		entryText(),
		'',
		'Example of a reply:',
		JSON.stringify(entrySchema.examples[0]),
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

export type EntryPointValue = { name: string; kind: string; purpose: string; value: string }

function entryPointLine(entry: EntryPointValue) {
	if (entry.kind === 'command')
		return `- ${entry.name}: run \`${entry.value}\` when you need it. ${entry.purpose} Do not write its output in your notes.`
	return `- ${entry.name}: ${entry.value}. ${entry.purpose}`
}

export function explorerBrief(
	charter: Charter,
	entries: EntryPointValue[],
	dataPrefix: string,
	evidenceFolder: string
) {
	return [
		'Test this change of the application and find its defects.',
		'',
		`Goal: ${charter.goal}`,
		...(charter.requirements.length
			? ['', 'Rules of the change:', ...charter.requirements.map((item) => `- ${item.id}: ${item.text}`)]
			: []),
		...(charter.sources.length ? ['', `Read: ${charter.sources.join(', ')}`] : []),
		...(charter.instructions ? ['', charter.instructions] : []),
		...(charter.scope.length ? ['', 'Changed files:', ...charter.scope.map((path) => `- ${path}`)] : []),
		'',
		'The application:',
		...entries.map(entryPointLine),
		'',
		`You can: ${charter.operations.join(', ')}. Do not change the code, the configuration, or the deployment of the application.`,
		...(charter.tools.length
			? [`Tools: ${charter.tools.map((tool) => `${tool.name} (${tool.purpose})`).join('; ')}`]
			: []),
		`Make your own test data. Start each name or value that you make with ${dataPrefix}.`,
		`Save the files that show a problem, for example screenshots or responses, in ${evidenceFolder}/.`,
		'At the end, list what you tested and each problem that you found, with its steps.',
	].join('\n')
}
