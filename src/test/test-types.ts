import { Mock } from 'vitest'
import { ChatCompletionMessageParam, ChatCompletionContentPartText } from 'openai/resources/chat/completions'
import { OpenAIClient } from '../step/openai/openai-client'
import { StepStatusCallback } from '../step/types'
import { LoopDetectedError } from '../step/tool/loop-detector'

export interface MockPage {
	goto: Mock
	click: Mock
	hover: Mock
	locator: Mock<(selector: string) => MockLocator>
	keyboard: MockKeyboard
	waitForTimeout: Mock
}

export interface MockLocator {
	clear: Mock
	pressSequentially: Mock
	selectOption: Mock
	innerHTML: Mock
}

export interface MockKeyboard {
	press: Mock
}

export interface MockConfigurationManager {
	getApiKey: Mock<() => string>
	getBaseURL: Mock<() => string | undefined>
	getModel: Mock<() => string>
	getTimeout: Mock<() => number>
	getMaxRetries: Mock<() => number>
	getLogLevel: Mock<() => string>
	getTemperature: Mock<() => number>
	getTokenBudgetUSD?: Mock<() => number | undefined>
	getTokenBudgetCount?: Mock<() => number | undefined>
	getToolChoice?: Mock<() => string>
	getReasoningEffort?: Mock<() => string | undefined>
}

export interface MockToolRegistry {
	getTools: Mock
	setStep: Mock
}

export interface MockOpenAIClient extends Partial<OpenAIClient> {
	getMessages: Mock<() => ChatCompletionMessageParam[]>
	replaceHistory: Mock<(history: ChatCompletionMessageParam[]) => void>
	countHistoryTokens?: Mock<() => number>
	getConfigurationManager?: Mock
	getToolRegistry?: Mock
	initialize?: Mock
	sendMessage?: Mock
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

export type MockStepStatusCallback = Mock<StepStatusCallback>

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

export interface OpenAIClientTestable {
	executeWithRetry: <T>(operation: () => Promise<T>) => Promise<T>
	calculateBackoff: (attempt: number) => number
	sleep: (ms: number) => Promise<void>
	getStatus: (error: unknown) => number | null
	messages: ChatCompletionMessageParam[]
}

export interface MockResponseProcessor {
	instance: MockResponseProcessor | null
	handleResponse: Mock
	resetStepTokens: Mock
}
