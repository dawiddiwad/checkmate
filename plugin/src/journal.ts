import type { Store } from './store.ts'
import { all, canonical, completed, digest, execute, one, write } from './store.ts'
import {
	Refusal,
	requireCondition,
	requireIdentifier,
	requireText,
	requireWellFormed,
	schemaProblems,
	unusedId,
} from './contracts.ts'
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
	linked?: string
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
type Journal = Omit<ReturnType<typeof journal>, 'entries'> & { entries: Entry[] }
export type Gap = { kind: string; subject: string; idea: string }
type Fix = Record<string, unknown>

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
const jsonHint = 'Use double quotes for keys and strings. Put a backslash before each quote inside a string.'
const openEnd =
	/\b(not (yet )?(tested|verified|captured|covered|tried|exercised)|untested|unverified|skipped|todo|to-do|tbd|did ?n[o']t (test|try|check|verify))\b/i
const sourceWords = new Set(
	'nodecision not decided yet use follow see refer read check the a an and or to existing current ticket tickets doc docs documentation spec specs specification as written is per of in on answer none unknown n/a na pm only rely says say'.split(
		' '
	)
)
const sourceMarkers = [
	'nodecision',
	'decided',
	'ticket',
	'tickets',
	'doc',
	'docs',
	'documentation',
	'spec',
	'specs',
	'specification',
	'unknown',
	'none',
]
const viaNames: Record<string, string> = { ui: 'the UI', api: 'the API', code: 'the code', other: 'other means' }
const fewBaselines = 3

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
	if (/\s|:\/\//.test(spec.trim()) || !/[/\\]|\.[A-Za-z][A-Za-z0-9]{0,4}$/.test(spec)) return { text: spec }
	throw new Refusal(
		'malformed',
		`Evidence file not found: ${spec}`,
		'Save the file in the workspace first. Or give the text of what you saw.'
	)
}

export class Unreadable {
	reason: string
	text: string
	constructor(reason: string, text: string) {
		this.reason = reason
		this.text = text
	}
}

class EntryRefusal extends Refusal {
	field: string
	fix: Fix | undefined
	constructor(field: string, message: string, hint: string, fix?: Fix) {
		super('malformed', message, hint)
		this.field = field
		this.fix = fix
	}
}

function unfenced(text: string) {
	const fenced = /^\s*```[\w-]*[ \t]*\n([\s\S]*?)\n\s*```\s*$/.exec(text)
	return fenced ? fenced[1] : text
}

function withoutTrailingCommas(text: string) {
	const closing = /\s*[}\]]/y
	let out = ''
	let quoted = false
	for (let i = 0; i < text.length; i++) {
		const char = text[i]
		if (quoted) {
			out += char
			if (char === '\\') out += text[++i] ?? ''
			else if (char === '"') quoted = false
			continue
		}
		if (char === '"') quoted = true
		closing.lastIndex = i + 1
		if (char === ',' && closing.test(text)) continue
		out += char
	}
	return out
}

function topLevelParts(text: string) {
	const found: string[] = []
	let depth = 0
	let quoted = false
	let start = 0
	for (let i = 0; i < text.length; i++) {
		const char = text[i]
		if (quoted) {
			if (char === '\\') i++
			else if (char === '"') quoted = false
			continue
		}
		if (char === '"') quoted = true
		else if (char === '{' || char === '[') depth++
		else if (char === '}' || char === ']') depth--
		const closed = depth === 0 && (char === '}' || char === ']')
		if (closed || (depth === 0 && char === ',')) {
			found.push(text.slice(start, closed ? i + 1 : i))
			start = i + 1
		}
	}
	found.push(text.slice(start))
	return found.map((part) => part.trim()).filter(Boolean)
}

