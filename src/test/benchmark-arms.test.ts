import { describe, it, expect, vi, beforeEach } from 'vitest'
import { Page } from '@playwright/test'
import { readFileSync } from 'node:fs'
import { createRunner } from '../core'
import { web } from '../playwright'
import { mcpBaseline } from '../../scripts/baseline/mcp-baseline'
import { testConfig } from './test-types'

const createMock = vi.fn()
const navigateMock = vi.fn()

vi.mock('openai', () => ({
	default: class MockOpenAI {
		chat = { completions: { create: createMock } }
		constructor() {}
	},
}))

vi.mock('../logging', () => ({
	logger: {
		info: vi.fn(),
		warn: vi.fn(),
		error: vi.fn(),
		debug: vi.fn(),
	},
	setLogLevel: vi.fn(),
}))

vi.mock('../tools/browser/tool', () => ({
	BrowserTool: {
		TOOL_NAVIGATE: 'browser_navigate',
		TOOL_CLICK_OR_HOVER: 'browser_click_or_hover',
		TOOL_SET_DIALOG_RESPONSE: 'browser_set_dialog_response',
		TOOL_SNAPSHOT: 'browser_snapshot',
		TOOL_LIST_TABS: 'browser_list_tabs',
		TOOL_SELECT_TAB: 'browser_select_tab',
		TOOL_CLOSE_TAB: 'browser_close_tab',
	},
	BrowserToolRuntime: class {
		constructor(private readonly page: Page) {}
		getActivePage() {
			return this.page
		}
		ensureActivePage() {
			return this.page
		}
		getBrowserContext() {
			return this.page.context?.() ?? {}
		}
		captureCurrentSnapshot() {
			return Promise.resolve('mocked snapshot')
		}
		navigateToUrl(url: string) {
			return navigateMock(url)
		}
	},
	createBrowserTools: vi.fn(() => [
		{
			definition: {
				name: 'browser_navigate',
				description: 'Navigate to a url',
				parameters: {
					type: 'object',
					properties: { url: { type: 'string' }, goal: { type: 'string' } },
					required: ['url', 'goal'],
					additionalProperties: false,
				},
				strict: true,
			},
			execute: (args: { url: string }) => navigateMock(args.url),
		},
	]),
}))

vi.mock('../tools/browser/snapshot-service', () => ({
	SnapshotService: class {
		get = vi.fn().mockResolvedValue('mocked snapshot')
	},
}))

function toolCallResponse(id: string, name: string, args: Record<string, unknown>) {
	return {
		choices: [
			{
				index: 0,
				finish_reason: 'tool_calls',
				message: {
					role: 'assistant',
					content: null as string | null,
					tool_calls: [{ id, type: 'function', function: { name, arguments: JSON.stringify(args) } }],
				},
			},
		],
		usage: { prompt_tokens: 10, completion_tokens: 5, prompt_tokens_details: { cached_tokens: 4 } },
	}
}

describe('benchmark arms', () => {
	let page: Page

	beforeEach(() => {
		vi.clearAllMocks()
		navigateMock.mockReturnValue({ response: 'Navigated to https://example.com', snapshot: 'mocked snapshot' })
		page = {} as Page
	})

	it('composes and produces a report for the checkmate arm', async () => {
		createMock
			.mockResolvedValueOnce(
				toolCallResponse('call-1', 'browser_navigate', { url: 'https://example.com', goal: 'open' })
			)
			.mockResolvedValueOnce(toolCallResponse('call-2', 'pass_test_step', { actualResult: 'page opened' }))

		const runner = createRunner({ config: testConfig(), extensions: [web({ page })] })
		const report = await runner.run({ action: 'Open example.com', expect: 'The homepage is shown' })

		expect(report.schemaVersion).toBe(1)
		expect(report.outcome).toBe('passed')
		expect(report.category).toBe('app')
		expect(navigateMock).toHaveBeenCalledWith('https://example.com')

		await runner.teardown()
	})

	it('composes and produces a report for the mcp-baseline arm', async () => {
		createMock
			.mockResolvedValueOnce(toolCallResponse('call-1', 'browser_navigate', { url: 'https://example.com' }))
			.mockResolvedValueOnce(toolCallResponse('call-2', 'pass_test_step', { actualResult: 'page opened' }))

		const runner = createRunner({ config: testConfig(), extensions: [mcpBaseline({ page })] })
		const report = await runner.run({ action: 'Open example.com', expect: 'The homepage is shown' })

		expect(report.schemaVersion).toBe(1)
		expect(report.outcome).toBe('passed')
		expect(report.category).toBe('app')
		expect(navigateMock).toHaveBeenCalledWith('https://example.com')

		await runner.teardown()
	})

	it('vendors the baseline arm instead of depending on @playwright/mcp', () => {
		const packageJson = JSON.parse(readFileSync(new URL('../../package.json', import.meta.url), 'utf-8'))

		expect(packageJson.dependencies?.['@playwright/mcp']).toBeUndefined()
		expect(packageJson.devDependencies?.['@playwright/mcp']).toBeUndefined()
		expect(packageJson.peerDependencies?.['@playwright/mcp']).toBeUndefined()
	})
})
