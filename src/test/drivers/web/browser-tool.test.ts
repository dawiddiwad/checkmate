import type { Stagehand } from '@browserbasehq/stagehand'
import { describe, expect, it, vi } from 'vitest'
import { createBrowserTools } from '../../../drivers/web/tools/tool.js'
import { TelemetryReceiver } from '../../../drivers/web/telemetry-receiver.js'
import type { DriverToolContext } from '../../../driver.js'

const context: DriverToolContext = {
	step: { id: 'inspect', action: 'Inspect', expect: 'fact' },
	turn: 1,
	signal: new AbortController().signal,
	generateStructured: async () => {
		throw new Error('unexpected generation')
	},
}

describe('browser tools', () => {
	it('exposes exactly five tools and resolves the managed active page for each operation', async () => {
		const receiver = await TelemetryReceiver.start(true, (text) => text)
		try {
			const page = { goto: vi.fn(), url: vi.fn(async () => 'https://example.test/') }
			const activePage = vi.fn(async () => page)
			const extract = vi.fn(async () => ({
				data: { extraction: 'fact' },
				metadata: { usage: { inputTokens: 900 } },
			}))
			const candidates = [
				{ selector: '#submit', description: 'Submit', method: 'click', arguments: [] as string[] },
			]
			const observe = vi.fn(async () => ({ data: candidates }))
			const act = vi.fn(async () => ({ data: { success: true, message: 'Submitted' } }))
			const tools = createBrowserTools(
				{ browser: { context: { activePage } }, observe, act, extract } as unknown as Stagehand,
				receiver
			)
			expect(tools.map((tool) => tool.definition.name)).toEqual([
				'browser_navigate',
				'browser_observe',
				'browser_act',
				'browser_extract',
				'browser_diagnostics',
			])
			expect(await tools[0].execute({ url: 'https://example.test/' }, context)).toBe(
				'{"url":"https://example.test/"}'
			)
			expect(page.goto).toHaveBeenCalledWith('https://example.test/')
			expect(JSON.stringify(tools[0].definition.parameters)).not.toContain('"format"')
			expect(await tools[1].execute({}, context)).toBe(JSON.stringify(candidates))
			expect(observe).toHaveBeenLastCalledWith(undefined, { page })
			expect(await tools[1].execute({ instruction: 'Find submit' }, context)).toBe(JSON.stringify(candidates))
			expect(observe).toHaveBeenLastCalledWith('Find submit', { page })
			expect(tools[1].definition.strict).toBe(false)
			expect(await tools[2].execute({ instruction: 'Submit' }, context)).toBe(
				'{"success":true,"message":"Submitted"}'
			)
			expect(act).toHaveBeenCalledWith('Submit', { page })
			act.mockResolvedValueOnce({ data: { success: false, message: 'No matching action' } })
			expect(await tools[2].execute({ instruction: 'Missing' }, context)).toEqual({
				status: 'error',
				response: '{"success":false,"message":"No matching action"}',
			})
			expect(await tools[3].execute({ instruction: 'Read fact' }, context)).toBe('{"extraction":"fact"}')
			expect(extract).toHaveBeenCalledWith('Read fact', { page, screenshot: false })
			expect(activePage).toHaveBeenCalledTimes(6)
			expect(await tools[4].execute({}, context)).toContain('"partial":true')
			expect(tools[4].definition.strict).toBe(false)
			for (const [index, args] of [
				[0, { url: 'invalid' }],
				[0, { url: 'https://example.test', goal: 'old' }],
				[1, { instruction: '' }],
				[1, { instruction: null }],
				[1, { page: 'other' }],
				[2, {}],
				[2, { instruction: ' ' }],
				[2, { instruction: 'Submit', selfHeal: true }],
				[2, { selector: '#submit', method: 'click', arguments: [] }],
				[3, { instruction: 'read', schema: {} }],
				[4, { limit: 51 }],
				[4, { query: 'unsupported' }],
			] as const) {
				expect(await tools[index].execute(args, context)).toMatchObject({ status: 'error' })
			}
		} finally {
			await receiver.close()
		}
	})
})
