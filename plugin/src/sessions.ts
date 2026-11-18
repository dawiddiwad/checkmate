import { Refusal } from './contracts.ts'
import type { ChildProcess } from 'node:child_process'
import { spawn, spawnSync } from 'node:child_process'
import {
	accessSync,
	chmodSync,
	constants,
	mkdirSync,
	readFileSync,
	realpathSync,
	rmSync,
	statSync,
	writeFileSync,
} from 'node:fs'
import { homedir } from 'node:os'
import { delimiter, join } from 'node:path'
import { fileURLToPath } from 'node:url'

export type Env = Record<string, string | undefined>
export type ChildHook = { port: number; token: string; explorationId: string; who: string }
export type ChildContext = { hiddenPlugin: string | null; claudeArgs: string[]; deny?: string[]; hook?: ChildHook }
export type UiFile = { port: number; pid: number; hookToken: string }

export const hookTokenName = 'CHECKMATE_HOOK_TOKEN'
const permissionTimeoutSeconds = 600
const activityTimeoutSeconds = 5

export const storeDenyRules = [
	'Read(./.checkmate/**)',
	'Edit(./.checkmate/**)',
	'Bash(ls .checkmate:*)',
	'Bash(cat .checkmate:*)',
	'Bash(sqlite3 .checkmate:*)',
]

export function workDenyRules(otherFolders: string[]) {
	return [
		'Read(./.checkmate/checkmate.db*)',
		'Edit(./.checkmate/checkmate.db*)',
		'Read(./.checkmate/tmp/**)',
		'Edit(./.checkmate/tmp/**)',
		'Bash(cat .checkmate/checkmate.db:*)',
		'Bash(sqlite3 .checkmate:*)',
		...otherFolders.flatMap((folder) => [`Read(./${folder}/**)`, `Edit(./${folder}/**)`]),
	]
}
export type ClaudeCall = {
	failure?: ['interrupted' | 'operational_error', string]
	result?: unknown
	costUsd?: number
	durationMs?: number
	sessionId?: string
	stderr?: string[]
}

export const pluginRoot = fileURLToPath(new URL('..', import.meta.url))
const maxOutputBytes = 4 * 1024 * 1024

export const reservedClaudeArgs = [
	'-p',
	'--print',
	'--output-format',
	'--input-format',
	'--json-schema',
	'--plugin-dir',
	'--settings',
	'--resume',
	'--fork-session',
	'--session-id',
	'--permission-prompts',
	'--allowedTools',
	'--allowed-tools',
	'--tools',
	'--disallowedTools',
	'--disallowed-tools',
]

export function checkmateScript() {
	const own = fileURLToPath(import.meta.url)
	return own.endsWith('.ts') ? join(pluginRoot, 'bin', 'checkmate.ts') : own
}

export function claudeConfigDir(env: Env) {
	return env.CLAUDE_CONFIG_DIR?.trim() || join(homedir(), '.claude')
}

function realPath(path: string) {
	try {
		return realpathSync(path)
	} catch {
		return undefined
	}
}

export function installedPluginId(env: Env, root = pluginRoot): string | null {
	let installed: { plugins?: Record<string, Array<{ installPath?: unknown }>> }
	try {
		installed = JSON.parse(readFileSync(join(claudeConfigDir(env), 'plugins', 'installed_plugins.json'), 'utf8'))
	} catch {
		return null
	}
	const own = realPath(root)
	for (const [id, installs] of Object.entries(installed.plugins ?? {}))
		for (const install of Array.isArray(installs) ? installs : [])
			if (typeof install.installPath === 'string' && own && realPath(install.installPath) === own) return id
	return null
}

export function checkClaudeArgs(claudeArgs: string[]) {
	for (const arg of claudeArgs) {
		const reserved = reservedClaudeArgs.find((flag) => arg === flag || arg.startsWith(`${flag}=`))
		if (reserved)
			throw new Refusal(
				'malformed',
				`--claude-arg ${arg} is not permitted. Checkmate needs its own control of ${reserved}.`,
				'Give tool rules with --allow. Give other host choices, for example --model, with --claude-arg.'
			)
	}
	return claudeArgs
}

export function uiFilePath(workspace: string) {
	return join(workspace, '.checkmate', 'ui.json')
}

function zombie(pid: number) {
	try {
		return readFileSync(`/proc/${pid}/stat`, 'utf8').split(') ')[1]?.startsWith('Z') === true
	} catch {
		return false
	}
}

