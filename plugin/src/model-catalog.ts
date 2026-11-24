import { execFile, spawn } from 'node:child_process'
import { createInterface } from 'node:readline'
import { stripVTControlCharacters } from 'node:util'
import { piModelArgs } from './pi.ts'
import type { Harness } from './pi.ts'
import type { Env } from './sessions.ts'
import { requireChild } from './sessions.ts'

export type ModelOption = { value: string; label: string; effortLevels?: string[] }
export type ModelCatalog = { models: ModelOption[]; defaultModel?: ModelOption }

export const effortLevels = {
	claude: ['low', 'medium', 'high', 'xhigh', 'max'],
	pi: ['off', 'minimal', 'low', 'medium', 'high', 'xhigh', 'max'],
}

export function resolvedEffort(
	harness: Harness,
	catalog: ModelCatalog,
	model: string,
	effort: string,
	provider?: string
) {
	let option = model ? catalog.models.find((item) => item.value === model) : catalog.defaultModel
	if (harness === 'claude' && model === 'default') option = catalog.defaultModel
	if (harness === 'pi' && model && provider && !option?.value.startsWith(`${provider}/`))
		option = catalog.models.find((item) => item.value === `${provider}/${model}`)
	if (harness === 'pi' && model && !option && !provider) {
		const matches = catalog.models.filter((item) => item.value.slice(item.value.indexOf('/') + 1) === model)
		if (matches.length === 1) option = matches[0]
	}
	const selected = effort || 'medium'
	return option?.effortLevels?.includes(selected) ? selected : undefined
}

export function effortArgs(harness: Harness, effort: string | undefined) {
	return effort ? [harness === 'pi' ? '--thinking' : '--effort', effort] : []
}

const requestId = 'checkmate-models'
const claudeArgs = [
	'-p',
	'--input-format',
	'stream-json',
	'--output-format',
	'stream-json',
	'--verbose',
	'--no-session-persistence',
	'--strict-mcp-config',
	'--mcp-config',
	'{"mcpServers":{}}',
	'--settings',
	'{"disableAllHooks":true}',
	'--tools',
	'',
]

type InitializeResponse = {
	type?: string
	response?: {
		request_id?: string
		subtype?: string
		response?: {
			models?: Array<{
				value?: string
				displayName?: string
				supportsEffort?: boolean
				supportedEffortLevels?: unknown
			}>
		}
	}
}

function catalog(options: ModelOption[], defaultModel?: ModelOption): ModelCatalog {
	const models = [...new Map(options.map((model) => [model.value, model])).values()]
	return { models, ...(defaultModel ? { defaultModel } : {}) }
}

function claudeModels(stdout: string): ModelCatalog | undefined {
	for (const line of stdout.split('\n')) {
		let event: InitializeResponse
		try {
			event = JSON.parse(line)
		} catch {
			continue
		}
		if (event?.type !== 'control_response' || event.response?.request_id !== requestId) continue
		const models = event.response.response?.models
		if (event.response.subtype !== 'success' || !Array.isArray(models)) return undefined
		const options = models.flatMap((model) => {
			if (typeof model?.value !== 'string' || !model.value) return []
			const advertised = model.supportedEffortLevels
			const levels =
				model.supportsEffort !== false && Array.isArray(advertised)
					? effortLevels.claude.filter((level) => advertised.includes(level))
					: []
			const name = typeof model.displayName === 'string' ? model.displayName : model.value
			// An older Haiku stays in the list, labelled as older and below Haiku 5.5.
			const label = /haiku/i.test(model.value) && model.value !== claudeDefaultModel ? `${name} (older)` : name
			return [
				{
					value: model.value,
					label,
					...(levels.length ? { effortLevels: levels } : {}),
				},
			]
		})
		return catalog(
			options.filter((option) => option.value !== 'default'),
			options.find((option) => option.value === 'default')
		)
	}
	return undefined
}

type PiModel = { provider?: unknown; id?: unknown; reasoning?: unknown; thinkingLevelMap?: Record<string, unknown> }

function piOption(model?: PiModel): ModelOption[] {
	if (typeof model?.provider !== 'string' || !model.provider || typeof model.id !== 'string' || !model.id) return []
	const value = `${model.provider}/${model.id}`
	const levels =
		model.reasoning === true
			? effortLevels.pi.filter((level) => {
					const mapped = model.thinkingLevelMap?.[level]
					return mapped !== null && ((level !== 'xhigh' && level !== 'max') || typeof mapped === 'string')
				})
			: []
	return [{ value, label: value, ...(levels.some((level) => level !== 'off') ? { effortLevels: levels } : {}) }]
}

const piCatalogTimeout = 10_000

type PiCatalogProbe = { value?: ModelCatalog; timedOut: boolean }

