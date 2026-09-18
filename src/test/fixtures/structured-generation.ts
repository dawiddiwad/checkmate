import type { ChatCompletion } from 'openai/resources/chat/completions'
import { z } from 'zod/v4'
import {
	defineDriverTool,
	type DriverSession,
	type DriverStructuredGenerationRequest,
	type DriverToolContext,
} from '../../driver'

export const generationRequest: DriverStructuredGenerationRequest = {
	messages: [{ role: 'user', content: [{ type: 'text', text: 'Inspect the fixture' }] }],
	schemaName: 'fixture_fact',
	schema: {
		type: 'object',
		properties: { fact: { type: 'string' } },
		required: ['fact'],
		additionalProperties: false,
	},
}

export function structuredResponse(
	content = '{"fact":"ready"}',
	usage: ChatCompletion['usage'] = {
		prompt_tokens: 5,
		completion_tokens: 2,
		total_tokens: 7,
		prompt_tokens_details: { cached_tokens: 3 },
	}
): ChatCompletion {
	return {
		id: 'nested',
		object: 'chat.completion',
		created: 0,
		model: 'fixture-model',
		usage,
		choices: [
			{ index: 0, logprobs: null, finish_reason: 'stop', message: { role: 'assistant', refusal: null, content } },
		],
	}
}

export function generationSession(handler: (context: DriverToolContext) => Promise<string>): DriverSession {
	return {
		tools: [
			defineDriverTool({
				name: 'fixture_action',
				description: 'Generate a fixture fact',
				schema: z.object({}).strict(),
				handler: (_args, context) => handler(context),
			}),
		],
		instructions: [],
		buildInitialContext: async () => [],
		handleToolResponses: async () => [],
		close: async () => undefined,
	}
}
