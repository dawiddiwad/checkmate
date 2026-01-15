import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { LoopDetector, LoopDetectedError } from '../step/tool/loop-detector'
import { ConfigurationManager } from '../step/configuration-manager'
import { ToolCall } from '../step/tool/openai-tool'

/**
 * Simplified integration tests for LoopDetector with ConfigurationManager
 * Tests that loop detection configuration is properly read and applied
 */
describe('Loop Detection Integration Tests', () => {
	let loopDetector: LoopDetector
	let originalEnv: string | undefined

	beforeEach(() => {
		originalEnv = process.env.OPENAI_LOOP_MAX_REPETITIONS
	})

	afterEach(() => {
		if (originalEnv) {
			process.env.OPENAI_LOOP_MAX_REPETITIONS = originalEnv
		} else {
			delete process.env.OPENAI_LOOP_MAX_REPETITIONS
		}
	})

	it('should use configuration from environment for max repetitions', () => {
		process.env.OPENAI_LOOP_MAX_REPETITIONS = '2'

		const configManager = new ConfigurationManager()
		loopDetector = new LoopDetector(configManager.getLoopMaxRepetitions())

		const toolCall: ToolCall = {
			name: 'browser_click',
			arguments: { ref: 'e1', name: 'Button', goal: 'click' },
		}

		loopDetector.recordToolCall(toolCall)

		expect(() => {
			loopDetector.recordToolCall(toolCall)
		}).toThrow(LoopDetectedError)
	})

	it('should detect single-tool loop with configured threshold', () => {
		process.env.OPENAI_LOOP_MAX_REPETITIONS = '3'

		const configManager = new ConfigurationManager()
		loopDetector = new LoopDetector(configManager.getLoopMaxRepetitions())

		const toolCall: ToolCall = {
			name: 'browser_navigate',
			arguments: { url: 'https://example.com', goal: 'nav' },
		}

		loopDetector.recordToolCall(toolCall)
		loopDetector.recordToolCall(toolCall)

		expect(() => {
			loopDetector.recordToolCall(toolCall)
		}).toThrow(LoopDetectedError)
	})

	it('should detect multi-tool pattern loop', () => {
		process.env.OPENAI_LOOP_MAX_REPETITIONS = '3'

		const configManager = new ConfigurationManager()
		loopDetector = new LoopDetector(configManager.getLoopMaxRepetitions())

		const toolCall1: ToolCall = {
			name: 'browser_click',
			arguments: { ref: 'e1', name: 'Button', goal: 'click' },
		}

		const toolCall2: ToolCall = {
			name: 'browser_snapshot',
			arguments: { goal: 'capture' },
		}

		loopDetector.recordToolCall(toolCall1)
		loopDetector.recordToolCall(toolCall2)
		loopDetector.recordToolCall(toolCall1)
		loopDetector.recordToolCall(toolCall2)
		loopDetector.recordToolCall(toolCall1)

		expect(() => {
			loopDetector.recordToolCall(toolCall2)
		}).toThrow(LoopDetectedError)
	})

	it('should include pattern details in error message', () => {
		process.env.OPENAI_LOOP_MAX_REPETITIONS = '2'

		const configManager = new ConfigurationManager()
		loopDetector = new LoopDetector(configManager.getLoopMaxRepetitions())

		const toolCall: ToolCall = {
			name: 'browser_type',
			arguments: { ref: 'e1', text: 'test', name: 'Input', goal: 'type' },
		}

		try {
			loopDetector.recordToolCall(toolCall)
			loopDetector.recordToolCall(toolCall)
			expect.fail('Should have thrown LoopDetectedError')
		} catch (error) {
			const loopError = error as LoopDetectedError
			expect(loopError).toBeInstanceOf(LoopDetectedError)
			expect(loopError.status).toBe(LoopDetectedError.STATUS)
			expect(loopError.message).toContain('browser_type')
			expect(loopError.loopResult.repetitions).toBe(2)
		}
	})

	it('should reset detector state after throwing', () => {
		process.env.OPENAI_LOOP_MAX_REPETITIONS = '2'

		const configManager = new ConfigurationManager()
		loopDetector = new LoopDetector(configManager.getLoopMaxRepetitions())

		const toolCall: ToolCall = {
			name: 'browser_click',
			arguments: { ref: 'e1', name: 'Button', goal: 'click' },
		}

		try {
			loopDetector.recordToolCall(toolCall)
			loopDetector.recordToolCall(toolCall)
		} catch {
			loopDetector.recordToolCall(toolCall)
		}

		expect(() => {
			loopDetector.recordToolCall(toolCall)
		}).toThrow(LoopDetectedError)
	})
})
