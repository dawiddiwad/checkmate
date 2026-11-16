import type { Charter } from './explorations.ts'
import { anyTestOperation, anyTestOperationText } from './targets.ts'
import entrySchema from '../contracts/journal-entry.schema.json' with { type: 'json' }
import criterionSchema from '../contracts/journal-criterion.schema.json' with { type: 'json' }
import observationSchema from '../contracts/journal-observation.schema.json' with { type: 'json' }
import defectSchema from '../contracts/journal-defect.schema.json' with { type: 'json' }
import questionSchema from '../contracts/journal-question.schema.json' with { type: 'json' }
import verdictSchema from '../contracts/journal-verdict.schema.json' with { type: 'json' }
import noteSchema from '../contracts/journal-note.schema.json' with { type: 'json' }
import issueSchema from '../contracts/journal-issue.schema.json' with { type: 'json' }
import topicSchema from '../contracts/journal-topic.schema.json' with { type: 'json' }

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
	'journal-topic.schema.json': topicSchema as Schema,
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

export function recorderPrompt(build: string, record: string, saved: string[] = []) {
	return [
		`Now write the record of this test session for the QA record of the team (build ${build}).`,
		'Record what you did and found, your questions for the product owner, and the answers that you received. Do not test again for the record, and do not change the files of the project. Do not repeat what the record already holds.',
		'Reply with only one JSON array of the new entries, and nothing else. Use no tool.',
		'Number the new entries freely, for example N1, O1, D1. Use an ID of the record only to point at an entry of the record.',
		'Evidence is the path of a file that already exists, as the tester saved it, from the directory of the session, or the text that you saw.',
		'When the session retested a defect of an earlier build, log a verdict with the ID of that defect: fixed or not_fixed.',
		'',
		'The entries:',
		entryText(),
		'',
		'Example of a reply:',
		JSON.stringify(entrySchema.examples[0]),
		'',
		'The record already holds:',
		record,
		...(saved.length
			? [
					'',
					'This session was recorded before. The record already holds these entries of the session. Reply with only the entries that are not in this list:',
					...saved,
				]
			: []),
	].join('\n')
}

export function followBrief(
	questions: Array<{ question: string; answer: string }>,
	workFolder: string,
	seconds: number
) {
	return [
		'The owner of the product answered these questions:',
		...questions.map((item, index) => `${index + 1}. ${item.question} Answer: ${item.answer}`),
		'',
		'Test the points that these answers decide, on the same build.',
		`Your work folder is ${workFolder}/ again, and it is empty. Put each file that you or your tools make in it.`,
		`Write ${workFolder}/follow-up-report.md with only what this turn adds: each new defect in the same form as in your report, and for each earlier unclear point that an answer settles, one line that says what is now known.`,
		`You have ${seconds} seconds for this turn.`,
	].join('\n')
}

export function repairPrompt(refusals: string[]) {
	return [
		'Checkmate refused these entries of your reply:',
		...refusals.map((refusal) => `- ${refusal}`),
		'Reply with only one JSON array of the corrected entries, and nothing else. Do not send the saved entries again. Use no tool.',
	].join('\n')
}

function operationText(operations: string[]) {
	return operations.includes(anyTestOperation) ? anyTestOperationText : `You can: ${operations.join(', ')}.`
}

export type EntryPointValue = { name: string; kind: string; purpose: string; value: string }

function entryPointLine(entry: EntryPointValue) {
	if (entry.kind === 'command')
		return `- ${entry.name}: run \`${entry.value}\` when you need it. ${entry.purpose} Do not write its output in your notes.`
	return `- ${entry.name}: ${entry.value}. ${entry.purpose}`
}

function testDataText(dataPrefix: string) {
	return `Use the existing records of the application, and make new records when a case needs them. Start each name or value that you make with ${dataPrefix}.`
}

export function explorerBrief(
	charter: Charter,
	entries: EntryPointValue[],
	dataPrefix: string,
	workFolder: string,
	seconds: { study: number; test: number }
) {
	const change = charter.change
	const diff = change
		? [
				`The code of the change is shown by git diff ${change.range.join(' ')} in ${change.repo === '.' ? 'the workspace' : `the folder ${change.repo}`}.`,
				...(change.checkedOut
					? []
					: ['The checked-out files are the version before the change, and the diff shows the change.']),
				'Read the diff first. Test what the diff changes and what depends on it.',
			]
		: []
	const study = [
		'A change of the application is ready for test. Study it before you test.',
		'',
		`Goal: ${charter.goal}`,
		...(charter.requirements.length
			? ['', 'Rules of the change:', ...charter.requirements.map((item) => `- ${item.id}: ${item.text}`)]
			: []),
		...(charter.sources.length ? ['', `Read: ${charter.sources.join(', ')}`] : []),
		...(charter.instructions ? ['', charter.instructions] : []),
		...(charter.scope.length ? ['', 'Changed files:', ...charter.scope.map((path) => `- ${path}`)] : []),
		...(diff.length ? ['', ...diff] : []),
		...(charter.knownState
			? [
					'',
					`Read ${charter.knownState}. It has the results of earlier builds. Retest each open problem in it, and say for each one if it is still there or fixed.`,
				]
			: []),
		'',
		'The application:',
		...entries.map(entryPointLine),
		'',
		`${operationText(charter.operations)} Do not change the code, the configuration, or the deployment of the application.`,
		...(charter.tools.length
			? [
					`Tools you can use: ${charter.tools
						.map((tool) => tool.name)
						.sort()
						.join(', ')}.`,
				]
			: []),
		'A direct HTTP call is sufficient when it proves the behaviour. Use the browser when the page itself is what you test.',
		`Your work folder is ${workFolder}/. Put each file that you or your tools make in it, for example notes, scripts, screenshots, responses, and logs.`,
		'Apart from your work folder, the folders in the workspace whose names start with a dot belong to tools, not to the product under test.',
		'',
		'Study the sources, the changed files and the running application.',
		`Write ${workFolder}/plan.md with your test approach.`,
		`Write ${workFolder}/questions.md with numbered questions for the owner of the product about anything unclear, one question for each numbered line, or None.`,
		'Do not test the change in this turn.',
		`You have ${seconds.study} seconds for this turn. Write the two files early and update them as you go.`,
	]
	const test = [
		'Now test the change and the existing behaviour that it can break.',
		'The owner of the product has not answered your questions yet. Use the sources where they decide the point, and report the rest as unclear.',
		...diff,
		testDataText(dataPrefix),
		`Save the files that show a problem, for example screenshots or responses, in ${workFolder}/.`,
		`Write ${workFolder}/report.md: one section for each defect with title, severity, steps, expected result, actual result and evidence files. Number the defects D1, D2, and so on. List also what you tested and what is still unclear.`,
		...(charter.knownState
			? [
					`For each problem in ${charter.knownState}, write one line in the report: still present, fixed, or not retested with the reason.`,
				]
			: []),
		`You have ${seconds.test} seconds for this turn. Write the report early and update it as you go.`,
	]
	return { study: study.join('\n'), test: test.join('\n') }
}

