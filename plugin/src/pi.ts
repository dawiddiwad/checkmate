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

export function piResult(output: string, error: string, status: number | null, signal: string | null): ChildCall {
	let sessionId: string | undefined
	let final: PiMessage | undefined
	for (const line of output.split('\n')) {
		const event = piEvent(line)
		if (event?.type === 'session' && typeof event.id === 'string') sessionId = event.id
		if (event?.type === 'agent_start') final = undefined
		if (event?.type === 'agent_end')
			final = !event.willRetry && Array.isArray(event.messages) ? event.messages.at(-1) : undefined
		if (event?.type === 'agent_settled' && event.aborted)
			final = { role: 'assistant', stopReason: 'aborted', errorMessage: final?.errorMessage }
	}
	let failure: ChildCall['failure']
	if (status !== 0)
		failure = [
			'operational_error',
			`pi exited with ${signal ? `signal ${signal}` : `code ${status}`}${excerpt(error || final?.errorMessage)}`,
		]
	else if (final?.role !== 'assistant')
		failure = ['operational_error', 'pi did not return a final assistant message.']
	else if (final.stopReason === 'aborted')
		failure = ['interrupted', `pi interrupted the response${excerpt(final.errorMessage)}`]
	else if (final.stopReason === 'error')
		failure = ['operational_error', `pi ended with an error${excerpt(final.errorMessage)}`]
	else if (final.stopReason === 'length') failure = ['operational_error', 'pi reached the output token limit.']
	else if (final.stopReason !== 'stop') failure = ['operational_error', 'pi did not finish the assistant turn.']
	const tail = failure ? stderrTail(error) : []
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
