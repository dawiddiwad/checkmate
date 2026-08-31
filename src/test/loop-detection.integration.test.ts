import { describe, it, expect } from 'vitest'
import { LoopDetector, LoopDetectedError } from '../tools/loop-detector'
import { resolveConfig } from '../config/resolved-config'
import { ToolCall } from '../tools/tool-contract'

/**
 * Integration tests for LoopDetector and the resolved `checkmateLoopMaxRepetitions` option.
 */
describe('Loop Detection Integration Tests', () => {
	let loopDetector: LoopDetector

	function detectorFor(maxRepetitions: number): LoopDetector {
		return new LoopDetector(resolveConfig({ checkmateLoopMaxRepetitions: maxRepetitions }).loopMaxRepetitions)
	}

	it('uses the resolved max repetitions option', () => {
		loopDetector = detectorFor(2)

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
		loopDetector = detectorFor(3)

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
		loopDetector = detectorFor(3)

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
		loopDetector = detectorFor(2)

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
		loopDetector = detectorFor(2)

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