export function running(pid: unknown) {
	if (typeof pid !== 'number') return false
	try {
		process.kill(pid, 0)
		return !zombie(pid)
	} catch (error) {
		return (error as NodeJS.ErrnoException).code === 'EPERM'
	}
}

function readUiFile(workspace: string): UiFile | null {
	try {
		const file = JSON.parse(readFileSync(uiFilePath(workspace), 'utf8')) as Partial<UiFile>
		const valid =
			Number.isInteger(file.port) &&
			Number.isInteger(file.pid) &&
			typeof file.hookToken === 'string' &&
			file.hookToken !== ''
		return valid ? (file as UiFile) : null
	} catch {
		return null
	}
}

export function liveUi(workspace: string) {
	const file = readUiFile(workspace)
	return file && running(file.pid) ? file : null
}

export function writeUiFile(workspace: string, file: UiFile) {
	mkdirSync(join(workspace, '.checkmate'), { recursive: true })
	writeFileSync(uiFilePath(workspace), JSON.stringify(file), { mode: 0o600 })
	chmodSync(uiFilePath(workspace), 0o600)
}

export function removeUiFile(workspace: string, hookToken: string) {
	if (readUiFile(workspace)?.hookToken === hookToken) rmSync(uiFilePath(workspace), { force: true })
}

export function childHook(workspace: string, explorationId: string, who: string): ChildHook | undefined {
	const ui = liveUi(workspace)
	return ui ? { port: ui.port, token: ui.hookToken, explorationId, who } : undefined
}

export function hookSettings(hook: ChildHook) {
	const base = `http://127.0.0.1:${hook.port}/hooks`
	const entry = (path: string, timeout: number) => [
		{
			hooks: [
				{
					type: 'http',
					url: `${base}/${path}/${hook.explorationId}/${hook.who}`,
					timeout,
					headers: { Authorization: `Bearer $${hookTokenName}` },
					allowedEnvVars: [hookTokenName],
				},
			],
		},
	]
	return {
		hooks: {
			PermissionRequest: entry('permission', permissionTimeoutSeconds),
			PreToolUse: entry('activity', activityTimeoutSeconds),
		},
	}
}

export function childArgs(context: ChildContext, own: string[]) {
	const settings = {
		...(context.hiddenPlugin ? { enabledPlugins: { [context.hiddenPlugin]: false } } : {}),
		...(context.deny?.length ? { permissions: { deny: context.deny } } : {}),
		...(context.hook ? hookSettings(context.hook) : {}),
	}
	return [
		'-p',
		...context.claudeArgs,
		...(Object.keys(settings).length ? ['--settings', JSON.stringify(settings)] : []),
		...own,
		'--output-format',
		'json',
		'--permission-prompts',
		'none',
	]
}

export function childEnv(env: Env, extra: Env = {}, hook?: ChildHook) {
	return {
		...Object.fromEntries(Object.entries(env).filter(([name]) => !name.startsWith('CHECKMATE_'))),
		...extra,
		...(hook ? { [hookTokenName]: hook.token } : {}),
	}
}

export function executableOnPath(name: string, env: Env) {
	for (const directory of (env.PATH ?? '').split(delimiter).filter(Boolean)) {
		const path = join(directory, name)
		try {
			accessSync(path, constants.X_OK)
			if (statSync(path).isFile()) return path
		} catch {}
	}
	return undefined
}

export function requireClaude(env: Env) {
	const claude = executableOnPath('claude', env)
	if (!claude)
		throw new Refusal(
			'prohibited',
			'No claude executable on PATH. Nothing changed.',
			'Install Claude Code, or add the directory of claude to PATH. Then run the command again.'
		)
	return claude
}

export const authenticationHint =
	'The host session does not pass its login token to the commands that it runs. Log in on this machine so that Claude Code stores the login (run claude and log in), or run checkmate test from a shell outside a Claude Code session, or let the host give the credential in a supported way, for example an apiKeyHelper in the host settings.'

export function authenticationFailed(call: ClaudeCall) {
	return (
		Boolean(call.failure) &&
		/authentication/i.test(
			[call.failure?.[1] ?? '', ...(call.stderr ?? []), typeof call.result === 'string' ? call.result : ''].join(
				' '
			)
		)
	)
}

const stderrLines = 10
const stderrLineLength = 300

