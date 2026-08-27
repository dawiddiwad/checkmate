import { beforeEach, describe, expect, it, vi } from 'vitest'
import { ToolDispatcher } from '../tools/dispatcher'
import { ToolRegistry } from '../tools/registry'
import { AgentTool } from '../tools/types'
import { RuntimeConfig } from '../config/runtime-config'
import { logger } from '../logging'

vi.mock('../../src/logging', () => ({
	logger: {
		info: vi.fn(),
		warn: vi.fn(),
		error: vi.fn(),
		debug: vi.fn(),
	},
}))

function createConfig(allowedNames: string[] = []): RuntimeConfig {
	return {
		getAllowedFunctionNames: vi.fn().mockReturnValue(allowedNames),
		getLoopMaxRepetitions: vi.fn().mockReturnValue(10),
	} as unknown as RuntimeConfig
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
		const dispatcher = new ToolDispatcher(registry)

		await expect(
			dispatcher.dispatch(
				{ name: 'missing_tool', arguments: { ref: 'button' } },
				{ step: { action: 'click', expect: 'clicked' }, resolveStepResult: vi.fn() }
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
		const dispatcher = new ToolDispatcher(registry)

		let caught: unknown
		try {
			await dispatcher.dispatch(
				{ name: 'throwing_tool', arguments: { id: 123 } },
				{ step: { action: 'run', expect: 'done' }, resolveStepResult: vi.fn() }
			)
		} catch (error) {
			caught = error
		}

		expect(caught).toBeInstanceOf(Error)
		expect((caught as Error).message).toMatch(/throwing_tool[\s\S]*123[\s\S]*boom/)
		expect((caught as Error).cause).toBe(cause)
	})

	it('normalizes string and object error responses and logs them', async () => {
		const registry = new ToolRegistry(createConfig())
		registry.register([
			createTool('string_error_tool', () => 'Error: bad result'),
			createTool('object_error_tool', () => ({ response: 'bad object', status: 'error' })),
		])
		const dispatcher = new ToolDispatcher(registry)
		const context = { step: { action: 'run', expect: 'done' }, resolveStepResult: vi.fn() }

		await expect(dispatcher.dispatch({ name: 'string_error_tool' }, context)).resolves.toMatchObject({
			status: 'error',
			response: 'Error: bad result',
		})
		await expect(dispatcher.dispatch({ name: 'object_error_tool' }, context)).resolves.toMatchObject({
			status: 'error',
			response: 'bad object',
		})
		expect(logger.warn).toHaveBeenCalledTimes(2)
	})
})
