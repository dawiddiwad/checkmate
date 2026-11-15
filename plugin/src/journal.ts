import type { Store } from './store.ts'
import { all, canonical, completed, digest, execute, one, write } from './store.ts'
import { Refusal, requireCondition, requireIdentifier, requireText, schemaErrors, unusedId } from './contracts.ts'
import { readEvidence } from './runs.ts'
import { findInstance, targetRequest } from './targets.ts'
import { normalised } from './lite.ts'
import { existsSync } from 'node:fs'
import { isAbsolute, relative, resolve } from 'node:path'

export const entryKinds = ['criterion', 'observation', 'defect', 'question', 'verdict', 'note'] as const
type Kind = (typeof entryKinds)[number] | 'answer' | 'decision'
type Evidence = { text: string } | { path: string; sha256: string; size: number }
export type Entry = {
	kind: Kind
	id: string
	build?: string
	supersedes?: string
	about?: string
	area?: string
	text?: string
	source?: string
	steps?: string | string[]
	saw?: string
	value?: string
	repeats?: string
	verdict?: 'ok' | 'wrong'
	via?: string
	title?: string
	expected?: string
	actual?: string
	severity?: string
	links?: string[]
	suspected?: boolean
	defect?: string
	result?: 'fixed' | 'not_fixed'
	evidence?: Evidence[]
	question?: string
	answer?: string
	decision?: 'accepted' | 'rejected'
	rationale?: string
	gaps?: number
}
type Row = Entry & { seq: number; actor: string; at: string }
type Journal = ReturnType<typeof journal>
export type Gap = { kind: string; subject: string; idea: string }

const prefixes: Record<Kind, string> = {
	criterion: 'C',
	observation: 'O',
	defect: 'D',
	question: 'Q',
	verdict: 'V',
	note: 'N',
	answer: 'A',
	decision: 'R',
}
const capabilityEntryPoints: Record<string, { via: string; idea: string }> = {
	browser: { via: 'ui', idea: 'Use the main flows in the browser, as a user does.' },
	http: { via: 'api', idea: 'Send the requests of the main flows to the API, also with invalid input.' },
}
const guideHint = (kind: string) => `Fix the named fields. Run checkmate journal guide to read the fields of ${kind}.`

function changeRow(store: Store, changeId: string) {
	const row = one<{ change_id: string; target_id: string; instance_id: string | null }>(
		store,
		'SELECT change_id, target_id, instance_id FROM changes WHERE change_id = ?',
		changeId
	)
	requireCondition(
		row,
		`Unknown change: ${changeId}.`,
		`Open it first: checkmate journal open ${changeId} --target <targetId>.`
	)
	return { changeId: row.change_id, targetId: row.target_id, instanceId: row.instance_id }
}

function journal(store: Store, changeId: string) {
	const opened = changeRow(store, changeId)
	const rows = all<{ seq: number; body: string; actor: string; at: string }>(
		store,
		`SELECT e.rowid AS seq, e.body, e.actor, o.at FROM journal_entries e JOIN operations o ON o.id = e.operation_id
		WHERE e.change_id = ? ORDER BY e.rowid`,
		changeId
	).map((row): Row => ({ ...JSON.parse(row.body), seq: row.seq, actor: row.actor, at: row.at }))
	const latest = new Map<string, Row>()
	for (const row of rows) latest.set(row.id, row)
	const named = [...new Set(rows.flatMap((row) => (row.build ? [row.build] : [])))]
	const builds = named.includes('base') ? ['base', ...named.filter((build) => build !== 'base')] : named
	const vias = targetRequest(store, opened.targetId).capabilities.flatMap((name) => capabilityEntryPoints[name] ?? [])
	return { ...opened, rows, entries: [...latest.values()], builds, vias }
}

const ofKind = (state: Journal, kind: Kind) => state.entries.filter((entry) => entry.kind === kind)
const words = (about: string | undefined) => (about ?? '').split(/[\s,;]+/).filter(Boolean)
const isAbout = (entry: Entry, id: string) => entry.about === id || words(entry.about).includes(id)
const sameValue = (a: string, b: string) => normalised(a) === normalised(b)

function answerOf(state: Journal, questionId: string) {
	return ofKind(state, 'answer')
		.filter((entry) => entry.question === questionId)
		.at(-1)
}

function openDefects(state: Journal) {
	const verdicts = ofKind(state, 'verdict')
	return ofKind(state, 'defect').filter(
		(defect) => verdicts.filter((verdict) => verdict.defect === defect.id).at(-1)?.result !== 'fixed'
	)
}

