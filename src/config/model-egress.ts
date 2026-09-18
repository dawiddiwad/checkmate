import { Buffer } from 'node:buffer'
import type {
	ChatCompletionCreateParamsNonStreaming,
	ChatCompletionMessageParam,
} from 'openai/resources/chat/completions'
import type { ModelEgressPolicyV1 } from '../contracts/types.js'
import { Redactor } from '../redaction/redactor.js'
import type { ManifestPolicy } from './policy.js'
import { deepFreeze } from './policy.js'

export function resolveModelEgress(policy: ManifestPolicy): ModelEgressPolicyV1 {
	return deepFreeze({
		provider: { ...policy.modelEgress.provider },
		textRedaction: policy.modelEgress.textRedaction,
		allowOpaque: policy.modelEgress.allowOpaque,
		maxStepBytes: policy.modelEgress.maxStepBytes,
		maxMessageBytes: policy.modelEgress.maxMessageBytes,
	})
}

export class ModelEgressError extends Error {
	constructor(
		readonly code:
			'opaque-content-disallowed' | 'message-too-large' | 'step-too-large' | 'schema-redaction-conflict',
		message: string
	) {
		super(message)
		this.name = 'ModelEgressError'
	}
}

export function prepareModelRequest(
	request: ChatCompletionCreateParamsNonStreaming,
	policy: ModelEgressPolicyV1,
	exactSecrets: Iterable<string> = []
): ChatCompletionCreateParamsNonStreaming {
	const redactor = new Redactor({ mode: policy.textRedaction, exactSecrets })
	const messages = request.messages.map((message, index) => {
		const prepared = prepareMessage(message, policy, redactor)
		const bytes = Buffer.byteLength(JSON.stringify(prepared), 'utf8')
		if (bytes > policy.maxMessageBytes) {
			throw new ModelEgressError(
				'message-too-large',
				`Provider message ${index} exceeds the policy limit of ${policy.maxMessageBytes} bytes`
			)
		}
		return prepared
	})
	const prepared = { ...request, messages }
	if (request.response_format?.type === 'json_schema') {
		const format = request.response_format.json_schema
		assertUnchanged(format.name, redactor)
		prepared.response_format = {
			type: 'json_schema',
			json_schema: {
				...format,
				...(format.description === undefined ? {} : { description: redactor.redactText(format.description) }),
				...(format.schema === undefined
					? {}
					: { schema: redactSchema(format.schema, redactor, 'schema') as Record<string, unknown> }),
			},
		}
	}
	const requestBytes = Buffer.byteLength(JSON.stringify(prepared), 'utf8')
	if (requestBytes > policy.maxStepBytes) {
		throw new ModelEgressError(
			'step-too-large',
			`Provider JSON request exceeds the policy limit of ${policy.maxStepBytes} bytes`
		)
	}
	return prepared
}

type SchemaPosition = 'schema' | 'map' | 'schemas' | 'literal' | 'annotation'

function redactSchema(value: unknown, redactor: Redactor, position: SchemaPosition): unknown {
	if (typeof value === 'string') {
		if (position === 'annotation') return redactor.redactText(value)
		assertUnchanged(value, redactor)
		return value
	}
	if (Array.isArray(value)) {
		return value.map((item) => redactSchema(item, redactor, position === 'schemas' ? 'schema' : position))
	}
	if (!value || typeof value !== 'object') return value
	return Object.fromEntries(
		Object.entries(value).map(([key, child]) => {
			assertUnchanged(key, redactor)
			let next: SchemaPosition = position === 'annotation' ? 'annotation' : 'literal'
			if (position === 'map') next = 'schema'
			if (position === 'schema') {
				if (['title', 'description', '$comment', 'examples'].includes(key)) next = 'annotation'
				else if (['properties', 'patternProperties', '$defs', 'definitions', 'dependentSchemas'].includes(key))
					next = 'map'
				else if (['allOf', 'anyOf', 'oneOf', 'prefixItems'].includes(key)) next = 'schemas'
				else if (
					[
						'items',
						'additionalProperties',
						'unevaluatedProperties',
						'unevaluatedItems',
						'contains',
						'propertyNames',
						'not',
						'if',
						'then',
						'else',
					].includes(key)
				)
					next = 'schema'
			}
			return [key, redactSchema(child, redactor, next)]
		})
	)
}

function assertUnchanged(value: string, redactor: Redactor): void {
	if (redactor.redactText(value) !== value) {
		throw new ModelEgressError(
			'schema-redaction-conflict',
			'Redaction would change structured response schema semantics'
		)
	}
}

function prepareMessage(
	message: ChatCompletionMessageParam,
	policy: ModelEgressPolicyV1,
	redactor: Redactor
): ChatCompletionMessageParam {
	const prepared = structuredClone(message)
	if (typeof prepared.content === 'string') prepared.content = redactor.redactText(prepared.content)
	else if (Array.isArray(prepared.content)) {
		prepared.content = prepared.content.map((part) => {
			if ('text' in part && typeof part.text === 'string')
				return { ...part, text: redactor.redactText(part.text) }
			if ('image_url' in part) {
				if (!policy.allowOpaque) {
					throw new ModelEgressError(
						'opaque-content-disallowed',
						'Opaque image content is disabled by model egress policy'
					)
				}
				return structuredClone(part)
			}
			return structuredClone(part)
		}) as typeof prepared.content
	}
	if ('tool_calls' in prepared && prepared.tool_calls) {
		prepared.tool_calls = prepared.tool_calls.map((call) =>
			call.type === 'function'
				? { ...call, function: { ...call.function, arguments: redactor.redactText(call.function.arguments) } }
				: call
		)
	}
	return prepared
}
