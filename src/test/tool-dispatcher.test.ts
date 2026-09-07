import { beforeEach, describe, expect, it, vi } from 'vitest'
import { ToolDispatcher } from '../tools/dispatcher'
import { LoopDetector } from '../tools/loop-detector'
import { ToolRegistry } from '../tools/registry'
import { AgentTool } from '../tools/types'
const logger = { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() }

function createConfig(allowedNames: string[] = []) {
	return { allowedTools: allowedNames.length ? allowedNames : ('*' as const) }
}

function createTool(name: string, execute: AgentTool['execute']): AgentTool {
	return {
		definition: {
			name,
			description: `${name} description`,
			parameters: { type: 'object' },
			strict: true,
		},
		execute,
	}
}

describe('ToolDispatcher diagnostics', () => {
	beforeEach(() => {
		vi.clearAllMocks()
	})

	it('includes requested, arguments, registered, and allowed tool names for invalid tools', async () => {
		const registry = new ToolRegistry(createConfig(['allowed_tool']))
		registry.register(createTool('registered_tool', () => 'ok'))
		const dispatcher = new ToolDispatcher(registry, new LoopDetector(10), logger)

		await expect(
			dispatcher.dispatch(
				{ name: 'missing_tool', arguments: { ref: 'button' } },
				{ step: { action: 'click', expect: 'clicked' } }
			)
		).rejects.toThrow(/missing_tool[\s\S]*ref[\s\S]*registered_tool[\s\S]*allowed_tool/)
	})

	it('wraps throwing tools with tool name, arguments, and original cause', async () => {
		const cause = new Error('boom')
		const registry = new ToolRegistry(createConfig())
		registry.register(
			createTool('throwing_tool', () => {
				throw cause
			})
		)
		const dispatcher = new ToolDispatcher(registry, new LoopDetector(10), logger)

		let caught: unknown
		try {
			await dispatcher.dispatch(
				{ name: 'throwing_tool', arguments: { id: 123 } },
				{ step: { action: 'run', expect: 'done' } }
			)
		} catch (error) {
			caught = error
		}

		expect(caught).toBeInstanceOf(Error)
		expect((caught as Error).message).toMatch(/throwing_tool[\s\S]*123[\s\S]*boom/)
		expect((caught as Error).cause).toBe(cause)
	})

	it('normalizes string and object error responses', async () => {
		const registry = new ToolRegistry(createConfig())
		registry.register([
			createTool('string_error_tool', () => 'Error: bad result'),
			createTool('object_error_tool', () => ({ response: 'bad object', status: 'error' })),
		])
		const dispatcher = new ToolDispatcher(registry, new LoopDetector(10), logger)
		const context = { step: { action: 'run', expect: 'done' } }

		await expect(dispatcher.dispatch({ name: 'string_error_tool' }, context)).resolves.toMatchObject({
			status: 'error',
			response: 'Error: bad result',
		})
		await expect(dispatcher.dispatch({ name: 'object_error_tool' }, context)).resolves.toMatchObject({
			status: 'error',
			response: 'bad object',
		})
		expect(logger.warn).not.toHaveBeenCalled()
	})

	it('logs tools completed without model responses in debug mode', async () => {
		const registry = new ToolRegistry(createConfig())
		registry.register(createTool('pass_test_step', () => undefined))
		const dispatcher = new ToolDispatcher(registry, new LoopDetector(10), logger, true)
		const context = { step: { action: 'run', expect: 'done' } }

		await expect(
			dispatcher.dispatch({ name: 'pass_test_step', arguments: { note: 'done' } }, context)
		).resolves.toBeNull()

		expect(logger.debug).toHaveBeenCalledTimes(1)
		const debugLog = String(vi.mocked(logger.debug).mock.calls[0][0])
		expect(debugLog).toContain('tool completed without model response')
		expect(debugLog).toContain('pass_test_step')
		expect(debugLog).toContain('done')
	})

	it('does not log tools completed without model responses outside debug mode', async () => {
		const registry = new ToolRegistry(createConfig())
		registry.register(createTool('pass_test_step', () => undefined))
		const dispatcher = new ToolDispatcher(registry, new LoopDetector(10), logger)
		const context = { step: { action: 'run', expect: 'done' } }

		await expect(
			dispatcher.dispatch({ name: 'pass_test_step', arguments: { note: 'done' } }, context)
		).resolves.toBeNull()

		expect(logger.debug).not.toHaveBeenCalled()
	})
})
