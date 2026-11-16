import type { Store } from './store.ts'
import { all, canonical, completed, digest, execute, one, write } from './store.ts'
import { Refusal, requireCondition, requireWellFormed, schemaProblems, unusedId } from './contracts.ts'
import { existsSync, readdirSync, readFileSync, realpathSync, statSync } from 'node:fs'
import { isAbsolute, join, relative, resolve, sep } from 'node:path'

export const entryKinds = ['criterion', 'observation', 'defect', 'question', 'verdict', 'note', 'issue'] as const
type Kind = (typeof entryKinds)[number] | 'answer'
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
	question?: string
	defect?: string
	result?: 'fixed' | 'not_fixed'
	evidence?: Evidence[]
	answer?: string
	reports?: string[]
	note?: string
	confirms?: string
	refutes?: string
}
export type Row = Entry & { seq: number; actor: string; at: string; ref: string; explorationId: string }
export type Journal = ReturnType<typeof journal>
type Fix = Record<string, unknown>
type Recorded = { replyIds: Set<string>; dropped: string[] }
export type ExplorationRow = {
	exploration_id: string
	plan_id: string
	plan_revision: number | null
	target_id: string
	target_revision: number
	instance_id: string
	build: string
	mode: string
	charter: string
	started_at: string
}

const prefixes: Record<Kind, string> = {
	criterion: 'C',
	observation: 'O',
	defect: 'D',
	question: 'Q',
	verdict: 'V',
	note: 'N',
	issue: 'I',
	answer: 'A',
}
const fieldsHint = 'Fix the named fields.'
const jsonHint = 'Use double quotes for keys and strings. Put a backslash before each quote inside a string.'
const maxEvidenceBytes = 32 * 1024 * 1024
const nonTesters = ['merge', 'verify']
const sharedKinds: Kind[] = ['answer']

export const shortName = (actor: string) => actor.slice(actor.lastIndexOf(':') + 1)
export const isTester = (actor: string | undefined) =>
	actor !== undefined && actor.startsWith('qa:') && !nonTesters.includes(shortName(actor))
const refOf = (actor: string, id: string) => `${shortName(actor)}/${id}`
export const bareOf = (ref: string) => ref.slice(ref.lastIndexOf('/') + 1)

