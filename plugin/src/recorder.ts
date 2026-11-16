import type { Reply, Status, Store } from './store.ts'
import { all, one, write } from './store.ts'
import { Refusal } from './contracts.ts'
import { recorderPrompt } from './guide.ts'
import { changeState } from './journal.ts'
import { spawnSync } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { accessSync, constants, readdirSync, realpathSync, statSync } from 'node:fs'
import { homedir } from 'node:os'
import { delimiter, join } from 'node:path'

type Env = Record<string, string | undefined>
type RecordInput = { changeId: string; build?: string; session?: string; timeoutSeconds: number }
type ClaudeResult = {
	session_id?: unknown
	total_cost_usd?: unknown
	duration_ms?: unknown
	is_error?: unknown
	result?: unknown
}

export const defaultRecorderTimeout = 600
const maxOutputBytes = 4 * 1024 * 1024
const longestProjectName = 200

function names(directory: string) {
	try {
		return readdirSync(directory)
	} catch {
		return []
	}
}

function executableOnPath(name: string, env: Env) {
	for (const directory of (env.PATH ?? '').split(delimiter).filter(Boolean)) {
		const path = join(directory, name)
		try {
			accessSync(path, constants.X_OK)
			if (statSync(path).isFile()) return path
		} catch {}
	}
	return undefined
}

function claudeProjectFolders(workspace: string, env: Env) {
	const projects = join(env.CLAUDE_CONFIG_DIR?.trim() || join(homedir(), '.claude'), 'projects')
	const name = realpathSync(workspace).replace(/[^a-zA-Z0-9]/g, '-')
	if (name.length <= longestProjectName) return [join(projects, name)]
	const prefix = `${name.slice(0, longestProjectName)}-`
	return names(projects)
		.filter((folder) => folder.startsWith(prefix))
		.map((folder) => join(projects, folder))
}

function earlierRecorders(store: Store) {
	return all<{ recorder: string | null }>(
		store,
		"SELECT json_extract(arguments, '$.recorder') AS recorder FROM operations WHERE command = 'record'"
	).flatMap((row) => (row.recorder ? [row.recorder] : []))
}

function latestSession(folders: string[], skip: Set<string>) {
	return folders
		.flatMap((folder) =>
			names(folder)
				.filter((name) => /^[0-9a-f-]{36}\.jsonl$/i.test(name))
				.map((name) => ({ id: name.slice(0, -'.jsonl'.length), at: statSync(join(folder, name)).mtimeMs }))
		)
		.filter((session) => !skip.has(session.id))
		.sort((a, b) => b.at - a.at)[0]?.id
}

function lastEntry(store: Store) {
	return one<{ seq: number }>(store, 'SELECT coalesce(max(rowid), 0) AS seq FROM journal_entries')!.seq
}

function addedEntries(store: Store, changeId: string, actor: string, after: number) {
	const rows = all<{ kind: string; count: number }>(
		store,
		'SELECT kind, count(*) AS count FROM journal_entries WHERE change_id = ? AND actor = ? AND rowid > ? GROUP BY kind ORDER BY min(rowid)',
		changeId,
		actor,
		after
	)
	return Object.fromEntries(rows.map((row) => [row.kind, row.count]))
}

function claudeResult(output: string): ClaudeResult {
	try {
		const parsed = JSON.parse(output) as unknown
		return parsed && typeof parsed === 'object' ? (parsed as ClaudeResult) : {}
	} catch {
		return {}
	}
}

function excerpt(text: unknown) {
	const line = typeof text === 'string' ? text.trim().split('\n')[0].slice(0, 200) : ''
	return line ? `: ${line}` : ''
}

