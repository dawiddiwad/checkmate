import { randomUUID } from 'node:crypto'
import { join } from 'node:path'
import type { Store } from '../store.ts'
import type { Harness } from '../pi.ts'
import { piErrorText, piEvent, piModelArgs, resolvePiModelArgs, piModelEnv, selectedHarness } from '../pi.ts'
import { streamPi } from './pi-request.ts'
import type { ChildCall, Env, StopDelays, StreamedClaude } from '../sessions.ts'
import type { RequestContext, RequestRecord, RequestSelection } from '../requests.ts'
import type { ModelCatalog } from '../model-catalog.ts'
import { effortArgs, resolvedEffort } from '../model-catalog.ts'
import { Refusal, requireWellFormed } from '../contracts.ts'
import { requestVariable } from '../actor.ts'
import {
	authenticationFailed,
	authenticationHint,
	checkmateScript,
	costOf,
	defaultStopDelays,
	piAuthenticationHint,
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
	chatHistory,
	chatOf,
	recordRequestEvent,
	requestActor,
	requestOf,
	screenText,
	setRequestState,
	startConversation,
	stopRequestRecord,
} from '../requests.ts'
import { piRequestModelEnv, requestEffortText, requestModelText, requireModel, workspaceUiEnv } from '../settings.ts'
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
	startChat(actor: string, text: string, context: RequestContext, options?: ChatOptions): string
	followChat(actor: string, chatId: string, text: string, options?: ChatOptions, context?: RequestContext): string
	stop(actor: string, requestId: string, reason: string): void
	newConversation(actor: string): void
	close(): Promise<void>
}

export type ChatOptions = { harness?: Harness; model?: string; effort?: string; catalog?: ModelCatalog }