export function explorationRow(store: Store, explorationId: string) {
	const row = one<ExplorationRow>(store, 'SELECT * FROM explorations WHERE exploration_id = ?', explorationId)
	if (!row) {
		const ids = all<{ exploration_id: string }>(
			store,
			'SELECT exploration_id FROM explorations ORDER BY rowid'
		).map((item) => item.exploration_id)
		throw new Refusal(
			'prohibited',
			`Unknown exploration: ${explorationId}. The store has ${ids.length ? `the explorations ${ids.join(', ')}` : 'no exploration'}.`,
			'Run checkmate explore list to read the explorations. Start one with checkmate explore <planId> --build <build>.'
		)
	}
	return row
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

export function journal(store: Store, planId: string, viewer?: string) {
	const rows = all<{ seq: number; body: string; actor: string; at: string; exploration_id: string }>(
		store,
		`SELECT e.rowid AS seq, e.body, e.actor, e.exploration_id, o.at FROM journal_entries e
		JOIN explorations x ON x.exploration_id = e.exploration_id
		LEFT JOIN operations o ON o.id = e.operation_id
		WHERE x.plan_id = ? ORDER BY e.rowid`,
		planId
	).map((row): Row => {
		const body = JSON.parse(row.body) as Entry
		return {
			...body,
			seq: row.seq,
			actor: row.actor,
			at: row.at,
			ref: refOf(row.actor, body.id),
			explorationId: row.exploration_id,
		}
	})
	const latest = new Map<string, Row>()
	for (const row of rows) latest.set(row.ref, row)
	const seen = (row: Row) =>
		!isTester(viewer) || row.actor === viewer || !isTester(row.actor) || sharedKinds.includes(row.kind)
	const shown = [...latest.values()].filter(seen)
	const full = (row: Row, word: string) =>
		latest.has(word) ? word : latest.has(refOf(row.actor, word)) ? refOf(row.actor, word) : word
	const team = shown.map((row) => ({ ...withRefs(row, (word) => full(row, word)), id: row.ref }))
	const uses = new Map<string, number>()
	for (const row of shown) uses.set(row.id, (uses.get(row.id) ?? 0) + 1)
	const idOf = (ref: string) => {
		const target = latest.get(ref)
		return target && seen(target) && uses.get(target.id) === 1 ? target.id : ref
	}
	const entries = team.map((entry) => ({
		...withRefs(entry, (word) => (latest.has(word) ? idOf(word) : word)),
		id: idOf(entry.id),
	}))
	const builds = [...new Set(rows.filter(seen).flatMap((row) => (row.build ? [row.build] : [])))]
	return { planId, viewer, rows: rows.filter(seen), entries, team, builds }
}

function lookup(state: Journal, actor: string) {
	const keys = new Map<string, Row>()
	for (const entry of state.team) keys.set(entry.id, entry)
	state.entries.forEach((entry, index) => keys.set(entry.id, state.team[index]))
	for (const entry of state.team) if (entry.actor === actor) keys.set(bareOf(entry.id), entry)
	return keys
}

const storedRef = (target: Row, actor: string) => (target.actor === actor ? bareOf(target.id) : target.id)

export const ofKind = (state: Journal, kind: Kind) => state.entries.filter((entry) => entry.kind === kind)

function evidenceFile(store: Store, name: string) {
	requireWellFormed(name && !isAbsolute(name), `Evidence path must be relative to the workspace: ${name}`)
	const real = realpathSync(resolve(store.workspace, name))
	requireWellFormed(
		real.startsWith(realpathSync(store.workspace) + sep),
		`Evidence file must be inside the workspace: ${name}`
	)
	const stats = statSync(real)
	requireWellFormed(stats.isFile(), `Evidence must be a file: ${name}`)
	requireWellFormed(stats.size <= maxEvidenceBytes, `Evidence file exceeds 32 MiB: ${name}`)
	return readFileSync(real)
}

function insideWorkspace(store: Store, path: string) {
	return realpathSync(path).startsWith(realpathSync(store.workspace) + sep)
}

const skippedFolders = ['node_modules', '.git', '.checkmate']
const isEvidenceText = (spec: string) => /\s|:\/\//.test(spec.trim()) || !/[/\\]|\.[A-Za-z][A-Za-z0-9]{0,4}$/.test(spec)

function folderItems(folder: string) {
	try {
		return readdirSync(folder, { withFileTypes: true })
	} catch {
		return []
	}
}

function filesEndingWith(folder: string, segments: string[], above: string[] = []): string[] {
	return folderItems(folder).flatMap((item) => {
		if (item.isFile()) {
			const path = [...above, item.name]
			const tail = path.slice(-segments.length)
			return tail.length === segments.length && tail.every((name, index) => name === segments[index])
				? [join(folder, item.name)]
				: []
		}
		if (!item.isDirectory() || skippedFolders.includes(item.name)) return []
		return filesEndingWith(join(folder, item.name), segments, [...above, item.name])
	})
}

function onlyFileEndingWith(cwd: string, spec: string) {
	const segments = spec.split(/[/\\]/).filter((name) => name && name !== '.')
	if (isAbsolute(spec) || !segments.length || segments.includes('..')) return undefined
	const matches = filesEndingWith(cwd, segments)
	return matches.length === 1 ? matches[0] : undefined
}

function evidenceOf(store: Store, spec: string, cwd: string, missing?: string[]): Evidence {
	const found =
		[resolve(cwd, spec), resolve(store.workspace, spec)].find((path) => existsSync(path)) ??
		(missing && !isEvidenceText(spec) ? onlyFileEndingWith(cwd, spec) : undefined)
	if (found && (!missing || insideWorkspace(store, found))) {
		const name = relative(store.workspace, found)
		const bytes = evidenceFile(store, name)
		const sha256 = digest(bytes)
		execute(
			store,
			'INSERT OR IGNORE INTO blobs (sha256, size, bytes) VALUES (?, ?, ?)',
			sha256,
			bytes.length,
			bytes
		)
		return { path: name, sha256, size: bytes.length }
	}
	if (!found && isEvidenceText(spec)) return { text: spec }
	if (missing) {
		missing.push(spec)
		return { text: spec }
	}
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
		"Send the entries on standard input, in a quoted heredoc: checkmate log <explorationId> <<'EOF', the JSON, then EOF"
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
	build: string,
	state: Journal,
	actor: string,
	cwd: string,
	missing?: string[],
	recorded?: Recorded
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
	const draft: Fix = { ...given, build }
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
			fieldsHint,
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
				`Use the ID of an earlier ${kind}, and leave out "id".`,
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
			`Use the ID of an earlier ${kinds.join(' or ')}.`,
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
	if (recorded) {
		const unknown = (id: string) => !known.has(id) && !recorded.replyIds.has(id)
		const links = entry.links?.filter((id) => !unknown(id))
		recorded.dropped.push(...(entry.links ?? []).filter(unknown))
		if (links?.length) entry.links = links
		else delete entry.links
		if (entry.repeats !== undefined && unknown(entry.repeats)) {
			recorded.dropped.push(entry.repeats)
			delete entry.repeats
		}
	}
	if (entry.defect !== undefined) entry.defect = refer(entry.defect, defectOrIssue, 'defect', idsOf(['defect']))
	if (entry.confirms !== undefined)
		entry.confirms = refer(entry.confirms, defectOrIssue, 'confirms', idsOf(defectOrIssue))
	if (entry.refutes !== undefined)
		entry.refutes = refer(entry.refutes, defectOrIssue, 'refutes', idsOf(defectOrIssue))
	if (entry.repeats !== undefined)
		entry.repeats = refer(entry.repeats, ['observation'], 'repeats', idsOf(['observation']))
	const listed = (field: 'links' | 'reports', kinds: Kind[]) => {
		const ids = entry[field]
		if (!ids) return
		const fix = ids.filter((item) => kinds.includes(known.get(item)?.kind as Kind))
		entry[field] = ids.map((item) => refer(item, kinds, field, field === 'links' ? fix : idsOf(kinds)))
	}
	listed('links', ['observation', 'criterion', 'question'])
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
		return { ...rest, evidence: [evidence].flat().map((spec) => evidenceOf(store, spec, cwd, missing)) }
	} catch (error) {
		if (!(error instanceof Refusal)) throw error
		throw new EntryRefusal(`${path}.evidence`, error.message, error.hint ?? '', {
			...given,
			evidence: '<a file in the workspace, or the text that you saw>',
		})
	}
}