export function stderrTail(text: string, count = stderrLines) {
	return text
		.split('\n')
		.map((line) => line.trimEnd())
		.filter(Boolean)
		.slice(-count)
		.map((line) => line.slice(0, stderrLineLength))
}

export function excerpt(text: unknown) {
	const line = typeof text === 'string' ? text.trim().split('\n')[0].slice(0, 200) : ''
	return line ? `: ${line}` : ''
}

export function claudeResult(output: string, error: string, status: number | null, signal: string | null) {
	let parsed: Record<string, unknown> = {}
	try {
		const value = JSON.parse(output) as unknown
		if (value && typeof value === 'object') parsed = value as Record<string, unknown>
	} catch {}
	const failure: ClaudeCall['failure'] =
		status !== 0
			? [
					'operational_error',
					`claude exited with ${signal ? `signal ${signal}` : `code ${status}`}${excerpt(error || parsed.result)}`,
				]
			: parsed.is_error === true
				? ['operational_error', `claude ended with an error${excerpt(parsed.result)}`]
				: undefined
	const tail = failure ? stderrTail(error) : []
	return {
		failure,
		...(tail.length ? { stderr: tail } : {}),
		result: parsed.result,
		...(typeof parsed.total_cost_usd === 'number' ? { costUsd: parsed.total_cost_usd } : {}),
		...(typeof parsed.duration_ms === 'number' ? { durationMs: parsed.duration_ms } : {}),
		...(typeof parsed.session_id === 'string' ? { sessionId: parsed.session_id } : {}),
	}
}

export function callClaude(
	claude: string,
	args: string[],
	prompt: string,
	cwd: string,
	env: Env,
	seconds: number
): ClaudeCall {
	const child = spawnSync(claude, args, {
		cwd,
		env,
		input: prompt,
		encoding: 'utf8',
		timeout: seconds * 1000,
		killSignal: 'SIGTERM',
		maxBuffer: maxOutputBytes,
	})
	const code = child.error && 'code' in child.error ? String(child.error.code) : undefined
	if (code === 'ETIMEDOUT')
		return { failure: ['interrupted', `claude did not end in ${seconds} seconds. Checkmate stopped it.`] }
	if (code) return { failure: ['operational_error', `claude failed: ${code}.`] }
	return claudeResult(child.stdout ?? '', child.stderr ?? '', child.status, child.signal)
}

function closingBracket(text: string, start: number) {
	let depth = 0
	let quoted = false
	for (let i = start; i < text.length; i++) {
		const char = text[i]
		if (quoted) {
			if (char === '\\') i++
			else if (char === '"') quoted = false
		} else if (char === '"') quoted = true
		else if (char === '[') depth++
		else if (char === ']' && --depth === 0) return i
	}
	return -1
}

export function replyArray(text: unknown): unknown[] | undefined {
	if (typeof text !== 'string') return undefined
	for (let start = text.indexOf('['); start !== -1; start = text.indexOf('[', start + 1)) {
		const end = closingBracket(text, start)
		if (end === -1) continue
		try {
			const parsed = JSON.parse(text.slice(start, end + 1)) as unknown
			if (Array.isArray(parsed)) return parsed
		} catch {}
	}
	return undefined
}

const liveChildren = new Set<ChildProcess>()
const endGraceMilliseconds = 1500

function killGroup(child: ChildProcess, signal: NodeJS.Signals) {
	try {
		process.kill(-child.pid!, signal)
	} catch {}
}

export async function endLaunchedClaudes() {
	const ending = [...liveChildren]
	const closed = Promise.all(ending.map((child) => new Promise((done) => child.once('close', done))))
	for (const child of ending) killGroup(child, 'SIGTERM')
	const grace = setTimeout(() => {
		for (const child of ending) killGroup(child, 'SIGKILL')
	}, endGraceMilliseconds)
	await closed
	clearTimeout(grace)
}

export function exitOnSignal() {
	const end = async () => {
		await endLaunchedClaudes()
		process.exit(143)
	}
	process.once('SIGTERM', end)
	process.once('SIGINT', end)
}

