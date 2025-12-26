import { describe, it, expect, beforeEach } from 'vitest'
import { LoopDetector, LoopDetectedError } from '../step/tool/loop-detector'
import { ToolCall } from '../step/tool/openai-tool'

describe('LoopDetector', () => {
	let loopDetector: LoopDetector
	const MAX_REPETITIONS = 5

	beforeEach(() => {
		loopDetector = new LoopDetector(MAX_REPETITIONS)
	})

	describe('basic pattern detection', () => {
		it('should detect simple single-tool loop', () => {
			const toolCall: ToolCall = {
				name: 'test_tool',
				arguments: { param: 'value' },
			}

			expect(() => {
				for (let i = 0; i < MAX_REPETITIONS; i++) {
					loopDetector.recordToolCall(toolCall)
				}
			}).toThrow(LoopDetectedError)
		})

		it('should not detect loop with fewer repetitions than threshold', () => {
			const toolCall: ToolCall = {
				name: 'test_tool',
				arguments: { param: 'value' },
			}

			expect(() => {
				for (let i = 0; i < MAX_REPETITIONS - 1; i++) {
					loopDetector.recordToolCall(toolCall)
				}
			}).not.toThrow()
		})

		it('should detect two-tool alternating pattern loop', () => {
			const toolCall1: ToolCall = {
				name: 'tool_a',
				arguments: { id: 1 },
			}
			const toolCall2: ToolCall = {
				name: 'tool_b',
				arguments: { id: 2 },
			}

			expect(() => {
				for (let i = 0; i < MAX_REPETITIONS; i++) {
					loopDetector.recordToolCall(toolCall1)
					loopDetector.recordToolCall(toolCall2)
				}
			}).toThrow(LoopDetectedError)
		})

		it('should detect three-tool repeating pattern loop', () => {
			const toolCall1: ToolCall = { name: 'tool_a', arguments: {} }
			const toolCall2: ToolCall = { name: 'tool_b', arguments: {} }
			const toolCall3: ToolCall = { name: 'tool_c', arguments: {} }

			expect(() => {
				for (let i = 0; i < MAX_REPETITIONS; i++) {
					loopDetector.recordToolCall(toolCall1)
					loopDetector.recordToolCall(toolCall2)
					loopDetector.recordToolCall(toolCall3)
				}
			}).toThrow(LoopDetectedError)
		})
	})

	describe('tool signature creation', () => {
		it('should differentiate tools with same name but different arguments', () => {
			const toolCall1: ToolCall = {
				name: 'test_tool',
				arguments: { param: 'value1' },
			}
			const toolCall2: ToolCall = {
				name: 'test_tool',
				arguments: { param: 'value2' },
			}

			expect(() => {
				for (let i = 0; i < MAX_REPETITIONS * 2; i++) {
					loopDetector.recordToolCall(i % 2 === 0 ? toolCall1 : toolCall2)
				}
			}).toThrow(LoopDetectedError)
		})

		it('should handle tools with no arguments', () => {
			const toolCall: ToolCall = {
				name: 'test_tool',
				arguments: {},
			}

			expect(() => {
				for (let i = 0; i < MAX_REPETITIONS; i++) {
					loopDetector.recordToolCall(toolCall)
				}
			}).toThrow(LoopDetectedError)
		})

		it('should handle tools with undefined arguments', () => {
			const toolCall: ToolCall = {
				name: 'test_tool',
			}

			expect(() => {
				for (let i = 0; i < MAX_REPETITIONS; i++) {
					loopDetector.recordToolCall(toolCall)
				}
			}).toThrow(LoopDetectedError)
		})

		it('should sort argument keys for consistent signatures', () => {
			const toolCall1: ToolCall = {
				name: 'test_tool',
				arguments: { b: 2, a: 1, c: 3 },
			}
			const toolCall2: ToolCall = {
				name: 'test_tool',
				arguments: { a: 1, c: 3, b: 2 },
			}

			expect(() => {
				for (let i = 0; i < MAX_REPETITIONS; i++) {
					loopDetector.recordToolCall(i % 2 === 0 ? toolCall1 : toolCall2)
				}
			}).toThrow(LoopDetectedError)
		})

		it('should handle complex nested argument objects', () => {
			const toolCall: ToolCall = {
				name: 'complex_tool',
				arguments: {
					nested: { deep: { value: 123 } },
					array: [1, 2, 3],
					string: 'test',
				},
			}

			expect(() => {
				for (let i = 0; i < MAX_REPETITIONS; i++) {
					loopDetector.recordToolCall(toolCall)
				}
			}).toThrow(LoopDetectedError)
		})
	})

	describe('reset behavior', () => {
		it('should reset history to empty', () => {
			const toolCall: ToolCall = {
				name: 'test_tool',
				arguments: { param: 'value' },
			}

			loopDetector.recordToolCall(toolCall)
			loopDetector.recordToolCall(toolCall)
			loopDetector.recordToolCall(toolCall)

			expect(loopDetector.getHistoryLength()).toBe(3)

			loopDetector.reset()

			expect(loopDetector.getHistoryLength()).toBe(0)
			expect(loopDetector.getHistory()).toEqual([])
		})

		it('should allow same pattern after reset without detecting loop', () => {
			const toolCall: ToolCall = {
				name: 'test_tool',
				arguments: { param: 'value' },
			}

			loopDetector.recordToolCall(toolCall)
			loopDetector.recordToolCall(toolCall)
			loopDetector.recordToolCall(toolCall)

			loopDetector.reset()

			expect(() => {
				loopDetector.recordToolCall(toolCall)
				loopDetector.recordToolCall(toolCall)
				loopDetector.recordToolCall(toolCall)
			}).not.toThrow()
		})

		it('should reset automatically after detecting loop', () => {
			const toolCall: ToolCall = {
				name: 'test_tool',
				arguments: { param: 'value' },
			}

			try {
				for (let i = 0; i < MAX_REPETITIONS; i++) {
					loopDetector.recordToolCall(toolCall)
				}
			} catch (e) {
				expect(e).toBeInstanceOf(LoopDetectedError)
			}

			expect(loopDetector.getHistoryLength()).toBe(0)
		})
	})

	describe('LoopDetectedError', () => {
		it('should include pattern information in error', () => {
			const toolCall: ToolCall = {
				name: 'test_tool',
				arguments: { param: 'value' },
			}

			try {
				for (let i = 0; i < MAX_REPETITIONS; i++) {
					loopDetector.recordToolCall(toolCall)
				}
			} catch (error) {
				expect(error).toBeInstanceOf(LoopDetectedError)
				const loopError = error as LoopDetectedError
				expect(loopError.loopResult.loopDetected).toBe(true)
				expect(loopError.loopResult.patternLength).toBe(1)
				expect(loopError.loopResult.repetitions).toBeGreaterThanOrEqual(MAX_REPETITIONS)
				expect(loopError.loopResult.pattern).toHaveLength(1)
				expect(loopError.loopResult.pattern[0]).toContain('test_tool')
				expect(loopError.status).toBe('TOOL_CALL_LOOP')
			}
		})

		it('should include pattern details for multi-tool loop', () => {
			const toolCall1: ToolCall = { name: 'tool_a', arguments: {} }
			const toolCall2: ToolCall = { name: 'tool_b', arguments: {} }

			try {
				for (let i = 0; i < MAX_REPETITIONS; i++) {
					loopDetector.recordToolCall(toolCall1)
					loopDetector.recordToolCall(toolCall2)
				}
			} catch (error) {
				expect(error).toBeInstanceOf(LoopDetectedError)
				const loopError = error as LoopDetectedError
				expect(loopError.loopResult.patternLength).toBe(2)
				expect(loopError.loopResult.pattern).toHaveLength(2)
				expect(loopError.message).toContain('tool_a')
				expect(loopError.message).toContain('tool_b')
				expect(loopError.message).toContain('->')
			}
		})
	})

	describe('edge cases', () => {
		it('should handle empty history', () => {
			expect(loopDetector.getHistoryLength()).toBe(0)
			expect(loopDetector.getHistory()).toEqual([])
		})

		it('should handle single tool call', () => {
			const toolCall: ToolCall = {
				name: 'test_tool',
				arguments: { param: 'value' },
			}

			expect(() => {
				loopDetector.recordToolCall(toolCall)
			}).not.toThrow()

			expect(loopDetector.getHistoryLength()).toBe(1)
		})

		it('should not detect loop with varied patterns', () => {
			const toolCalls: ToolCall[] = [
				{ name: 'tool_a', arguments: {} },
				{ name: 'tool_b', arguments: {} },
				{ name: 'tool_c', arguments: {} },
				{ name: 'tool_d', arguments: {} },
				{ name: 'tool_e', arguments: {} },
			]

			expect(() => {
				toolCalls.forEach((toolCall) => loopDetector.recordToolCall(toolCall))
			}).not.toThrow()
		})

		it('should detect loop starting after some non-looping calls', () => {
			const toolCall1: ToolCall = { name: 'tool_a', arguments: {} }
			const toolCall2: ToolCall = { name: 'tool_b', arguments: {} }
			const loopingToolCall: ToolCall = { name: 'looping_tool', arguments: {} }

			loopDetector.recordToolCall(toolCall1)
			loopDetector.recordToolCall(toolCall2)

			expect(() => {
				for (let i = 0; i < MAX_REPETITIONS; i++) {
					loopDetector.recordToolCall(loopingToolCall)
				}
			}).toThrow(LoopDetectedError)
		})

		it('should work with max repetitions set to 1', () => {
			const fastLoopDetector = new LoopDetector(1)
			const toolCall: ToolCall = { name: 'test_tool', arguments: {} }

			expect(() => {
				fastLoopDetector.recordToolCall(toolCall)
			}).not.toThrow()

			expect(() => {
				fastLoopDetector.recordToolCall(toolCall)
			}).toThrow(LoopDetectedError)
		})

		it('should work with large max repetitions', () => {
			const slowLoopDetector = new LoopDetector(100)
			const toolCall: ToolCall = { name: 'test_tool', arguments: {} }

			expect(() => {
				for (let i = 0; i < 99; i++) {
					slowLoopDetector.recordToolCall(toolCall)
				}
			}).not.toThrow()

			expect(() => {
				slowLoopDetector.recordToolCall(toolCall)
			}).toThrow(LoopDetectedError)
		})
	})

	describe('getHistory and getHistoryLength', () => {
		it('should return copy of history array', () => {
			const toolCall: ToolCall = { name: 'test_tool', arguments: {} }

			loopDetector.recordToolCall(toolCall)
			const history = loopDetector.getHistory()

			history.push('fake_signature')

			expect(loopDetector.getHistory()).toHaveLength(1)
			expect(loopDetector.getHistory()).not.toContain('fake_signature')
		})

		it('should correctly report history length as tools are added', () => {
			const toolCall: ToolCall = { name: 'test_tool', arguments: {} }

			expect(loopDetector.getHistoryLength()).toBe(0)

			loopDetector.recordToolCall(toolCall)
			expect(loopDetector.getHistoryLength()).toBe(1)

			loopDetector.recordToolCall(toolCall)
			expect(loopDetector.getHistoryLength()).toBe(2)

			loopDetector.recordToolCall(toolCall)
			expect(loopDetector.getHistoryLength()).toBe(3)
		})
	})
})
