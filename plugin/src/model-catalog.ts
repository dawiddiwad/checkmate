import { execFile } from 'node:child_process'
import { stripVTControlCharacters } from 'node:util'
import type { Harness } from './pi.ts'
import type { Env } from './sessions.ts'
import { requireChild } from './sessions.ts'

export type ModelOption = { value: string; label: string }

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
		response?: { models?: Array<{ value?: string; displayName?: string }> }
	}
}

function claudeModels(stdout: string): ModelOption[] | undefined {
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
		return models.flatMap((model) =>
			typeof model?.value === 'string' && model.value.length && model.value !== 'default'
				? [
						{
							value: model.value,
							label: typeof model.displayName === 'string' ? model.displayName : model.value,
						},
					]
				: []
		)
	}
	return undefined
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

export async function discoverModels(harness: Harness, workspace: string, env: Env): Promise<ModelOption[]> {
	const program = requireChild(env, harness)
	const isPi = harness === 'pi'
	const parseModels = isPi ? piModels : claudeModels
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
				const models = error ? undefined : parseModels(stdout)
				if (!models) return reject(new Error(`${name} could not list models. Check the host configuration.`))
				resolve([...new Map(models.map((model) => [model.value, model])).values()])
			}
		)
		host.stdin?.on('error', () => {})
		host.stdin?.end(input)
	})
}
