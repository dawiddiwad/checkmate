import { describe, it, expect, beforeEach, vi } from 'vitest'
import { Page } from '@playwright/test'
import { BrowserTool, BrowserToolRuntime, createBrowserTools } from '../tools/browser/tool'
import { AgentTool, AgentToolContext } from '../tools/types'
import {
	MockBrowserContext,
	MockPage,
	MockLocator,
	createMockBrowserContext,
	createMockNetworkRequest,
	createMockNetworkResponse,
	testConfig,
} from './test-types'

const trackerMocks = vi.hoisted(() => ({
	startMock: vi.fn().mockResolvedValue(undefined),
	stopMock: vi.fn().mockResolvedValue([]),
	formatTimelineMock: vi.fn().mockReturnValue(''),
	constructorMock: vi.fn(),
}))

vi.mock('../../src/logging', () => ({
	logger: {
		info: vi.fn(),
		warn: vi.fn(),
		error: vi.fn(),
		debug: vi.fn(),
	},
}))

const playwrightTest = vi.hoisted(() => ({ stepNames: [] as string[], insideTest: true }))

vi.mock('@playwright/test', () => ({
	test: {
		step: async (name: string, body: () => Promise<unknown>) => {
			playwrightTest.stepNames.push(name)
			return body()
		},
		info: () => {
			if (!playwrightTest.insideTest) {
				throw new Error('test.info() can only be called from a test')
			}
			return {}
		},
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

		constructor(page: Page, options?: unknown) {
			trackerMocks.constructorMock(page, options)
		}
	},
}))

