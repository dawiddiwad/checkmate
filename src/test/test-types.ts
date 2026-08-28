import { Mock, vi } from 'vitest'
import { ChatCompletionMessageParam, ChatCompletionContentPartText } from 'openai/resources/chat/completions'
import { AiClient } from '../ai/client'
import { ResolveStepResult } from '../runtime/types'
import { LoopDetectedError } from '../tools/loop-detector'

export interface MockNetworkRequest {
	method: Mock<() => string>
	url: Mock<() => string>
	resourceType: Mock<() => string>
	failure: Mock<() => { errorText: string } | null>
}

export interface MockNetworkResponse {
	request: Mock<() => MockNetworkRequest>
	status: Mock<() => number>
	statusText: Mock<() => string>
}

export interface MockBrowserContext {
	pages: Mock<() => MockPage[]>
	on: Mock<(event: string, handler: (payload: never) => void) => MockBrowserContext>
	off: Mock<(event: string, handler: (payload: never) => void) => MockBrowserContext>
	emitPage: (page: MockPage) => void
	emitRequest: (request: MockNetworkRequest) => void
	emitResponse: (response: MockNetworkResponse) => void
	emitRequestFailed: (request: MockNetworkRequest) => void
}

export function createMockBrowserContext(): MockBrowserContext {
	const handlers = new Map<string, Array<(payload: never) => void>>()
	const pages: MockPage[] = []
	const emit = (event: string, payload: unknown) => {
		for (const handler of [...(handlers.get(event) ?? [])]) {
			handler(payload as never)
		}
	}
	const context = {
		pages: vi.fn(() => pages),
		on: vi.fn((event: string, handler: (payload: never) => void) => {
			const registered = handlers.get(event) ?? []
			registered.push(handler)
			handlers.set(event, registered)
			return context
		}),
		off: vi.fn((event: string, handler: (payload: never) => void) => {
			const registered = handlers.get(event) ?? []
			const index = registered.indexOf(handler)
			if (index >= 0) {
				registered.splice(index, 1)
			}
			return context
		}),
		emitPage: (page: MockPage) => {
			pages.push(page)
			emit('page', page)
		},
		emitRequest: (request: MockNetworkRequest) => emit('request', request),
		emitResponse: (response: MockNetworkResponse) => emit('response', response),
		emitRequestFailed: (request: MockNetworkRequest) => emit('requestfailed', request),
	} as MockBrowserContext
	return context
}

export function createMockNetworkRequest(
	method: string,
	url: string,
	resourceType = 'fetch',
	errorText: string | null = null
): MockNetworkRequest {
	return {
		method: vi.fn(() => method),
		url: vi.fn(() => url),
		resourceType: vi.fn(() => resourceType),
		failure: vi.fn(() => (errorText === null ? null : { errorText })),
	}
}

export function createMockNetworkResponse(
	request: MockNetworkRequest,
	status: number,
	statusText: string
): MockNetworkResponse {
	return {
		request: vi.fn(() => request),
		status: vi.fn(() => status),
		statusText: vi.fn(() => statusText),
	}
}

export interface MockPage {
	goto: Mock
	click: Mock
	hover: Mock
	locator: Mock<(selector: string) => MockLocator>
	keyboard: MockKeyboard
	waitForTimeout: Mock
	context: Mock<() => MockBrowserContext>
	url: Mock<() => string>
	title: Mock<() => Promise<string>>
	bringToFront: Mock<() => Promise<void>>
	waitForLoadState: Mock<() => Promise<void>>
	isClosed: Mock<() => boolean>
	close: Mock<() => Promise<void>>
	opener: Mock<() => Promise<MockPage | null>>
}

export interface MockLocator {
	clear: Mock
	pressSequentially: Mock
	selectOption: Mock
	dragTo: Mock
	setInputFiles: Mock
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
}

export interface MockOpenAIClient extends Partial<AiClient> {
	getMessages: Mock<() => ChatCompletionMessageParam[]>
	replaceHistory: Mock<(history: ChatCompletionMessageParam[]) => void>
	countHistoryTokens?: Mock<() => number>
	getRuntimeConfig?: Mock
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

export type MockResolveStepResult = Mock<ResolveStepResult>

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
