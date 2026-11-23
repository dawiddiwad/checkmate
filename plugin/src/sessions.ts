import { Refusal } from './contracts.ts'
import { piArgs, piResult, resolvePiModelArgs } from './pi.ts'
import type { Harness } from './pi.ts'
import { randomBytes } from 'node:crypto'
import type { ChildProcess } from 'node:child_process'
import { spawn, spawnSync } from 'node:child_process'
import {
	accessSync,
	chmodSync,
	constants,
	existsSync,
	mkdirSync,
	readFileSync,
	realpathSync,
	rmSync,
	statSync,
	writeFileSync,
} from 'node:fs'
import { createRequire } from 'node:module'
import { homedir } from 'node:os'
import { delimiter, dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

export type Env = Record<string, string | undefined>
export type ChildHook = { port: number; token: string; explorationId: string; who: string }
export type ChildContext = {
	hiddenPlugin: string | null
	claudeArgs: string[]
	harness?: Harness
	piArgs?: string[]
	deny?: string[]
	work?: string
	hook?: ChildHook
}
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
export type ChildCall = {
	failure?: ['interrupted' | 'operational_error', string]
	result?: unknown
	costUsd?: number
	costPartial?: boolean
	observedModels?: string[]
	durationMs?: number
	sessionId?: string
	stderr?: string[]
}

export function costOf(
	calls: Array<Pick<ChildCall, 'costUsd' | 'costPartial'>>
): Pick<ChildCall, 'costUsd' | 'costPartial'> {
	const costs = calls.flatMap((call) => (call.costUsd === undefined ? [] : [call.costUsd]))
	if (!costs.length) return {}
	const costUsd = costs.reduce((total, cost) => total + cost, 0)
	if (!Number.isFinite(costUsd)) return {}
	return {
		costUsd,
		...(costs.length < calls.length || calls.some((call) => call.costPartial) ? { costPartial: true } : {}),
	}
}

export function usageOf(calls: Array<Pick<ChildCall, 'costUsd' | 'costPartial' | 'observedModels'>>) {
	const recent = new Set<string>()
	for (const call of calls)
		for (const model of call.observedModels ?? []) {
			recent.delete(model)
			recent.add(model)
		}
	const observedModels = [...recent]
	return { ...costOf(calls), ...(observedModels.length ? { observedModels } : {}) }
}

const moduleRoot = dirname(dirname(fileURLToPath(import.meta.url)))
export const pluginRoot = existsSync(join(moduleRoot, '.claude-plugin', 'plugin.json'))
	? moduleRoot
	: join(moduleRoot, 'plugin')

export function childOutputLimit(harness: Harness) {
	const mib = harness === 'pi' ? 100 : 4
	return { mib, bytes: mib * 1024 * 1024 }
}

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
	return own.endsWith('.ts') ? join(pluginRoot, '..', 'cli', 'src', 'main.ts') : own
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
	if (process.platform === 'darwin') {
		const processState = spawnSync('/bin/ps', ['-o', 'state=', '-p', String(pid)], { encoding: 'utf8' })
		return processState.stdout?.trimStart().startsWith('Z') === true
	}
	try {
		const stat = readFileSync(`/proc/${pid}/stat`, 'utf8')
		return stat[stat.lastIndexOf(') ') + 2] === 'Z'
	} catch {
		return false
	}
}