export function openChange(
	store: Store,
	actor: string | undefined,
	input: { changeId: string; target: string; instance?: string }
) {
	return write(store, { actor, command: 'journal open', subject: input.changeId, input }, (operationId) => {
		const changeId = requireIdentifier(input.changeId, 'change ID')
		targetRequest(store, input.target)
		if (input.instance !== undefined) findInstance(store, input.target, input.instance)
		requireCondition(
			!one(store, 'SELECT 1 FROM changes WHERE change_id = ?', changeId),
			`Change ${changeId} is open.`,
			`Run checkmate journal show ${changeId} to read it. Use a new change ID for another change.`
		)
		execute(
			store,
			'INSERT INTO changes (change_id, target_id, instance_id, operation_id) VALUES (?, ?, ?, ?)',
			changeId,
			input.target,
			input.instance ?? null,
			operationId
		)
		return {
			reply: completed(changeId, {
				changeId,
				targetId: input.target,
				instanceId: input.instance ?? null,
				next: [`Run checkmate journal guide ${changeId} to read how to log entries.`],
			}),
			subjects: [`change:${changeId}`],
		}
	})
}

function evidenceOf(store: Store, spec: string): Evidence {
	const name = isAbsolute(spec) ? relative(store.workspace, spec) : spec
	if (existsSync(resolve(store.workspace, name))) {
		const file = readEvidence(store, './', name)
		const sha256 = digest(file.bytes)
		execute(
			store,
			'INSERT OR IGNORE INTO blobs (sha256, size, bytes) VALUES (?, ?, ?)',
			sha256,
			file.bytes.length,
			file.bytes
		)
		return { path: name, sha256, size: file.bytes.length }
	}
	if (/\s/.test(spec.trim()) || !/[/\\]|\.[A-Za-z][A-Za-z0-9]{0,4}$/.test(spec)) return { text: spec }
	throw new Refusal(
		'malformed',
		`Evidence file not found: ${spec}`,
		'Save the file in the workspace first. Or give the text of what you saw.'
	)
}

function checkedEntry(
	store: Store,
	raw: unknown,
	path: string,
	build: string | undefined,
	known: Map<string, Entry>
): Entry {
	requireCondition(
		raw && typeof raw === 'object' && !Array.isArray(raw),
		`${path} is not a JSON object.`,
		'Send each entry as a JSON object with "kind".'
	)
	const draft = { ...(raw as Record<string, unknown>) }
	if (draft.build === undefined && build !== undefined) draft.build = build
	const errors = schemaErrors('journal-entry', draft, path)
	const kind = String(draft.kind)
	if (!errors.length) errors.push(...schemaErrors(`journal-${kind}`, draft, path))
	if (errors.length)
		throw new Refusal(
			'malformed',
			errors.join(', '),
			errors.some((error) => error.includes('"build"'))
				? 'Give the build in the entry, or with --build on the call.'
				: guideHint(kind)
		)
	const entry = draft as Omit<Entry, 'evidence'> & { evidence?: string | string[] }
	const used = [...known.keys()]
	if (entry.supersedes !== undefined) {
		const earlier = known.get(entry.supersedes)
		requireCondition(
			earlier?.kind === kind && (entry.id === undefined || entry.id === entry.supersedes),
			`${path}.supersedes names no earlier ${kind}: ${entry.supersedes}.`,
			`Use the ID of an earlier ${kind}, and leave out "id". Run checkmate journal show to read the IDs.`
		)
		entry.id = entry.supersedes
	} else if (entry.id !== undefined)
		requireCondition(
			!known.has(entry.id),
			`${path}.id ${entry.id} is in use.`,
			`To replace that entry, give "supersedes": "${entry.id}". Or use a new ID, for example ${unusedId(prefixes[entry.kind], used)}.`
		)
	else entry.id = unusedId(prefixes[entry.kind], used)
	const refer = (id: string | undefined, kinds: Kind[], field: string) =>
		requireCondition(
			id === undefined || kinds.includes(known.get(id)?.kind as Kind),
			`${path}.${field} names no ${kinds.join(' or ')}: ${id}.`,
			`Use the ID of an earlier ${kinds.join(' or ')}. Run checkmate journal show to read the IDs.`
		)
	refer(entry.defect, ['defect'], 'defect')
	refer(entry.repeats, ['observation'], 'repeats')
	for (const link of entry.links ?? []) refer(link, ['observation', 'criterion'], 'links')
	const { evidence, ...rest } = entry
	return {
		...rest,
		...(evidence === undefined ? {} : { evidence: [evidence].flat().map((spec) => evidenceOf(store, spec)) }),
	}
}

