import { createReadStream, realpathSync } from 'node:fs'
import { readdir } from 'node:fs/promises'
import { homedir } from 'node:os'
import { basename, join, resolve } from 'node:path'
import { createInterface } from 'node:readline'
import { all, completed, write } from './store.ts'
import type { Store } from './store.ts'
import { piMessageCost } from './pi.ts'
import type { Env } from './sessions.ts'

type Phase = {
	operation: string
	step: string
	explorer: string
	session: string
	parent: string | null
	since: string
	until: string
}
type Session = {
	parent: string | null
	messages: Map<string, { at: string; cost: number | null }>
}

async function readUsage(path: string, workspace: string, session: string): Promise<Session | undefined> {
	const stream = createReadStream(path, { encoding: 'utf8' })
	let usage: Session | undefined
	try {
		for await (const line of createInterface({ input: stream, crlfDelay: Infinity })) {
			if (!line.trim()) continue
			const entry = JSON.parse(line)
			if (!usage) {
				if (entry.type !== 'session' || entry.id !== session || realpathSync(entry.cwd) !== workspace) return
				usage = { parent: entry.parentSession ? basename(entry.parentSession) : null, messages: new Map() }
			} else if (entry.type === 'message') {
				const cost = piMessageCost(entry.message)
				if (cost === undefined) continue
				if (typeof entry.id !== 'string' || typeof entry.timestamp !== 'string') return
				usage.messages.set(entry.id, { at: entry.timestamp, cost })
			}
		}
		return usage
	} catch {
		return undefined
	} finally {
		stream.destroy()
	}
}

export async function recoverPiCosts(store: Store, env: Env) {
	const phases = all<Phase>(
		store,
		`
		SELECT e.operation_id AS operation, e.step, coalesce(e.explorer, '') AS explorer,
			CASE WHEN e.step = 'record' THEN e.detail ->> 'recorder' ELSE e.detail ->> 'session' END AS session,
			CASE WHEN e.step = 'record' THEN e.detail ->> 'session' END AS parent,
			CASE WHEN e.step = 'follow-turn' THEN (SELECT max(f.at) FROM exploration_events f WHERE f.exploration_id = e.exploration_id
				AND f.step = 'follow' AND f.rowid < e.rowid) ELSE start.at END AS since, e.at AS until
		FROM exploration_events start JOIN exploration_events e ON e.exploration_id = start.exploration_id
		JOIN exploration_events done ON done.exploration_id = e.exploration_id AND done.step = 'done'
		LEFT JOIN exploration_event_costs c ON c.source_operation_id = e.operation_id
			AND c.step = e.step AND c.explorer = coalesce(e.explorer, '')
		WHERE start.step = 'start' AND start.detail ->> '$.context.harness' = 'pi'
			AND e.step IN ('end', 'record', 'rules', 'merge', 'verify', 'follow-turn')
			AND coalesce(json_type(e.detail, '$.costUsd'), '') NOT IN ('integer', 'real') AND c.cost_usd IS NULL
	`
	)
	if (!phases.length) return
	const workspace = realpathSync(store.workspace)
	const home = env.HOME || env.USERPROFILE || homedir()
	const expand = (path: string) =>
		resolve(
			workspace,
			path.replace(/^~(?=$|[/\\])/, () => home)
		)
	const agent = expand(env.PI_CODING_AGENT_DIR || join(home, '.pi', 'agent'))
	const project = '--' + workspace.replace(/^[/\\]/, '').replace(/[/\\:]/g, '-') + '--'
	const folder = env.PI_CODING_AGENT_SESSION_DIR
		? expand(env.PI_CODING_AGENT_SESSION_DIR)
		: join(agent, 'sessions', project)
	const files = await readdir(folder, { withFileTypes: true }).catch(() => [])
	const paths = new Map<string, string>()
	for (const file of files) {
		const id = /_([0-9a-f-]{36})\.jsonl$/i.exec(file.name)?.[1]
		if (file.isFile() && id) paths.set(id, join(folder, file.name))
	}
	const sessions = new Map<string, Promise<Session | undefined>>()
	function load(id: string) {
		const path = paths.get(id)
		if (!path) return
		if (!sessions.has(id)) sessions.set(id, readUsage(path, workspace, id))
		return sessions.get(id)
	}
	const costs: Array<Phase & { total: number; partial: boolean }> = []
	for (const phase of phases) {
		const session = await load(phase.session)
		if (!session) continue
		const parent = phase.parent ? await load(phase.parent) : undefined
		if (phase.parent && (!parent || session.parent !== basename(paths.get(phase.parent)!))) continue
		if (!phase.parent && session.parent) continue
		let total = 0
		let reported = false
		let partial = false
		for (const [id, { at, cost }] of session.messages) {
			if (parent?.messages.has(id) || at < phase.since || at > phase.until) continue
			if (cost === null) partial = true
			else {
				total += cost
				reported = true
			}
		}
		if (reported && Number.isFinite(total)) costs.push({ ...phase, total, partial })
	}
	if (!costs.length) return
	write(
		store,
		{ actor: 'checkmate', command: 'recover Pi costs', subject: 'explorations', input: null },
		(operationId) => {
			const insert = store.db.prepare(`INSERT INTO exploration_event_costs
			(source_operation_id, step, explorer, cost_usd, partial, operation_id) VALUES (?, ?, ?, ?, ?, ?)
			ON CONFLICT (source_operation_id, step, explorer) DO NOTHING`)
			let saved = 0
			for (const cost of costs)
				saved += Number(
					insert.run(cost.operation, cost.step, cost.explorer, cost.total, Number(cost.partial), operationId)
						.changes
				)
			return { reply: completed('explorations', { saved }), subjects: ['explorations'] }
		}
	)
}
