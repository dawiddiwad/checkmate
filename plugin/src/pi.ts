import { spawnSync } from 'node:child_process'
import { STATUS_CODES } from 'node:http'
import { stripVTControlCharacters } from 'node:util'
import { Refusal } from './contracts.ts'
import { excerpt, stderrTail, usageOf } from './sessions.ts'
import type { ChildCall, Env } from './sessions.ts'

export type Harness = 'claude' | 'pi'

export function selectedHarness(env: Env = process.env): Harness {
	const configured = env.CHECKMATE_HARNESS?.trim()
	if (!configured || configured === 'claude') return 'claude'
	if (configured === 'pi') return 'pi'
	throw new Refusal('malformed', 'CHECKMATE_HARNESS must be claude or pi.')
}

export function piModelEnv(env: Env, model: string, providerQualified = model.includes('/')): Env {
	return model
		? { ...env, CHECKMATE_PI_MODEL: model, ...(providerQualified ? { CHECKMATE_PI_PROVIDER: undefined } : {}) }
		: env
}

export function piSavedModelEnv(env: Env, model: string, providerQualified = model.includes('/')): Env {
	const provider = env.CHECKMATE_PI_PROVIDER?.trim()
	if (provider && !env.CHECKMATE_PI_MODEL?.trim()) {
		if (!providerQualified || !model.toLowerCase().startsWith(`${provider.toLowerCase()}/`)) return env
		return { ...env, CHECKMATE_PI_MODEL: model.slice(provider.length + 1) }
	}
	return piModelEnv(env, model, providerQualified)
}

export function piModelArgs(env: Env) {
	const model = env.CHECKMATE_PI_MODEL?.trim()
	const provider = env.CHECKMATE_PI_PROVIDER?.trim()
	if (provider && !model) {
		if (/[,\p{Cc}]/u.test(provider)) throw new Refusal('malformed', 'Give a Pi provider with a valid name.')
		return ['--models', `${provider.replace(/[\\*?[\]{}!+()]/g, '\\$&')}/**`]
	}
	return [...(model ? ['--model', model] : []), ...(provider ? ['--provider', provider] : [])]
}

function piScopeProvider(args: string[]) {
	const index = args.indexOf('--models')
	const scope = args[index + 1]
	if (index >= 0 && scope?.endsWith('/**')) return scope.slice(0, -3).replace(/\\(.)/g, '$1')
}

export function piOverrideModelArgs(source: string[], model: string) {
	const args: string[] = []
	const hasProvider = model.includes('/')
	for (let index = 0; index < source.length; index++) {
		const flag = source[index]
		if (flag === '--model' || flag === '--models' || (hasProvider && flag === '--provider')) index++
		else args.push(flag)
	}
	const provider = hasProvider ? undefined : piScopeProvider(source)
	if (provider) args.push('--provider', provider)
	return [...args, '--model', model]
}

export function resolvePiModelArgs(program: string, args: string[], cwd: string, env: Env): string[] {
	const provider = piScopeProvider(args)
	if (!provider) return args
	const index = args.indexOf('--models')
	const scope = args[index + 1]
	const host = spawnSync(program, ['--no-mcp', '--no-session', '--mode', 'rpc', '--models', scope], {
		cwd,
		env,
		encoding: 'utf8',
		input: '{"type":"get_state","id":"checkmate-provider"}\n',
		timeout: 10_000,
		killSignal: 'SIGKILL',
		maxBuffer: 1024 * 1024,
	})
	for (const line of host.stdout?.split('\n') ?? []) {
		let response
		try {
			response = JSON.parse(line)
		} catch {
			continue
		}
		if (response?.type !== 'response' || response.id !== 'checkmate-provider' || !response.success) continue
		const model = response.data?.model
		if (piModelId(model?.provider, model?.id) && model.provider.toLowerCase() === provider.toLowerCase())
			return [
				...args.slice(0, index),
				'--provider',
				model.provider,
				'--model',
				model.id,
				...args.slice(index + 2),
			]
	}
	throw new Refusal('prohibited', `Pi could not select an available model for provider ${provider}.`)
}

export function piArgs(own: string[] = [], env: Env = process.env) {
	return ['-p', '--mode', 'json', ...piModelArgs(env), ...own]
}

export type PiContent = { type: string; text?: string; name?: string; id?: string; arguments?: unknown }
type PiUsage = { totalTokens?: number; cost?: { total?: unknown } }

export type PiMessage = {
	role: string
	provider?: string
	model?: string
	content?: PiContent[]
	stopReason?: string
	errorMessage?: string
	usage?: PiUsage
}
export type PiEvent = {
	type: string
	id?: string
	message?: PiMessage
	messages?: PiMessage[]
	willRetry?: boolean
	aborted?: boolean
	assistantMessageEvent?: { type: string; delta?: string; partial?: PiMessage }
	usage?: PiUsage
	entry?: { type?: string; provider?: string; model?: string; usage?: PiUsage }
	toolName?: string
	toolCallId?: string
	args?: unknown
	result?: unknown
	isError?: boolean
}

