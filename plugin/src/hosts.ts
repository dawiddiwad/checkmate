import type { Result } from './types.ts'
import { execFileSync } from 'node:child_process'
import { requireCondition } from './files.ts'

// Token, context, and cost figures exactly as the host reports them for one stage.
// Input tokens include cached input. Checkmate keeps no price table.
export type Usage = NonNullable<Result['usage']>

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
	// Throws when the output reports a failure. Returns the model name and usage if the output has them.
	read(output: string): { model: string | null; usage: Usage | null }
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

// A token count from host output. A missing or invalid value counts as zero.
function count(value: unknown) {
	return typeof value === 'number' && Number.isFinite(value) && value > 0 ? Math.round(value) : 0
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
		const byModel = 'modelUsage' in envelope ? envelope.modelUsage : null
		type ModelUsage = { outputTokens?: unknown; contextWindow?: unknown; costBasis?: unknown }
		const models = (typeof byModel === 'object' && byModel !== null ? Object.entries(byModel) : []) as Array<
			[string, ModelUsage]
		>
		models.sort((a, b) => count(b[1]?.outputTokens) - count(a[1]?.outputTokens))
		const main = models[0]?.[1]
		type Tokens = {
			input_tokens?: unknown
			cache_read_input_tokens?: unknown
			cache_creation_input_tokens?: unknown
			output_tokens?: unknown
		}
		const input = (tokens: Tokens) =>
			count(tokens.input_tokens) +
			count(tokens.cache_read_input_tokens) +
			count(tokens.cache_creation_input_tokens)
		const totals = ('usage' in envelope ? envelope.usage : null) as (Tokens & { iterations?: Tokens[] }) | null
		// Claude reports only its final request in iterations. That request is the largest unless the context was compacted.
		const requests = Array.isArray(totals?.iterations) ? totals.iterations : []
		const cost = 'total_cost_usd' in envelope ? envelope.total_cost_usd : null
		return {
			model: models[0]?.[0] ?? null,
			usage: totals
				? {
						inputTokens: input(totals),
						cacheReadTokens: count(totals.cache_read_input_tokens),
						cacheWriteTokens: count(totals.cache_creation_input_tokens),
						outputTokens: count(totals.output_tokens),
						peakContextTokens: requests.length ? Math.max(...requests.map(input)) : null,
						contextWindowTokens: count(main?.contextWindow) || null,
						costUSD: typeof cost === 'number' && cost >= 0 ? cost : null,
						costSource:
							typeof cost === 'number'
								? `Claude Code${typeof main?.costBasis === 'string' ? ` (${main.costBasis} prices)` : ''}`
								: null,
					}
				: null,
		}
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
		const turns = events.filter((event) => event.type === 'turn.completed')
		requireCondition(turns.length, 'Codex did not complete the stage')
		// Codex reports the total of each turn. Its input tokens include cached input. It reports no cost or window.
		type Tokens = {
			input_tokens?: unknown
			cached_input_tokens?: unknown
			cache_write_input_tokens?: unknown
			output_tokens?: unknown
		}
		const sum = (key: keyof Tokens) =>
			turns.reduce((total, turn) => total + count((turn.usage as Tokens)?.[key]), 0)
		return {
			model: findModel(events),
			usage: turns.some((turn) => turn.usage)
				? {
						inputTokens: sum('input_tokens'),
						cacheReadTokens: sum('cached_input_tokens'),
						cacheWriteTokens: sum('cache_write_input_tokens'),
						outputTokens: sum('output_tokens'),
						peakContextTokens: null,
						contextWindowTokens: null,
						costUSD: null,
						costSource: null,
					}
				: null,
		}
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
		// pi reports usage for each model request in message_end. Its input excludes cached input.
		type Tokens = {
			input?: unknown
			cacheRead?: unknown
			cacheWrite?: unknown
			output?: unknown
			cost?: { total?: unknown; totalFromProvider?: unknown }
		}
		const requests = events.flatMap((event) => {
			const message = event.message as { role?: unknown; usage?: Tokens } | undefined
			return event.type === 'message_end' && message?.role === 'assistant' && message.usage ? [message.usage] : []
		})
		const input = (tokens: Tokens) => count(tokens.input) + count(tokens.cacheRead) + count(tokens.cacheWrite)
		const sum = (value: (tokens: Tokens) => number) => requests.reduce((total, tokens) => total + value(tokens), 0)
		const costed = requests.filter((tokens) => typeof tokens.cost?.total === 'number')
		return {
			model: findModel(events),
			usage: requests.length
				? {
						inputTokens: sum(input),
						cacheReadTokens: sum((tokens) => count(tokens.cacheRead)),
						cacheWriteTokens: sum((tokens) => count(tokens.cacheWrite)),
						outputTokens: sum((tokens) => count(tokens.output)),
						peakContextTokens: Math.max(...requests.map(input)),
						contextWindowTokens: null,
						costUSD: costed.length ? sum((tokens) => Number(tokens.cost?.total ?? 0)) : null,
						costSource: costed.length
							? costed.every((tokens) => tokens.cost?.totalFromProvider === true)
								? 'pi (provider cost)'
								: 'pi (model catalog prices)'
							: null,
					}
				: null,
		}
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
