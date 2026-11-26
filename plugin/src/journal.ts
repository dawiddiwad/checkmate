import type { Store } from './store.ts'
import type { JournalVerdict } from './types.ts'
import { all, canonical, completed, digest, execute, one, saveBlob, write } from './store.ts'
import { Refusal, requireCondition, requireWellFormed, schemaProblems, unusedId } from './contracts.ts'
import { recordApproval } from './plans.ts'
import { explorationRules, outsideRule } from './rules.ts'
import { existsSync, readdirSync, readFileSync, realpathSync, statSync } from 'node:fs'
import { isAbsolute, join, relative, resolve, sep } from 'node:path'

export const entryKinds = [
	'criterion',
	'observation',
	'defect',
	'question',
	'verdict',
	'note',
	'issue',
	'topic',
] as const
type Kind = (typeof entryKinds)[number] | 'answer'
export type Evidence = { text: string } | { path: string; sha256: string; size: number }
export type Entry = {
	kind: Kind
	id: string
	build?: string
	supersedes?: string
	about?: string
	rule?: string
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
	result?: JournalVerdict['result']
	evidence?: Evidence[]
	answer?: string
	reports?: string[]
	members?: string[]
	blocking?: boolean
	note?: string
	label?: string
	confirms?: string
	refutes?: string
}
export type Row = Entry & { seq: number; actor: string; at: string; ref: string; explorationId: string }
export type Journal = ReturnType<typeof journal>
type Fix = Record<string, unknown>
type Recorded = { replyIds: Set<string>; dropped: string[] }
type Rules = { ids: Set<string>; unknown: string[] }
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
	topic: 'T',
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
		...(entry.members && { members: entry.members.map(name) }),
		...(entry.defect !== undefined && { defect: name(entry.defect) }),
		...(entry.repeats !== undefined && { repeats: name(entry.repeats) }),
		...(entry.confirms !== undefined && { confirms: name(entry.confirms) }),
		...(entry.refutes !== undefined && { refutes: name(entry.refutes) }),
		...(entry.kind === 'answer' && { question: name(entry.question!) }),
	}
}

export function addPlanBuild(store: Store, planId: string, build: string, at: string, operationId: string) {
	execute(
		store,
		'INSERT OR IGNORE INTO plan_builds (plan_id, build, first_tested_at, operation_id) VALUES (?, ?, ?, ?)',
		planId,
		build,
		at,
		operationId
	)
}

export function buildOrder(store: Store, planId: string) {
	return all<{ build: string; first_tested_at: string }>(
		store,
		'SELECT build, first_tested_at FROM plan_builds WHERE plan_id = ? ORDER BY first_tested_at, rowid',
		planId
	).map((row) => ({ build: row.build, firstTestedAt: row.first_tested_at }))
}