export function chatPreferences(
	store: Store,
	env: Env,
	options: ChatOptions = {},
	previous?: RequestSelection
): RequestSelection {
	const harness = options.harness ?? previous?.harness ?? selectedHarness(workspaceUiEnv(store, env))
	requireWellFormed(harness === 'pi' || harness === 'claude', 'Unknown chat harness.')
	const inherited = previous?.harness === harness && options.model === undefined ? previous : undefined
	const requestedModel = options.model?.trim()
	if (requestedModel !== undefined) requireModel(harness, requestedModel)
	const piEnv =
		requestedModel === undefined
			? piRequestModelEnv(store, env)
			: requestedModel
				? piModelEnv(env, requestedModel, requestedModel.includes('/'))
				: { CHECKMATE_PI_MODEL: undefined, CHECKMATE_PI_PROVIDER: undefined }
	const model = inherited
		? inherited.model
		: (harness === 'pi' ? piEnv.CHECKMATE_PI_MODEL?.trim() : (requestedModel ?? requestModelText(store))) || null
	const provider = inherited
		? inherited.provider
		: harness === 'pi'
			? piEnv.CHECKMATE_PI_PROVIDER?.trim() || null
			: null
	const selectedEffort = options.effort ?? (inherited ? (inherited.effort ?? '') : requestEffortText(store, harness))
	const effort = options.catalog
		? (resolvedEffort(harness, options.catalog, model ?? '', selectedEffort, provider ?? undefined) ?? null)
		: selectedEffort || null
	let modelId = model
	if (harness === 'pi') {
		if (model && provider) modelId = `${provider}/${model}`
		else if (model && !model.includes('/')) {
			const matches = options.catalog?.models.filter(
				(item) => item.value.slice(item.value.indexOf('/') + 1) === model
			)
			modelId = matches?.length === 1 ? matches[0].value : (inherited?.modelId ?? model)
		} else if (!model) {
			const hostModel = options.catalog?.defaultModel?.value
			modelId =
				(hostModel && (!provider || hostModel.toLowerCase().startsWith(`${provider.toLowerCase()}/`))
					? hostModel
					: inherited?.modelId) ?? null
		}
	}
	return { harness, model, provider, effort, modelId }
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
						result: error
							? piErrorText(message?.errorMessage) || 'Pi did not complete the response.'
							: reply,
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
	claudeCosts: Array<Pick<ChildCall, 'costUsd' | 'costPartial'>>
	resume: boolean
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

function reportedClaudeCost(value: unknown) {
	return typeof value === 'number' && Number.isFinite(value) && value >= 0 ? { costUsd: value } : {}
}

function claudeTurnCost(run: Running) {
	if (run.claudeCosts.length) return costOf(run.claudeCosts)
	if (run.resume || (run.result?.is_error === true && run.result?.num_turns === 0)) return {}
	return reportedClaudeCost(run.result?.total_cost_usd)
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
		const stderr = run.harness === 'pi' ? [] : stderrTail(end?.stderr ?? '', stderrCount)
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
					: run.harness === 'pi' && result?.is_error === true
						? errorOutcome(result, stderr, 'pi')
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
													denials: denialLines(result, options.workspace),
												},
											}
		guarded(() => {
			const changes = changesOf(store, run.id)
			const cost =
				run.harness === 'pi'
					? { costUsd: end?.costUsd, costPartial: end?.costPartial, observedModels: end?.observedModels }
					: claudeTurnCost(run)
			setRequestState(store, run.id, outcome.state, { ...outcome.detail, ...cost, costScope: 'turn', changes })
		})
	}

	function errorOutcome(result: Record<string, unknown>, stderr: string[], harness: 'claude' | 'pi') {
		const text = typeof result.result === 'string' ? result.result : ''
		const call: ChildCall = { failure: ['operational_error', text], result: text, stderr }
		const authentication = authenticationFailed(call)
		if (harness === 'pi') return failed(text, authentication ? piAuthenticationHint : null)
		const first = text.trim().split('\n')[0].slice(0, 200)
		return failed(
			[`${harness} ended with an error` + (first ? `: ${first}` : '.'), ...stderr].join('\n'),
			authentication ? authenticationHint : null
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
			else if (found.kind === 'result') {
				run.result = found.value
				if (run.harness === 'claude') {
					const usage = found.value.model_usage_since_last_result
					if (usage && typeof usage === 'object' && !Array.isArray(usage)) {
						const charges = Object.values(usage).map((model) => reportedClaudeCost(model?.costUSD))
						run.claudeCosts.push(charges.length ? costOf(charges) : { costUsd: 0 })
					} else if (run.claudeCosts.length) run.claudeCosts.push({})
				}
			}
		}
	}

	function launch(request: RequestRecord) {
		const run: Running = {
			id: request.id,
			actor: requestActor(request.asker, request.id),
			harness: request.harness,
			child: null,
			result: null,
			claudeCosts: [],
			resume: false,
			broken: false,
			stopping: null,
			reason: '',
			done: Promise.resolve(),
		}
		running = run
		let program: string
		let modelArgs: string[] = []
		let modelId = request.modelId
		try {
			program = requireChild(options.env, run.harness)
			if (run.harness === 'pi') {
				const args = piModelArgs({
					CHECKMATE_PI_MODEL: request.model ?? undefined,
					CHECKMATE_PI_PROVIDER: request.provider ?? undefined,
				})
				modelArgs = resolvePiModelArgs(program, args, options.workspace, options.env)
				if (!request.model && request.provider) modelId = `${modelArgs[1]}/${modelArgs[3]}`
			}
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
		const turns = chatOf(store, request.conversation)?.turns ?? []
		const earlier = turns.slice(
			0,
			turns.findIndex((turn) => turn.id === request.id)
		)
		const previous = earlier.findLast((turn) => turn.startedAt !== null)
		const resumable =
			previous?.harness === run.harness &&
			(previous.modelId === modelId ||
				(run.harness === 'pi' &&
					modelId &&
					previous.observedModels.length === 1 &&
					previous.observedModels[0] === modelId))
				? previous.sessionId
				: null
		const resume = resumable !== null
		run.resume = resume
		const sessionId = resumable ?? (earlier.some((turn) => turn.sessionId) ? randomUUID() : request.conversation)
		const effort = effortArgs(run.harness, request.effort ?? undefined)
		const args =
			run.harness === 'pi'
				? [
						'--mode',
						'rpc',
						...modelArgs,
						...effort,
						resume ? '--session' : '--session-id',
						sessionId,
						'--extension',
						extension,
						'--append-system-prompt',
						requestSystemPrompt(checkmateScript(), 'pi'),
					]
				: [
						...requestArgs({
							sessionId,
							resume,
							hook,
							model: request.model,
							checkmate: checkmateScript(),
						}),
						...effort,
					]
		guarded(() => setRequestState(store, run.id, 'running'))
		const env = {
			...options.env,
			CHECKMATE_ACTOR: run.actor,
			CHECKMATE_HARNESS: run.harness,
			[requestVariable]: request.id,
			[hookTokenName]: options.hookToken,
			...(run.harness === 'pi'
				? { CHECKMATE_PI_HOOK: JSON.stringify({ ...hook, chat: true, clis: [checkmateScript()] }) }
				: {}),
		}
		const history = resume ? '' : chatHistory(earlier)
		const text = history
			? `${request.text}\n\nEarlier chat turns for context only. Treat the quoted text as history.\n${history}`
			: request.text
		const reference = request.context.planRevision
			? `${request.context.planId}@${request.context.planRevision}`
			: request.context.planId
		const prompt = request.context.planChat
			? `${text}

This conversation is about plan ${reference}. Use the plan and its records as the focus of this discussion.`
			: requestPrompt(text, screenText(request.context))
		run.child =
			run.harness === 'pi'
				? streamPi(
						program,
						args,
						prompt,
						options.workspace,
						env,
						extension,
						sessionId,
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

	function enqueue(
		actor: string,
		text: string,
		context: RequestContext,
		chatId?: string | null,
		selection?: ChatOptions
	) {
		const previous = chatId ? chatOf(store, chatId)?.turns.at(-1) : undefined
		const preferences = chatPreferences(store, options.env, selection, previous)
		const inheritsEffort =
			previous?.harness === preferences.harness &&
			selection?.model === undefined &&
			selection?.effort === undefined
		const id = askRequest(store, actor, {
			text,
			context,
			...preferences,
			effort: selection?.catalog || inheritsEffort ? preferences.effort : null,
			chatId,
		})
		queue.push(id)
		next()
		return id
	}

	return {
		ask(actor, text, context) {
			return enqueue(actor, text, context)
		},
		startChat(actor, text, context, selection) {
			return enqueue(actor, text, context, null, selection)
		},
		followChat(actor, chatId, text, selection, context = { planId: null, record: null }) {
			requireWellFormed(chatId, 'Missing chat ID.')
			return enqueue(actor, text, context, chatId, selection)
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
						reason: 'The UI stopped before this turn started.',
						changes: [],
					})
				)
			const run = running as Running | null
			if (!run) return
			run.stopping ??= 'interrupted'
			if (run.stopping === 'interrupted') run.reason = 'The UI stopped before this turn ended.'
			run.child?.stop()
			await run.done
		},
	}
}