function piRpcCatalog(program: string, workspace: string, env: Env, timeout: number): Promise<PiCatalogProbe> {
	const provider = !env.CHECKMATE_PI_MODEL?.trim() ? env.CHECKMATE_PI_PROVIDER?.trim().toLowerCase() : undefined
	return new Promise((resolve) => {
		const host = spawn(program, ['--no-mcp', '--no-session', '--mode', 'rpc', ...piModelArgs(env)], {
			cwd: workspace,
			env,
			stdio: ['pipe', 'pipe', 'ignore'],
		})
		const lines = createInterface({ input: host.stdout })
		let models: ModelOption[] | undefined
		let model: ModelOption | undefined
		let available = false
		let state = false
		const timer = setTimeout(() => {
			host.kill('SIGKILL')
			finish(true)
		}, timeout)
		function finish(timedOut = false) {
			clearTimeout(timer)
			lines.close()
			resolve({ value: models && catalog(models, model), timedOut })
		}
		host.once('error', () => finish())
		host.once('close', () => finish())
		host.stdin.on('error', () => {})
		lines.on('line', (line) => {
			let response
			try {
				response = JSON.parse(line)
			} catch {
				return
			}
			if (response?.type !== 'response') return
			if (response.id === 'models' && response.command === 'get_available_models') {
				available = true
				if (response.success && Array.isArray(response.data?.models))
					models = response.data.models.flatMap(piOption)
			}
			if (response.id === 'state' && response.command === 'get_state') {
				state = true
				const selected = response.data?.model
				if (
					response.success &&
					(!provider ||
						(typeof selected?.provider === 'string' && selected.provider.toLowerCase() === provider))
				)
					model = piOption(selected)[0]
			}
			if (available && state && !host.stdin.writableEnded) host.stdin.end()
		})
		host.stdin.write('{"id":"models","type":"get_available_models"}\n{"id":"state","type":"get_state"}\n')
	})
}

function piModels(stdout: string): ModelOption[] | undefined {
	const lines = stripVTControlCharacters(stdout).trim().split('\n')
	const header = lines.findIndex((line) => /^provider\s+model\s+context\b/.test(line.trim()))
	if (header === -1) return lines.some((line) => /^No models available\./.test(line.trim())) ? [] : undefined
	const columns = lines[header].trim().split(/\s+/).length
	return lines.slice(header + 1).flatMap((line) => {
		const fields = line.trim().split(/\s{2,}/)
		if (fields.length !== columns) return []
		const [provider, model] = fields
		const value = `${provider}/${model}`
		return [{ value, label: value }]
	})
}

// The chat picker shows the provider of the host's default model first, and luna models first in it.
// The client filters the rest by a search. A value without a provider prefix has no primary group.
// The Claude model a chat uses when none is chosen. Its picker label is Haiku 5.5.
export const claudeDefaultModel = 'haiku'

export function chatModelOrder(catalog: ModelCatalog): { models: ModelOption[]; primary: string | null } {
	const fallback = catalog.models[0]?.value
	const source = catalog.defaultModel?.value ?? fallback ?? ''
	const slash = source.indexOf('/')
	const primary = slash > 0 ? source.slice(0, slash) : null
	const group = (model: ModelOption) => (primary && model.value.startsWith(`${primary}/`) ? 0 : 1)
	const luna = (model: ModelOption) => (/luna/i.test(model.value) ? 0 : 1)
	// Haiku 5.5 is the Claude default, so it comes first.
	const preferred = (model: ModelOption) => (model.value === claudeDefaultModel ? 0 : 1)
	const models = [...catalog.models].sort(
		(a, b) =>
			preferred(a) - preferred(b) || group(a) - group(b) || luna(a) - luna(b) || a.value.localeCompare(b.value)
	)
	return { models, primary }
}

export async function discoverModelCatalog(
	harness: Harness,
	workspace: string,
	env: Env,
	retryForEffort = false
): Promise<ModelCatalog> {
	const program = requireChild(env, harness)
	const isPi = harness === 'pi'
	if (isPi) {
		const first = await piRpcCatalog(program, workspace, env, piCatalogTimeout).catch(() => undefined)
		const retry =
			retryForEffort && first?.timedOut
				? await piRpcCatalog(program, workspace, env, 2 * piCatalogTimeout).catch(() => undefined)
				: undefined
		const value = retry?.value ?? first?.value
		if (value) return value
	}
	const name = isPi ? 'Pi' : 'Claude Code'
	const args = isPi ? ['--no-mcp', '--list-models'] : claudeArgs
	const input = isPi
		? ''
		: JSON.stringify({ type: 'control_request', request_id: requestId, request: { subtype: 'initialize' } }) + '\n'
	return new Promise((resolve, reject) => {
		const host = execFile(
			program,
			args,
			{ cwd: workspace, env, timeout: 10_000, killSignal: 'SIGKILL', maxBuffer: 1024 * 1024 },
			(error, stdout) => {
				if (!error) {
					const models = isPi ? piModels(stdout) : undefined
					const result = isPi ? models && catalog(models) : claudeModels(stdout)
					if (result) return resolve(result)
				}
				reject(new Error(`${name} could not list models. Check the host configuration.`))
			}
		)
		host.stdin?.on('error', () => {})
		host.stdin?.end(input)
	})
}

export async function discoverModels(harness: Harness, workspace: string, env: Env): Promise<ModelOption[]> {
	return (await discoverModelCatalog(harness, workspace, env)).models
}