function comparison(entry: Entry, known: Map<string, Entry>) {
	const earlier = entry.repeats === undefined ? undefined : known.get(entry.repeats)
	if (!earlier || earlier.value === undefined || entry.value === undefined) return undefined
	return sameValue(earlier.value, entry.value)
		? `same as ${earlier.id} on ${earlier.build}: ${entry.value}`
		: `differs from ${earlier.id} on ${earlier.build}: "${earlier.value}", now "${entry.value}". Explain it with a note, or report a defect.`
}

function insert(store: Store, changeId: string, entry: Entry, actor: string, operationId: string) {
	execute(
		store,
		'INSERT INTO journal_entries (change_id, entry_id, kind, build, body, actor, operation_id) VALUES (?, ?, ?, ?, ?, ?, ?)',
		changeId,
		entry.id,
		entry.kind,
		entry.build ?? null,
		canonical(entry),
		actor,
		operationId
	)
}

export function logEntries(
	store: Store,
	actor: string | undefined,
	input: { changeId: string; build?: string; entries: unknown }
) {
	return write(store, { actor, command: 'journal log', subject: input.changeId, input }, (operationId, _, actor) => {
		const state = journal(store, input.changeId)
		const list = Array.isArray(input.entries) ? input.entries : [input.entries]
		requireCondition(list.length, 'The array has no entry.', 'Send one entry, or an array of entries.')
		const known = new Map<string, Entry>(state.entries.map((entry) => [entry.id, entry]))
		const saved: Array<{ index: number; id: string; kind: string; build: string | null; compare?: string }> = []
		const refused: Array<{ index: number; reason: string; hint?: string }> = []
		for (const [index, raw] of list.entries()) {
			let entry: Entry
			try {
				entry = checkedEntry(store, raw, `[${index}]`, input.build, known)
			} catch (error) {
				if (!(error instanceof Refusal)) throw error
				refused.push({ index, reason: error.message, hint: error.hint })
				continue
			}
			insert(store, state.changeId, entry, actor, operationId)
			const compare = comparison(entry, known)
			known.set(entry.id, entry)
			saved.push({
				index,
				id: entry.id,
				kind: entry.kind,
				build: entry.build ?? null,
				...(compare ? { compare } : {}),
			})
		}
		if (!saved.length)
			throw new Refusal(
				'malformed',
				refused.map((item) => item.reason).join(' '),
				[...new Set(refused.flatMap((item) => item.hint ?? []))].join(' ')
			)
		return {
			reply: completed(state.changeId, { saved, refused }),
			subjects: [`change:${state.changeId}`],
		}
	})
}

function rootOf(entry: Entry, byId: Map<string, Entry>) {
	let at = entry
	const seen = new Set<string>()
	while (at.repeats && byId.has(at.repeats) && !seen.has(at.id)) {
		seen.add(at.id)
		at = byId.get(at.repeats)!
	}
	return at
}