export function readEntries(text: string): unknown {
	requireWellFormed(
		text.trim().length > 0,
		'Missing JSON payload on standard input',
		"Send the entries on standard input, in a quoted heredoc: checkmate journal log <changeId> --build <build> <<'EOF', the JSON, then EOF"
	)
	const body = withoutTrailingCommas(unfenced(text)).trim()
	try {
		return JSON.parse(body)
	} catch (error) {
		const parts = topLevelParts(body.startsWith('[') && body.endsWith(']') ? body.slice(1, -1) : body)
		if (parts.length < 2)
			throw new Refusal('malformed', `Standard input is not valid JSON: ${(error as Error).message}`, jsonHint)
		return parts.flatMap((part) => {
			try {
				return [JSON.parse(part)].flat()
			} catch (error) {
				return [new Unreadable((error as Error).message, part)]
			}
		})
	}
}

function entryList(entries: unknown): unknown[] {
	if (Array.isArray(entries)) return entries
	const wrapper = entries as { kind?: unknown; entries?: unknown } | null
	if (wrapper && typeof wrapper === 'object' && wrapper.kind === undefined && Array.isArray(wrapper.entries))
		return wrapper.entries
	return [entries]
}

function checkedEntry(
	store: Store,
	raw: unknown,
	path: string,
	build: string | undefined,
	known: Map<string, Entry>
): Entry {
	if (raw instanceof Unreadable)
		throw new EntryRefusal(
			path,
			`${path} is not valid JSON (${raw.reason}): ${raw.text.slice(0, 80)}`,
			`${jsonHint} Send this entry again.`
		)
	if (!raw || typeof raw !== 'object' || Array.isArray(raw))
		throw new EntryRefusal(path, `${path} is not a JSON object.`, 'Send each entry as a JSON object with "kind".', {
			kind: entryKinds.join('|'),
		})
	const given = raw as Fix
	const draft = { ...given }
	if (draft.build === undefined && build !== undefined) draft.build = build
	const problems = schemaProblems('journal-entry', draft, path)
	const kind = String(draft.kind)
	if (!problems.length) problems.push(...schemaProblems(`journal-${kind}`, draft, path))
	if (problems.length) {
		const fix = { ...given }
		for (const problem of problems)
			if (problem.unknown) delete fix[problem.field]
			else fix[problem.field] = problem.choices?.join('|') ?? `<${problem.field}>`
		throw new EntryRefusal(
			[...new Set(problems.map((problem) => `${path}.${problem.field}`))].join(', '),
			problems.map((problem) => problem.text).join(', '),
			problems.some((problem) => problem.field === 'build')
				? 'Give the build in the entry, or with --build on the call.'
				: guideHint(kind),
			fix
		)
	}
	const entry = draft as Omit<Entry, 'evidence'> & { evidence?: string | string[] }
	const used = [...known.keys()]
	if (entry.supersedes !== undefined) {
		const earlier = known.get(entry.supersedes)
		if (earlier?.kind !== kind || (entry.id !== undefined && entry.id !== entry.supersedes)) {
			const { supersedes: _, ...fix } = given
			throw new EntryRefusal(
				`${path}.supersedes`,
				`${path}.supersedes names no earlier ${kind}: ${entry.supersedes}.`,
				`Use the ID of an earlier ${kind}, and leave out "id". Run checkmate journal show to read the IDs.`,
				fix
			)
		}
		entry.id = entry.supersedes
	} else if (entry.id !== undefined) {
		if (known.has(entry.id)) {
			const free = unusedId(prefixes[entry.kind], used)
			throw new EntryRefusal(
				`${path}.id`,
				`${path}.id ${entry.id} is in use.`,
				`To replace that entry, give "supersedes": "${entry.id}". Or use a new ID, for example ${free}.`,
				{ ...given, id: free }
			)
		}
	} else entry.id = unusedId(prefixes[entry.kind], used)
	const refer = (id: string | undefined, kinds: Kind[], field: string, fix: unknown) => {
		if (id === undefined || kinds.includes(known.get(id)?.kind as Kind)) return
		throw new EntryRefusal(
			`${path}.${field}`,
			`${path}.${field} names no ${kinds.join(' or ')}: ${id}.`,
			`Use the ID of an earlier ${kinds.join(' or ')}. Run checkmate journal show to read the IDs.`,
			{ ...given, [field]: fix }
		)
	}
	const idsOf = (kinds: Kind[]) =>
		[...known.values()]
			.filter((item) => kinds.includes(item.kind))
			.map((item) => item.id)
			.slice(-6)
			.join('|') || `<${kinds.join(' or ')} ID>`
	refer(entry.defect, ['defect'], 'defect', idsOf(['defect']))
	if (entry.repeats !== 'none') refer(entry.repeats, ['observation'], 'repeats', idsOf(['observation']))
	const links = entry.links ?? []
	const linkable: Kind[] = ['observation', 'criterion']
	for (const link of links)
		refer(
			link,
			linkable,
			'links',
			links.filter((item) => linkable.includes(known.get(item)?.kind as Kind))
		)
	const { evidence, ...rest } = entry
	if (evidence === undefined) return rest
	try {
		return { ...rest, evidence: [evidence].flat().map((spec) => evidenceOf(store, spec)) }
	} catch (error) {
		if (!(error instanceof Refusal)) throw error
		throw new EntryRefusal(`${path}.evidence`, error.message, error.hint ?? '', {
			...given,
			evidence: '<a file in the workspace, or the text that you saw>',
		})
	}
}

