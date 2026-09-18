import type { ChatCompletionMessageParam } from 'openai/resources/chat/completions'
import type { DriverContextMessage, DriverSession, DriverTool, DriverToolExecution, StepIntent } from '../driver.js'
import type { AgentTool, ToolExecution } from '../tools/types.js'
import { awaitStepDriverBoundary } from './driver-boundary.js'
import type { StepControl } from './scenario-control.js'

export function adaptDriverTool(driverId: string, tool: DriverTool): AgentTool {
	return {
		driverId,
		definition: { ...tool.definition, parameters: structuredClone(tool.definition.parameters) },
		execute: async (args, context) => {
			if (!context.control || context.turn === undefined || !context.signal) {
				throw new Error(`Driver tool '${tool.definition.name}' requires an active step control`)
			}
			const generation = context.generation
			if (!generation) throw new Error('Driver tool requires a generation gateway')
			const scope = generation.openScope()
			try {
				const result = await awaitStepDriverBoundary(
					`tool:${tool.definition.name}`,
					context.control,
					(signal) =>
						tool.execute(args, {
							step: toStepIntent(context.step),
							turn: context.turn!,
							signal,
							generateStructured: scope.generateStructured,
						})
				)
				scope.assertComplete()
				return result
			} catch (error) {
				generation.assertLive()
				throw error
			} finally {
				scope.close()
			}
		},
	}
}

export async function buildInitialDriverContext(
	session: DriverSession,
	step: StepIntent,
	control: StepControl
): Promise<ChatCompletionMessageParam[]> {
	const context = await awaitStepDriverBoundary('build-initial-context', control, (signal) =>
		session.buildInitialContext({ step, signal })
	)
	return context.map(toProviderMessage)
}

export async function buildPostToolDriverContext(
	session: DriverSession,
	step: StepIntent,
	turn: number,
	toolResponses: readonly ToolExecution[],
	control: StepControl
): Promise<ChatCompletionMessageParam[]> {
	const context = await awaitStepDriverBoundary('handle-tool-responses', control, (signal) =>
		session.handleToolResponses({
			step,
			turn,
			toolResponses: toolResponses.map(toDriverToolExecution),
			signal,
		})
	)
	return context.map(toProviderMessage)
}

export function isEphemeralDriverMessage(message: ChatCompletionMessageParam): boolean {
	return Boolean((message as ChatCompletionMessageParam & { __checkmateEphemeral?: boolean }).__checkmateEphemeral)
}

function toProviderMessage(context: DriverContextMessage): ChatCompletionMessageParam {
	const content =
		typeof context.content === 'string'
			? context.content
			: context.content.map((part) =>
					part.type === 'text'
						? { type: 'text' as const, text: part.text }
						: {
								type: 'image_url' as const,
								image_url: {
									url: `data:${part.mediaType};base64,${part.data}`,
									detail: 'high' as const,
								},
							}
				)
	const message = { role: 'user' as const, content } as ChatCompletionMessageParam & {
		__checkmateEphemeral?: boolean
	}
	if (context.ephemeral) {
		Object.defineProperty(message, '__checkmateEphemeral', { value: true, enumerable: false })
	}
	return message
}

function toDriverToolExecution(execution: ToolExecution): DriverToolExecution {
	return {
		toolCallId: execution.toolCallId,
		name: execution.toolCall.name,
		arguments: structuredClone(execution.toolCall.arguments ?? {}),
		response: execution.toolResponse.response,
		status: execution.toolResponse.status,
	}
}

function toStepIntent(step: { id?: string; action: string; expect: string }): StepIntent {
	return { id: step.id ?? 'legacy-step', action: step.action, expect: step.expect }
}
