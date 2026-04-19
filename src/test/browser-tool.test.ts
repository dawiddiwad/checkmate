import { describe, it, expect, beforeEach, vi } from 'vitest'
import { Page } from '@playwright/test'
import { BrowserTool, BrowserToolRuntime, createBrowserTools } from '../tools/browser/tool'
import { AgentTool, AgentToolContext } from '../tools/types'
import { MockPage, MockLocator } from './test-types'

const trackerMocks = vi.hoisted(() => ({
	startMock: vi.fn().mockResolvedValue(undefined),
	stopMock: vi.fn().mockResolvedValue([]),
	formatTimelineMock: vi.fn().mockReturnValue(''),
}))

vi.mock('../../src/logging', () => ({
	logger: {
		info: vi.fn(),
		warn: vi.fn(),
		error: vi.fn(),
		debug: vi.fn(),
	},
}))

vi.mock('../../src/tools/browser/snapshot-service', () => ({
	SnapshotService: class {
		get = vi.fn().mockResolvedValue('mocked snapshot content')
	},
}))

vi.mock('../tools/browser/transient-state-tracker', () => ({
	TransientStateTracker: class {
		start = trackerMocks.startMock
		stop = trackerMocks.stopMock
		formatTimeline = trackerMocks.formatTimelineMock
	},
}))