function gapList(state: Journal, build: string): Gap[] {
	const gaps: Gap[] = []
	const add = (kind: string, subject: string, idea: string) => gaps.push({ kind, subject, idea })
	const order = (entry: Entry) => state.builds.indexOf(entry.build ?? '')
	const position = state.builds.includes(build) ? state.builds.indexOf(build) : state.builds.length
	const earlier = (entry: Entry) => entry.build !== undefined && order(entry) >= 0 && order(entry) < position
	const observations = ofKind(state, 'observation')
	const here = observations.filter((entry) => entry.build === build)
	const defects = ofKind(state, 'defect')
	const notes = ofKind(state, 'note')
	const explained = (id: string) =>
		defects.some((defect) => defect.links?.includes(id)) || notes.some((note) => isAbout(note, id))
	const criteria = ofKind(state, 'criterion')
	if (!here.length) add('build', build, `No observation on ${build} yet. Test it and log what you see.`)
	if (build !== 'base') {
		if (!criteria.length)
			add(
				'criteria',
				'no criterion',
				'You can log the rules of the ticket and the docs as criterion entries. Then gaps shows what each rule still needs.'
			)
		for (const criterion of criteria) {
			const seen = here.filter((entry) => isAbout(entry, criterion.id))
			const subject = `${criterion.id} ${criterion.text}`
			if (!seen.length)
				add(
					'criterion',
					subject,
					`No observation on ${build}. Test it and log an observation with "about": "${criterion.id}".`
				)
			else if (seen.length === 1 || seen.every((entry) => entry.verdict === 'ok'))
				add(
					'happy_path',
					subject,
					`${seen.length === 1 ? 'One observation' : 'Only ok observations'}. Try a boundary value, invalid input, the other entry point, or the state after a change.`
				)
		}
		for (const question of ofKind(state, 'question')) {
			const answer = answerOf(state, question.id)
			if (answer && !here.some((entry) => isAbout(entry, question.id)))
				add(
					'answer',
					`${question.id} ${answer.answer}`,
					`No observation on ${build} uses this PM answer. Test it and log an observation with "about": "${question.id}".`
				)
		}
	}
	const byId = new Map<string, Entry>(observations.map((entry) => [entry.id, entry]))
	for (const baseline of observations.filter(
		(entry) => entry.value !== undefined && !entry.repeats && earlier(entry)
	)) {
		const chain = observations.filter((entry) => rootOf(entry, byId).id === baseline.id)
		const now = chain.filter((entry) => entry.build === build)
		const steps = [baseline.steps ?? baseline.saw].flat().join(' ')
		if (!now.length) {
			add(
				'baseline',
				`${baseline.id} on ${baseline.build}: ${baseline.value}`,
				`Do it again on ${build}: ${steps}. Log an observation with "repeats": "${baseline.id}" and "value".`
			)
			continue
		}
		const previous = chain
			.filter((entry) => entry.value !== undefined && earlier(entry))
			.sort((a, b) => order(a) - order(b))
			.at(-1)!
		for (const entry of now.filter((item) => item.value !== undefined))
			if (!sameValue(entry.value!, previous.value!) && !explained(entry.id))
				add(
					'difference',
					`${entry.id} repeats ${baseline.id}: ${previous.build} "${previous.value}", ${build} "${entry.value}"`,
					`Explain or report: log a note with "about": "${entry.id}", or a defect with "links": ["${entry.id}"].`
				)
	}
	const verdicts = ofKind(state, 'verdict')
	for (const defect of defects.filter(earlier)) {
		const of = verdicts.filter((verdict) => verdict.defect === defect.id)
		if (of.some((verdict) => verdict.build === build)) continue
		if (of.some((verdict) => verdict.result === 'fixed' && earlier(verdict))) continue
		add(
			'retest',
			`${defect.id} ${defect.title}`,
			`Do its steps again on ${build}. Log a verdict with "defect": "${defect.id}", the result, and evidence.`
		)
	}
	for (const defect of defects.filter((entry) => entry.build === build && !entry.evidence?.length))
		add(
			'evidence',
			`${defect.id} ${defect.title}`,
			`No evidence. Log it again with "supersedes": "${defect.id}" and "evidence".`
		)
	for (const entry of here.filter((item) => item.verdict === 'wrong' && !explained(item.id)))
		add(
			'wrong',
			`${entry.id} ${entry.saw}`,
			`Marked wrong without a defect. Log a defect with "links": ["${entry.id}"], or a note with "about": "${entry.id}" that says why not.`
		)
	for (const { via, idea } of state.vias)
		if (!here.some((entry) => entry.via === via))
			add('entry_point', `no observation on ${build} used the ${via.toUpperCase()}`, idea)
	if (build !== 'base')
		for (const area of new Set([...criteria, ...notes].flatMap((entry) => entry.area ?? []))) {
			const ids = criteria.filter((entry) => entry.area === area).map((entry) => entry.id)
			if (!here.some((entry) => entry.about?.includes(area) || ids.some((id) => isAbout(entry, id))))
				add(
					'area',
					area,
					`No observation on ${build} is about this changed area. Read its diff and test what it changes.`
				)
		}
	return gaps
}

function buildOf(state: Journal, build: string | undefined) {
	return build ?? state.builds.at(-1) ?? 'base'
}

export function changeGaps(store: Store, changeId: string, build?: string) {
	const state = journal(store, changeId)
	const tested = buildOf(state, build)
	return completed(state.changeId, { build: tested, gaps: gapList(state, tested) })
}

export function answerQuestion(
	store: Store,
	actor: string | undefined,
	input: { changeId: string; questionId: string; answer: string }
) {
	return write(
		store,
		{ actor, command: 'journal answer', subject: input.changeId, input },
		(operationId, _, actor) => {
			const state = journal(store, input.changeId)
			const question = ofKind(state, 'question').find((entry) => entry.id === input.questionId)
			requireCondition(
				question,
				`Unknown question: ${input.questionId}.`,
				`Use one of: ${
					ofKind(state, 'question')
						.map((entry) => entry.id)
						.join(', ') || 'no question yet'
				}.`
			)
			const entry: Entry = {
				kind: 'answer',
				id: unusedId(
					'A',
					state.entries.map((item) => item.id)
				),
				question: question.id,
				answer: requireText(input.answer, 'answer (--answer)'),
			}
			insert(store, state.changeId, entry, actor, operationId)
			return {
				reply: completed(state.changeId, { id: entry.id, question: question.id }),
				subjects: [`change:${state.changeId}`],
			}
		}
	)
}