export function insertEntry(store: Store, explorationId: string, entry: Entry, actor: string, operationId: string) {
	execute(
		store,
		'INSERT INTO journal_entries (exploration_id, entry_id, kind, build, body, actor, operation_id) VALUES (?, ?, ?, ?, ?, ?, ?)',
		explorationId,
		entry.id,
		entry.kind,
		entry.build ?? null,
		canonical(entry),
		actor,
		operationId
	)
}

function replyIds(list: unknown[]) {
	return new Set(list.flatMap((raw) => (typeof (raw as Entry | null)?.id === 'string' ? [(raw as Entry).id] : [])))
}

type Saved = { index: number; id: string; kind: string }
export type Refused = { index: number; field: string; reason: string; hint?: string; fix?: Fix }

const fixText = (item: Refused) => (item.fix ? ` Send: ${JSON.stringify(item.fix)}` : '')

export function refusalText(item: Refused) {
	return `[${item.index}] ${item.reason}.${item.hint ? ` ${item.hint}` : ''}${fixText(item)}`
}

export function logEntries(
	store: Store,
	actor: string | undefined,
	input: {
		explorationId: string
		entries: unknown
		cwd?: string
		missingEvidence?: string[]
		droppedReferences?: string[]
	}
) {
	const { cwd, missingEvidence, droppedReferences, ...logged } = input
	const operation = { actor, command: 'log', subject: input.explorationId, input: logged }
	return write(store, operation, (operationId, _, actor) => {
		const exploration = explorationRow(store, input.explorationId)
		const list = entryList(input.entries)
		requireCondition(list.length, 'The array has no entry.', 'Send one entry, or an array of entries.')
		const saved: Saved[] = []
		const refused: Refused[] = []
		const recorded = droppedReferences && { replyIds: replyIds(list), dropped: droppedReferences }
		for (const [index, raw] of list.entries()) {
			const state = journal(store, exploration.plan_id, actor)
			let entry: Entry
			try {
				entry = checkedEntry(
					store,
					raw,
					`[${index}]`,
					exploration.build,
					state,
					actor,
					cwd ?? store.workspace,
					missingEvidence,
					recorded
				)
			} catch (error) {
				if (!(error instanceof EntryRefusal)) throw error
				refused.push({ index, field: error.field, reason: error.message, hint: error.hint, fix: error.fix })
				continue
			}
			insertEntry(store, exploration.exploration_id, entry, actor, operationId)
			saved.push({ index, id: entry.id, kind: entry.kind })
		}
		if (!saved.length)
			throw new Refusal(
				'malformed',
				refused.map((item) => `${item.reason}.${fixText(item)}`).join(' '),
				[...new Set(refused.flatMap((item) => item.hint ?? []))].join(' ')
			)
		return {
			reply: completed(exploration.exploration_id, { saved, refused }),
			subjects: [`exploration:${exploration.exploration_id}`, `plan:${exploration.plan_id}`],
		}
	})
}

