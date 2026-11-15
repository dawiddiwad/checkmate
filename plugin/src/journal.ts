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
import issueSchema from '../contracts/journal-issue.schema.json' with { type: 'json' }
import observationSchema from '../contracts/journal-observation.schema.json' with { type: 'json' }
import { existsSync } from 'node:fs'
import { relative, resolve } from 'node:path'

export const entryKinds = ['criterion', 'observation', 'defect', 'question', 'verdict', 'note', 'issue'] as const
type Kind = (typeof entryKinds)[number] | 'answer' | 'decision' | 'team' | 'seen'
export const teamModes = ['independent', 'open'] as const
export type TeamMode = (typeof teamModes)[number]
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
	reports?: string[]
	note?: string
	confirms?: string
	refutes?: string
	to?: string
	assign?: string
	mode?: TeamMode
	position?: number
}
type Row = Entry & { seq: number; actor: string; at: string; ref: string }
type Journal = ReturnType<typeof journal>
export type Gap = { kind: string; subject: string; idea: string }
type Fix = Record<string, unknown>

const prefixes: Record<Kind, string> = {
	criterion: 'C',
	observation: 'O',
	defect: 'D',
	question: 'Q',
	verdict: 'V',
	note: 'N',
	issue: 'I',
	answer: 'A',
	decision: 'R',
	team: 'T',
	seen: 'S',
}
const capabilityEntryPoints: Record<string, { via: string; idea: string }> = {
	browser: { via: 'ui', idea: 'Use the main flows in the browser, as a user does.' },
	http: { via: 'api', idea: 'Send the requests of the main flows to the API, also with invalid input.' },
}
const fieldsHint = 'Fix the named fields.'
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
const nonTesters = ['merge', 'verify', 'lead']
const sharedKinds: Kind[] = ['answer', 'decision']

const shortName = (actor: string) => actor.slice(actor.lastIndexOf(':') + 1)
const isTester = (actor: string | undefined) =>
	actor !== undefined && actor.startsWith('qa:') && !nonTesters.includes(shortName(actor))
const refOf = (actor: string, id: string) => `${shortName(actor)}/${id}`
const bareOf = (ref: string) => ref.slice(ref.lastIndexOf('/') + 1)

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

function withRefs<T extends Entry>(entry: T, name: (word: string) => string): T {
	return {
		...entry,
		...(entry.about !== undefined && {
			about: entry.about
				.split(/([\s,;]+)/)
				.map(name)
				.join(''),
		}),
		...(entry.links && { links: entry.links.map(name) }),
		...(entry.reports && { reports: entry.reports.map(name) }),
		...(entry.defect !== undefined && { defect: name(entry.defect) }),
		...(entry.repeats !== undefined && { repeats: name(entry.repeats) }),
		...(entry.confirms !== undefined && { confirms: name(entry.confirms) }),
		...(entry.refutes !== undefined && { refutes: name(entry.refutes) }),
		...(entry.kind === 'answer' && { question: name(entry.question!) }),
	}
}

