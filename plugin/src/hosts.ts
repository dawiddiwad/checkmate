import { execFileSync } from 'node:child_process'
import { requireCondition } from './files.ts'

// A host is an agent CLI that can run one Checkmate stage headless.
// Each host keeps its own model, authentication, and permissions. Checkmate only
// builds the command line and reads the host's own output for failure and model name.
// The stage answer always comes from the response file, never from this output.

export type Stage = 'setup' | 'plan' | 'revise' | 'execute'
export type HostRun = {
	prompt: string
	pluginRoot: string
	// The skill directory of the stage, for hosts that can load a skill directly.
	skill: string
	// The caller's rules, in the host's own format.
	allow: string[]
}
export type Host = {
	// True when the host cannot enforce the rules. The caller must accept that.
	unrestricted: boolean
	// The smallest set of rules each stage needs. The caller still chooses the rules.
	minimumRules: Record<Stage, string[]>
	args(run: HostRun): string[]
	// Hosts that do not read the prompt from standard input get it as an argument.
	promptOnStdin: boolean
	// Throws when the output reports a failure. Returns the model name if the output has one.
	read(output: string): { model: string | null }
}

// The first line of a host message, shortened, so a failure says why.
export function excerpt(message: unknown) {
	const line = typeof message === 'string' ? message.trim().split('\n')[0].slice(0, 200) : ''
	return line ? `: ${line}` : ''
}

function jsonLines(output: string, host: string) {
	const events: Record<string, unknown>[] = []
	for (const line of output.split('\n')) {
		if (!line.trim()) continue
		try {
			const event = JSON.parse(line)
			if (typeof event === 'object' && event !== null) events.push(event)
		} catch {
			throw new Error(`${host} did not return JSON lines`)
		}
	}
	requireCondition(events.length, `${host} returned no events`)
	return events
}

// The first string value of a "model" key, at any depth. Hosts that do not name the model give null.
function findModel(value: unknown): string | null {
	if (Array.isArray(value)) {
		for (const item of value) {
			const model = findModel(item)
			if (model) return model
		}
	} else if (typeof value === 'object' && value !== null) {
		for (const [key, item] of Object.entries(value)) {
			if (key === 'model' && typeof item === 'string' && item) return item
			const model = findModel(item)
			if (model) return model
		}
	}
	return null
}

const claude: Host = {
	unrestricted: false,
	minimumRules: {
		setup: ['Read', 'Write', 'Bash(node *)', 'Bash(playwright-cli *)'],
		plan: ['Read', 'Write'],
		revise: ['Read', 'Write'],
		execute: ['Read', 'Write', 'Bash(node *)', 'Bash(playwright-cli *)'],
	},
	args: (run) => [
		'-p',
		'--plugin-dir',
		run.pluginRoot,
		'--output-format',
		'json',
		'--permission-prompts',
		'none',
		'--no-session-persistence',
		...run.allow.flatMap((rule) => ['--allowedTools', rule]),
	],
	promptOnStdin: true,
	read(output) {
		let envelope: unknown
		try {
			envelope = JSON.parse(output)
		} catch {
			throw new Error('Claude did not return a JSON envelope')
		}
		requireCondition(
			typeof envelope === 'object' && envelope !== null && 'type' in envelope && 'subtype' in envelope,
			'Invalid Claude envelope'
		)
		requireCondition(
			envelope.type === 'result' &&
				envelope.subtype === 'success' &&
				(!('is_error' in envelope) || envelope.is_error !== true),
			`Claude did not complete the stage${excerpt('result' in envelope ? envelope.result : '')}`
		)
		// modelUsage names each model the session used. The main model wrote the most output.
		const usage = 'modelUsage' in envelope ? envelope.modelUsage : null
		const models = typeof usage === 'object' && usage !== null ? Object.entries(usage) : []
		const outputTokens = (entry: [string, unknown]) => {
			const tokens = (entry[1] as { outputTokens?: unknown })?.outputTokens
			return typeof tokens === 'number' ? tokens : 0
		}
		models.sort((a, b) => outputTokens(b) - outputTokens(a))
		return { model: models[0]?.[0] ?? null }
	},
}

