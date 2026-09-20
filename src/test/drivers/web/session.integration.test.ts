import { createServer, type Server } from 'node:http'
import { readFile } from 'node:fs/promises'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { ChatCompletion, ChatCompletionAssistantMessageParam } from 'openai/resources/chat/completions'
import type { DriverDescriptorV1, ModelEgressPolicyV1 } from '../../../contracts/types'
import { checkmateDriver, webSettings } from '../../../drivers/web'
import { silentLogger } from '../../../logging/types'
import { createDriverRunner } from '../../../runtime/runner'
import { ScenarioControl } from '../../../runtime/scenario-control'

const servers: Server[] = []

afterEach(async () => {
	await Promise.all(servers.splice(0).map((server) => new Promise<void>((resolve) => server.close(() => resolve()))))
})

describe('web driver session', () => {
	it('resolves logging settings with quiet, non-persistent defaults', () => {
		expect(webSettings({})).toMatchObject({ logLevel: 'off', logsAsEvidence: false })
		expect(webSettings({ logLevel: 'debug', logsAsEvidence: true })).toMatchObject({
			logLevel: 'debug',
			logsAsEvidence: true,
		})
	})

	it('owns one browser session and preserves navigation, input, click, context, and verdict behavior', async () => {
		const server = createServer((_request, response) => {
			response.setHeader('content-type', 'text/html')
			response.end(`<!doctype html>
<html><body>
<label>Name <input aria-label="Name"></label>
<button onclick="document.querySelector('#status').textContent = 'saved'">Save</button>
<p id="status">idle</p>
</body></html>`)
		})
		servers.push(server)
		await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
		const address = server.address()
		if (!address || typeof address === 'string') throw new Error('Fixture server did not bind a TCP port')
		const baseUrl = `http://127.0.0.1:${address.port}`
		const controller = new AbortController()
		const session = await checkmateDriver.start({
			target: { baseUrl },
			settings: { headless: true },
			secrets: { read: () => '' },
			evidence: { capture: async () => ({ status: 'discarded' }) },
			logger: silentLogger,
			signal: controller.signal,
		})
		const step = { id: 'web-action', action: 'Fill and save the form', expect: 'The status becomes saved' }
		const initial = await session.buildInitialContext({ step, signal: controller.signal })
		const snapshot = String(initial[0]?.content ?? '')
		const inputRef = referenceFor(snapshot, 'textbox', 'Name')
		const buttonRef = referenceFor(snapshot, 'button', 'Save')
		const typeTool = session.tools.find((tool) => tool.definition.name === 'browser_type_or_select')!
		const clickTool = session.tools.find((tool) => tool.definition.name === 'browser_click_or_hover')!
		const typeResult = await typeTool.execute(
			{
				elements: [{ ref: inputRef, name: 'Name', text: 'Ada', clear: true, select: false }],
				goal: 'fill the name',
			},
			{ step, turn: 1, signal: controller.signal }
		)
		const clickResult = await clickTool.execute(
			{ ref: buttonRef, name: 'Save', hover: false, goal: 'save the form' },
			{ step, turn: 2, signal: controller.signal }
		)
		expect(typeResult).toMatchObject({ status: 'success' })
		expect(clickResult).toMatchObject({ status: 'success' })
		const fresh = await session.handleToolResponses({ step, turn: 2, toolResponses: [], signal: controller.signal })
		expect(String(fresh[0]?.content)).toContain('saved')
		expect(initial[0].ephemeral).toBe(true)
		expect(session.tools).toHaveLength(14)

		const descriptor = JSON.parse(
			await readFile(new URL('../../../drivers/web/checkmate-driver.json', import.meta.url), 'utf8')
		) as DriverDescriptorV1
		expect(session.tools.map((tool) => tool.definition.name).sort()).toEqual(
			descriptor.tools.map((tool) => tool.name).sort()
		)
		const send = vi
			.fn()
			.mockResolvedValueOnce(toolResponse('pass_test_step', { actualResult: 'saved' }))
			.mockResolvedValueOnce(toolResponse('fail_test_step', { actualResult: 'not saved' }))
		const runner = createDriverRunner({
			driverId: 'web',
			descriptor,
			session,
			allowedTools: '*',
			modelEgress,
			limits: {
				turnsPerStep: 3,
				stepTimeoutMs: 5_000,
				requestTimeoutMs: 5_000,
				maxRetries: 0,
				loopMaxRepetitions: 3,
			},
			apiKey: 'fixture-key',
			aiClient: { send } as never,
		})
		const scenario = new ScenarioControl({ timeoutMs: 15_000 })
		const passed = await runner.run(
			{ id: 'pass', action: 'inspect saved status', expect: 'saved' },
			scenario.createStepControl(5_000)
		)
		const failed = await runner.run(
			{ id: 'fail', action: 'inspect saved status', expect: 'missing' },
			scenario.createStepControl(5_000)
		)
		expect(passed.reason).toBe('met-expectation')
		expect(failed.reason).toBe('failed-expectation')

		await session.close({ signal: controller.signal })
		await session.close({ signal: controller.signal })
		scenario.dispose()
	}, 20_000)
})

const modelEgress: ModelEgressPolicyV1 = {
	provider: { id: 'openai', model: 'fixture', apiKeyBinding: 'provider-key' },
	textRedaction: 'on',
	allowOpaque: false,
	maxStepBytes: 1024 * 1024,
	maxMessageBytes: 256 * 1024,
}

function referenceFor(snapshot: string, role: string, name: string): string {
	const escapedName = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
	const match = snapshot.match(new RegExp(`${role} ${escapedName}[^\\n]*?ref=(e\\d+)`, 'i'))
	if (!match) throw new Error(`Could not find ${role} '${name}' in snapshot:\n${snapshot}`)
	return match[1]
}

function toolResponse(name: string, args: unknown) {
	return {
		response: {
			id: `response-${name}`,
			object: 'chat.completion',
			created: 0,
			model: 'fixture',
			choices: [
				{
					index: 0,
					logprobs: null,
					finish_reason: 'tool_calls',
					message: {
						role: 'assistant',
						content: null,
						refusal: null,
						tool_calls: [
							{
								id: `call-${name}`,
								type: 'function',
								function: { name, arguments: JSON.stringify(args) },
							},
						],
					},
				},
			],
			usage: { prompt_tokens: 2, completion_tokens: 1, total_tokens: 3 },
		} as ChatCompletion,
		assistantMessages: [] as ChatCompletionAssistantMessageParam[],
	}
}