export function decideBuild(
	store: Store,
	actor: string | undefined,
	input: { changeId: string; build: string; decision: 'accepted' | 'rejected'; rationale: string }
) {
	const command = input.decision === 'accepted' ? 'journal accept' : 'journal reject'
	return write(store, { actor, command, subject: input.changeId, input }, (operationId, _, actor) => {
		const state = journal(store, input.changeId)
		requireCondition(
			state.builds.includes(input.build),
			`Build ${input.build} has no entry in change ${state.changeId}.`,
			`Use one of: ${state.builds.join(', ') || 'no build yet'}.`
		)
		const gaps = gapList(state, input.build)
		const entry: Entry = {
			kind: 'decision',
			id: unusedId(
				'R',
				state.entries.map((item) => item.id)
			),
			build: input.build,
			decision: input.decision,
			rationale: requireText(input.rationale, 'rationale (--rationale)'),
			gaps: gaps.length,
		}
		insert(store, state.changeId, entry, actor, operationId)
		return {
			reply: completed(state.changeId, { id: entry.id, build: input.build, decision: input.decision, gaps }),
			subjects: [`change:${state.changeId}`],
		}
	})
}

function matrix(state: Journal) {
	const observations = ofKind(state, 'observation')
	const criteria = ofKind(state, 'criterion')
	const free = observations.filter((entry) => !criteria.some((criterion) => isAbout(entry, criterion.id)))
	const rows = [
		...criteria.map((criterion) => ({
			about: criterion.id,
			of: observations.filter((entry) => isAbout(entry, criterion.id)),
		})),
		...[...new Set(free.map((entry) => entry.about ?? '-'))].map((about) => ({
			about,
			of: free.filter((entry) => (entry.about ?? '-') === about),
		})),
	]
	return rows.map(({ about, of }) => {
		const cells = Object.fromEntries(
			state.builds.map((build) => {
				const seen = of.filter((entry) => entry.build === build)
				const count = (verdict: string | undefined) => seen.filter((entry) => entry.verdict === verdict).length
				return [build, { ok: count('ok'), wrong: count('wrong'), seen: count(undefined) }]
			})
		)
		return { about, cells }
	})
}

function questionList(state: Journal) {
	return ofKind(state, 'question').map((question) => {
		const answer = answerOf(state, question.id)
		return {
			id: question.id,
			question: question.question!,
			status: answer ? 'answered' : 'open',
			answer: answer?.answer ?? null,
		}
	})
}

function defectList(state: Journal) {
	const verdicts = ofKind(state, 'verdict')
	return ofKind(state, 'defect').map((defect) => ({
		id: defect.id,
		build: defect.build!,
		severity: defect.severity!,
		title: defect.title!,
		suspected: defect.suspected ?? false,
		verdicts: verdicts
			.filter((verdict) => verdict.defect === defect.id)
			.map((verdict) => ({ id: verdict.id, build: verdict.build!, result: verdict.result! })),
	}))
}

export function changeState(store: Store, changeId: string) {
	const state = journal(store, changeId)
	return {
		changeId: state.changeId,
		targetId: state.targetId,
		instanceId: state.instanceId,
		builds: state.builds,
		criteria: ofKind(state, 'criterion').map(({ id, text, source }) => ({ id, text: text!, source: source! })),
		matrix: matrix(state),
		defects: defectList(state),
		openDefects: openDefects(state).map((defect) => defect.id),
		questions: questionList(state),
		decisions: ofKind(state, 'decision').map(({ id, build, decision, rationale, gaps }) => ({
			id,
			build: build!,
			decision: decision!,
			rationale: rationale!,
			gaps: gaps!,
		})),
	}
}

export function showChange(store: Store, changeId: string) {
	const state = changeState(store, changeId)
	return completed(state.changeId, state)
}

export function exportChange(store: Store, changeId: string) {
	const state = journal(store, changeId)
	const record = {
		...changeState(store, changeId),
		entries: state.entries,
		history: state.rows,
		gaps: Object.fromEntries(state.builds.map((build) => [build, gapList(state, build)])),
	}
	return JSON.stringify(record, null, '\t') + '\n'
}