// Codex has sandbox modes, not rules per command. A rule is a sandbox mode or "network".
const codexModes = ['read-only', 'workspace-write']
const codex: Host = {
	unrestricted: false,
	minimumRules: {
		setup: ['workspace-write', 'network'],
		plan: ['workspace-write'],
		revise: ['workspace-write'],
		execute: ['workspace-write', 'network'],
	},
	args(run) {
		const modes = run.allow.filter((rule) => codexModes.includes(rule))
		const unknown = run.allow.filter((rule) => !codexModes.includes(rule) && rule !== 'network')
		requireCondition(
			!unknown.length,
			`Unknown Codex rule: ${unknown.join(', ')}. Use ${codexModes.join(', ')}, network`
		)
		requireCondition(modes.length === 1, `Give exactly one Codex sandbox mode: ${codexModes.join(' or ')}`)
		return [
			'exec',
			'--json',
			'--skip-git-repo-check',
			'--ephemeral',
			'--sandbox',
			modes[0],
			'-c',
			'approval_policy="never"',
			...(run.allow.includes('network') ? ['-c', 'sandbox_workspace_write.network_access=true'] : []),
			'-',
		]
	},
	promptOnStdin: true,
	read(output) {
		const events = jsonLines(output, 'Codex')
		const failure = events.find((event) => event.type === 'turn.failed' || event.type === 'error')
		if (failure) {
			const error = failure.error as { message?: unknown } | undefined
			throw new Error(`Codex did not complete the stage${excerpt(error?.message ?? failure.message)}`)
		}
		requireCondition(
			events.some((event) => event.type === 'turn.completed'),
			'Codex did not complete the stage'
		)
		return { model: findModel(events) }
	},
}

// pi has no permission system. A rule is a tool name for --tools; the tools themselves are unrestricted.
const pi: Host = {
	unrestricted: true,
	minimumRules: {
		setup: ['read', 'write', 'bash'],
		plan: ['read', 'write'],
		revise: ['read', 'write'],
		execute: ['read', 'write', 'bash'],
	},
	args: (run) => [
		'--mode',
		'json',
		'--no-session',
		// Ignore untrusted project configuration. Load the stage skill explicitly.
		'--no-approve',
		'--skill',
		run.skill,
		'--tools',
		run.allow.join(','),
		run.prompt,
	],
	promptOnStdin: false,
	read(output) {
		const events = jsonLines(output, 'pi')
		for (const event of events) {
			const update = event.assistantMessageEvent as
				{ type?: unknown; error?: unknown; reason?: unknown } | undefined
			if (event.type === 'message_update' && update?.type === 'error')
				throw new Error(`pi did not complete the stage${excerpt(update.error ?? update.reason)}`)
			if (event.type === 'auto_retry_end' && event.success === false)
				throw new Error(`pi did not complete the stage${excerpt(event.finalError)}`)
			if (event.type === 'agent_settled' && event.aborted === true)
				throw new Error('pi stopped the stage before the end')
		}
		return { model: findModel(events) }
	},
}

export const hosts = { claude, codex, pi }
export type HostName = keyof typeof hosts

export function hostNamed(name: string): Host {
	requireCondition(Object.hasOwn(hosts, name), `Unknown host: ${name}. Use one of: ${Object.keys(hosts).join(', ')}`)
	return hosts[name as HostName]
}

// The version line that the host CLI reports, or null if it does not answer.
export function hostVersion(executable: string): string | null {
	try {
		const output = execFileSync(executable, ['--version'], { encoding: 'utf8', timeout: 5000, stdio: 'pipe' })
		return output.trim().split('\n')[0].slice(0, 200) || null
	} catch {
		return null
	}
}
