import { createServer } from 'node:http'
import { readFile } from 'node:fs/promises'
import { describe, expect, it, vi } from 'vitest'
import { checkmateDriver } from '../../../drivers/web/index.js'
import { silentLogger } from '../../../logging/types.js'
import type { DriverStructuredGenerationRequest, DriverToolContext } from '../../../driver.js'

describe('real Stagehand form', () => {
	it('observes, acts, and verifies changed form state without automatic context or evidence', async () => {
		const server = createServer((_request, response) => {
			response.setHeader('content-type', 'text/html')
			response.end(
				"<html><body><h1>Inspection fact: cobalt heron</h1><form onsubmit=\"event.preventDefault(); document.querySelector('h1').textContent = 'Saved cobalt heron'\"><button>Save</button></form></body></html>"
			)
		})
		await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
		const address = server.address()
		if (!address || typeof address === 'string') throw new Error('No fixture address')
		const baseUrl = `http://127.0.0.1:${address.port}`
		const capture = vi.fn(async () => ({ status: 'discarded' as const }))
		const session = await checkmateDriver.start({
			target: { baseUrl },
			settings: {},
			secrets: { read: () => '' },
			evidence: { capture },
			logger: silentLogger,
			signal: new AbortController().signal,
			allowlistedTools: ['browser_navigate', 'browser_observe', 'browser_act', 'browser_extract'],
			diagnostics: { sanitizeText: (text) => text },
		})
		try {
			const requests: DriverStructuredGenerationRequest[] = []
			const context: DriverToolContext = {
				step: { id: 'inspect', action: 'Inspect', expect: 'cobalt heron' },
				turn: 1,
				signal: new AbortController().signal,
				generateStructured: async (request) => {
					requests.push(request)
					if (request.schemaName === 'Observation' || request.schemaName === 'Act') {
						const elementId = JSON.stringify(request.messages).match(/\[(\d+-\d+)\] button: Save/)?.[1]
						expect(elementId).toBeDefined()
						const action = { elementId, description: 'Save', method: 'click', arguments: [] as string[] }
						return {
							value: request.schemaName === 'Act' ? { action, twoStep: false } : { elements: [action] },
						}
					}
					expect(['Extraction', 'Metadata']).toContain(request.schemaName)
					expect(JSON.stringify(request.messages)).toContain('Saved cobalt heron')
					return {
						value:
							request.schemaName === 'Metadata'
								? { completed: true, progress: 'Complete' }
								: { extraction: 'Saved cobalt heron' },
					}
				},
			}
			const descriptor = JSON.parse(
				await readFile(new URL('../../../drivers/web/checkmate-driver.json', import.meta.url), 'utf8')
			)
			expect(session.tools.map((tool) => tool.definition.name)).toEqual(
				descriptor.tools.map((tool: { name: string }) => tool.name)
			)
			expect(await session.buildInitialContext(context)).toEqual([])
			await session.tools[0].execute({ url: baseUrl }, context)
			expect(requests).toHaveLength(0)
			const observed = JSON.parse(
				(await session.tools[1].execute({ instruction: 'Find the Save button' }, context)) as string
			)
			expect(observed).toEqual([
				expect.objectContaining({ description: 'Save', method: 'click', selector: expect.any(String) }),
			])
			const acted = JSON.parse((await session.tools[2].execute({ instruction: 'Click Save' }, context)) as string)
			expect(acted.success).toBe(true)
			expect(await session.tools[3].execute({ instruction: 'Read the inspection fact' }, context)).toBe(
				'{"extraction":"Saved cobalt heron"}'
			)
			expect(requests.map((request) => request.schemaName)).toEqual([
				'Observation',
				'Act',
				'Extraction',
				'Metadata',
			])
			expect(await session.handleToolResponses({ ...context, toolResponses: [] })).toEqual([])
			expect(capture).not.toHaveBeenCalled()
			await expect(session.tools[4].execute({}, context)).rejects.toThrow('not permitted')
		} finally {
			await session.close({ signal: new AbortController().signal })
			await session.close({ signal: new AbortController().signal })
			server.closeAllConnections()
			await new Promise<void>((resolve) => server.close(() => resolve()))
		}
	}, 30_000)
})