export function launchClaude(
	claude: string,
	args: string[],
	prompt: string,
	cwd: string,
	env: Env,
	seconds: number,
	onStart?: (pid: number) => void
): Promise<ClaudeCall> {
	return new Promise((resolvePromise) => {
		const child = spawn(claude, args, { cwd, env, stdio: ['pipe', 'pipe', 'pipe'], detached: true })
		liveChildren.add(child)
		if (child.pid) onStart?.(child.pid)
		let output = ''
		let errors = ''
		let failure: ClaudeCall['failure']
		const timer = setTimeout(() => {
			failure = ['interrupted', `claude did not end in ${seconds} seconds. Checkmate stopped it.`]
			killGroup(child, 'SIGTERM')
			setTimeout(() => killGroup(child, 'SIGKILL'), endGraceMilliseconds).unref()
		}, seconds * 1000)
		child.stdout.on('data', (bytes: Buffer) => {
			if (output.length < maxOutputBytes) output += bytes.toString()
		})
		child.stderr.on('data', (bytes: Buffer) => {
			errors = (errors + bytes.toString()).slice(-16384)
		})
		child.stdin.on('error', () => {})
		child.stdin.end(prompt)
		child.on('error', (error) => {
			failure ??= ['operational_error', `claude failed: ${'code' in error ? String(error.code) : 'unknown'}.`]
		})
		child.on('close', (status, signal) => {
			liveChildren.delete(child)
			clearTimeout(timer)
			resolvePromise(failure ? { failure } : claudeResult(output, errors, status, signal))
		})
	})
}

export type RequestSession = {
	sessionId: string
	resume: boolean
	hook: ChildHook
	model: string | null
	checkmate: string
}

export const requestHookName = 'request'

export function requestSystemPrompt(checkmate: string) {
	return [
		'This request comes from the Checkmate web UI.',
		'The reply shows in a narrow pane. Answer in plain sentences: first what you found or did, then what changed.',
		'Put a question to the person in the reply.',
		`To change a record, use the checkmate command line of this workspace: node ${checkmate} <command>.`,
	].join(' ')
}

export function requestArgs(session: RequestSession) {
	return [
		'-p',
		'--output-format',
		'stream-json',
		'--verbose',
		session.resume ? '--resume' : '--session-id',
		session.sessionId,
		'--plugin-dir',
		pluginRoot,
		'--settings',
		JSON.stringify(hookSettings(session.hook)),
		'--append-system-prompt',
		requestSystemPrompt(session.checkmate),
		...(session.model ? ['--model', session.model] : []),
	]
}

export function requestPrompt(text: string, screen: string | null) {
	return screen
		? `${text}\n\nFor context only: the person had ${screen} on screen. Use this only when the request refers to it.`
		: text
}

export type StreamEnd = { status: number | null; signal: string | null; stderr: string; error: string | null }
export type StopDelays = { terminate: number; kill: number }
export type StreamedClaude = { pid: number | undefined; stop(): void; finished: Promise<StreamEnd> }

export const defaultStopDelays: StopDelays = { terminate: 5000, kill: endGraceMilliseconds }

export function streamClaude(
	claude: string,
	args: string[],
	prompt: string,
	cwd: string,
	env: Env,
	onLine: (line: string) => void,
	delays: StopDelays = defaultStopDelays
): StreamedClaude {
	const child = spawn(claude, args, { cwd, env, stdio: ['pipe', 'pipe', 'pipe'], detached: true })
	liveChildren.add(child)
	const timers: NodeJS.Timeout[] = []
	let errors = ''
	let pending = ''
	let spawnError: string | null = null
	child.stdout.on('data', (bytes: Buffer) => {
		const lines = (pending + bytes.toString()).split('\n')
		pending = lines.pop() ?? ''
		for (const line of lines) if (line.trim()) onLine(line)
	})
	child.stderr.on('data', (bytes: Buffer) => {
		errors = (errors + bytes.toString()).slice(-16384)
	})
	child.stdin.on('error', () => {})
	child.stdin.end(prompt)
	child.on('error', (error) => {
		spawnError = `claude failed: ${'code' in error ? String(error.code) : 'unknown'}.`
	})
	const finished = new Promise<StreamEnd>((resolvePromise) => {
		child.on('close', (status, signal) => {
			liveChildren.delete(child)
			for (const timer of timers) clearTimeout(timer)
			if (pending.trim()) onLine(pending)
			resolvePromise({ status, signal, stderr: errors, error: spawnError })
		})
	})
	return {
		pid: child.pid,
		finished,
		stop() {
			if (timers.length) return
			killGroup(child, 'SIGINT')
			timers.push(
				setTimeout(() => killGroup(child, 'SIGTERM'), delays.terminate),
				setTimeout(() => killGroup(child, 'SIGKILL'), delays.terminate + delays.kill)
			)
		},
	}
}