function journal(store: Store, changeId: string, viewer?: string) {
	const opened = changeRow(store, changeId)
	const parsed = all<{ seq: number; body: string; actor: string; at: string }>(
		store,
		`SELECT e.rowid AS seq, e.body, e.actor, o.at FROM journal_entries e LEFT JOIN operations o ON o.id = e.operation_id
		WHERE e.change_id = ? ORDER BY e.rowid`,
		changeId
	).map((row): Row => {
		const body = JSON.parse(row.body) as Entry
		return { ...body, seq: row.seq, actor: row.actor, at: row.at, ref: refOf(row.actor, body.id) }
	})
	const settings = parsed.filter((row) => row.kind === 'team' || row.kind === 'seen')
	const rows = parsed.filter((row) => !settings.includes(row))
	const mode = settings.filter((row) => row.kind === 'team').at(-1)?.mode ?? 'independent'
	const open = mode === 'open'
	const latest = new Map<string, Row>()
	for (const row of rows) latest.set(row.ref, row)
	const seen = (row: Row) =>
		!isTester(viewer) || open || row.actor === viewer || !isTester(row.actor) || sharedKinds.includes(row.kind)
	const teammate = (row: Row) => open && isTester(viewer) && isTester(row.actor) && row.actor !== viewer
	const shown = [...latest.values()].filter(seen)
	const full = (row: Row, word: string) =>
		latest.has(word) ? word : latest.has(refOf(row.actor, word)) ? refOf(row.actor, word) : word
	const team = shown.map((row) => ({ ...withRefs(row, (word) => full(row, word)), id: row.ref }))
	const uses = new Map<string, number>()
	for (const row of shown.filter((item) => !teammate(item))) uses.set(row.id, (uses.get(row.id) ?? 0) + 1)
	const idOf = (ref: string) => {
		const target = latest.get(ref)
		return target && seen(target) && !teammate(target) && uses.get(target.id) === 1 ? target.id : ref
	}
	const entries = team.map((entry) => ({
		...withRefs(entry, (word) => (latest.has(word) ? idOf(word) : word)),
		id: idOf(entry.id),
	}))
	const visible = rows.filter(seen)
	const named = [...new Set(visible.flatMap((row) => (row.build ? [row.build] : [])))]
	const builds = named.includes('base') ? ['base', ...named.filter((build) => build !== 'base')] : named
	const vias = targetRequest(store, opened.targetId).capabilities.flatMap((name) => capabilityEntryPoints[name] ?? [])
	const testers = new Set(shown.filter((row) => isTester(row.actor)).map((row) => row.actor))
	const marks = settings.filter((row) => row.kind === 'seen')
	const everyone = [...latest.values()]
	return {
		...opened,
		viewer,
		mode,
		rows: visible,
		entries,
		team,
		everyone,
		marks,
		builds,
		vias,
		testers: testers.size,
	}
}

function lookup(state: Journal, actor: string) {
	const keys = new Map<string, Row>()
	for (const entry of state.team) keys.set(entry.id, entry)
	state.entries.forEach((entry, index) => keys.set(entry.id, state.team[index]))
	for (const entry of state.team) if (entry.actor === actor) keys.set(bareOf(entry.id), entry)
	return keys
}

const storedRef = (target: Row, actor: string) => (target.actor === actor ? bareOf(target.id) : target.id)

const ofKind = (state: Journal, kind: Kind) => state.entries.filter((entry) => entry.kind === kind)
const words = (about: string | undefined) => (about ?? '').split(/[\s,;]+/).filter(Boolean)
const isAbout = (entry: Entry, id: string) => entry.about === id || words(entry.about).includes(id)
const sameValue = (a: string, b: string) => normalised(a) === normalised(b)
const observed = (entry: Entry) => entry.saw !== undefined || entry.value !== undefined || entry.via !== undefined