describe('Browser tools', () => {
	let mockPage: MockPage
	let runtime: BrowserToolRuntime
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
		vi.clearAllMocks()
		mockPage = {
			goto: vi.fn().mockResolvedValue(undefined),
			click: vi.fn().mockResolvedValue(undefined),
			hover: vi.fn().mockResolvedValue(undefined),
			locator: vi.fn().mockReturnValue({
				clear: vi.fn().mockResolvedValue(undefined),
				pressSequentially: vi.fn().mockResolvedValue(undefined),
				selectOption: vi.fn().mockResolvedValue(undefined),
				innerHTML: vi.fn().mockResolvedValue('<html>content</html>'),
			} as MockLocator),
			keyboard: {
				press: vi.fn().mockResolvedValue(undefined),
			},
			waitForTimeout: vi.fn().mockResolvedValue(undefined),
		}

		runtime = new BrowserToolRuntime(mockPage as unknown as Page)
		tools = createBrowserTools(runtime)
		context = {
			step: { action: 'act', expect: 'done' },
			services: {},
			pass: vi.fn(),
			fail: vi.fn(),
			resolveStepResult: vi.fn(),
		}
	})

	it('creates six browser tool definitions', () => {
		expect(tools).toHaveLength(6)
		expect(tools.map((tool) => tool.definition.function.name)).toEqual([
			BrowserTool.TOOL_NAVIGATE,
			BrowserTool.TOOL_CLICK_OR_HOVER,
			BrowserTool.TOOL_TYPE_OR_SELECT,
			BrowserTool.TOOL_PRESS_KEY,
			BrowserTool.TOOL_SNAPSHOT,
			BrowserTool.TOOL_WAIT,
		])
	})

	it('navigates and returns response plus snapshot', async () => {
		const result = await getTool(BrowserTool.TOOL_NAVIGATE).execute(
			{ url: 'https://example.com', goal: 'test' },
			context
		)

		expect(mockPage.goto).toHaveBeenCalledWith('https://example.com')
		expect(result).toEqual({
			response: 'Navigated to: https://example.com',
			context: [{ kind: 'text', name: 'browser.snapshot', content: 'mocked snapshot content' }],
		})
	})

	it('validates navigate arguments with zod', async () => {
		const result = await getTool(BrowserTool.TOOL_NAVIGATE).execute({ goal: 'test' }, context)
		expect(result).toContain("Invalid args for 'browser_navigate'")
	})

	it('clicks and returns separate response and snapshot', async () => {
		const result = await getTool(BrowserTool.TOOL_CLICK_OR_HOVER).execute(
			{ ref: 'e123', name: 'Submit Button', hover: false, goal: 'submit form' },
			context
		)

		expect(mockPage.click).toHaveBeenCalledWith('aria-ref=e123')
		expect(result).toEqual({
			response: "Clicked element with ref 'e123'.",
			context: [{ kind: 'text', name: 'browser.snapshot', content: 'mocked snapshot content' }],
		})
	})

	it('hovers when requested', async () => {
		const result = await getTool(BrowserTool.TOOL_CLICK_OR_HOVER).execute(
			{ ref: 'e321', name: 'Menu', hover: true, goal: 'open menu' },
			context
		)

		expect(mockPage.hover).toHaveBeenCalledWith('aria-ref=e321')
		expect(result).toEqual({
			response: "Hovered element with ref 'e321'.",
			context: [{ kind: 'text', name: 'browser.snapshot', content: 'mocked snapshot content' }],
		})
	})

	it('prefers transient timeline in click responses when available', async () => {
		trackerMocks.formatTimelineMock.mockReturnValueOnce('timeline: click flow')

		const result = await getTool(BrowserTool.TOOL_CLICK_OR_HOVER).execute(
			{ ref: 'e123', name: 'Submit Button', hover: false, goal: 'submit form' },
			context
		)

		expect(result).toEqual({
			response: 'timeline: click flow',
			context: [{ kind: 'text', name: 'browser.snapshot', content: 'mocked snapshot content' }],
		})
	})

	it('types text into an element', async () => {
		const result = await getTool(BrowserTool.TOOL_TYPE_OR_SELECT).execute(
			{
				elements: [{ ref: 'e456', text: 'Hello World', name: 'Input', clear: true, select: false }],
				goal: 'enter text',
			},
			context
		)

		expect(mockPage.locator).toHaveBeenCalledWith('aria-ref=e456')
		expect(mockPage.locator('aria-ref=e456').clear).toHaveBeenCalledOnce()
		expect(mockPage.locator('aria-ref=e456').pressSequentially).toHaveBeenCalledWith('Hello World', { delay: 50 })
		expect(result).toEqual({
			response: 'Updated 1 page element.',
			context: [{ kind: 'text', name: 'browser.snapshot', content: 'mocked snapshot content' }],
		})
	})

	it('selects an option from a dropdown', async () => {
		const result = await getTool(BrowserTool.TOOL_TYPE_OR_SELECT).execute(
			{
				elements: [{ ref: 'e789', text: 'Option 2', name: 'Dropdown', clear: false, select: true }],
				goal: 'select option',
			},
			context
		)

		expect(mockPage.locator('aria-ref=e789').selectOption).toHaveBeenCalledWith('Option 2')
		expect(result).toEqual({
			response: 'Updated 1 page element.',
			context: [{ kind: 'text', name: 'browser.snapshot', content: 'mocked snapshot content' }],
		})
	})

	it('validates type/select arguments with zod', async () => {
		const result = await getTool(BrowserTool.TOOL_TYPE_OR_SELECT).execute(
			{ elements: [], goal: 'fill form' },
			context
		)
		expect(result).toContain("Invalid args for 'browser_type_or_select'")
	})

	it('presses a key', async () => {
		const result = await getTool(BrowserTool.TOOL_PRESS_KEY).execute({ key: 'Enter', goal: 'submit' }, context)

		expect(mockPage.keyboard.press).toHaveBeenCalledWith('Enter')
		expect(result).toEqual({
			response: "Pressed key 'Enter'.",
			context: [{ kind: 'text', name: 'browser.snapshot', content: 'mocked snapshot content' }],
		})
	})

	it('returns runtime error message when key is empty', async () => {
		const result = await getTool(BrowserTool.TOOL_PRESS_KEY).execute({ key: '', goal: 'submit' }, context)
		expect(result).toContain("failed to press key ''")
	})

	it('captures a raw snapshot without filtering', async () => {
		const result = await getTool(BrowserTool.TOOL_SNAPSHOT).execute({ goal: 'capture current state' }, context)
		expect(result).toEqual({
			response: 'Captured latest page snapshot.',
			context: [{ kind: 'text', name: 'browser.snapshot', content: 'mocked snapshot content' }],
		})
	})

	it('waits for specified seconds', async () => {
		const result = await getTool(BrowserTool.TOOL_WAIT).execute({ seconds: 2.5, goal: 'wait for content' }, context)

		expect(mockPage.waitForTimeout).toHaveBeenCalledWith(2500)
		expect(result).toEqual({
			response: 'Waited 2.5 seconds.',
			context: [{ kind: 'text', name: 'browser.snapshot', content: 'mocked snapshot content' }],
		})
	})

	it('returns runtime error when seconds is not positive', async () => {
		const result = await getTool(BrowserTool.TOOL_WAIT).execute({ seconds: 0, goal: 'wait' }, context)
		expect(result).toContain('failed to wait for 0 seconds')
	})

	it('validates wait arguments with zod when missing', async () => {
		const result = await getTool(BrowserTool.TOOL_WAIT).execute({ goal: 'wait' }, context)
		expect(result).toContain("Invalid args for 'browser_wait'")
	})
})
