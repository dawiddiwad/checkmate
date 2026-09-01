import { beforeEach, describe, expect, it, vi } from 'vitest'
import { MessageHistory } from '../ai/message-history'
import { ToolResponseHandler } from '../ai/tool-response-handler'
import { LogLevel } from '../logging/logger'
import { logger } from '../logging'
import { ToolExecution, ToolResponse } from '../tools/types'
import { testConfig } from './test-types'

vi.mock('../../src/logging', () => ({
	logger: {
		info: vi.fn(),
		warn: vi.fn(),
		error: vi.fn(),
		debug: vi.fn(),
	},
}))

function createHandler(logLevel: LogLevel = 'off'): ToolResponseHandler {
	return new ToolResponseHandler(testConfig({ checkmateLogLevel: logLevel }), new MessageHistory())
}

function execution(toolCallId: string, name: string, args: unknown, toolResponse: ToolResponse): ToolExecution {
	return { toolCallId, toolCall: { name, arguments: args }, toolResponse }
}

describe('ToolResponseHandler', () => {
	beforeEach(() => {
		vi.clearAllMocks()
	})

	it('returns one tool message per call plus a single execution summary', () => {
		const messages = createHandler().build([
			execution(
				'call_1',
				'browser_click_or_hover',
				{ ref: 'e123', goal: 'submit form' },
				{
					name: 'browser_click_or_hover',
					response: 'Timeline of events after last function call:\n[123ms] Clicked submit',
					snapshot: 'page snapshot:\n{button Submit}',
					status: 'success',
				}
			),
		])

		expect(messages).toEqual([
			{
				role: 'tool',
				tool_call_id: 'call_1',
				content: 'Timeline of events after last function call:\n[123ms] Clicked submit',
			},
			{
				role: 'user',
				content:
					'tool execution summary:\n- successfully executed: browser_click_or_hover {"ref":"e123","goal":"submit form"}',
			},
		])
	})

	it('summarizes tool errors with the failing response', () => {
		const messages = createHandler().build([
			execution(
				'call_1',
				'browser_click_or_hover',
				{ ref: 'e999', goal: 'click missing button' },
				{
					name: 'browser_click_or_hover',
					response: 'failed to click element',
					snapshot: null,
					status: 'error',
				}
			),
		])

		expect(messages[1]).toEqual({
			role: 'user',
			content:
				'tool execution summary:\n- tool call error: browser_click_or_hover {"ref":"e999","goal":"click missing button"} -> failed to click element',
		})
	})

	it('returns nothing when no tools ran', () => {
		expect(createHandler().build([])).toEqual([])
	})

	it('logs model-bound tool responses in debug mode', () => {
		createHandler('debug').build([
			execution(
				'call_debug',
				'browser_click_or_hover',
				{ ref: 'e123', goal: 'submit form' },
				{
					name: 'browser_click_or_hover',
					response: 'Clicked submit button',
					snapshot: null,
					status: 'success',
				}
			),
		])

		expect(logger.debug).toHaveBeenCalledTimes(1)
		const debugLog = String(vi.mocked(logger.debug).mock.calls[0][0])
		expect(debugLog).toContain('tool response returned to model')
		expect(debugLog).toContain('call_debug')
		expect(debugLog).toContain('browser_click_or_hover')
		expect(debugLog).toContain('status: success')
		expect(debugLog).toContain('submit form')
		expect(debugLog).toContain('Clicked submit button')
		expect(debugLog).toContain('snapshot: none')
	})

	it('does not log model-bound tool responses outside debug mode', () => {
		createHandler().build([
			execution(
				'call_info',
				'browser_click_or_hover',
				{ ref: 'e123' },
				{ name: 'browser_click_or_hover', response: 'Clicked submit button', snapshot: null, status: 'success' }
			),
		])

		expect(logger.debug).not.toHaveBeenCalled()
	})

	it('does not duplicate error response bodies between warning and debug logs in debug mode', () => {
		const uniqueResponse = 'unique debug-only error body'

		createHandler('debug').build([
			execution(
				'call_error_debug',
				'browser_click_or_hover',
				{ ref: 'missing' },
				{ name: 'browser_click_or_hover', response: uniqueResponse, snapshot: null, status: 'error' }
			),
		])

		const debugLog = vi
			.mocked(logger.debug)
			.mock.calls.map((call) => String(call[0]))
			.join('\n')
		const warnings = vi
			.mocked(logger.warn)
			.mock.calls.map((call) => String(call[0]))
			.join('\n')

		expect(debugLog).toContain(uniqueResponse)
		expect(warnings).toContain('response: logged at debug level')
		expect(warnings).not.toContain(uniqueResponse)
	})

	it('does not include full snapshot content in generic tool response debug logs', () => {
		const snapshot = 'page snapshot:\n{button Submit}'

		createHandler('debug').build([
			execution(
				'call_snapshot',
				'browser_click_or_hover',
				{ ref: 'e123' },
				{ name: 'browser_click_or_hover', response: 'clicked', snapshot, status: 'success' }
			),
		])

		const debugLog = String(vi.mocked(logger.debug).mock.calls[0][0])
		expect(debugLog).toContain(`snapshot: present (${snapshot.length} chars, content logged by SnapshotService)`)
		expect(debugLog).not.toContain('page snapshot:')
		expect(debugLog).not.toContain('{button Submit}')
	})

	it('redacts secrets and image data from error diagnostics', () => {
		const base64 = 'A'.repeat(220)

		createHandler().build([
			execution(
				'call_secret',
				'browser_upload',
				{
					apiKey: 'sk-argument',
					cookie: 'Cookie: session=secret',
					image: `data:image/png;base64,${base64}`,
				},
				{
					name: 'browser_upload',
					response: `failed with Authorization: Bearer sk-response and data:image/png;base64,${base64}`,
					snapshot: null,
					status: 'error',
				}
			),
		])

		const warnings = vi
			.mocked(logger.warn)
			.mock.calls.map((call) => String(call[0]))
			.join('\n')
		expect(warnings).toContain('call_secret')
		expect(warnings).toContain('[secret omitted]')
		expect(warnings).toContain('[image omitted]')
		expect(warnings).not.toContain('sk-argument')
		expect(warnings).not.toContain('sk-response')
		expect(warnings).not.toContain(base64)
		expect(warnings).not.toContain('session=secret')
	})

	it('redacts JSON and env-style secret fields from error diagnostics', () => {
		const base64 = 'B'.repeat(220)

		createHandler().build([
			execution(
				'call_json_secret',
				'browser_upload',
				{
					OPENAI_API_KEY: 'openai-secret-value',
					CHECKMATE_OPENAI_API_KEY: 'checkmate-secret-value',
					api_key: 'snake-secret-value',
					apiKey: 'camel-secret-value',
					authorization: 'Bearer auth-secret-value',
					cookie: 'session=cookie-secret-value',
					image: `data:image/png;base64,${base64}`,
				},
				{
					name: 'browser_upload',
					response: `failed OPENAI_API_KEY=response-secret CHECKMATE_OPENAI_API_KEY=response-checkmate-secret api_key=response-snake authorization=Bearer response-auth cookie=session=response-cookie data:image/png;base64,${base64}`,
					snapshot: null,
					status: 'error',
				}
			),
		])

		const warnings = vi
			.mocked(logger.warn)
			.mock.calls.map((call) => String(call[0]))
			.join('\n')
		expect(warnings).toContain('tool response error')
		expect(warnings).toContain('call_json_secret')
		expect(warnings).toContain('[secret omitted]')
		expect(warnings).toContain('[image omitted]')

		for (const secret of [
			'openai-secret-value',
			'checkmate-secret-value',
			'snake-secret-value',
			'camel-secret-value',
			'auth-secret-value',
			'cookie-secret-value',
			'response-secret',
			'response-checkmate-secret',
			'response-snake',
			'response-auth',
			'response-cookie',
			base64,
		]) {
			expect(warnings).not.toContain(secret)
		}

		for (const keyName of [
			'OPENAI_API_KEY',
			'CHECKMATE_OPENAI_API_KEY',
			'api_key',
			'apiKey',
			'authorization',
			'cookie',
		]) {
			expect(warnings).not.toContain(keyName)
		}
	})
})
