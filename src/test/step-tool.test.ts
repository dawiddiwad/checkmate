import { describe, it, expect, beforeEach, vi } from 'vitest'
import { StepTool } from '../step/tool/step-tool'
import { ToolCall } from '../step/tool/openai-tool'
import { StepStatusCallback } from '../step/types'

describe('StepTool', () => {
	let stepTool: StepTool
	let mockCallback: StepStatusCallback

	beforeEach(() => {
		stepTool = new StepTool()
		mockCallback = vi.fn()
	})

	describe('constructor and function declarations', () => {
		it('should create step tool with 2 function declarations', () => {
			expect(stepTool.functionDeclarations).toHaveLength(2)
		})

		it('should include fail test step declaration', () => {
			const failTool = stepTool.functionDeclarations.find(
				(tool) => tool.function.name === StepTool.TOOL_FAIL_TEST_STEP
			)
			expect(failTool).toBeDefined()
			expect(failTool?.function.description).toContain('Fail the test step')
			expect(failTool?.function?.parameters?.required).toContain('actualResult')
		})

		it('should include pass test step declaration', () => {
			const passTool = stepTool.functionDeclarations.find(
				(tool) => tool.function.name === StepTool.TOOL_PASS_TEST_STEP
			)
			expect(passTool).toBeDefined()
			expect(passTool?.function.description).toContain('Pass the test step')
			expect(passTool?.function?.parameters?.required).toContain('actualResult')
		})

		it('should have strict mode enabled for both tools', () => {
			stepTool.functionDeclarations.forEach((tool) => {
				expect(tool.function.strict).toBe(true)
			})
		})

		it('should have additionalProperties set to false', () => {
			stepTool.functionDeclarations.forEach((tool) => {
				expect(tool.function?.parameters?.additionalProperties).toBe(false)
			})
		})
	})

	describe('call method - pass test step', () => {
		it('should call callback with passed status', () => {
			const toolCall: ToolCall = {
				name: StepTool.TOOL_PASS_TEST_STEP,
				arguments: { actualResult: 'Test passed successfully' },
			}

			stepTool.call(toolCall, mockCallback)

			expect(mockCallback).toHaveBeenCalledTimes(1)
			expect(mockCallback).toHaveBeenCalledWith({
				passed: true,
				actual: 'Test passed successfully',
			})
		})

		it('should handle pass with empty actual result', () => {
			const toolCall: ToolCall = {
				name: StepTool.TOOL_PASS_TEST_STEP,
				arguments: { actualResult: '' },
			}

			stepTool.call(toolCall, mockCallback)

			expect(mockCallback).toHaveBeenCalledWith({
				passed: true,
				actual: '',
			})
		})

		it('should handle pass with undefined arguments', () => {
			const toolCall: ToolCall = {
				name: StepTool.TOOL_PASS_TEST_STEP,
				arguments: undefined,
			}

			stepTool.call(toolCall, mockCallback)

			expect(mockCallback).toHaveBeenCalledWith({
				passed: true,
				actual: undefined,
			})
		})
	})

	describe('call method - fail test step', () => {
		it('should call callback with failed status', () => {
			const toolCall: ToolCall = {
				name: StepTool.TOOL_FAIL_TEST_STEP,
				arguments: { actualResult: 'Expected button, found none' },
			}

			stepTool.call(toolCall, mockCallback)

			expect(mockCallback).toHaveBeenCalledTimes(1)
			expect(mockCallback).toHaveBeenCalledWith({
				passed: false,
				actual: 'Expected button, found none',
			})
		})

		it('should handle fail with empty actual result', () => {
			const toolCall: ToolCall = {
				name: StepTool.TOOL_FAIL_TEST_STEP,
				arguments: { actualResult: '' },
			}

			stepTool.call(toolCall, mockCallback)

			expect(mockCallback).toHaveBeenCalledWith({
				passed: false,
				actual: '',
			})
		})

		it('should handle fail with undefined arguments', () => {
			const toolCall: ToolCall = {
				name: StepTool.TOOL_FAIL_TEST_STEP,
				arguments: undefined,
			}

			stepTool.call(toolCall, mockCallback)

			expect(mockCallback).toHaveBeenCalledWith({
				passed: false,
				actual: undefined,
			})
		})
	})

	describe('call method - error handling', () => {
		it('should throw error when tool name is missing', () => {
			const toolCall: ToolCall = {
				name: undefined as any,
				arguments: { actualResult: 'test' },
			}

			expect(() => stepTool.call(toolCall, mockCallback)).toThrow('Tool name is required')
		})

		it('should throw error when tool name is empty string', () => {
			const toolCall: ToolCall = {
				name: '',
				arguments: { actualResult: 'test' },
			}

			expect(() => stepTool.call(toolCall, mockCallback)).toThrow('Tool name is required')
		})

		it('should return error message for non-existent tool', () => {
			const toolCall: ToolCall = {
				name: 'non_existent_tool',
				arguments: { actualResult: 'test' },
			}

			const result = stepTool.call(toolCall, mockCallback)
			expect(result).toContain('Step tool not implemented: non_existent_tool')
		})
	})

	describe('tool name constants', () => {
		it('should have correct tool name constants', () => {
			expect(StepTool.TOOL_FAIL_TEST_STEP).toBe('fail_test_step')
			expect(StepTool.TOOL_PASS_TEST_STEP).toBe('pass_test_step')
		})
	})

	describe('callback invocation', () => {
		it('should not call callback for unknown tool names', () => {
			const toolCall: ToolCall = {
				name: 'some_other_tool',
				arguments: { actualResult: 'test' },
			}

			try {
				stepTool.call(toolCall, mockCallback)
			} catch {
				/* expected unknown tool error */
			}

			expect(mockCallback).not.toHaveBeenCalled()
		})

		it('should call callback exactly once for valid tools', () => {
			const passCall: ToolCall = {
				name: StepTool.TOOL_PASS_TEST_STEP,
				arguments: { actualResult: 'passed' },
			}

			stepTool.call(passCall, mockCallback)
			expect(mockCallback).toHaveBeenCalledTimes(1)

			mockCallback = vi.fn()
			const failCall: ToolCall = {
				name: StepTool.TOOL_FAIL_TEST_STEP,
				arguments: { actualResult: 'failed' },
			}

			stepTool.call(failCall, mockCallback)
			expect(mockCallback).toHaveBeenCalledTimes(1)
		})
	})
})
