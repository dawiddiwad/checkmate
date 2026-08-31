import { beforeEach, describe, expect, it, vi } from 'vitest'
import { Page } from '@playwright/test'
import { BrowserTool, BrowserToolRuntime, createBrowserTools } from '../tools/browser/tool'
import { AgentTool, AgentToolContext } from '../tools/types'
import { MockBrowserContext, MockPage, testConfig } from './test-types'

const playwrightTest = vi.hoisted(() => ({ stepNames: [] as string[] }))

vi.mock('@playwright/test', () => ({
	test: {
		step: async (name: string, body: () => Promise<unknown>) => {
			playwrightTest.stepNames.push(name)
			return body()
		},
	},
}))

vi.mock('../../src/logging', () => ({
	logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}))

vi.mock('../../src/tools/browser/snapshot-service', () => ({
	SnapshotService: class {
		get = vi.fn().mockResolvedValue('mocked snapshot content')
	},
}))

vi.mock('../tools/browser/transient-state-tracker', () => ({
	TransientStateTracker: class {
		start = vi.fn().mockResolvedValue(undefined)
		stop = vi.fn().mockResolvedValue([])
		formatTimeline = vi.fn().mockReturnValue('')
	},
}))

function createMockContext(): MockBrowserContext {
	const handlers: Array<(page: MockPage) => void> = []
	const pages: MockPage[] = []
	const context = {
		pages: vi.fn(() => pages),
		on: vi.fn((_event: string, handler: (page: MockPage) => void) => {
			handlers.push(handler)
			return context
		}),
		off: vi.fn(),
		emitPage: (page: MockPage) => {
			pages.push(page)
			for (const handler of handlers) {
				handler(page)
			}
		},
	} as MockBrowserContext
	return context
}

function createMockPage(context: MockBrowserContext): MockPage {
	const page = {
		goto: vi.fn().mockResolvedValue(undefined),
		click: vi.fn().mockResolvedValue(undefined),
		hover: vi.fn().mockResolvedValue(undefined),
		locator: vi.fn().mockReturnValue({ innerHTML: vi.fn().mockResolvedValue('<html></html>') }),
		keyboard: { press: vi.fn().mockResolvedValue(undefined) },
		waitForTimeout: vi.fn().mockResolvedValue(undefined),
		context: vi.fn(() => context),
		url: vi.fn(() => 'https://example.com'),
		title: vi.fn().mockResolvedValue('Example'),
		bringToFront: vi.fn().mockResolvedValue(undefined),
		waitForLoadState: vi.fn().mockResolvedValue(undefined),
		isClosed: vi.fn(() => false),
		close: vi.fn().mockResolvedValue(undefined),
		opener: vi.fn().mockResolvedValue(null),
	} as MockPage
	context.emitPage(page)
	return page
}

describe('per-turn test.step nesting', () => {
	let tools: AgentTool[]

	beforeEach(() => {
		vi.clearAllMocks()
		playwrightTest.stepNames.length = 0
		const context = createMockContext()
		const page = createMockPage(context)
		const runtime = new BrowserToolRuntime(page as unknown as Page, testConfig())
		tools = createBrowserTools(runtime)
	})

	function getTool(name: string): AgentTool {
		const tool = tools.find((candidate) => candidate.definition.name === name)
		if (!tool) {
			throw new Error(`Missing tool ${name}`)
		}
		return tool
	}

	it('opens one turn-labelled step per dispatched tool call, in dispatch order', async () => {
		await getTool(BrowserTool.TOOL_NAVIGATE).execute(
			{ url: 'https://example.com', goal: 'open' },
			{ step: { action: 'a', expect: 'b' }, turn: 1 }
		)
		await getTool(BrowserTool.TOOL_CLICK_OR_HOVER).execute(
			{ ref: 'e1', name: 'Submit', hover: false, goal: 'submit' },
			{ step: { action: 'a', expect: 'b' }, turn: 2 }
		)
		await getTool(BrowserTool.TOOL_PRESS_KEY).execute(
			{ key: 'Enter', goal: 'confirm' },
			{ step: { action: 'a', expect: 'b' }, turn: 2 }
		)

		expect(playwrightTest.stepNames).toEqual([
			`turn 1 · ${BrowserTool.TOOL_NAVIGATE}`,
			`turn 2 · ${BrowserTool.TOOL_CLICK_OR_HOVER}`,
			`turn 2 · ${BrowserTool.TOOL_PRESS_KEY}`,
		])
	})

	it('opens exactly one step per call, so the stability wait inside it never becomes a step of its own', async () => {
		await getTool(BrowserTool.TOOL_NAVIGATE).execute(
			{ url: 'https://example.com', goal: 'open' },
			{ step: { action: 'a', expect: 'b' }, turn: 5 }
		)

		expect(playwrightTest.stepNames).toHaveLength(1)
	})

	it('falls back to the bare tool name when no turn is known', async () => {
		const context: AgentToolContext = { step: { action: 'a', expect: 'b' } }

		await getTool(BrowserTool.TOOL_WAIT).execute({ seconds: 1, goal: 'wait' }, context)

		expect(playwrightTest.stepNames).toEqual([BrowserTool.TOOL_WAIT])
	})
})