const stepsOf = (entry: Entry) => normalised([entry.steps ?? []].flat().join(' ').toLowerCase())
const aboutOf = (entry: Entry) => normalised((entry.about ?? '').toLowerCase())
const escaped = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
const stemOf = (entry: Entry) => entry.id.replace(new RegExp(`[-_.]${escaped(entry.build ?? '')}$`, 'i'), '')

function baselineMatch(entry: Entry, known: Map<string, Entry>, builds: string[]) {
	const position = builds.indexOf(entry.build ?? '')
	const order = (item: Entry) => builds.indexOf(item.build ?? '')
	const observations = [...known.values()].filter((item) => item.kind === 'observation')
	const byId = new Map(observations.map((item) => [item.id, item]))
	const earlier = observations.filter(
		(item) => item.value !== undefined && order(item) >= 0 && order(item) < position
	)
	const stem = stemOf(entry)
	const rule = (item: Entry) =>
		stem !== entry.id && stemOf(item) === stem
			? 'the same ID without the build name'
			: stepsOf(entry) && stepsOf(item) === stepsOf(entry) && aboutOf(item) === aboutOf(entry)
				? 'the same about and steps'
				: undefined
	const matches = earlier.filter(rule)
	const roots = [...new Set(matches.map((item) => rootOf(item, byId).id))]
	if (roots.length !== 1) return { ambiguous: roots }
	const chain = earlier.filter((item) => rootOf(item, byId).id === roots[0]).sort((a, b) => order(a) - order(b))
	const latest = chain.at(-1)!
	return { to: latest, rule: rule(latest) ?? rule(matches[0])!, ambiguous: [] }
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

type Saved = { index: number; id: string; kind: string; build: string | null }
type Refused = { index: number; field: string; reason: string; hint?: string; fix?: Fix }

const fixText = (item: Refused) => (item.fix ? ` Send: ${JSON.stringify(item.fix)}` : '')

export function logEntries(
	store: Store,
	actor: string | undefined,
	input: { changeId: string; build?: string; entries: unknown }
) {
	return write(store, { actor, command: 'journal log', subject: input.changeId, input }, (operationId, _, actor) => {
		const state = journal(store, input.changeId)
		const list = entryList(input.entries)
		requireCondition(list.length, 'The array has no entry.', 'Send one entry, or an array of entries.')
		const known = new Map<string, Entry>(state.entries.map((entry) => [entry.id, entry]))
		const builds = [...state.builds]
		const saved: Saved[] = []
		const refused: Refused[] = []
		for (const [index, raw] of list.entries()) {
			let entry: Entry
			try {
				entry = checkedEntry(store, raw, `[${index}]`, input.build, known)
			} catch (error) {
				if (!(error instanceof EntryRefusal)) throw error
				refused.push({ index, field: error.field, reason: error.message, hint: error.hint, fix: error.fix })
				continue
			}
			if (entry.build !== undefined && !builds.includes(entry.build))
				if (entry.build === 'base') builds.unshift('base')
				else builds.push(entry.build)
			if (entry.repeats === 'none') delete entry.repeats
			else if (entry.kind === 'observation' && entry.value !== undefined && entry.repeats === undefined) {
				const match = baselineMatch(entry, known, builds)
				if (match.to) {
					entry.repeats = match.to.id
					entry.linked = match.rule
				}
			}
			insert(store, state.changeId, entry, actor, operationId)
			known.set(entry.id, entry)
			saved.push({ index, id: entry.id, kind: entry.kind, build: entry.build ?? null })
		}
		if (!saved.length)
			throw new Refusal(
				'malformed',
				refused.map((item) => `${item.reason}.${fixText(item)}`).join(' '),
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

const short = (text: string | undefined) =>
	(text ?? '').length > 120 ? `${(text ?? '').slice(0, 117)}...` : (text ?? '')

function decides(answer: string) {
	const words = answer
		.toLowerCase()
		.replace(/\bno (decision|answer)\b/g, 'nodecision')
		.split(/[^a-z/]+/)
		.filter(Boolean)
	return !(words.every((word) => sourceWords.has(word)) && words.some((word) => sourceMarkers.includes(word)))
}

function gapList(state: Journal, build: string): Gap[] {
	const gaps: Gap[] = []
	const keys = new Set<string>()
	const add = (key: string, kind: string, subject: string, idea: string) => {
		if (keys.has(key)) return
		keys.add(key)
		gaps.push({ kind, subject, idea })
	}
	const order = (entry: Entry) => state.builds.indexOf(entry.build ?? '')
	const position = state.builds.includes(build) ? state.builds.indexOf(build) : state.builds.length
	const earlier = (entry: Entry) => entry.build !== undefined && order(entry) >= 0 && order(entry) < position
	const first = (state.builds[0] ?? build) === build
	const observations = ofKind(state, 'observation')
	const here = observations.filter((entry) => entry.build === build)
	const defects = ofKind(state, 'defect')
	const notes = ofKind(state, 'note')
	const criteria = ofKind(state, 'criterion')
	const areas = [...new Set([...criteria, ...notes].flatMap((entry) => entry.area ?? []))]
	const aboutArea = (entry: Entry, area: string) =>
		Boolean(entry.about?.includes(area)) ||
		criteria.some((criterion) => criterion.area === area && isAbout(entry, criterion.id))
	const explained = (id: string) =>
		defects.some((defect) => defect.links?.includes(id)) || notes.some((note) => isAbout(note, id))
	const byId = new Map<string, Entry>(observations.map((entry) => [entry.id, entry]))
	const baselines = observations.filter((entry) => entry.value !== undefined && !entry.repeats && earlier(entry))
	const repeatsOf = (baseline: Entry) =>
		here.filter((entry) => entry.id !== baseline.id && rootOf(entry, byId).id === baseline.id)
	const missingVia = (seen: Entry[]) => state.vias.find(({ via }) => !seen.some((entry) => entry.via === via))
	const usedVias = (seen: Entry[]) =>
		[...new Set(seen.flatMap((entry) => (entry.via ? [viaNames[entry.via] ?? entry.via] : [])))].join(' and ')

	for (const baseline of baselines) {
		const previous = observations
			.filter((entry) => entry.value !== undefined && earlier(entry) && rootOf(entry, byId).id === baseline.id)
			.sort((a, b) => order(a) - order(b))
			.at(-1)!
		for (const entry of repeatsOf(baseline).filter((item) => item.value !== undefined))
			if (!sameValue(entry.value!, previous.value!) && !explained(entry.id))
				add(
					entry.id,
					'difference',
					`${entry.id} repeats ${baseline.id}: ${previous.build} "${previous.value}", ${build} "${entry.value}"`,
					`Explain or report: log a note with "about": "${entry.id}", or a defect with "links": ["${entry.id}"].`
				)
	}
	for (const baseline of baselines.filter((entry) => !repeatsOf(entry).length))
		add(
			baseline.id,
			'baseline',
			`${baseline.id} on ${baseline.build}: ${baseline.value}`,
			`Do it again on ${build}: ${short([baseline.steps ?? baseline.saw].flat().join(' '))}. Log the value with "repeats": "${baseline.id}".`
		)
	if (first) {
		const measured = here.filter((entry) => entry.value !== undefined)
		if (measured.length < fewBaselines)
			add(
				'baselines',
				'baselines',
				`${measured.length} baseline${measured.length === 1 ? '' : 's'} on ${build}`,
				'Existing rules near the change can break. Give a value to an observation of each: the same totals and calculations, validation and error messages, lists, exports, and counters that show the changed data, permissions, and the rules in the docs for the same page or endpoint.'
			)
		for (const area of areas.filter((item) => !measured.some((entry) => aboutArea(entry, item))))
			add(
				`baseline ${area}`,
				'baseline_area',
				area,
				`No baseline is about this area. Measure an existing rule of it on ${build}, and log an observation with "about": "${area}" and "value".`
			)
	}
	for (const entry of here.filter((item) => item.verdict === 'wrong' && !explained(item.id)))
		add(
			entry.id,
			'wrong',
			`${entry.id} ${short(entry.saw)}`,
			`Marked wrong without a defect. Log a defect with "links": ["${entry.id}"], or a note with "about": "${entry.id}" that says why not.`
		)
	for (const defect of defects.filter((entry) => entry.build === build)) {
		const seen = observations.filter((entry) => defect.links?.includes(entry.id) || isAbout(entry, defect.id))
		const subject = `${defect.id} ${defect.title}`
		const verify = `Try it on the running app, and log an observation with "about": "${defect.id}".`
		if (defect.suspected && !seen.some((entry) => entry.via !== 'code'))
			add(
				defect.id,
				'unverified',
				subject,
				`Suspected, and no observation shows it on the running app. ${verify}`
			)
		else if (seen.length && seen.every((entry) => entry.via === 'code'))
			add(defect.id, 'unverified', subject, `Only code observations show it. ${verify}`)
	}
	for (const defect of defects.filter((entry) => entry.build === build && !entry.evidence?.length))
		add(
			defect.id,
			'evidence',
			`${defect.id} ${defect.title}`,
			`No evidence. Log it again with "supersedes": "${defect.id}" and "evidence".`
		)
	for (const entry of state.entries.filter(
		(item) =>
			(item.kind === 'note' || item.kind === 'observation') &&
			(item.build === build || item.build === undefined) &&
			openEnd.test(item.text ?? item.saw ?? '') &&
			!state.entries.some((other) => other.id !== item.id && isAbout(other, item.id))
	))
		add(
			entry.id,
			'open_end',
			`${entry.id} ${short(entry.text ?? entry.saw)}`,
			`Your record says that this is open. Test it, or log a note with "about": "${entry.id}" that says why not.`
		)
	const verdicts = ofKind(state, 'verdict')
	for (const defect of defects.filter(earlier)) {
		const of = verdicts.filter((verdict) => verdict.defect === defect.id)
		if (of.some((verdict) => verdict.build === build)) continue
		if (of.some((verdict) => verdict.result === 'fixed' && earlier(verdict))) continue
		add(
			defect.id,
			'retest',
			`${defect.id} ${defect.title}`,
			`Do its steps again on ${build}. Log a verdict with "defect": "${defect.id}", the result, and evidence.`
		)
	}
	if (!here.length) add(build, 'build', build, `No observation on ${build} yet. Test it and log what you see.`)
	if (build === 'base')
		for (const entry of here.filter((item) => item.value === undefined))
			add(
				entry.id,
				'value',
				`${entry.id} ${short(entry.saw)}`,
				`Add a value to make this a baseline: log it again with "supersedes": "${entry.id}" and "value".`
			)
	if (build !== 'base') {
		if (!criteria.length)
			add(
				'criteria',
				'criteria',
				'no criterion',
				'You can log the rules of the ticket and the docs as criterion entries. Then each rule shows its open items.'
			)
		for (const criterion of criteria) {
			const seen = here.filter((entry) => isAbout(entry, criterion.id))
			const subject = `${criterion.id} ${criterion.text}`
			const other = missingVia(seen)
			if (!seen.length)
				add(
					criterion.id,
					'criterion',
					subject,
					`No observation on ${build}. Test it and log an observation with "about": "${criterion.id}".`
				)
			else if (seen.length === 1 || seen.every((entry) => entry.verdict === 'ok'))
				add(
					criterion.id,
					'happy_path',
					subject,
					`${seen.length === 1 ? 'One observation' : 'Only ok observations'}${other && usedVias(seen) ? `, only through ${usedVias(seen)}` : ''}. Try a boundary value, invalid input, ${other ? viaNames[other.via] : 'the other entry point'}, or the state after a change.`
				)
		}
		for (const area of areas.filter((item) => !here.some((entry) => aboutArea(entry, item))))
			add(
				area,
				'area',
				area,
				`No observation on ${build} is about this changed area. Read its diff and test what it changes.`
			)
		for (const question of ofKind(state, 'question')) {
			const answer = answerOf(state, question.id)
			if (answer && decides(answer.answer!) && !here.some((entry) => isAbout(entry, question.id)))
				add(
					question.id,
					'answer',
					`${question.id} ${short(answer.answer)}`,
					`No observation on ${build} uses this PM answer. Test it and log an observation with "about": "${question.id}".`
				)
		}
	}
	for (const { via, idea } of state.vias)
		if (!here.some((entry) => entry.via === via))
			add(`via ${via}`, 'entry_point', `no observation on ${build} used ${viaNames[via]}`, idea)
	for (const criterion of criteria) {
		const seen = here.filter((entry) => isAbout(entry, criterion.id))
		const other = missingVia(seen)
		if (seen.length && other && usedVias(seen))
			add(criterion.id, 'entry_point', `${criterion.id} was observed only through ${usedVias(seen)}`, other.idea)
	}
	return gaps
}

function picked(gaps: Gap[], limit: number, perKind: number) {
	const chosen = new Set<Gap>()
	const count = (kind: string) => [...chosen].filter((gap) => gap.kind === kind).length
	for (const gap of gaps) if (chosen.size < limit && !count(gap.kind)) chosen.add(gap)
	for (const gap of gaps) if (chosen.size < limit && count(gap.kind) < perKind) chosen.add(gap)
	return gaps.filter((gap) => chosen.has(gap))
}

function openItems(state: Journal, build: string, limit: number, perKind = limit) {
	const gaps = gapList(state, build)
	const counts: Record<string, number> = {}
	for (const gap of gaps) counts[gap.kind] = (counts[gap.kind] ?? 0) + 1
	return { build, total: gaps.length, counts, gaps: picked(gaps, limit, perKind) }
}

function buildOf(state: Journal, build: string | undefined) {
	return build ?? state.builds.at(-1) ?? 'base'
}

export function changeGaps(store: Store, changeId: string, build?: string, every = false) {
	const state = journal(store, changeId)
	const open = openItems(state, buildOf(state, build), every ? Infinity : 40, every ? Infinity : 8)
	return completed(state.changeId, open)
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