export function freshIds(store: Store, planId: string, actor: string, entries: unknown[]) {
	const used = new Set(lookup(journal(store, planId, actor), actor).keys())
	const given = entries.flatMap((raw) => (typeof (raw as Entry | null)?.id === 'string' ? [(raw as Entry).id] : []))
	const taken = [...used, ...given]
	const renamed = new Map<string, string>()
	for (const raw of entries) {
		const entry = raw as Partial<Entry> | null
		if (!entry || typeof entry !== 'object' || typeof entry.id !== 'string' || entry.supersedes !== undefined)
			continue
		const prefix = prefixes[entry.kind as Kind]
		if (!used.has(entry.id) || !prefix || renamed.has(entry.id)) continue
		const fresh = unusedId(prefix, taken)
		renamed.set(entry.id, fresh)
		taken.push(fresh)
	}
	const name = (word: string) => renamed.get(word) ?? word
	const seen = new Set<string>()
	return entries.map((raw) => {
		const entry = raw as Entry | null
		if (!entry || typeof entry !== 'object' || Array.isArray(entry)) return raw
		const first = typeof entry.id === 'string' && entry.supersedes === undefined && !seen.has(entry.id)
		if (first) seen.add(entry.id)
		return {
			...withRefs(entry, name),
			...(entry.supersedes !== undefined && { supersedes: name(entry.supersedes) }),
			...(first && { id: name(entry.id) }),
		}
	})
}

export function recordText(store: Store, planId: string, viewer: string) {
	const state = journal(store, planId, viewer)
	const lines = [
		...ofKind(state, 'criterion').map((criterion) => `criterion ${criterion.id}: ${criterion.text}`),
		...ofKind(state, 'defect').map(
			(defect) => `defect ${defect.id} (${defect.build}, ${defect.severity}): ${defect.title}`
		),
		...ofKind(state, 'question').map((question) => {
			const answer = ofKind(state, 'answer')
				.filter((entry) => entry.question === question.id)
				.at(-1)
			return `question ${question.id}: ${question.question}${answer ? ` Answer: ${answer.answer}` : ''}`
		}),
	]
	return lines.length ? lines.join('\n') : 'No criterion, defect, or question yet.'
}