export function journal(store: Store, planId: string, viewer?: string, keep: (row: Row) => boolean = () => true) {
	const listed = all<{ seq: number; body: string; actor: string; at: string; exploration_id: string }>(
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
	const rows = listed.filter(keep)
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
	const order = buildOrder(store, planId).map((item) => item.build)
	const position = (build: string) => (order.includes(build) ? order.indexOf(build) : order.length)
	const builds = [...new Set(rows.filter(seen).flatMap((row) => (row.build ? [row.build] : [])))].sort(
		(a, b) => position(a) - position(b)
	)
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
		return { path: name, ...saveBlob(store, evidenceFile(store, name)) }
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
	rules: Rules,
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
	const draft: Fix = { ...given }
	if (typeof draft.supersedes === 'string' && draft.supersedes.startsWith(`${shortName(actor)}/`))
		draft.supersedes = bareOf(draft.supersedes)
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
	const entry = { ...draft, build } as Omit<Entry, 'evidence'> & { evidence?: string | string[] }
	if (recorded && entry.kind === 'criterion' && entry.verdict && !entry.saw?.trim())
		throw new EntryRefusal(
			`${path}.saw`,
			`${path}.saw is required for a criterion verdict in a recorder reply`,
			'Give the specific product behaviour the session observed for this rule, or omit the verdict if the rule remains unverified.'
		)
	if (entry.rule !== undefined && entry.rule !== outsideRule && !rules.ids.has(entry.rule)) {
		rules.unknown.push(entry.rule)
		entry.rule = outsideRule
	}
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
	const everyone = () => lookup(journal(store, state.planId), actor)
	const refer = (id: string, kinds: Kind[], field: string, fix: unknown) => {
		const own = known.get(id)
		const target = own && kinds.includes(own.kind) ? own : kinds.includes('defect') ? everyone().get(id) : own
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
	const listed = (field: 'links' | 'reports' | 'members', kinds: Kind[]) => {
		const ids = entry[field]
		if (!ids) return
		const fix = ids.filter((item) => kinds.includes(known.get(item)?.kind as Kind))
		entry[field] = ids.map((item) => refer(item, kinds, field, field === 'links' ? fix : idsOf(kinds)))
	}
	listed('links', ['observation', 'criterion', 'question'])
	listed('reports', ['defect'])
	listed('members', ['question'])
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
		unknownRules?: string[]
	}
) {
	const { cwd, missingEvidence, droppedReferences, unknownRules, ...logged } = input
	const operation = { actor, command: 'log', subject: input.explorationId, input: logged }
	return write(store, operation, (operationId, _, actor) => {
		const exploration = explorationRow(store, input.explorationId)
		const list = entryList(input.entries)
		requireCondition(list.length, 'The array has no entry.', 'Send one entry, or an array of entries.')
		const saved: Saved[] = []
		const refused: Refused[] = []
		const recorded = droppedReferences && { replyIds: replyIds(list), dropped: droppedReferences }
		const rules = {
			ids: new Set(explorationRules(store, exploration.exploration_id).map((rule) => rule.id)),
			unknown: unknownRules ?? [],
		}
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
					rules,
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
			reply: completed(exploration.exploration_id, {
				saved,
				refused,
				...(rules.unknown.length ? { unknownRules: rules.unknown } : {}),
			}),
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

export function recordText(store: Store, planId: string, viewer: string, build?: string) {
	const state = journal(store, planId, viewer)
	const earlier = planClaims(store, planId).filter((claim) => claim.open && claim.build !== build)
	const lines = [
		...earlier.map((claim) => `open defect ${claim.id} (${claim.build}, ${claim.severity}): ${claim.title}`),
		...ofKind(state, 'criterion').map((criterion) => `criterion ${criterion.id}: ${criterion.text}`),
		...ofKind(state, 'defect').map(
			(defect) => `defect ${defect.id} (${defect.build}, ${defect.severity}): ${defect.title}`
		),
		...planQuestions(store, planId).map(
			(question) =>
				`question ${question.id}: ${question.question}${question.answer ? ` Answer: ${question.answer}` : ''}`
		),
	]
	return lines.length ? lines.join('\n') : 'No criterion, defect, or question yet.'
}

export type ClaimState = 'observed' | 'suspected' | 'confirmed' | 'unresolved' | 'accepted' | 'rejected'
export type BuildStatus = {
	status: 'fixed' | 'not_fixed' | 'disputed' | 'no verdict'
	basis: 'majority' | 'disputed' | 'single' | 'verified' | 'reported' | 'none'
}

export type ClaimDecision = { verdict: 'approved' | 'rejected'; actor: string; rationale: string }
export type Handoff = { to: string; actor: string; at: string }
export type Claim = ReturnType<typeof claimList>[number]

export function mostFrequent(values: Array<string | undefined>) {
	const counts = new Map<string, number>()
	for (const value of values) if (value !== undefined) counts.set(value, (counts.get(value) ?? 0) + 1)
	let best: string | null = null
	let most = 0
	for (const [value, count] of counts)
		if (count > most) {
			best = value
			most = count
		}
	return best
}

const evidenceScore = (entry: Entry) => (entry.evidence?.length ?? 0) * 2 + (entry.steps ? 1 : 0)
const short = (text: string | undefined) =>
	(text ?? '').length > 120 ? `${(text ?? '').slice(0, 117)}...` : (text ?? '')

function claimDecisions(store: Store, planId: string) {
	const rows = all<{ subject_id: string; verdict: 'approved' | 'rejected'; actor: string; rationale: string }>(
		store,
		"SELECT subject_id, verdict, actor, rationale FROM approvals WHERE subject_kind = 'claim' AND subject_id LIKE ? ORDER BY rowid",
		`${planId}:%`
	)
	const decided = new Map<string, ClaimDecision>()
	for (const row of rows)
		decided.set(row.subject_id.slice(planId.length + 1), {
			verdict: row.verdict,
			actor: row.actor,
			rationale: row.rationale,
		})
	return decided
}

function claimHandoffs(store: Store, planId: string) {
	const rows = all<{ claim_id: string; target: string | null; actor: string; at: string }>(
		store,
		'SELECT claim_id, target, actor, at FROM handoffs WHERE plan_id = ? ORDER BY rowid',
		planId
	)
	const handed = new Map<string, Handoff>()
	for (const row of rows)
		if (row.target === null) handed.delete(row.claim_id)
		else handed.set(row.claim_id, { to: row.target, actor: row.actor, at: row.at })
	return handed
}

function claimGroups(state: Journal) {
	const defects = new Map(state.team.filter((entry) => entry.kind === 'defect').map((entry) => [entry.id, entry]))
	const recorded = state.team.filter((entry) => entry.kind === 'issue')
	const grouped = new Set(recorded.flatMap((issue) => issue.reports ?? []))
	return [
		...recorded.map((issue) => ({ issue, reports: (issue.reports ?? []).filter((id) => defects.has(id)) })),
		...[...defects.values()]
			.filter((defect) => !grouped.has(defect.id))
			.map((defect) => ({ issue: defect, reports: [defect.id] })),
	]
		.filter((group) => group.reports.length)
		.map((group) => ({ ...group, found: group.reports.map((id) => defects.get(id)!) }))
}

export function claimList(
	state: Journal,
	decided: Map<string, ClaimDecision> = new Map(),
	handed: Map<string, Handoff> = new Map()
) {
	const order = (build: string | undefined) => state.builds.indexOf(build ?? '')
	return claimGroups(state).map(({ issue, reports, found }) => {
		const actors = [...new Set(found.map((defect) => defect.actor))]
		const names = [issue.id, ...reports]
		const checks = state.team
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
		const verified = !firstCheck ? 'none' : confirms(firstCheck) ? 'confirmed' : 'refuted'
		const verdicts = state.team
			.filter(
				(entry) =>
					entry.kind === 'verdict' && entry.result !== 'not_retested' && names.includes(entry.defect ?? '')
			)
			.sort((a, b) => a.seq - b.seq)
		const statusOn = (build: string): BuildStatus => {
			const results = new Map<string, string>()
			for (const verdict of verdicts.filter((entry) => entry.build === build))
				results.set(verdict.actor, verdict.result!)
			const count = (result: string) => [...results.values()].filter((item) => item === result).length
			const check = checkOn(build)
			if (check) return { status: confirms(check) ? 'not_fixed' : 'fixed', basis: 'verified' }
			if (found.some((defect) => defect.build === build)) return { status: 'not_fixed', basis: 'reported' }
			if (!results.size) return { status: 'no verdict', basis: 'none' }
			if (count('fixed') === count('not_fixed')) return { status: 'disputed', basis: 'disputed' }
			return {
				status: count('fixed') > count('not_fixed') ? 'fixed' : 'not_fixed',
				basis: results.size === 1 ? 'single' : 'majority',
			}
		}
		const retests = state.builds.slice(first + 1).map((build) => [build, statusOn(build)] as const)
		const latestRetest = retests.findLast(([, on]) => on.status !== 'no verdict')?.[1].status ?? null
		const decision = decided.get(issue.id) ?? null
		const confirmed = actors.length > 1 || verified === 'confirmed'
		const suspected = found.every((defect) => defect.suspected || (!defect.steps && !defect.evidence?.length))
		const claimState: ClaimState = decision
			? decision.verdict === 'approved'
				? 'accepted'
				: 'rejected'
			: confirmed
				? 'confirmed'
				: verified === 'refuted'
					? 'unresolved'
					: suspected
						? 'suspected'
						: 'observed'
		return {
			id: issue.id,
			title: issue.title!,
			severity: issue.severity!,
			build: state.builds[first],
			explorationId: issue.explorationId,
			expected: best.expected!,
			actual: best.actual!,
			steps: best.steps ?? null,
			evidence: best.evidence ?? [],
			reports,
			reporters: actors.length,
			actors: actors.map(shortName),
			rule: mostFrequent(found.map((defect) => defect.rule)),
			state: claimState,
			verified,
			verifierSaw: verified === 'refuted' ? (firstCheck?.saw ?? null) : null,
			reason:
				claimState === 'unresolved'
					? `The verifier did not see it: ${firstCheck?.saw ?? 'no reason given'}`
					: (decision?.rationale ?? null),
			decision,
			handoff: handed.get(issue.id) ?? null,
			statuses: Object.fromEntries(retests),
			latestRetest,
			open: claimState !== 'rejected' && latestRetest !== 'fixed',
			note: issue.note ?? null,
		}
	})
}

export function planClaims(store: Store, planId: string, keep?: (row: Row) => boolean) {
	return claimList(
		journal(store, planId, undefined, keep),
		claimDecisions(store, planId),
		claimHandoffs(store, planId)
	)
}

export const factoryStates: ClaimState[] = ['observed', 'confirmed', 'accepted']
export const oracleStates: ClaimState[] = ['suspected', 'unresolved']

export function planQuestions(store: Store, planId: string, keep?: (row: Row) => boolean) {
	const state = journal(store, planId, undefined, keep)
	const answers = state.team.filter((entry) => entry.kind === 'answer')
	const questions = new Map(state.team.filter((entry) => entry.kind === 'question').map((entry) => [entry.id, entry]))
	const topics = state.team.filter((entry) => entry.kind === 'topic')
	const grouped = new Set(topics.flatMap((topic) => topic.members ?? []))
	const groups = [
		...topics.map((topic) => ({ head: topic, members: (topic.members ?? []).filter((id) => questions.has(id)) })),
		...[...questions.values()]
			.filter((entry) => !grouped.has(entry.id))
			.map((entry) => ({ head: entry, members: [entry.id] })),
	].filter((group) => group.members.length)
	return groups.map(({ head, members }) => {
		const names = new Set([head.id, ...members])
		const found = members.map((id) => questions.get(id)!)
		const answer = answers.filter((entry) => names.has(entry.question!)).at(-1)
		return {
			id: head.id,
			explorationId: head.explorationId,
			at: head.at,
			question: head.question!,
			label: head.kind === 'topic' ? (head.label ?? null) : null,
			actual: found.map((entry) => entry.actual).find(Boolean) ?? null,
			rule: mostFrequent(found.map((entry) => entry.rule)),
			builds: [...new Set(found.flatMap((entry) => (entry.build ? [entry.build] : [])))],
			members,
			blocking: found.some((entry) => entry.blocking === true),
			about: head.about ?? null,
			answer: answer?.answer ?? null,
			answerId: answer?.id ?? null,
			decision: (answer as { decision?: string } | undefined)?.decision ?? null,
		}
	})
}

export function planCriteria(store: Store, planId: string) {
	return ofKind(journal(store, planId), 'criterion').map(({ id, text, source }) => ({
		id,
		text: text!,
		source: source ?? null,
	}))
}

export function criterionCounts(entries: Entry[]) {
	return {
		right: entries.filter((entry) => entry.verdict === 'ok').length,
		wrong: entries.filter((entry) => entry.verdict === 'wrong').length,
	}
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
const overlap = (a: Set<string>, b: Set<string>) =>
	[...a].filter((word) => b.has(word)).length / (new Set([...a, ...b]).size || 1)
const similarWords = 0.5

const stepText = (entry: Entry) => [entry.steps ?? []].flat().join(' ')
const someWords = 0.25

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

export function unplacedMatches(state: Journal, claims: Claim[], build: string, after = 0) {
	const byId = new Map(state.team.map((entry) => [entry.id, entry]))
	const single = claims.filter(
		(claim) =>
			claim.build === build &&
			claim.reports.length === 1 &&
			claim.id === claim.reports[0] &&
			byId.get(claim.id)!.seq > after
	)
	return single.flatMap((own) => {
		const report = byId.get(own.id)!
		const like = claims.flatMap((other) => {
			if (other.id === own.id || other.state === 'rejected') return []
			const reason = other.reports
				.map((id) => byId.get(id))
				.filter((entry) => entry && entry.actor !== report.actor)
				.map((entry) => likeness(report, entry!))
				.find(Boolean)
			return reason ? [{ id: other.id, title: other.title, reason }] : []
		})
		return like.length ? [{ report: own.id, title: own.title, like }] : []
	})
}

export function mergeItems(state: Journal, build: string, claims: Claim[] = [], after = 0) {
	const defects = state.team.filter((entry) => entry.kind === 'defect' && entry.build === build && entry.seq > after)
	const fresh = new Set(defects.map((defect) => defect.id))
	const testers = new Set(defects.map((defect) => defect.actor))
	const groups: string[][] = []
	for (const [index, a] of defects.entries())
		for (const b of defects.slice(index + 1)) {
			if (a.actor === b.actor || overlap(wordsOf(a), wordsOf(b)) < similarWords) continue
			const joined = groups.filter((group) => group.includes(a.id) || group.includes(b.id))
			const group = [...new Set([...joined.flat(), a.id, b.id])]
			groups.splice(0, groups.length, ...groups.filter((item) => !joined.includes(item)), group)
		}
	const questions = state.team.filter(
		(entry) => entry.kind === 'question' && entry.build === build && entry.seq > after
	)
	const earlier = claims
		.filter(
			(claim) =>
				claim.state !== 'rejected' &&
				(claim.build !== build || (after > 0 && !claim.reports.some((id) => fresh.has(id))))
		)
		.map((claim) => ({
			id: claim.id,
			reports: claim.reports,
			title: short(claim.title),
			expected: short(claim.expected),
			actual: short(claim.actual),
		}))
	return {
		earlier,
		testers: testers.size,
		questionTesters: new Set(questions.map((entry) => entry.actor)).size,
		questions: questions.map((entry) => ({ id: entry.id, question: short(entry.question) })),
		defects: defects.map((defect) => ({
			id: defect.id,
			severity: defect.severity!,
			title: short(defect.title),
			expected: short(defect.expected),
			actual: short(defect.actual),
			steps: short([defect.steps ?? []].flat().join(' ')),
		})),
		groups,
	}
}

export function joinClaims(entries: unknown[], claims: Claim[]) {
	const issues = new Map(
		claims.filter((claim) => claim.id !== claim.reports[0]).map((claim) => [claim.id, claim.reports])
	)
	return entries.map((raw) => {
		const entry = raw as Partial<Entry> | null
		if (!entry || entry.kind !== 'issue' || entry.supersedes !== undefined || !Array.isArray(entry.reports))
			return raw
		const named = new Set(entry.reports)
		const into = [...issues].find(([id, reports]) => named.has(id) || reports.some((report) => named.has(report)))
		if (!into) return raw
		const reports = [...new Set([...into[1], ...entry.reports.filter((id) => id !== into[0])])]
		issues.set(into[0], reports)
		const { id: _, ...rest } = entry
		return { ...rest, supersedes: into[0], reports }
	})
}

export function verifyItems(claims: Claim[], build: string, fresh?: Set<string>) {
	return claims.filter(
		(claim) =>
			claim.build === build &&
			claim.reporters === 1 &&
			claim.verified === 'none' &&
			!claim.decision &&
			(!fresh || claim.reports.some((id) => fresh.has(id)))
	)
}

export function answerQuestion(
	store: Store,
	actor: string,
	operationId: string,
	input: { planId: string; questionId: string; kind: string; value: string; source: string | null; rationale: string }
) {
	const state = journal(store, input.planId)
	const question = state.team.find(
		(entry) => (entry.kind === 'question' || entry.kind === 'topic') && entry.id === input.questionId
	)
	requireCondition(
		question,
		`Unknown gap or question ${input.questionId} of plan ${input.planId}.`,
		'Run checkmate inbox to read the open gaps and questions with their IDs.'
	)
	const used = state.rows.filter((row) => row.actor === actor).map((row) => row.id)
	const entry: Entry & { decision: string; source?: string; rationale: string } = {
		kind: 'answer',
		id: unusedId('A', used),
		question: question.id,
		answer: input.value,
		decision: input.kind,
		...(input.source ? { source: input.source } : {}),
		rationale: input.rationale,
	}
	insertEntry(store, question.explorationId, entry, actor, operationId)
	return entry
}

export function handOffClaims(
	store: Store,
	actor: string | undefined,
	input: { planId: string; claimIds: string[]; to?: string; undo: boolean }
) {
	return write(store, { actor, command: 'claim handoff', subject: input.planId, input }, (operationId, at, actor) => {
		const target = input.to?.trim()
		requireWellFormed(
			input.undo !== Boolean(target),
			'Give either --to "<who or what>" or --undo.',
			`checkmate claim handoff ${input.planId} <claimId...> --to "<who or what>"`
		)
		const claims = planClaims(store, input.planId)
		const chosen = [...new Set(input.claimIds)].map((id) => {
			const claim = claims.find((item) => item.id === id)
			requireCondition(
				claim,
				`Unknown claim ${id} of plan ${input.planId}.`,
				`Use one of: ${claims.map((item) => item.id).join(', ') || 'no claim yet'}.`
			)
			if (input.undo) requireCondition(claim.handoff, `Claim ${id} is not handed over. There is nothing to undo.`)
			else requireCondition(claim.state !== 'rejected', `Claim ${id} is rejected. Hand over an open claim.`)
			return claim
		})
		for (const claim of chosen)
			execute(
				store,
				'INSERT INTO handoffs (plan_id, claim_id, target, actor, at, operation_id) VALUES (?, ?, ?, ?, ?, ?)',
				input.planId,
				claim.id,
				target ?? null,
				actor,
				at,
				operationId
			)
		return {
			reply: completed(input.planId, {
				planId: input.planId,
				claims: chosen.map((claim) => claim.id),
				to: target ?? null,
				undo: input.undo,
			}),
			subjects: [
				`plan:${input.planId}`,
				...new Set(chosen.map((claim) => `exploration:${claim.explorationId}`)),
				'inbox',
			],
		}
	})
}

export function decideClaim(
	store: Store,
	actor: string | undefined,
	input: { planId: string; claimId: string; verdict: 'approved' | 'rejected'; rationale: string }
) {
	const command = input.verdict === 'approved' ? 'claim accept' : 'claim reject'
	return write(store, { actor, command, subject: input.planId, input }, (operationId, _, actor) => {
		const claims = planClaims(store, input.planId)
		const claim = claims.find((item) => item.id === input.claimId)
		requireCondition(
			claim,
			`Unknown claim ${input.claimId} of plan ${input.planId}.`,
			`Use one of: ${claims.map((item) => item.id).join(', ') || 'no claim yet'}.`
		)
		const sha256 = digest(canonical({ id: claim.id, reports: claim.reports, title: claim.title }))
		const reply = recordApproval(store, actor, operationId, {
			kind: 'claim',
			subject: `${input.planId}:${claim.id}`,
			sha256,
			verdict: input.verdict,
			rationale: input.rationale,
		})
		return {
			reply: { ...reply, subject: input.planId, data: { ...reply.data, claimId: claim.id } },
			subjects: [`plan:${input.planId}`, `exploration:${claim.explorationId}`, 'inbox'],
		}
	})
}
