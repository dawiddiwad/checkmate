import { join } from 'node:path'
import type { Store } from '../store.ts'
import { piEvent, piModelArgs, selectedHarness } from '../pi.ts'
import { streamPi } from './pi-request.ts'
import type { ChildCall, Env, StopDelays, StreamedClaude } from '../sessions.ts'
import type { RequestContext, RequestRecord } from '../requests.ts'
import { Refusal } from '../contracts.ts'
import { requestVariable } from '../actor.ts'
import {
	authenticationFailed,
	authenticationHint,
	checkmateScript,
	defaultStopDelays,
	pluginRoot,
	requestSystemPrompt,
	hookTokenName,
	requestArgs,
	requestHookName,
	requestPrompt,
	requireChild,
	stderrTail,
	streamClaude,
} from '../sessions.ts'
import {
	addRequestActivity,
	askRequest,
	changesOf,
	conversationStarted,
	recordRequestEvent,
	requestActor,
	requestOf,
	screenText,
	setRequestState,
	startConversation,
	stopRequestRecord,
} from '../requests.ts'
import { requestModelText, workspaceUiEnv } from '../settings.ts'
import { activityLine } from './hooks.ts'

export type RequesterOptions = {
	workspace: string
	env: Env
	hookPort: () => number
	hookToken: string
	delays?: StopDelays
	log?: (line: string) => void
}

export type Requester = {
	ask(actor: string, text: string, context: RequestContext): string
	stop(actor: string, requestId: string, reason: string): void
	newConversation(actor: string): void
	close(): Promise<void>
}

export type StreamLine =
	| { kind: 'session'; sessionId: string }
	| { kind: 'tool'; name: string; input: unknown; cwd: string | undefined }
	| { kind: 'result'; value: Record<string, unknown> }
	| { kind: 'other' }
	| { kind: 'broken' }

const stderrCount = 20

export function readStreamLine(line: string, harness: 'claude' | 'pi' = 'claude'): StreamLine[] {
	if (harness === 'pi') {
		const event = piEvent(line)
		if (!event) return [{ kind: 'broken' }]
		if (event.type === 'session' && event.id) return [{ kind: 'session', sessionId: event.id }]
		if (event.type === 'agent_settled' && event.aborted)
			return [{ kind: 'result', value: { is_error: true, result: 'Pi interrupted the response.' } }]
		if (event.type === 'tool_execution_start' && event.toolName)
			return [{ kind: 'tool', name: event.toolName, input: event.args, cwd: undefined }]
		if (event.type === 'agent_end' && !event.willRetry) {
			const message = event.messages?.at(-1)
			const error = message?.role !== 'assistant' || message.stopReason !== 'stop'
			const reply =
				message?.content?.flatMap((part) => (part.type === 'text' && part.text ? [part.text] : [])).join('') ??
				''
			return [
				{
					kind: 'result',
					value: {
						is_error: error,
						result: error ? message?.errorMessage || 'Pi did not complete the response.' : reply,
					},
				},
			]
		}
		return [{ kind: 'other' }]
	}
	let value: unknown
	try {
		value = JSON.parse(line)
	} catch {
		return [{ kind: 'broken' }]
	}
	if (!value || typeof value !== 'object' || Array.isArray(value)) return [{ kind: 'broken' }]
	const fields = value as Record<string, unknown>
	if (fields.type === 'system' && fields.subtype === 'init' && typeof fields.session_id === 'string')
		return [{ kind: 'session', sessionId: fields.session_id }]
	if (fields.type === 'result') return [{ kind: 'result', value: fields }]
	if (fields.type !== 'assistant') return [{ kind: 'other' }]
	const content = (fields.message as { content?: unknown } | undefined)?.content
	const tools = (Array.isArray(content) ? content : []).flatMap((block: Record<string, unknown>) =>
		block?.type === 'tool_use' && typeof block.name === 'string'
			? [
					{
						kind: 'tool' as const,
						name: block.name,
						input: block.input,
						cwd: typeof fields.cwd === 'string' ? fields.cwd : undefined,
					},
				]
			: []
	)
	return tools.length ? tools : [{ kind: 'other' }]
}

