import { STATUS_CODES } from 'node:http'
import { stripVTControlCharacters } from 'node:util'
import { Refusal } from './contracts.ts'
import { excerpt, stderrTail } from './sessions.ts'
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

export function piModelArgs(env: Env) {
	const model = env.CHECKMATE_PI_MODEL?.trim()
	const provider = env.CHECKMATE_PI_PROVIDER?.trim()
	if (provider && !model) throw new Refusal('malformed', 'CHECKMATE_PI_PROVIDER requires CHECKMATE_PI_MODEL.')
	return [...(model ? ['--model', model] : []), ...(provider ? ['--provider', provider] : [])]
}

export function piArgs(own: string[] = [], env: Env = process.env) {
	return ['-p', '--mode', 'json', ...piModelArgs(env), ...own]
}

export type PiContent = { type: string; text?: string; name?: string; id?: string; arguments?: unknown }
export type PiMessage = { role: string; content?: PiContent[]; stopReason?: string; errorMessage?: string }
export type PiEvent = {
	type: string
	id?: string
	message?: PiMessage
	messages?: PiMessage[]
	willRetry?: boolean
	aborted?: boolean
	assistantMessageEvent?: { type: string; delta?: string }
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

export function piResult(output: string, error: string, status: number | null, signal: string | null): ChildCall {
	let sessionId: string | undefined
	let final: PiMessage | undefined
	let latestError: PiMessage | undefined
	for (const line of output.split('\n')) {
		const event = piEvent(line)
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
			const last = Array.isArray(event.messages) ? event.messages.at(-1) : undefined
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
		...(tail.length ? { stderr: tail } : {}),
		...(sessionId ? { sessionId } : {}),
		result: failure ? undefined : result,
	}
}