function prepare(store: Store, actor: string | undefined, input: RecordInput, env: Env) {
	const writer = actor?.trim()
	if (!writer) throw new Error('A write needs an actor. Use --actor <name> or set CHECKMATE_ACTOR.')
	if (env.CHECKMATE_RECORDER)
		throw new Refusal(
			'prohibited',
			'A recorder cannot start another recorder. CHECKMATE_RECORDER is set. Nothing changed.',
			'Run checkmate record from outside the recorder session, after the test session.'
		)
	changeState(store, input.changeId)
	const claude = executableOnPath('claude', env)
	if (!claude)
		throw new Refusal(
			'prohibited',
			'No claude executable on PATH. Nothing changed.',
			'Install Claude Code, or add the directory of claude to PATH. Then run the command again.'
		)
	const folders = claudeProjectFolders(store.workspace, env)
	const skip = new Set([
		...earlierRecorders(store),
		...(env.CLAUDE_CODE_SESSION_ID ? [env.CLAUDE_CODE_SESSION_ID] : []),
	])
	const session = input.session ?? latestSession(folders, skip)
	if (!session)
		throw new Refusal(
			'prohibited',
			`No Claude Code session of ${store.workspace} in ${folders.join(', ') || 'the projects folder of Claude Code'}. Nothing changed.`,
			`Pass the ID of the test session: checkmate record ${input.changeId} --session <sessionId>. claude -p --output-format json gives it in session_id.`
		)
	return { claude, session, recorder: randomUUID(), actor: writer }
}

function recorderArgs(session: string, recorder: string, checkmate: string) {
	return [
		'-p',
		'--resume',
		session,
		'--fork-session',
		'--session-id',
		recorder,
		'--output-format',
		'json',
		'--permission-prompts',
		'none',
		'--allowedTools',
		`Bash(${checkmate} *)`,
		'Read',
	]
}

export function recordSession(
	store: Store,
	actor: string | undefined,
	input: RecordInput,
	host: { env: Env; script?: string }
): Reply {
	const operation = { actor, command: 'record', subject: input.changeId, input }
	let plan: ReturnType<typeof prepare>
	try {
		plan = prepare(store, actor, input, host.env)
	} catch (error) {
		return write(store, operation, () => {
			throw error
		})
	}
	const checkmate = host.script ? `node ${host.script}` : 'checkmate'
	const prompt = [
		recorderPrompt(input.changeId, input.build),
		...(host.script ? [`\`checkmate <command>\` means \`${checkmate} <command>\`.`] : []),
	].join('\n')
	const after = lastEntry(store)
	const child = spawnSync(plan.claude, recorderArgs(plan.session, plan.recorder, checkmate), {
		cwd: store.workspace,
		env: {
			...host.env,
			CHECKMATE_WORKSPACE: store.workspace,
			CHECKMATE_ACTOR: plan.actor,
			CHECKMATE_RECORDER: '1',
		},
		input: prompt,
		encoding: 'utf8',
		timeout: input.timeoutSeconds * 1000,
		killSignal: 'SIGTERM',
		maxBuffer: maxOutputBytes,
	})
	const added = addedEntries(store, input.changeId, plan.actor, after)
	const entries = Object.values(added).reduce((sum, count) => sum + count, 0)
	const result = claudeResult(child.stdout ?? '')
	const code = child.error && 'code' in child.error ? String(child.error.code) : undefined
	const [status, reason]: [Status, string | undefined] =
		code === 'ETIMEDOUT'
			? ['interrupted', `The recorder did not end in ${input.timeoutSeconds} seconds. Checkmate stopped it.`]
			: code
				? ['operational_error', `The recorder failed: ${code}.`]
				: child.status !== 0
					? [
							'operational_error',
							`The recorder exited with ${child.signal ? `signal ${child.signal}` : `code ${child.status}`}${excerpt(child.stderr || result.result)}`,
						]
					: result.is_error === true
						? ['operational_error', `The recorder ended with an error${excerpt(result.result)}`]
						: !entries
							? ['operational_error', `The recorder added no entry to ${input.changeId}.`]
							: ['completed', undefined]
	const reply: Reply = {
		status,
		subject: input.changeId,
		reasons: reason ? [reason] : [],
		...(reason
			? {
					hint: `The entries that the recorder added stay. To read what it did, run claude --resume ${plan.recorder}. Then run checkmate record ${input.changeId} again.`,
				}
			: {}),
		data: {
			changeId: input.changeId,
			build: input.build ?? null,
			session: plan.session,
			recorder: typeof result.session_id === 'string' ? result.session_id : plan.recorder,
			added,
			entries,
			...(typeof result.total_cost_usd === 'number' ? { costUsd: result.total_cost_usd } : {}),
			...(typeof result.duration_ms === 'number' ? { durationMs: result.duration_ms } : {}),
		},
	}
	return write(store, { ...operation, input: { ...input, session: plan.session, recorder: plan.recorder } }, () => ({
		reply,
		subjects: [`change:${input.changeId}`],
	}))
}