type Running = {
	id: string
	actor: string
	harness: 'claude' | 'pi'
	child: StreamedClaude | null
	result: Record<string, unknown> | null
	broken: boolean
	stopping: 'stopped' | 'interrupted' | null
	reason: string
	done: Promise<void>
}

function failed(reason: string, hint: string | null = null) {
	return { state: 'failed' as const, detail: { reason, ...(hint ? { hint } : {}) } }
}

function denialLines(result: Record<string, unknown>, workspace: string) {
	const denials = Array.isArray(result.permission_denials) ? result.permission_denials : []
	return denials.flatMap((denial: Record<string, unknown>) =>
		typeof denial?.tool_name === 'string' ? [activityLine(denial.tool_name, denial.tool_input, workspace)] : []
	)
}

export function createRequester(store: Store, options: RequesterOptions): Requester {
	const log = options.log ?? ((line: string) => process.stderr.write(`checkmate ui: ${line}\n`))
	const delays = options.delays ?? defaultStopDelays
	const queue: string[] = []
	let running: Running | null = null
	let closing = false

	function guarded(action: () => void) {
		try {
			action()
		} catch (error) {
			log(`could not record a request: ${(error as Error).message}`)
		}
	}

	function conclude(run: Running, end: Awaited<StreamedClaude['finished']> | null) {
		const stderr = stderrTail(end?.stderr ?? '', stderrCount)
		const result = run.result
		const outcome = run.stopping
			? {
					state: run.stopping,
					detail: { reason: run.reason },
				}
			: !end
				? failed(run.reason)
				: end.error
					? failed(end.error)
					: run.harness === 'pi' && end.status !== 0
						? failed(
								[
									`pi exited with ${end.signal ? `signal ${end.signal}` : `code ${end.status}`}.`,
									...stderr,
								].join('\n')
							)
						: run.broken
							? failed([`${run.harness} printed a line that is not JSON.`, ...stderr].join('\n'))
							: !result
								? failed([`${run.harness} ended without a reply.`, ...stderr].join('\n'))
								: result.is_error === true
									? errorOutcome(result, stderr, run.harness)
									: {
											state: 'answered' as const,
											detail: {
												reply: typeof result.result === 'string' ? result.result : '',
												...(typeof result.total_cost_usd === 'number'
													? { costUsd: result.total_cost_usd }
													: {}),
												denials: denialLines(result, options.workspace),
											},
										}
		guarded(() => {
			const changes = changesOf(store, run.id)
			setRequestState(store, run.id, outcome.state, { ...outcome.detail, changes })
		})
	}

	function errorOutcome(result: Record<string, unknown>, stderr: string[], harness: 'claude' | 'pi') {
		const text = typeof result.result === 'string' ? result.result : ''
		const call: ChildCall = { failure: ['operational_error', text], result: text, stderr }
		const authentication = authenticationFailed(call)
		const first = text.trim().split('\n')[0].slice(0, 200)
		return failed(
			[`${harness} ended with an error` + (first ? `: ${first}` : '.'), ...stderr].join('\n'),
			authentication && harness === 'claude' ? authenticationHint : null
		)
	}

	function read(run: Running, line: string) {
		for (const found of readStreamLine(line, run.harness)) {
			if (found.kind === 'broken') {
				run.broken = true
				run.child?.stop()
			} else if (found.kind === 'session')
				guarded(() =>
					recordRequestEvent(
						store,
						run.id,
						{
							step: 'session',
							status: 'started',
							detail: { sessionId: found.sessionId, harness: run.harness },
						},
						{ subjects: [`request:${run.id}`] }
					)
				)
			else if (found.kind === 'tool')
				guarded(() =>
					addRequestActivity(
						store,
						run.id,
						activityLine(found.name, found.input, found.cwd ?? options.workspace)
					)
				)
			else if (found.kind === 'result') run.result = found.value
		}
	}

	function launch(request: RequestRecord) {
		const run: Running = {
			id: request.id,
			actor: requestActor(request.asker, request.id),
			harness: request.harness,
			child: null,
			result: null,
			broken: false,
			stopping: null,
			reason: '',
			done: Promise.resolve(),
		}
		running = run
		let program: string
		let modelArgs: string[] = []
		try {
			program = requireChild(options.env, run.harness)
			if (run.harness === 'pi')
				modelArgs = piModelArgs({
					...options.env,
					CHECKMATE_PI_MODEL: requestModelText(store, 'pi') || options.env.CHECKMATE_PI_MODEL,
				})
		} catch (error) {
			const refusal = error as Refusal
			run.reason = [refusal.message, refusal.hint].filter(Boolean).join(' ')
			guarded(() => setRequestState(store, run.id, 'running'))
			run.done = Promise.resolve().then(() => finish(run, null))
			return
		}
		const hook = {
			port: options.hookPort(),
			token: options.hookToken,
			explorationId: requestHookName,
			who: request.id,
		}
		const extension = join(pluginRoot, 'pi', 'permission.mjs')
		const args =
			run.harness === 'pi'
				? [
						'--mode',
						'rpc',
						...modelArgs,
						conversationStarted(store, request.conversation) ? '--session' : '--session-id',
						request.conversation,
						'--extension',
						extension,
						'--append-system-prompt',
						requestSystemPrompt(checkmateScript()),
					]
				: requestArgs({
						sessionId: request.conversation,
						resume: conversationStarted(store, request.conversation),
						hook,
						model: requestModelText(store, 'claude') || null,
						checkmate: checkmateScript(),
					})
		guarded(() => setRequestState(store, run.id, 'running'))
		const env = {
			...options.env,
			CHECKMATE_ACTOR: run.actor,
			CHECKMATE_HARNESS: run.harness,
			[requestVariable]: request.id,
			[hookTokenName]: options.hookToken,
			...(run.harness === 'pi' ? { CHECKMATE_PI_HOOK: JSON.stringify(hook) } : {}),
		}
		const prompt = requestPrompt(request.text, screenText(request.context))
		run.child =
			run.harness === 'pi'
				? streamPi(
						program,
						args,
						prompt,
						options.workspace,
						env,
						extension,
						request.conversation,
						(line) => read(run, line),
						delays
					)
				: streamClaude(program, args, prompt, options.workspace, env, (line) => read(run, line), delays)
		run.done = run.child.finished.then((end) => finish(run, end))
	}

	function finish(run: Running, end: Awaited<StreamedClaude['finished']> | null) {
		conclude(run, end)
		if (running === run) running = null
		next()
	}

	function next() {
		if (running || closing) return
		const id = queue.shift()
		if (!id) return
		const request = requestOf(store, id)
		if (request?.state === 'waiting') launch(request)
		else next()
	}

	return {
		ask(actor, text, context) {
			const harness = selectedHarness(workspaceUiEnv(store, options.env))
			const id = askRequest(store, actor, { text, context, harness })
			queue.push(id)
			next()
			return id
		},
		stop(actor, requestId, reason) {
			if (running?.id === requestId) {
				if (running.stopping) return
				running.stopping = 'stopped'
				running.reason = reason || 'Stopped by you.'
				stopRequestRecord(store, actor, requestId, reason)
				running.child?.stop()
				return
			}
			const at = queue.indexOf(requestId)
			if (at === -1) return
			queue.splice(at, 1)
			stopRequestRecord(store, actor, requestId, reason)
			setRequestState(store, requestId, 'stopped', { reason: 'Stopped before it started.', changes: [] })
		},
		newConversation(actor) {
			startConversation(store, actor)
		},
		async close() {
			closing = true
			for (const id of queue.splice(0))
				guarded(() =>
					setRequestState(store, id, 'interrupted', {
						reason: 'The UI stopped before the request started.',
						changes: [],
					})
				)
			const run = running as Running | null
			if (!run) return
			run.stopping ??= 'interrupted'
			if (run.stopping === 'interrupted') run.reason = 'The UI stopped before the request ended.'
			run.child?.stop()
			await run.done
		},
	}
}
