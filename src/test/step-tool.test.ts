import { describe, it, expect, beforeEach, vi } from 'vitest'
import { createStepResultTools, StepResultTool } from '../tools/step/result-tool'
import { AgentTool, AgentToolContext } from '../tools/types'

describe('Step result tools', () => {
	let tools: AgentTool[]
	let context: AgentToolContext

	function getTool(name: string): AgentTool {
		const tool = tools.find((candidate) => candidate.definition.function.name === name)
		if (!tool) {
			throw new Error(`Missing tool ${name}`)
		}

		return tool
	}

	beforeEach(() => {
		tools = createStepResultTools()
		context = {
			step: { action: 'act', expect: 'done' },
			resolveStepResult: vi.fn(),
		}
	})

	it('creates pass and fail tools', () => {
		expect(tools).toHaveLength(2)
		expect(tools.map((tool) => tool.definition.function.name)).toEqual([
			StepResultTool.TOOL_FAIL_TEST_STEP,
			StepResultTool.TOOL_PASS_TEST_STEP,
		])
	})

	it('passes a step through execution context', async () => {
		await getTool(StepResultTool.TOOL_PASS_TEST_STEP).execute({ actualResult: 'Test passed successfully' }, context)

		expect(context.resolveStepResult).toHaveBeenCalledWith({
			passed: true,
			actual: 'Test passed successfully',
		})
	})

	it('fails a step through execution context', async () => {
		await getTool(StepResultTool.TOOL_FAIL_TEST_STEP).execute(
			{ actualResult: 'Expected button, found none' },
			context
		)

		expect(context.resolveStepResult).toHaveBeenCalledWith({
			passed: false,
			actual: 'Expected button, found none',
		})
	})

	it('validates arguments with zod before executing', async () => {
		const result = await getTool(StepResultTool.TOOL_PASS_TEST_STEP).execute({}, context)

		expect(result).toContain("Invalid args for 'pass_test_step'")
		expect(context.resolveStepResult).not.toHaveBeenCalled()
	})

	it('exports stable tool name constants', () => {
		expect(StepResultTool.TOOL_FAIL_TEST_STEP).toBe('fail_test_step')
		expect(StepResultTool.TOOL_PASS_TEST_STEP).toBe('pass_test_step')
	})
})