describe('Browser tools', () => {
	let mockContext: MockBrowserContext
	let mockPage: MockPage
	let runtime: BrowserToolRuntime
	let tools: AgentTool[]
	let context: AgentToolContext

	function getTool(name: string): AgentTool {
		const tool = tools.find((candidate) => candidate.definition.name === name)
		if (!tool) {
			throw new Error(`Missing tool ${name}`)
		}

		return tool
	}

	function createMockPage(context: MockBrowserContext, url = 'https://example.com', title = 'Example'): MockPage {
		const page = {
			goto: vi.fn().mockResolvedValue(undefined),
			click: vi.fn().mockResolvedValue(undefined),
			hover: vi.fn().mockResolvedValue(undefined),
			locator: vi.fn().mockReturnValue({
				clear: vi.fn().mockResolvedValue(undefined),
				pressSequentially: vi.fn().mockResolvedValue(undefined),
				selectOption: vi.fn().mockResolvedValue(undefined),
				dragTo: vi.fn().mockResolvedValue(undefined),
				setInputFiles: vi.fn().mockResolvedValue(undefined),
				innerHTML: vi.fn().mockResolvedValue('<html>content</html>'),
			} as MockLocator),
			keyboard: {
				press: vi.fn().mockResolvedValue(undefined),
			},
			waitForTimeout: vi.fn().mockResolvedValue(undefined),
			context: vi.fn(() => context),
			url: vi.fn(() => url),
			title: vi.fn().mockResolvedValue(title),
			bringToFront: vi.fn().mockResolvedValue(undefined),
			waitForLoadState: vi.fn().mockResolvedValue(undefined),
			isClosed: vi.fn(() => false),
			close: vi.fn().mockResolvedValue(undefined),
			opener: vi.fn().mockResolvedValue(null),
		} as MockPage
		context.emitPage(page)
		return page
	}

	beforeEach(() => {
		vi.clearAllMocks()
		playwrightTest.stepNames.length = 0
		playwrightTest.insideTest = true
		mockContext = createMockBrowserContext()
		mockPage = createMockPage(mockContext)

		runtime = new BrowserToolRuntime(mockPage as unknown as Page, testConfig())
		tools = createBrowserTools(runtime)
		context = {
			step: { action: 'act', expect: 'done' },
			turn: 1,
		}
	})

	it('wraps each dispatched tool call in its own named test.step', async () => {
		await getTool(BrowserTool.TOOL_NAVIGATE).execute(
			{ url: 'https://example.com', goal: 'test' },
			{ ...context, turn: 4 }
		)

		expect(playwrightTest.stepNames).toEqual([`turn 4 · ${BrowserTool.TOOL_NAVIGATE}`])
	})

	it('skips the test.step wrapper outside a Playwright test worker, e.g. a plain script driving web() directly', async () => {
		playwrightTest.insideTest = false

		const result = await getTool(BrowserTool.TOOL_NAVIGATE).execute(
			{ url: 'https://example.com', goal: 'test' },
			{ ...context, turn: 4 }
		)

		expect(playwrightTest.stepNames).toEqual([])
		expect(result).toEqual({ response: 'Navigated to: https://example.com', snapshot: 'mocked snapshot content' })
	})

	it('creates fourteen browser tool definitions', () => {
		expect(tools).toHaveLength(14)
		expect(tools.map((tool) => tool.definition.name)).toEqual([
			BrowserTool.TOOL_NAVIGATE,
			BrowserTool.TOOL_CLICK_OR_HOVER,
			BrowserTool.TOOL_SET_DIALOG_RESPONSE,
			BrowserTool.TOOL_DRAG,
			BrowserTool.TOOL_UPLOAD,
			BrowserTool.TOOL_TYPE_OR_SELECT,
			BrowserTool.TOOL_PRESS_KEY,
			BrowserTool.TOOL_SNAPSHOT,
			BrowserTool.TOOL_WAIT,
			BrowserTool.TOOL_LIST_TABS,
			BrowserTool.TOOL_SELECT_TAB,
			BrowserTool.TOOL_CLOSE_TAB,
			BrowserTool.TOOL_NETWORK_REQUESTS,
			BrowserTool.TOOL_NETWORK_REQUEST,
		])
	})

	it('navigates and returns response plus snapshot', async () => {
		const result = await getTool(BrowserTool.TOOL_NAVIGATE).execute(
			{ url: 'https://example.com', goal: 'test' },
			context
		)

		expect(mockPage.goto).toHaveBeenCalledWith('https://example.com')
		expect(result).toEqual({ response: 'Navigated to: https://example.com', snapshot: 'mocked snapshot content' })
	})

	it('validates navigate arguments with zod', async () => {
		const result = await getTool(BrowserTool.TOOL_NAVIGATE).execute({ goal: 'test' }, context)
		expect(result).toContain("Invalid args for 'browser_navigate'")
	})

	it('arms the next JavaScript dialog response', async () => {
		const result = await getTool(BrowserTool.TOOL_SET_DIALOG_RESPONSE).execute(
			{ action: 'accept', promptText: 'Alice', goal: 'fill prompt' },
			context
		)

		expect(result).toBe('Will accept the next JavaScript dialog with prompt text.')
	})

	it('validates dialog response arguments with zod', async () => {
		const result = await getTool(BrowserTool.TOOL_SET_DIALOG_RESPONSE).execute(
			{ action: 'approve', goal: 'confirm' },
			context
		)
		expect(result).toContain("Invalid args for 'browser_set_dialog_response'")
	})

	it('makes pending dialog intent available to the next tracked action', async () => {
		let consumedIntent: unknown = null
		mockPage.click.mockImplementation(async () => {
			const options = trackerMocks.constructorMock.mock.calls.at(-1)?.[1] as {
				consumeDialogHandlingIntent: () => unknown
			}
			consumedIntent = options.consumeDialogHandlingIntent()
		})

		await getTool(BrowserTool.TOOL_SET_DIALOG_RESPONSE).execute(
			{ action: 'accept', promptText: 'Alice', goal: 'fill prompt' },
			context
		)
		await getTool(BrowserTool.TOOL_CLICK_OR_HOVER).execute(
			{ ref: 'e123', name: 'Prompt Button', hover: false, goal: 'open prompt' },
			context
		)

		expect(consumedIntent).toEqual({ action: 'accept', promptText: 'Alice' })
	})

	it('clears unused dialog intent after a tracked action finishes', async () => {
		const consumedIntents: unknown[] = []
		mockPage.click.mockResolvedValueOnce(undefined).mockImplementationOnce(async () => {
			const options = trackerMocks.constructorMock.mock.calls.at(-1)?.[1] as {
				consumeDialogHandlingIntent: () => unknown
			}
			consumedIntents.push(options.consumeDialogHandlingIntent())
		})

		await getTool(BrowserTool.TOOL_SET_DIALOG_RESPONSE).execute({ action: 'accept', goal: 'confirm' }, context)
		await getTool(BrowserTool.TOOL_CLICK_OR_HOVER).execute(
			{ ref: 'e123', name: 'Safe Button', hover: false, goal: 'no dialog' },
			context
		)
		await getTool(BrowserTool.TOOL_CLICK_OR_HOVER).execute(
			{ ref: 'e456', name: 'Other Button', hover: false, goal: 'other action' },
			context
		)

		expect(consumedIntents).toEqual([null])
	})

	it('clicks and returns separate response and snapshot', async () => {
		const result = await getTool(BrowserTool.TOOL_CLICK_OR_HOVER).execute(
			{ ref: 'e123', name: 'Submit Button', hover: false, goal: 'submit form' },
			context
		)

		expect(mockPage.click).toHaveBeenCalledWith('aria-ref=e123')
		expect(result).toEqual({ response: "Clicked element with ref 'e123'.", snapshot: 'mocked snapshot content' })
	})

	it('hovers when requested', async () => {
		const result = await getTool(BrowserTool.TOOL_CLICK_OR_HOVER).execute(
			{ ref: 'e321', name: 'Menu', hover: true, goal: 'open menu' },
			context
		)

		expect(mockPage.hover).toHaveBeenCalledWith('aria-ref=e321')
		expect(result).toEqual({ response: "Hovered element with ref 'e321'.", snapshot: 'mocked snapshot content' })
	})

	it('prefers transient timeline in click responses when available', async () => {
		trackerMocks.formatTimelineMock.mockReturnValueOnce('timeline: click flow')

		const result = await getTool(BrowserTool.TOOL_CLICK_OR_HOVER).execute(
			{ ref: 'e123', name: 'Submit Button', hover: false, goal: 'submit form' },
			context
		)

		expect(result).toEqual({ response: 'timeline: click flow', snapshot: 'mocked snapshot content' })
	})

	it('drags an element onto a target', async () => {
		const sourceLocator = {
			clear: vi.fn().mockResolvedValue(undefined),
			pressSequentially: vi.fn().mockResolvedValue(undefined),
			selectOption: vi.fn().mockResolvedValue(undefined),
			dragTo: vi.fn().mockResolvedValue(undefined),
			setInputFiles: vi.fn().mockResolvedValue(undefined),
			innerHTML: vi.fn().mockResolvedValue('<html>source</html>'),
		} as MockLocator
		const targetLocator = {
			clear: vi.fn().mockResolvedValue(undefined),
			pressSequentially: vi.fn().mockResolvedValue(undefined),
			selectOption: vi.fn().mockResolvedValue(undefined),
			dragTo: vi.fn().mockResolvedValue(undefined),
			setInputFiles: vi.fn().mockResolvedValue(undefined),
			innerHTML: vi.fn().mockResolvedValue('<html>target</html>'),
		} as MockLocator
		const htmlLocator = {
			clear: vi.fn().mockResolvedValue(undefined),
			pressSequentially: vi.fn().mockResolvedValue(undefined),
			selectOption: vi.fn().mockResolvedValue(undefined),
			dragTo: vi.fn().mockResolvedValue(undefined),
			setInputFiles: vi.fn().mockResolvedValue(undefined),
			innerHTML: vi.fn().mockResolvedValue('<html>content</html>'),
		} as MockLocator

		mockPage.locator.mockImplementation((selector: string) => {
			if (selector === 'aria-ref=e123') {
				return sourceLocator
			}
			if (selector === 'aria-ref=e456') {
				return targetLocator
			}
			return htmlLocator
		})

		const result = await getTool(BrowserTool.TOOL_DRAG).execute(
			{
				sourceRef: 'e123',
				sourceName: 'File card',
				targetRef: 'e456',
				targetName: 'Done column',
				goal: 'move card',
			},
			context
		)

		expect(mockPage.locator).toHaveBeenCalledWith('aria-ref=e123')
		expect(mockPage.locator).toHaveBeenCalledWith('aria-ref=e456')
		expect(sourceLocator.dragTo).toHaveBeenCalledWith(targetLocator)
		expect(result).toEqual({
			response: "Dragged element with ref 'e123' to element with ref 'e456'.",
			snapshot: 'mocked snapshot content',
		})
	})

	it('validates drag arguments with zod', async () => {
		const result = await getTool(BrowserTool.TOOL_DRAG).execute(
			{ sourceRef: 'e123', sourceName: 'File card', targetName: 'Done column', goal: 'move card' },
			context
		)
		expect(result).toContain("Invalid args for 'browser_drag'")
	})

	it('uploads files to an input element', async () => {
		const result = await getTool(BrowserTool.TOOL_UPLOAD).execute(
			{
				ref: 'e123',
				name: 'Resume Upload',
				filePaths: ['fixtures/resume.pdf'],
				goal: 'attach resume',
			},
			context
		)

		expect(mockPage.locator).toHaveBeenCalledWith('aria-ref=e123')
		expect(mockPage.locator('aria-ref=e123').setInputFiles).toHaveBeenCalledWith(['fixtures/resume.pdf'])
		expect(result).toEqual({
			response: "Uploaded 1 file to element with ref 'e123'.",
			snapshot: 'mocked snapshot content',
		})
	})

	it('validates upload arguments with zod', async () => {
		const result = await getTool(BrowserTool.TOOL_UPLOAD).execute(
			{ ref: 'e123', name: 'Resume Upload', filePaths: [], goal: 'attach resume' },
			context
		)
		expect(result).toContain("Invalid args for 'browser_upload'")
	})

	it('returns runtime error when upload file path is empty', async () => {
		const result = await getTool(BrowserTool.TOOL_UPLOAD).execute(
			{ ref: 'e123', name: 'Resume Upload', filePaths: [''], goal: 'attach resume' },
			context
		)
		expect(result).toContain("failed to upload files to element with ref 'e123'")
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
		expect(result).toEqual({ response: 'Updated 1 page element.', snapshot: 'mocked snapshot content' })
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
		expect(result).toEqual({ response: 'Updated 1 page element.', snapshot: 'mocked snapshot content' })
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
		expect(result).toEqual({ response: "Pressed key 'Enter'.", snapshot: 'mocked snapshot content' })
	})

	it('returns runtime error message when key is empty', async () => {
		const result = await getTool(BrowserTool.TOOL_PRESS_KEY).execute({ key: '', goal: 'submit' }, context)
		expect(result).toContain("failed to press key ''")
	})

	it('captures a raw snapshot without filtering', async () => {
		const result = await getTool(BrowserTool.TOOL_SNAPSHOT).execute({ goal: 'capture current state' }, context)
		expect(result).toEqual({ response: 'Captured latest page snapshot.', snapshot: 'mocked snapshot content' })
	})

	it('waits for specified seconds', async () => {
		const result = await getTool(BrowserTool.TOOL_WAIT).execute({ seconds: 2.5, goal: 'wait for content' }, context)

		expect(mockPage.waitForTimeout).toHaveBeenCalledWith(2500)
		expect(result).toEqual({ response: 'Waited 2.5 seconds.', snapshot: 'mocked snapshot content' })
	})

	it('returns runtime error when seconds is not positive', async () => {
		const result = await getTool(BrowserTool.TOOL_WAIT).execute({ seconds: 0, goal: 'wait' }, context)
		expect(result).toContain('failed to wait for 0 seconds')
	})

	it('validates wait arguments with zod when missing', async () => {
		const result = await getTool(BrowserTool.TOOL_WAIT).execute({ goal: 'wait' }, context)
		expect(result).toContain("Invalid args for 'browser_wait'")
	})

	it('uses the selected tab for later navigation and actions', async () => {
		const secondPage = createMockPage(mockContext, 'https://second.example', 'Second')

		await getTool(BrowserTool.TOOL_SELECT_TAB).execute({ pageId: 'p2', goal: 'switch' }, context)
		await getTool(BrowserTool.TOOL_NAVIGATE).execute({ url: 'https://target.example', goal: 'go' }, context)
		await getTool(BrowserTool.TOOL_PRESS_KEY).execute({ key: 'Enter', goal: 'submit' }, context)

		expect(secondPage.goto).toHaveBeenCalledWith('https://target.example')
		expect(secondPage.keyboard.press).toHaveBeenCalledWith('Enter')
		expect(mockPage.goto).not.toHaveBeenCalled()
	})

	it('lists tabs with stable ids, titles, urls, and active marker', async () => {
		createMockPage(mockContext, 'https://second.example', 'Second')

		const result = await getTool(BrowserTool.TOOL_LIST_TABS).execute({ goal: 'inspect tabs' }, context)

		expect(result).toContain('p1: https://example.com - Example')
		expect(result).toContain('p2 (active): https://second.example - Second')
	})

	it('selects a tab and returns a snapshot', async () => {
		const secondPage = createMockPage(mockContext, 'https://second.example', 'Second')

		const result = await getTool(BrowserTool.TOOL_SELECT_TAB).execute({ pageId: 'p2', goal: 'switch' }, context)

		expect(secondPage.bringToFront).toHaveBeenCalled()
		expect(result).toEqual({
			response: 'Selected browser tab p2: https://second.example',
			snapshot: 'mocked snapshot content',
		})
	})

	it('returns a clear error for unknown tabs', async () => {
		const result = await getTool(BrowserTool.TOOL_SELECT_TAB).execute({ pageId: 'p99', goal: 'switch' }, context)
		expect(result).toBe("Browser tab 'p99' was not found or is closed.")
	})

	it('returns a clear error for closed tabs', async () => {
		const secondPage = createMockPage(mockContext, 'https://second.example', 'Second')
		secondPage.isClosed.mockReturnValue(true)

		const result = await getTool(BrowserTool.TOOL_SELECT_TAB).execute({ pageId: 'p2', goal: 'switch' }, context)

		expect(result).toBe("Browser tab 'p2' was not found or is closed.")
	})

	it('makes a newly opened tab active and uses it for later actions', async () => {
		let popup: MockPage | null = null
		mockPage.click.mockImplementation(async () => {
			popup = createMockPage(mockContext, 'https://popup.example', 'Popup')
			popup.opener.mockResolvedValue(mockPage)
		})

		const result = await getTool(BrowserTool.TOOL_CLICK_OR_HOVER).execute(
			{ ref: 'e123', name: 'Open Popup', hover: false, goal: 'open popup' },
			context
		)
		await getTool(BrowserTool.TOOL_PRESS_KEY).execute({ key: 'Escape', goal: 'close menu' }, context)

		expect(result).toEqual({
			response:
				"Opened new tab p2: https://popup.example. Active tab is now p2.\nClicked element with ref 'e123'.",
			snapshot: 'mocked snapshot content',
		})
		expect(popup?.keyboard.press).toHaveBeenCalledWith('Escape')
		expect(mockPage.keyboard.press).not.toHaveBeenCalled()
	})

	it('falls back to the opener when the active tab closes before the next action', async () => {
		const popup = createMockPage(mockContext, 'https://popup.example', 'Popup')
		popup.opener.mockResolvedValue(mockPage)
		await getTool(BrowserTool.TOOL_SELECT_TAB).execute({ pageId: 'p2', goal: 'switch' }, context)
		popup.isClosed.mockReturnValue(true)

		await getTool(BrowserTool.TOOL_PRESS_KEY).execute({ key: 'Escape', goal: 'recover' }, context)

		expect(mockPage.bringToFront).toHaveBeenCalled()
		expect(mockPage.keyboard.press).toHaveBeenCalledWith('Escape')
		expect(popup.keyboard.press).not.toHaveBeenCalled()
	})

	it('closes the active tab and falls back to its opener', async () => {
		const popup = createMockPage(mockContext, 'https://popup.example', 'Popup')
		popup.opener.mockResolvedValue(mockPage)
		await getTool(BrowserTool.TOOL_SELECT_TAB).execute({ pageId: 'p2', goal: 'switch' }, context)
		popup.close.mockImplementation(async () => {
			popup.isClosed.mockReturnValue(true)
		})

		const result = await getTool(BrowserTool.TOOL_CLOSE_TAB).execute({ pageId: null, goal: 'close popup' }, context)

		expect(popup.close).toHaveBeenCalled()
		expect(mockPage.bringToFront).toHaveBeenCalled()
		expect(result).toEqual({
			response: 'Closed browser tab p2. Active tab is now p1: https://example.com',
			snapshot: 'mocked snapshot content',
		})
	})

	it('does not close the last remaining tab', async () => {
		const result = await getTool(BrowserTool.TOOL_CLOSE_TAB).execute({ pageId: null, goal: 'close' }, context)
		expect(result).toBe('Cannot close the last open browser tab.')
	})

	it('lists the API calls captured since the last browser action', async () => {
		const checkout = createMockNetworkRequest('POST', 'https://example.com/api/checkout')
		mockPage.click.mockImplementation(async () => {
			mockContext.emitRequest(checkout)
			mockContext.emitResponse(createMockNetworkResponse(checkout, 200, 'OK'))
		})

		await getTool(BrowserTool.TOOL_CLICK_OR_HOVER).execute(
			{ ref: 'e123', name: 'Place Order', hover: false, goal: 'place order' },
			context
		)
		const result = await getTool(BrowserTool.TOOL_NETWORK_REQUESTS).execute(
			{ static: false, goal: 'verify checkout api' },
			context
		)

		expect(result).toContain('Network requests since the last browser action')
		expect(result).toContain('1. [POST] https://example.com/api/checkout => [200] OK')
	})

	it('reports failed requests and requests still in flight', async () => {
		const pending = createMockNetworkRequest('GET', 'https://example.com/api/profile')
		const failed = createMockNetworkRequest(
			'POST',
			'https://example.com/api/track',
			'fetch',
			'net::ERR_CONNECTION_REFUSED'
		)
		mockPage.click.mockImplementation(async () => {
			mockContext.emitRequest(pending)
			mockContext.emitRequest(failed)
			mockContext.emitRequestFailed(failed)
		})

		await getTool(BrowserTool.TOOL_CLICK_OR_HOVER).execute(
			{ ref: 'e123', name: 'Place Order', hover: false, goal: 'place order' },
			context
		)
		const result = await getTool(BrowserTool.TOOL_NETWORK_REQUESTS).execute(
			{ static: false, goal: 'verify checkout api' },
			context
		)

		expect(result).toContain('1. [GET] https://example.com/api/profile => [PENDING]')
		expect(result).toContain('2. [POST] https://example.com/api/track => [FAILED] net::ERR_CONNECTION_REFUSED')
	})

	it('reports no API calls when nothing was captured', async () => {
		const result = await getTool(BrowserTool.TOOL_NETWORK_REQUESTS).execute(
			{ static: false, goal: 'verify checkout api' },
			context
		)

		expect(result).toBe('No API calls were made since the last browser action.')
	})

	it('drops requests captured before the last browser action', async () => {
		const beforeClick = createMockNetworkRequest('GET', 'https://example.com/api/cart')
		mockContext.emitRequest(beforeClick)
		mockContext.emitResponse(createMockNetworkResponse(beforeClick, 200, 'OK'))

		await getTool(BrowserTool.TOOL_CLICK_OR_HOVER).execute(
			{ ref: 'e123', name: 'Place Order', hover: false, goal: 'place order' },
			context
		)
		const result = await getTool(BrowserTool.TOOL_NETWORK_REQUESTS).execute(
			{ static: false, goal: 'verify checkout api' },
			context
		)

		expect(result).toBe('No API calls were made since the last browser action.')
	})

	it('hides static resources unless static is true', async () => {
		const api = createMockNetworkRequest('GET', 'https://example.com/api/cart')
		const stylesheet = createMockNetworkRequest('GET', 'https://example.com/app.css', 'stylesheet')
		mockPage.click.mockImplementation(async () => {
			mockContext.emitRequest(api)
			mockContext.emitResponse(createMockNetworkResponse(api, 200, 'OK'))
			mockContext.emitRequest(stylesheet)
			mockContext.emitResponse(createMockNetworkResponse(stylesheet, 200, 'OK'))
		})

		await getTool(BrowserTool.TOOL_CLICK_OR_HOVER).execute(
			{ ref: 'e123', name: 'Place Order', hover: false, goal: 'place order' },
			context
		)
		const apiOnly = await getTool(BrowserTool.TOOL_NETWORK_REQUESTS).execute(
			{ static: false, goal: 'verify api calls' },
			context
		)
		const everything = await getTool(BrowserTool.TOOL_NETWORK_REQUESTS).execute(
			{ static: true, goal: 'verify all requests' },
			context
		)

		expect(apiOnly).toContain('1. [GET] https://example.com/api/cart')
		expect(apiOnly).not.toContain('app.css')
		expect(everything).toContain('1. [GET] https://example.com/api/cart')
		expect(everything).toContain('2. [GET] https://example.com/app.css')
	})

	it('validates network request arguments with zod', async () => {
		const result = await getTool(BrowserTool.TOOL_NETWORK_REQUESTS).execute({ goal: 'verify api calls' }, context)
		expect(result).toContain("Invalid args for 'browser_network_requests'")
	})

	it('stops recording network requests after dispose', async () => {
		runtime.dispose()

		const api = createMockNetworkRequest('GET', 'https://example.com/api/cart')
		mockContext.emitRequest(api)

		const result = await getTool(BrowserTool.TOOL_NETWORK_REQUESTS).execute(
			{ static: false, goal: 'verify api calls' },
			context
		)

		expect(result).toBe('No API calls were made since the last browser action.')
	})

	it('inspects a captured network request by sequence', async () => {
		const checkout = createMockNetworkRequest('POST', 'https://example.com/api/checkout', 'fetch', null, {
			headers: { 'content-type': 'application/json' },
			postData: '{"item":"widget"}',
		})
		mockPage.click.mockImplementation(async () => {
			mockContext.emitRequest(checkout)
			mockContext.emitResponse(
				createMockNetworkResponse(checkout, 200, 'OK', {
					headers: { 'content-type': 'application/json' },
					text: '{"orderId":"ORD-8231"}',
				})
			)
		})

		await getTool(BrowserTool.TOOL_CLICK_OR_HOVER).execute(
			{ ref: 'e123', name: 'Place Order', hover: false, goal: 'place order' },
			context
		)

		const detail = await getTool(BrowserTool.TOOL_NETWORK_REQUEST).execute(
			{ sequence: 1, part: 'detail', goal: 'inspect checkout call' },
			context
		)
		expect(detail).toContain('1. [POST] https://example.com/api/checkout => [200] OK')
		expect(detail).toContain('request headers: content-type: application/json')
		expect(detail).toContain('response headers: content-type: application/json')

		const responseBody = await getTool(BrowserTool.TOOL_NETWORK_REQUEST).execute(
			{ sequence: 1, part: 'response-body', goal: 'read order id' },
			context
		)
		expect(responseBody).toContain('response body (application/json):')
		expect(responseBody).toContain('{"orderId":"ORD-8231"}')

		const requestBody = await getTool(BrowserTool.TOOL_NETWORK_REQUEST).execute(
			{ sequence: 1, part: 'request-body', goal: 'read post data' },
			context
		)
		expect(requestBody).toContain('request body:')
		expect(requestBody).toContain('{"item":"widget"}')
	})

	it('returns an error string for an unknown sequence instead of throwing', async () => {
		const result = await getTool(BrowserTool.TOOL_NETWORK_REQUEST).execute(
			{ sequence: 99, part: 'detail', goal: 'inspect missing request' },
			context
		)

		expect(result).toContain("'99'")
	})

	it('validates network request detail arguments with zod', async () => {
		const result = await getTool(BrowserTool.TOOL_NETWORK_REQUEST).execute(
			{ sequence: 1, goal: 'inspect' },
			context
		)
		expect(result).toContain("Invalid args for 'browser_network_request'")
	})
})
