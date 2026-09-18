import type { Mock } from 'vitest'
import { ChatCompletionMessageParam, ChatCompletionContentPartText } from 'openai/resources/chat/completions'
import { AiSendOptions } from '../ai/client'
import type { RuntimeConfig } from '../runtime/config'
import { LoopDetectedError } from '../tools/loop-detector'

export type MutableConfig = { -readonly [K in keyof RuntimeConfig]: RuntimeConfig[K] }

/**
 * A resolved config a test can keep mutating after handing it to a collaborator.
 */
export function testConfig(overrides: Partial<RuntimeConfig> = {}): MutableConfig {
	return {
		model: 'fixture-model',
		temperature: 0,
		turnCap: 20,
		requestTimeout: 60_000,
		maxRetries: 3,
		loopMaxRepetitions: 5,
		redact: true,
		toolChoice: 'required',
		rateLimitDelay: 0,
		logLevel: 'off',
		...overrides,
	}
}

export interface MockToolRegistry {
	getTools: Mock
}

export interface HttpError extends Error {
	status?: number
	statusCode?: number
	code?: number | string
	headers?: {
		get?: (key: string) => string | undefined
		'retry-after'?: string
	}
}

export function createHttpError(message: string, status?: number): HttpError {
	const error = new Error(message) as HttpError
	if (status !== undefined) {
		error.status = status
	}
	return error
}

export function getTextContent(content: ChatCompletionMessageParam['content']): string | undefined {
	if (typeof content === 'string') {
		return content
	}
	if (Array.isArray(content) && content.length > 0) {
		const firstPart = content[0]
		if ('text' in firstPart && typeof firstPart.text === 'string') {
			return firstPart.text
		}
	}
	return undefined
}

export interface UserMessageWithTextContent {
	role: 'user'
	content: ChatCompletionContentPartText[]
}

export type PrivateAccess<T> = {
	[K in keyof T]: T[K]
} & Record<string, unknown>

export type CaughtLoopError = LoopDetectedError & {
	status: string
	loopResult: {
		loopDetected: boolean
		patternLength: number
		repetitions: number
		pattern: string[]
	}
}

export interface ScreenshotMessageContent {
	role: 'user'
	content: Array<
		| { type: 'text'; text: string }
		| {
				type: 'image_url'
				image_url: {
					url: string
					detail: string
				}
		  }
	>
}

export interface AiClientTestable {
	executeWithRetry: <T>(
		messages: ChatCompletionMessageParam[],
		options: AiSendOptions,
		operation: () => Promise<T>
	) => Promise<T>
	calculateBackoff: (attempt: number) => number
	sleep: Mock<(ms: number) => Promise<void>>
	getStatus: (error: unknown) => number | null
}