export function running(pid: unknown) {
	if (typeof pid !== 'number') return false
	if (pid === process.pid) return true
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

export function removeUiFile(workspace: string, port: number) {
	if (readUiFile(workspace)?.port === port) rmSync(uiFilePath(workspace), { force: true })
}

export function hookTokenPath(workspace: string) {
	return join(workspace, '.checkmate', 'hook-token')
}

export function workspaceHookToken(workspace: string, renew = false) {
	if (!renew) {
		try {
			const stored = readFileSync(hookTokenPath(workspace), 'utf8').trim()
			if (/^[0-9a-f]{64}$/.test(stored)) return stored
		} catch {}
	}
	const made = randomBytes(32).toString('hex')
	mkdirSync(join(workspace, '.checkmate'), { recursive: true })
	writeFileSync(hookTokenPath(workspace), made, { mode: 0o600 })
	chmodSync(hookTokenPath(workspace), 0o600)
	return made
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

export function piToolNames(rules: string[]) {
	const builtin = ['read', 'bash', 'edit', 'write', 'grep', 'find', 'ls']
	const names = rules.map((rule) => {
		if (!/^[a-zA-Z_][a-zA-Z0-9_-]*$/.test(rule))
			throw new Refusal('malformed', `Pi --allow needs a tool name. It does not accept the rule ${rule}.`)
		const lower = rule.toLowerCase()
		return builtin.includes(lower) ? lower : rule
	})
	return [...new Set(names)]
}

function piWorkTools(context: ChildContext, names: string[]) {
	return context.work ? ['edit', 'write'].filter((name) => !names.includes(name)) : []
}

function piExtension(name: string) {
	const path = join(pluginRoot, 'pi', name)
	try {
		accessSync(path, constants.R_OK)
		const extension = createRequire(import.meta.url)(path) as { default?: unknown }
		if (typeof extension.default !== 'function') throw new Error('Missing extension entry point')
	} catch (error) {
		throw new Refusal('prohibited', `Cannot load the Pi extension ${name}${excerpt((error as Error).message)}`)
	}
	return ['--extension', path]
}

export function childArgs(context: ChildContext, own: string[], allow: string[] = []) {
	if (context.harness === 'pi') {
		const names = piToolNames(allow)
		const tools = [...names, ...piWorkTools(context, names)]
		const args = own[0] === '--resume' ? ['--session', ...own.slice(1)] : own
		return piArgs(
			[
				'--no-extensions',
				...(context.piArgs ?? []),
				'--no-context-files',
				'--no-skills',
				'--no-prompt-templates',
				'--no-tools',
				...(tools.length ? ['--tools', tools.map((name) => `+${name}`).join(',')] : []),
				...(context.deny?.length || context.work ? piExtension('child.mjs') : []),
				...(context.hook ? piExtension('permission.mjs') : []),
				...args,
			],
			{}
		)
	}
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
		...allow.flatMap((rule) => ['--allowedTools', rule]),
		'--output-format',
		'json',
		'--permission-prompts',
		'none',
	]
}

export function childEnv(env: Env, extra: Env = {}, hook?: ChildHook, context?: ChildContext, allow: string[] = []) {
	const base = {
		...Object.fromEntries(Object.entries(env).filter(([name]) => !name.startsWith('CHECKMATE_'))),
		...extra,
	}
	if (context?.harness !== 'pi') return { ...base, ...(hook ? { [hookTokenName]: hook.token } : {}) }
	const names = piToolNames(allow)
	const scoped = piWorkTools(context, names)
	return {
		...base,
		...(hook ? { CHECKMATE_PI_HOOK: JSON.stringify({ ...hook, allow: [...names, ...scoped] }) } : {}),
		...(context.deny?.length || context.work
			? { CHECKMATE_PI_POLICY: JSON.stringify({ deny: context.deny ?? [], work: context.work, scoped }) }
			: {}),
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

export function requireChild(env: Env, harness: Harness = 'claude') {
	if (harness === 'claude') return requireClaude(env)
	const pi = executableOnPath('pi', env)
	if (!pi)
		throw new Refusal('prohibited', 'No pi executable on PATH. Nothing changed.', 'Install Pi or add it to PATH.')
	return pi
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

export const piAuthenticationHint = 'Log in with Pi on this machine, or configure authentication through the Pi host.'

export function authenticationFailed(call: ChildCall) {
	return (
		Boolean(call.failure) &&
		/authentication|not authenticated|no api key|invalid api key|api key expired|unauthorized|\bHTTP 401\b/i.test(
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
	const failure: ChildCall['failure'] =
		status !== 0
			? [
					'operational_error',
					`claude exited with ${signal ? `signal ${signal}` : `code ${status}`}${excerpt(error || parsed.result)}`,
				]
			: parsed.is_error === true
				? ['operational_error', `claude ended with an error${excerpt(parsed.result)}`]
				: undefined
	const tail = failure ? stderrTail(error) : []
	const cost = parsed.total_cost_usd
	return {
		failure,
		...(tail.length ? { stderr: tail } : {}),
		result: parsed.result,
		...(typeof cost === 'number' && Number.isFinite(cost) && cost >= 0 ? { costUsd: cost } : {}),
		...(typeof parsed.duration_ms === 'number' ? { durationMs: parsed.duration_ms } : {}),
		...(typeof parsed.session_id === 'string' ? { sessionId: parsed.session_id } : {}),
	}
}

function piLaunchArgs(executable: string, args: string[], cwd: string, env: Env): string[] | ChildCall {
	try {
		return resolvePiModelArgs(executable, args, cwd, env)
	} catch (error) {
		return { failure: ['operational_error', (error as Error).message] }
	}
}

export function callChild(
	executable: string,
	args: string[],
	prompt: string,
	cwd: string,
	env: Env,
	seconds: number,
	harness: Harness = 'claude'
): ChildCall {
	const commandArgs = harness === 'pi' ? piLaunchArgs(executable, args, cwd, env) : args
	if (!Array.isArray(commandArgs)) return commandArgs
	const limit = childOutputLimit(harness)
	const child = spawnSync(executable, commandArgs, {
		cwd,
		env,
		input: prompt,
		encoding: 'utf8',
		timeout: seconds * 1000,
		killSignal: 'SIGTERM',
		maxBuffer: limit.bytes,
	})
	const result = harness === 'pi' ? piResult : claudeResult
	const parsed = result(child.stdout ?? '', child.stderr ?? '', child.status, child.signal)
	const code = child.error && 'code' in child.error ? String(child.error.code) : undefined
	const cost = usageOf(harness === 'pi' && code ? [parsed, {}] : [parsed])
	if (code === 'ETIMEDOUT')
		return {
			...cost,
			failure: ['interrupted', `${harness} did not end in ${seconds} seconds. Checkmate stopped it.`],
		}
	if (code === 'ENOBUFS')
		return {
			...cost,
			failure: ['operational_error', `${harness} output exceeded ${limit.mib} MiB. Checkmate stopped it.`],
		}
	if (code) return { ...cost, failure: ['operational_error', `${harness} failed: ${code}.`] }
	return parsed
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

export async function endLaunchedChildren() {
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
		await endLaunchedChildren()
		process.exit(143)
	}
	process.once('SIGTERM', end)
	process.once('SIGINT', end)
}

export function launchChild(
	executable: string,
	args: string[],
	prompt: string,
	cwd: string,
	env: Env,
	seconds: number,
	onStart?: (pid: number) => void,
	harness: Harness = 'claude'
): Promise<ChildCall> {
	const commandArgs = harness === 'pi' ? piLaunchArgs(executable, args, cwd, env) : args
	if (!Array.isArray(commandArgs)) return Promise.resolve(commandArgs)
	const limit = childOutputLimit(harness)
	return new Promise((resolvePromise) => {
		const child = spawn(executable, commandArgs, { cwd, env, stdio: ['pipe', 'pipe', 'pipe'], detached: true })
		child.stdout.setEncoding('utf8')
		liveChildren.add(child)
		if (child.pid) onStart?.(child.pid)
		let output = ''
		let errors = ''
		let failure: ChildCall['failure']
		let bytes = 0
		let killTimer: NodeJS.Timeout | undefined
		const stop = (reason: NonNullable<ChildCall['failure']>) => {
			if (failure) return
			failure = reason
			killGroup(child, 'SIGTERM')
			killTimer = setTimeout(() => killGroup(child, 'SIGKILL'), endGraceMilliseconds)
			killTimer.unref()
		}
		const timer = setTimeout(
			() => stop(['interrupted', `${harness} did not end in ${seconds} seconds. Checkmate stopped it.`]),
			seconds * 1000
		)
		child.stdout.on('data', (text: string) => {
			if (failure && harness !== 'pi') return
			bytes += Buffer.byteLength(text)
			if (bytes > limit.bytes)
				stop(['operational_error', `${harness} output exceeded ${limit.mib} MiB. Checkmate stopped it.`])
			else output += text
		})
		child.stderr.on('data', (bytes: Buffer) => {
			errors = (errors + bytes.toString()).slice(-16384)
		})
		child.stdin.on('error', () => {})
		child.stdin.end(prompt)
		child.on('error', (error) => {
			failure ??= ['operational_error', `${harness} failed: ${'code' in error ? String(error.code) : 'unknown'}.`]
		})
		child.on('close', (status, signal) => {
			liveChildren.delete(child)
			clearTimeout(timer)
			clearTimeout(killTimer)
			const result = harness === 'pi' ? piResult : claudeResult
			const parsed = result(output, errors, status, signal)
			const cost = usageOf(harness === 'pi' && failure ? [parsed, {}] : [parsed])
			resolvePromise(failure ? { ...cost, failure } : parsed)
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

export function requestSystemPrompt(checkmate: string, harness: Harness = 'claude') {
	const skill = readFileSync(join(pluginRoot, 'references', 'oracle-workflow.md'), 'utf8')
	const start = skill.indexOf('1. Run `target list`')
	if (start < 0) throw new Error('The Checkmate oracle workflow is missing. Reinstall the plugin.')
	const workflow = skill
		.slice(start)
		.replace(
			'- Run `delegate execute` without `--allow` or `--claude-arg`. Pi controls its own tools and permissions. Do not widen them to work around a refusal.',
			harness === 'pi'
				? '- Run `delegate execute` without `--allow` or `--claude-arg`. Pi controls its own tools and permissions. Do not widen them to work around a refusal.'
				: '- Use the configured Claude permissions for `delegate execute`. Do not widen them to work around a refusal.'
		)
	return [
		'This conversation comes from the Checkmate web UI.',
		'Answer what the person asked. When you change the record, say what changed.',
		'Ask a question when you need the person to decide or clarify.',
		'Write replies in Markdown. Link each Checkmate record you mention with a descriptive label and its relative UI path. Use IDs from the workspace records, including the explorer prefix for questions and defects. Do not guess links.',
		'UI paths: plan /plans/<planId>, revision /plans/<planId>@<revision>, stored test or requirement /plans/<planId>@<revision>#<id>, run /runs/<runId>, exploration /explorations/<explorationId>.',
		'For a tester question use /plans/<planId>?view=all&item=q%3A<testerId>%2F<questionId>. For a defect use the same path with c%3A instead. For a plan gap use /plans/<planId>@<revision>/gaps/<gapId>. For a run test or finding use /runs/<runId>?item=test%3A<testId> or /runs/<runId>?item=finding%3A<findingId>.',
		'Use Markdown image syntax for screenshots. Run evidence uses /evidence/<evidenceId>. Exploration claim evidence uses /explorations/<explorationId>/claims/<testerId>/<claimId>/evidence/<zeroBasedIndex>.',
		`To change a record, use the checkmate command line of this workspace: node '${checkmate.replaceAll("'", "'\\''")}' <command>.`,
		`Follow this Checkmate workflow using the command path above:\n${workflow}`,
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
		? `${text}\n\nStarting context: the person opened the chat from ${screen}. Use this when relevant. You may inspect other workspace records if they help answer the request.`
		: text
}

export type StreamEnd = Pick<ChildCall, 'costUsd' | 'costPartial' | 'observedModels'> & {
	status: number | null
	signal: string | null
	stderr: string
	error: string | null
}
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
	child.stdout.setEncoding('utf8')
	liveChildren.add(child)
	const timers: NodeJS.Timeout[] = []
	let errors = ''
	let pending = ''
	let spawnError: string | null = null
	child.stdout.on('data', (text: string) => {
		const lines = (pending + text).split('\n')
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