type MergeReport = { id: string; severity: string; title: string; expected: string; actual: string; steps: string }

export function mergerPrompt(
	build: string,
	reports: MergeReport[],
	groups: string[][],
	questions: Array<{ id: string; question: string }> = [],
	earlier: Array<{ id: string; reports: string[]; title: string; expected: string; actual: string }> = []
) {
	return [
		`Merge the reports of independent testers of build ${build}. Do not test.`,
		'Two defect reports are one defect when they have the same trigger and the same wrong result. Do not combine two reports with different expected results or different triggers. A report that is in no issue stays its own defect.',
		'Two questions are one topic when one answer answers both. A question that is in no topic stays its own question.',
		'Reply with only one JSON array of issue and topic entries, one for each defect that two or more reports describe and one for each question that two or more questions ask, and nothing else. Use no tool. Reply [] when nothing is the same.',
		'',
		entryText(['issue', 'topic'], () => true),
		'',
		'Example of entries:',
		JSON.stringify([issueSchema.examples[0], topicSchema.examples[0]]),
		...(reports.length
			? [
					'',
					'The defect reports:',
					...reports.map(
						(report) =>
							`${report.id} (${report.severity}): ${report.title} Expected: ${report.expected} Actual: ${report.actual}${report.steps ? ` Steps: ${report.steps}` : ''}`
					),
				]
			: []),
		...(groups.length
			? [
					'',
					'Reports with many of the same words. These are ideas, not rules:',
					...groups.map((group) => `- ${group.join(', ')}`),
				]
			: []),
		...(questions.length
			? ['', 'The questions:', ...questions.map((question) => `${question.id}: ${question.question}`)]
			: []),
		...(earlier.length
			? [
					'',
					'The issues found before. When a report of this build describes one of them, send an issue with the reports of that issue and the new report. For an issue of the merger, give "supersedes" with its ID. Do not open a new issue for it.',
					...earlier.map(
						(item) =>
							`${item.id}${item.reports.length > 1 || item.reports[0] !== item.id ? ` (reports ${item.reports.join(', ')})` : ''}: ${item.title} Expected: ${item.expected} Actual: ${item.actual}`
					),
				]
			: []),
	].join('\n')
}

type Unplaced = { report: string; title: string; like: Array<{ id: string; title: string; reason: string }> }

export function mergeAgainPrompt(unplaced: Unplaced[]) {
	return [
		'These reports are in no issue, but they look like other reports or issues:',
		...unplaced.map(
			(item) =>
				`- ${item.report}: ${item.title} Looks like: ${item.like.map((like) => `${like.id} (${like.title}; ${like.reason})`).join(', ')}`
		),
		'For each report that is the same defect as one of them, send an issue entry with all its reports. For an issue of the merger, give "supersedes" with its ID. Reply with only one JSON array of entries, and nothing else. Use no tool. Reply [] when none is the same.',
	].join('\n')
}

type VerifyItem = { id: string; title: string; expected: string; actual: string; steps: string | string[] | null }

export function verifierBrief(
	items: VerifyItem[],
	entries: EntryPointValue[],
	operations: string[],
	dataPrefix: string
) {
	return [
		'Reproduce each problem below on the application. Do not test other things.',
		'',
		'The application:',
		...entries.map(entryPointLine),
		'',
		`${operationText(operations)} Do not change the code, the configuration, or the deployment of the application.`,
		testDataText(dataPrefix),
		'',
		'The problems:',
		...items.map(
			(item) =>
				`- ${item.id}: ${item.title} Steps: ${[item.steps ?? 'not given'].flat().join(' ')} Expected: ${item.expected} Reported: ${item.actual}`
		),
		'',
		'At the end, reply with only one JSON array, with one object for each problem: {"id": "<the ID of the problem>", "seen": true when you saw the problem again, else false, "saw": "what you saw"}.',
	].join('\n')
}