export function piEvent(line: string): PiEvent | undefined {
	try {
		const value = JSON.parse(line)
		if (typeof value?.type === 'string') return value
	} catch {}
}

function providerMessage(text: string) {
	const body = text.trimStart()
	if (!body.startsWith('{')) return body.split(/\s+(?=\{|\[\{)/, 1)[0]
	try {
		const payload = JSON.parse(body)
		const messages = [payload.error?.message, payload.message, payload.error]
		return messages.find((message) => typeof message === 'string') ?? ''
	} catch {
		const primary = body.split(/"headers"\s*:/i, 1)[0]
		const message = /"message"\s*:\s*("(?:\\.|[^"\\])*")/.exec(primary)
		if (message) {
			try {
				return JSON.parse(message[1]) as string
			} catch {}
		}
		return ''
	}
}

function safeMessage(value: string) {
	const text = value.split(/[\r\n]/, 1)[0].trim()
	if (
		text.startsWith('{') ||
		text.startsWith('[') ||
		/^(?:headers?|response headers?|authorization|proxy-authorization|cookie|set-cookie|www-authenticate|proxy-authenticate|(?:content-|x-)[a-z0-9_-]+)\s*:/i.test(
			text
		)
	)
		return ''
	return text
		.replace(/\s+(?:response )?headers?\s*[:=].*$/i, '')
		.replace(/\b(?:authorization|cookie)\s*[:=]\s*.*$|\bbearer\s+.*$/i, '[redacted]')
		.replace(
			/(\b(?:api[-_ ]?key|(?:access |refresh )?token|password|secret|credential)(?: provided| used| value)?\s*[:=]\s*).*$/i,
			'$1[redacted]'
		)
		.replace(
			/(\b(?:api[-_ ]?key|(?:access |refresh )?token|password|secret|credential)\s+)["'][^"']+["']/gi,
			'$1[redacted]'
		)
		.replace(/https?:\/\/\S+/gi, '[URL]')
		.replace(/\b(?:sk-|gh[pousr]_|hf_|xox[baprs]-)[A-Za-z0-9_-]+/g, '[redacted]')
		.replace(/\p{Cc}/gu, '')
		.slice(0, 200)
		.trimEnd()
}

export function piErrorText(value: unknown): string {
	if (typeof value !== 'string') return ''
	const text = stripVTControlCharacters(value).trim()
	const wrapped =
		/^((?:The session of [a-z0-9-]+ could not resume: )?pi (?:ended with an error|interrupted the response|exited with (?:code \d+|signal [A-Z]+))):\s*([\s\S]+)$/i.exec(
			text
		)
	const reason = providerError(wrapped?.[2] ?? text)
	return wrapped ? [wrapped[1], reason].filter(Boolean).join(': ') : reason
}

function providerError(text: string) {
	const response =
		/^(?:(?:Error|APIError):\s*)?(?:(?:HTTP(?: error)?|status(?: code)?)\s*)?([45][0-9]{2})(?:[ :]+|$)/i.exec(text)
	const message = safeMessage(providerMessage(response ? text.slice(response[0].length) : text))
	if (!response) return message
	return `HTTP ${response[1]}: ${message || STATUS_CODES[Number(response[1])] || 'Provider request failed.'}`
}

export function piStderr(text: string) {
	return stderrTail(text.split('\n').map(piErrorText).filter(Boolean).join('\n'))
}

export function piModelId(provider: unknown, model: unknown) {
	if (typeof provider !== 'string' || typeof model !== 'string' || !provider.trim() || !model.trim()) return
	return `${provider}/${model}`
}

export function piMessageModel(message?: PiMessage) {
	if (message?.role === 'assistant') return piModelId(message.provider, message.model)
}

function reportedCost(usage?: PiUsage) {
	const cost = usage?.cost?.total
	return typeof cost === 'number' && Number.isFinite(cost) && cost >= 0 ? cost : null
}

export function piMessageCost(message?: PiMessage): number | null | undefined {
	if (message?.role !== 'assistant' && !(message?.role === 'toolResult' && message.usage)) return undefined
	const cost = reportedCost(message.usage)
	if (
		cost === 0 &&
		message.usage?.totalTokens === 0 &&
		(message.stopReason === 'error' || message.stopReason === 'aborted')
	)
		return null
	return cost
}

type CallUsage = Pick<ChildCall, 'costUsd' | 'costPartial' | 'observedModels'>

export function piTurnUsage() {
	const calls: CallUsage[] = []
	let messages: CallUsage[] = []
	let current: CallUsage = {}

	function addMessage(message?: PiMessage) {
		const costUsd = piMessageCost(message)
		if (costUsd === undefined) return
		const model = piMessageModel(message)
		if (message?.role === 'assistant') {
			messages.push({
				observedModels: model ? [model] : current.observedModels,
				costUsd: costUsd ?? current.costUsd,
				costPartial: costUsd === null && current.costUsd !== undefined,
			})
			current = {}
		} else messages.push({ costUsd: costUsd ?? undefined })
	}

	return {
		read(event: PiEvent) {
			switch (event.type) {
				case 'agent_start':
					calls.push(...messages)
					messages = []
					current = {}
					break
				case 'message_start': {
					const model = piMessageModel(event.message)
					if (model) current.observedModels = [model]
					break
				}
				case 'message_update': {
					const message = event.message ?? event.assistantMessageEvent?.partial
					const model = piMessageModel(message)
					if (model) current.observedModels = [model]
					const cost = event.usage ? reportedCost(event.usage) : piMessageCost(message)
					if (
						cost !== null &&
						cost !== undefined &&
						(cost !== 0 || (event.usage ?? message?.usage)?.totalTokens)
					)
						current.costUsd = cost
					break
				}
				case 'message_end':
					addMessage(event.message)
					break
				case 'agent_end':
					if (!messages.length && Array.isArray(event.messages))
						for (const message of event.messages) addMessage(message)
					calls.push(...messages)
					messages = []
					current = {}
					break
				case 'entry_appended':
					if (event.entry?.type === 'usage') {
						const model = piModelId(event.entry.provider, event.entry.model)
						calls.push({
							costUsd: reportedCost(event.entry.usage) ?? undefined,
							observedModels: model ? [model] : undefined,
						})
					}
					break
				case 'compaction_end':
					if (event.result && typeof event.result === 'object')
						calls.push({ costUsd: reportedCost((event.result as { usage?: PiUsage }).usage) ?? undefined })
			}
		},
		finish(partial: boolean) {
			return usageOf([
				...calls,
				...messages,
				...(current.costUsd !== undefined || current.observedModels ? [{ ...current, costPartial: true }] : []),
				...(partial || messages.length ? [{}] : []),
			])
		},
	}
}

export function piResult(output: string, error: string, status: number | null, signal: string | null): ChildCall {
	let sessionId: string | undefined
	let final: PiMessage | undefined
	let latestError: PiMessage | undefined
	const usage = piTurnUsage()
	for (const line of output.split('\n')) {
		const event = piEvent(line)
		if (event) usage.read(event)
		if (event?.type === 'session' && typeof event.id === 'string') sessionId = event.id
		if (event?.type === 'agent_start') {
			final = undefined
			latestError = undefined
		}
		if (
			event?.type === 'message_end' &&
			event.message?.role === 'assistant' &&
			['error', 'aborted'].includes(event.message.stopReason ?? '')
		)
			latestError = event.message
		if (event?.type === 'agent_end') {
			const messages = Array.isArray(event.messages) ? event.messages : []
			const last = messages.at(-1)
			if (last?.role === 'assistant' && last.errorMessage) latestError = last
			final = event.willRetry ? undefined : last
		}
		if (event?.type === 'agent_settled' && event.aborted)
			final = {
				role: 'assistant',
				stopReason: 'aborted',
				errorMessage: final?.errorMessage ?? latestError?.errorMessage,
			}
	}
	const reason = piErrorText(final?.errorMessage ?? latestError?.errorMessage)
	const stderr = piStderr(error)
	let failure: ChildCall['failure']
	if (status !== 0)
		failure = [
			'operational_error',
			`pi exited with ${signal ? `signal ${signal}` : `code ${status}`}${excerpt(reason || stderr[0])}`,
		]
	else if ((final ?? latestError)?.stopReason === 'aborted')
		failure = ['interrupted', `pi interrupted the response${excerpt(reason)}`]
	else if ((final ?? latestError)?.stopReason === 'error')
		failure = ['operational_error', `pi ended with an error${excerpt(reason)}`]
	else if (final?.role !== 'assistant')
		failure = ['operational_error', 'pi did not return a final assistant message.']
	else if (final.stopReason === 'length') failure = ['operational_error', 'pi reached the output token limit.']
	else if (final.stopReason !== 'stop') failure = ['operational_error', 'pi did not finish the assistant turn.']
	const tail = failure ? stderr : []
	const result = Array.isArray(final?.content)
		? final.content
				.flatMap((part) => (part?.type === 'text' && typeof part.text === 'string' ? [part.text] : []))
				.join('')
		: undefined
	return {
		failure,
		...usage.finish(status !== 0 || Boolean(failure && final === undefined)),
		...(tail.length ? { stderr: tail } : {}),
		...(sessionId ? { sessionId } : {}),
		result: failure ? undefined : result,
	}
}