function observationsOf(state: Journal) {
	const criteria = new Set(ofKind(state, 'criterion').map((entry) => entry.id))
	return state.entries.flatMap((entry): Entry[] => {
		if (entry.kind === 'observation') return [entry]
		if (entry.kind !== 'defect' || !observed(entry)) return []
		const about = [...words(entry.about), ...(entry.links ?? []).filter((id) => criteria.has(id))].join(' ')
		return [{ ...entry, saw: entry.saw ?? entry.actual, verdict: 'wrong', ...(about && { about }) }]
	})
}

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
	input: { changeId: string; target: string; instance?: string; team?: TeamMode }
) {
	return write(store, { actor, command: 'journal open', subject: input.changeId, input }, (operationId, _, actor) => {
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
		if (input.team !== undefined)
			insert(store, changeId, { kind: 'team', id: 'team', mode: input.team }, actor, operationId)
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

function evidenceOf(store: Store, spec: string, cwd: string): Evidence {
	const found = [resolve(cwd, spec), resolve(store.workspace, spec)].find((path) => existsSync(path))
	if (found) {
		const name = relative(store.workspace, found)
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
	state: Journal,
	actor: string,
	cwd: string
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
				: fieldsHint,
			fix
		)
	}
	const entry = draft as Omit<Entry, 'evidence'> & { evidence?: string | string[] }
	const known = lookup(state, actor)
	const used = [...known.keys()]
	if (entry.supersedes !== undefined) {
		const earlier = known.get(entry.supersedes)
		if (
			earlier?.actor !== actor ||
			earlier.kind !== kind ||
			(entry.id !== undefined && entry.id !== bareOf(earlier.id))
		) {
			const { supersedes: _, ...fix } = given
			throw new EntryRefusal(
				`${path}.supersedes`,
				`${path}.supersedes names no earlier ${kind}: ${entry.supersedes}.`,
				`Use the ID of an earlier ${kind}, and leave out "id". Run checkmate journal show to read the IDs.`,
				fix
			)
		}
		entry.id = bareOf(earlier.id)
		entry.supersedes = entry.id
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
	const refer = (id: string, kinds: Kind[], field: string, fix: unknown) => {
		const target = known.get(id)
		if (target && kinds.includes(target.kind)) return storedRef(target, actor)
		throw new EntryRefusal(
			`${path}.${field}`,
			`${path}.${field} names no ${kinds.join(' or ')}: ${id}.`,
			`Use the ID of an earlier ${kinds.join(' or ')}. Run checkmate journal show to read the IDs.`,
			{ ...given, [field]: fix }
		)
	}
	const idsOf = (kinds: Kind[]) =>
		state.entries
			.filter((item) => kinds.includes(item.kind))
			.map((item) => item.id)
			.slice(-6)
			.join('|') || `<${kinds.join(' or ')} ID>`
	const defectOrIssue: Kind[] = ['defect', 'issue']
	if (entry.defect !== undefined) entry.defect = refer(entry.defect, defectOrIssue, 'defect', idsOf(['defect']))
	if (entry.confirms !== undefined)
		entry.confirms = refer(entry.confirms, defectOrIssue, 'confirms', idsOf(defectOrIssue))
	if (entry.refutes !== undefined)
		entry.refutes = refer(entry.refutes, defectOrIssue, 'refutes', idsOf(defectOrIssue))
	if (entry.repeats !== undefined && entry.repeats !== 'none')
		entry.repeats = refer(entry.repeats, ['observation'], 'repeats', idsOf(['observation']))
	const listed = (field: 'links' | 'reports', kinds: Kind[]) => {
		const ids = entry[field]
		if (!ids) return
		const fix = ids.filter((item) => kinds.includes(known.get(item)?.kind as Kind))
		entry[field] = ids.map((item) => refer(item, kinds, field, field === 'links' ? fix : idsOf(kinds)))
	}
	listed('links', ['observation', 'criterion'])
	listed('reports', ['defect'])
	if (entry.about !== undefined)
		entry.about = entry.about
			.split(/([\s,;]+)/)
			.map((word) => {
				const target = known.get(word)
				return target ? storedRef(target, actor) : word
			})
			.join('')
	const { evidence, ...rest } = entry
	if (evidence === undefined) return rest
	try {
		return { ...rest, evidence: [evidence].flat().map((spec) => evidenceOf(store, spec, cwd)) }
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

function baselineMatch(entry: Entry, entries: Entry[], builds: string[]) {
	const position = builds.indexOf(entry.build ?? '')
	const order = (item: Entry) => builds.indexOf(item.build ?? '')
	const observations = entries.filter((item) => item.kind === 'observation')
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
	input: { changeId: string; build?: string; entries: unknown; cwd?: string }
) {
	const { cwd, ...logged } = input
	const operation = { actor, command: 'journal log', subject: input.changeId, input: logged }
	return write(store, operation, (operationId, _, actor) => {
		const { changeId } = changeRow(store, input.changeId)
		const list = entryList(input.entries)
		requireCondition(list.length, 'The array has no entry.', 'Send one entry, or an array of entries.')
		const saved: Saved[] = []
		const refused: Refused[] = []
		for (const [index, raw] of list.entries()) {
			const state = journal(store, changeId, actor)
			const builds = [...state.builds]
			let entry: Entry
			try {
				entry = checkedEntry(store, raw, `[${index}]`, input.build, state, actor, cwd ?? store.workspace)
			} catch (error) {
				if (!(error instanceof EntryRefusal)) throw error
				refused.push({ index, field: error.field, reason: error.message, hint: error.hint, fix: error.fix })
				continue
			}
			if (entry.build !== undefined && !builds.includes(entry.build))
				if (entry.build === 'base') builds.unshift('base')
				else builds.push(entry.build)
			if (entry.repeats === 'none') delete entry.repeats
			else if (
				['observation', 'defect'].includes(entry.kind) &&
				entry.value !== undefined &&
				entry.repeats === undefined
			) {
				const match = baselineMatch(entry, state.entries, builds)
				if (match.to) {
					entry.repeats = storedRef(lookup(state, actor).get(match.to.id)!, actor)
					entry.linked = match.rule
				}
			}
			insert(store, changeId, entry, actor, operationId)
			saved.push({ index, id: entry.id, kind: entry.kind, build: entry.build ?? null })
		}
		if (!saved.length)
			throw new Refusal(
				'malformed',
				refused.map((item) => `${item.reason}.${fixText(item)}`).join(' '),
				[...new Set(refused.flatMap((item) => item.hint ?? []))].join(' ')
			)
		const after = journal(store, changeId)
		const inbox = after.mode === 'open' ? { inbox: newNotes(after, actor).length } : {}
		return {
			reply: completed(changeId, { saved, refused, ...inbox }),
			subjects: [`change:${changeId}`],
		}
	})
}

export function setTeam(store: Store, actor: string | undefined, input: { changeId: string; mode: TeamMode }) {
	return write(store, { actor, command: 'journal team', subject: input.changeId, input }, (operationId, _, actor) => {
		const { changeId } = changeRow(store, input.changeId)
		insert(store, changeId, { kind: 'team', id: 'team', mode: input.mode }, actor, operationId)
		return { reply: completed(changeId, { mode: input.mode }), subjects: [`change:${changeId}`] }
	})
}

function newNotes(state: Journal, actor: string) {
	const upTo = state.marks.filter((row) => row.actor === actor).at(-1)?.position ?? 0
	return state.everyone
		.filter(
			(row) =>
				row.kind === 'note' &&
				row.actor !== actor &&
				row.seq > upTo &&
				(row.to === 'team' || (row.to !== undefined && row.to === shortName(actor)))
		)
		.sort((a, b) => a.seq - b.seq)
}

export function readInbox(store: Store, actor: string | undefined, input: { changeId: string }) {
	return write(
		store,
		{ actor, command: 'journal inbox', subject: input.changeId, input },
		(operationId, _, actor) => {
			const state = journal(store, input.changeId)
			const notes = newNotes(state, actor)
			if (notes.length)
				insert(
					store,
					state.changeId,
					{ kind: 'seen', id: 'inbox', position: notes.at(-1)!.seq },
					actor,
					operationId
				)
			return {
				reply: completed(state.changeId, {
					notes: notes.map((note) => ({
						id: note.ref,
						from: shortName(note.actor),
						to: note.to!,
						area: note.area ?? null,
						text: note.text!,
					})),
				}),
				subjects: [`change:${state.changeId}`],
			}
		}
	)
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

const areasOf = (state: Journal, notes: Entry[]) => [
	...new Set([...ofKind(state, 'criterion'), ...notes].flatMap((entry) => entry.area ?? [])),
]
const isAboutArea = (entry: Entry, area: string, criteria: Entry[]) =>
	Boolean(entry.about?.includes(area)) ||
	criteria.some((criterion) => criterion.area === area && isAbout(entry, criterion.id))
const openNote = (state: Journal, note: Entry) =>
	openEnd.test(note.text ?? note.saw ?? '') &&
	!state.entries.some((other) => other.id !== note.id && isAbout(other, note.id))

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
	const here = observationsOf(state).filter((entry) => entry.build === build)
	const defects = ofKind(state, 'defect')
	const notes = ofKind(state, 'note')
	const criteria = ofKind(state, 'criterion')
	const forViewer = (note: Entry) =>
		note.assign === undefined || !isTester(state.viewer) || note.assign === shortName(state.viewer!)
	const areas = areasOf(state, notes.filter(forViewer))
	const aboutArea = (entry: Entry, area: string) => isAboutArea(entry, area, criteria)
	const explained = (id: string) =>
		defects.some((defect) => defect.id === id || defect.links?.includes(id)) ||
		notes.some((note) => isAbout(note, id))
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
		const measured = here.filter((entry) => entry.kind === 'observation' && entry.value !== undefined)
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
	for (const entry of here.filter(
		(item) => item.kind === 'observation' && item.verdict === 'wrong' && !explained(item.id)
	))
		add(
			entry.id,
			'wrong',
			`${entry.id} ${short(entry.saw)}`,
			`Marked wrong without a defect. Log a defect with "links": ["${entry.id}"], or a note with "about": "${entry.id}" that says why not.`
		)
	for (const defect of defects.filter((entry) => entry.build === build)) {
		const seen = [
			...(observed(defect) ? [defect] : []),
			...observations.filter((entry) => defect.links?.includes(entry.id) || isAbout(entry, defect.id)),
		]
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
			openNote(state, item)
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
		for (const entry of here.filter((item) => item.kind === 'observation' && item.value === undefined))
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
	if (isTester(state.viewer) || !state.testers) return gaps
	for (const issue of issueList(state).filter((item) => state.builds.indexOf(item.build) <= position)) {
		const subject = `${issue.id} ${issue.title}`
		if (!issue.confirmed && !issue.refuted)
			add(
				`unconfirmed ${issue.id}`,
				'unconfirmed',
				subject,
				`One tester reported it, and no other actor confirmed it. Run checkmate journal verify ${state.changeId} --build ${issue.build}.`
			)
		const statuses = Object.entries(issue.statuses)
		const fixedBefore = statuses.some(([at, on]) => on.status === 'fixed' && state.builds.indexOf(at) < position)
		if (issue.statuses[build]?.status === 'no verdict' && !fixedBefore)
			add(
				`no_verdict ${issue.id}`,
				'no_verdict',
				subject,
				`No verdict on ${build} names it or one of its reports.`
			)
	}
	return gaps
}

export type Issue = ReturnType<typeof issueList>[number]
type Verified = 'confirmed' | 'refuted' | 'none'
export type BuildStatus = {
	status: 'fixed' | 'not_fixed' | 'no verdict'
	votes: { fixed: number; not_fixed: number }
	basis: 'majority' | 'disputed' | 'single' | 'verified' | 'none'
}

const evidenceScore = (entry: Entry) => (entry.evidence?.length ?? 0) * 2 + (entry.steps ? 1 : 0)

function issueList(state: Journal) {
	const team = state.team
	const defects = new Map(team.filter((entry) => entry.kind === 'defect').map((entry) => [entry.id, entry]))
	const recorded = team.filter((entry) => entry.kind === 'issue')
	const grouped = new Set(recorded.flatMap((issue) => issue.reports ?? []))
	const groups = [
		...recorded.map((issue) => ({ issue, reports: (issue.reports ?? []).filter((id) => defects.has(id)) })),
		...[...defects.values()]
			.filter((defect) => !grouped.has(defect.id))
			.map((defect) => ({ issue: defect, reports: [defect.id] })),
	].filter((group) => group.reports.length)
	const order = (build: string | undefined) => state.builds.indexOf(build ?? '')
	return groups.map(({ issue, reports }) => {
		const found = reports.map((id) => defects.get(id)!)
		const actors = [...new Set(found.map((defect) => defect.actor))]
		const names = [issue.id, ...reports]
		const checks = team
			.filter(
				(entry) =>
					entry.kind === 'observation' &&
					!actors.includes(entry.actor) &&
					names.some((name) => entry.confirms === name || entry.refutes === name)
			)
			.sort((a, b) => a.seq - b.seq)
		const checkOn = (build: string) => checks.filter((entry) => entry.build === build).at(-1)
		const confirms = (check: Entry) => names.includes(check.confirms ?? '')
		const best = found.reduce((top, defect) => (evidenceScore(defect) > evidenceScore(top) ? defect : top))
		const first = Math.min(...found.map((defect) => order(defect.build)))
		const firstCheck = checkOn(state.builds[first])
		const verified: Verified = !firstCheck ? 'none' : confirms(firstCheck) ? 'confirmed' : 'refuted'
		const confirmed = actors.length > 1 || verified === 'confirmed'
		const verdicts = team
			.filter((entry) => entry.kind === 'verdict' && names.includes(entry.defect ?? ''))
			.sort((a, b) => a.seq - b.seq)
		const statusOn = (build: string): BuildStatus => {
			const results = new Map<string, string>()
			for (const verdict of verdicts.filter((entry) => entry.build === build))
				results.set(verdict.actor, verdict.result!)
			const count = (result: string) => [...results.values()].filter((item) => item === result).length
			const votes = { fixed: count('fixed'), not_fixed: count('not_fixed') }
			const check = checkOn(build)
			if (check) return { status: confirms(check) ? 'not_fixed' : 'fixed', votes, basis: 'verified' }
			if (!results.size) return { status: 'no verdict', votes, basis: 'none' }
			if (votes.fixed === votes.not_fixed) return { status: 'fixed', votes, basis: 'disputed' }
			const status = votes.fixed > votes.not_fixed ? 'fixed' : 'not_fixed'
			return { status, votes, basis: results.size === 1 ? 'single' : 'majority' }
		}
		const statuses = Object.fromEntries(
			state.builds.filter((_, index) => index > first).map((build) => [build, statusOn(build)])
		)
		return {
			id: issue.id,
			title: issue.title!,
			severity: issue.severity!,
			build: state.builds[first],
			expected: best.expected!,
			actual: best.actual!,
			steps: best.steps ?? null,
			evidence: best.evidence ?? [],
			reports,
			reporters: actors.length,
			actors: actors.map(shortName),
			confirmed,
			refuted: !confirmed && verified === 'refuted',
			verified,
			statuses,
			note: issue.note ?? null,
		}
	})
}

export const issueStatus = (issue: Issue) => (issue.confirmed ? 'confirmed' : issue.refuted ? 'refuted' : 'unconfirmed')

export function changeIssues(store: Store, changeId: string, build?: string) {
	const state = journal(store, changeId)
	const issues = issueList(state).filter((issue) => build === undefined || issueBuilds(state, issue).includes(build))
	return completed(state.changeId, { issues })
}

function issueBuilds(state: Journal, issue: Issue) {
	return state.team.filter((entry) => issue.reports.includes(entry.id)).map((entry) => entry.build!)
}

const stopWords = new Set(
	'the and for with not but was are from that this when has have its into than then there should instead'.split(' ')
)
const wordsIn = (text: string) =>
	new Set(
		text
			.toLowerCase()
			.split(/[^a-z0-9]+/)
			.filter((word) => word.length > 2 && !stopWords.has(word))
	)
const wordsOf = (entry: Entry) => wordsIn(`${entry.title} ${entry.actual}`)
const stepText = (entry: Entry) => [entry.steps ?? []].flat().join(' ')
const overlap = (a: Set<string>, b: Set<string>) =>
	[...a].filter((word) => b.has(word)).length / (new Set([...a, ...b]).size || 1)
const similarWords = 0.5
const someWords = 0.25
const mergeLimit = 60

function pathsOf(entry: Entry) {
	const tokens = stepText(entry)
		.toLowerCase()
		.split(/[\s"'()]+/)
		.map((token) =>
			token
				.replace(/^[a-z]+:\/\/[^/]+/, '')
				.split('?')[0]
				.replace(/[.,;:]+$/, '')
		)
	return new Set(tokens.filter((token) => /^\/[a-z]/.test(token)))
}

function likeness(a: Entry, b: Entry) {
	if (overlap(wordsOf(a), wordsOf(b)) < someWords) return undefined
	if (!a.steps || !b.steps) return 'some of the same words in title and actual'
	const path = [...pathsOf(a)].find((item) => pathsOf(b).has(item))
	if (path) return `some of the same words, and the same path ${path}`
	if (overlap(wordsIn(stepText(a)), wordsIn(stepText(b))) >= someWords) return 'some of the same words and steps'
	return undefined
}

function criteriaOf(defect: Entry, team: Map<string, Row>) {
	const linked = (defect.links ?? []).flatMap((id) => {
		const target = team.get(id)
		if (target?.kind === 'criterion') return [id]
		return words(target?.about).filter((word) => team.get(word)?.kind === 'criterion')
	})
	return [...new Set(linked)]
}

export function mergeBuild(store: Store, changeId: string, build: string) {
	const state = journal(store, changeId)
	const team = new Map(state.team.map((entry) => [entry.id, entry]))
	const defects = state.team.filter((entry) => entry.kind === 'defect' && entry.build === build)
	const listed = defects.map((defect) => ({
		id: defect.id,
		severity: defect.severity!,
		title: short(defect.title),
		expected: short(defect.expected),
		actual: short(defect.actual),
		criteria: criteriaOf(defect, team),
	}))
	const onBuild = issueList(state).filter((issue) => issueBuilds(state, issue).includes(build))
	const issues = onBuild.filter((issue) => issue.reports.length > 1 || issue.id !== issue.reports[0])
	const together = (ids: string[]) => issues.some((issue) => ids.every((id) => issue.reports.includes(id)))
	const groups: Array<{ reports: string[]; reason: string }> = []
	const suggest = (reports: string[], reason: string) => {
		const actors = new Set(reports.map((id) => team.get(id)!.actor))
		const key = [...reports].sort().join(',')
		if (actors.size < 2 || together(reports) || groups.some((group) => [...group.reports].sort().join(',') === key))
			return
		groups.push({ reports, reason })
	}
	for (const criterion of [...new Set(listed.flatMap((defect) => defect.criteria))])
		suggest(
			listed.filter((defect) => defect.criteria.includes(criterion)).map((defect) => defect.id),
			`the same criterion ${criterion}`
		)
	const clusters: string[][] = []
	const vocabulary = new Map(defects.map((defect) => [defect.id, wordsOf(defect)]))
	for (const [index, a] of defects.entries())
		for (const b of defects.slice(index + 1)) {
			if (a.actor === b.actor || overlap(vocabulary.get(a.id)!, vocabulary.get(b.id)!) < similarWords) continue
			const joined = clusters.filter((cluster) => cluster.includes(a.id) || cluster.includes(b.id))
			const cluster = [...new Set([...joined.flat(), a.id, b.id])]
			clusters.splice(0, clusters.length, ...clusters.filter((item) => !joined.includes(item)), cluster)
		}
	for (const cluster of clusters) suggest(cluster, 'many of the same words in title and actual')
	const suggested = new Set(groups.flatMap((group) => group.reports))
	const singles = onBuild.filter((issue) => issue.reporters === 1 && !issue.reports.some((id) => suggested.has(id)))
	const larger = [
		...issues.filter((issue) => issue.reporters > 1).map((issue) => ({ into: issue.id, reports: issue.reports })),
		...groups.map((group) => ({ into: group.reports.join(','), reports: group.reports })),
	]
	const candidates = singles.flatMap((single) =>
		larger.flatMap(({ into, reports }) => {
			const reason = single.reports
				.flatMap((id) => reports.map((other) => likeness(team.get(id)!, team.get(other)!)))
				.find(Boolean)
			return reason ? [{ report: single.id, into, reason }] : []
		})
	)
	const grouped = new Set(issues.flatMap((issue) => issue.reports))
	const reports = groups[0]?.reports ?? defects.slice(0, 2).map((defect) => defect.id)
	const example = { ...(issueSchema.examples[0] as Fix), ...(reports.length ? { reports } : {}) }
	return completed(state.changeId, {
		build,
		total: listed.length,
		defects: listed.slice(0, mergeLimit),
		groups: groups.slice(0, mergeLimit),
		candidates: candidates.slice(0, mergeLimit),
		issues: issues.map(({ id, title, reports }) => ({ id, title: short(title), reports })),
		ungrouped: defects.filter((defect) => !grouped.has(defect.id)).map((defect) => defect.id),
		command: `checkmate journal log ${state.changeId} --build ${build}`,
		example,
	})
}

function verifyReason(state: Journal, issue: Issue, build: string) {
	if (issue.reporters === 1 && issue.verified === 'none' && issueBuilds(state, issue).includes(build))
		return 'one reporter'
	const basis = issue.statuses[build]?.basis
	if (basis === 'disputed' || basis === 'single') return `${basis} verdict`
	return undefined
}

export function verifyBuild(store: Store, changeId: string, build: string) {
	const state = journal(store, changeId)
	const items = issueList(state).flatMap((issue) => {
		const reason = verifyReason(state, issue, build)
		return reason ? [{ ...issue, reason }] : []
	})
	return completed(state.changeId, {
		build,
		items,
		command: `checkmate journal log ${state.changeId} --build ${build}`,
		example: observationSchema.examples[0],
	})
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

export function changeGaps(store: Store, changeId: string, build?: string, viewer?: string) {
	const state = journal(store, changeId, viewer)
	const every = viewer === undefined
	const open = openItems(state, buildOf(state, build), every ? Infinity : 40, every ? Infinity : 8)
	return completed(state.changeId, { ...open, tester: isTester(viewer) })
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
			const state = journal(store, input.changeId, actor)
			const known = lookup(state, actor)
			const question = known.get(input.questionId)
			requireCondition(
				question?.kind === 'question',
				`Unknown question: ${input.questionId}.`,
				`Use one of: ${
					ofKind(state, 'question')
						.map((entry) => entry.id)
						.join(', ') || 'no question yet'
				}.`
			)
			const entry: Entry = {
				kind: 'answer',
				id: unusedId('A', [...known.keys()]),
				question: storedRef(question!, actor),
				answer: requireText(input.answer, 'answer (--answer)'),
			}
			insert(store, state.changeId, entry, actor, operationId)
			return {
				reply: completed(state.changeId, { id: entry.id, question: input.questionId }),
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
			id: unusedId('R', [...lookup(state, actor).keys()]),
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
	const observations = observationsOf(state)
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

export function changeState(store: Store, changeId: string, viewer?: string) {
	const state = journal(store, changeId, viewer)
	return {
		changeId: state.changeId,
		team: state.mode,
		assignments: assignmentsOf(state)
			.filter((note) => viewer !== undefined && note.assign === shortName(viewer))
			.map((note) => ({ area: note.area!, text: note.text! })),
		coverage: viewer === undefined ? coverageOf(state) : [],
		targetId: state.targetId,
		instanceId: state.instanceId,
		builds: state.builds,
		criteria: ofKind(state, 'criterion').map(({ id, text, source }) => ({
			id,
			text: text!,
			source: source ?? null,
		})),
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

const assignmentsOf = (state: Journal) => state.everyone.filter((row) => row.kind === 'note' && row.assign)
const namesArea = (entry: Entry, area: string) => entry.area === area || Boolean(entry.about?.includes(area))

function coverageOf(state: Journal) {
	return assignmentsOf(state).map((note) => {
		const after = state.team.filter(
			(entry) => entry.seq > note.seq && (shortName(entry.actor) === note.assign || namesArea(entry, note.area!))
		)
		const count = (kind: Kind) => after.filter((entry) => entry.kind === kind).length
		return { area: note.area!, tester: note.assign!, observations: count('observation'), defects: count('defect') }
	})
}

const debriefLimit = 10

export function debriefBuild(store: Store, changeId: string, build: string) {
	const state = journal(store, changeId)
	const issues = issueList(state).filter((issue) => issueBuilds(state, issue).includes(build))
	const here = observationsOf(state).filter((entry) => entry.build === build)
	const criteria = ofKind(state, 'criterion')
	const notes = ofKind(state, 'note')
	const uncovered = [
		...criteria
			.filter((criterion) => !here.some((entry) => isAbout(entry, criterion.id)))
			.map((criterion) => ({ kind: 'criterion', subject: `${criterion.id} ${short(criterion.text)}` })),
		...areasOf(state, notes)
			.filter((area) => !here.some((entry) => isAboutArea(entry, area, criteria)))
			.map((area) => ({ kind: 'area', subject: area })),
	]
	const notTested = notes
		.filter((note) => (note.build === build || note.build === undefined) && openNote(state, note))
		.map((note) => ({ id: note.id, text: short(note.text) }))
	const line = (issue: Issue) => ({
		id: issue.id,
		severity: issue.severity,
		title: short(issue.title),
		actors: issue.actors,
		status: issueStatus(issue),
	})
	const lists = {
		merged: issues.filter((issue) => issue.reporters > 1).map(line),
		uncovered,
		notTested,
		singles: issues.filter((issue) => issue.reporters === 1).map(line),
	}
	return completed(state.changeId, {
		build,
		total: Object.fromEntries(Object.entries(lists).map(([name, list]) => [name, list.length])),
		...Object.fromEntries(Object.entries(lists).map(([name, list]) => [name, list.slice(0, debriefLimit)])),
	})
}

export function showChange(store: Store, changeId: string, viewer?: string) {
	const state = changeState(store, changeId, viewer)
	return completed(state.changeId, state)
}

export function exportChange(store: Store, changeId: string, viewer?: string) {
	const state = journal(store, changeId, viewer)
	const record = {
		...changeState(store, changeId, viewer),
		entries: state.entries,
		history: state.rows,
		gaps: Object.fromEntries(state.builds.map((build) => [build, gapList(state, build)])),
		issues: issueList(state),
	}
	return JSON.stringify(record, null, '\t') + '\n'
}
