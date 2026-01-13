import { describe, it, expect, beforeEach, vi } from 'vitest'
import { BrowserTool } from '../step/tool/browser-tool'
import { Page } from '@playwright/test'
import { ToolCall } from '../step/tool/openai-tool'

const trackerMocks = vi.hoisted(() => ({
	startMock: vi.fn().mockResolvedValue(undefined),
	stopMock: vi.fn().mockResolvedValue([]),
	formatTimelineMock: vi.fn().mockReturnValue(''),
}))

vi.mock('../../src/step/openai/openai-test-manager', () => ({
	logger: {
		info: vi.fn(),
		warn: vi.fn(),
		error: vi.fn(),
		debug: vi.fn(),
	},
}))

vi.mock('../../src/step/tool/page-snapshot', () => ({
	PageSnapshot: class {
		get = vi.fn().mockResolvedValue('mocked snapshot content')
	},
}))

vi.mock('../step/tool/transient-state-tracker', () => ({
	TransientStateTracker: class {
		start = trackerMocks.startMock
		stop = trackerMocks.stopMock
		formatTimeline = trackerMocks.formatTimelineMock
	},
}))

describe('BrowserTool', () => {
	let browserTool: BrowserTool
	let mockPage: Page

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
			}),
			keyboard: {
				press: vi.fn().mockResolvedValue(undefined),
			},
			waitForTimeout: vi.fn().mockResolvedValue(undefined),
		} as any

		browserTool = new BrowserTool(mockPage)
	})

	describe('constructor and function declarations', () => {
		it('should create browser tool with 6 function declarations', () => {
			expect(browserTool.functionDeclarations).toHaveLength(6)
		})

		it('should include navigate tool declaration', () => {
			const navigateTool = browserTool.functionDeclarations.find(
				(tool) => tool.function.name === BrowserTool.TOOL_NAVIGATE
			)
			expect(navigateTool).toBeDefined()
			expect(navigateTool?.function.description).toContain('Navigate')
			expect(navigateTool?.function?.parameters?.required).toContain('url')
			expect(navigateTool?.function?.parameters?.required).toContain('goal')
		})

		it('should include click tool declaration', () => {
			const clickTool = browserTool.functionDeclarations.find(
				(tool) => tool.function.name === BrowserTool.TOOL_CLICK_OR_HOVER
			)
			expect(clickTool).toBeDefined()
			expect(clickTool?.function?.parameters?.required).toContain('ref')
			expect(clickTool?.function?.parameters?.required).toContain('name')
			expect(clickTool?.function?.parameters?.required).toContain('hover')
			expect(clickTool?.function?.parameters?.required).toContain('goal')
		})

		it('should include type tool declaration', () => {
			const typeTool = browserTool.functionDeclarations.find(
				(tool) => tool.function.name === BrowserTool.TOOL_TYPE_OR_SELECT
			)
			expect(typeTool).toBeDefined()
			expect(typeTool?.function?.parameters?.required).toContain('elements')
			expect(typeTool?.function?.parameters?.required).toContain('goal')
		})

		it('should include press key tool declaration', () => {
			const pressKeyTool = browserTool.functionDeclarations.find(
				(tool) => tool.function.name === BrowserTool.TOOL_PRESS_KEY
			)
			expect(pressKeyTool).toBeDefined()
			expect(pressKeyTool?.function?.parameters?.required).toContain('key')
			expect(pressKeyTool?.function?.parameters?.required).toContain('goal')
		})

		it('should include snapshot tool declaration', () => {
			const snapshotTool = browserTool.functionDeclarations.find(
				(tool) => tool.function.name === BrowserTool.TOOL_SNAPSHOT
			)
			expect(snapshotTool).toBeDefined()
			expect(snapshotTool?.function?.parameters?.required).toContain('goal')
		})

		it('should include wait tool declaration', () => {
			const waitTool = browserTool.functionDeclarations.find(
				(tool) => tool.function.name === BrowserTool.TOOL_WAIT
			)
			expect(waitTool).toBeDefined()
			expect(waitTool?.function?.parameters?.required).toContain('seconds')
			expect(waitTool?.function?.parameters?.required).toContain('goal')
		})
	})

	describe('call method - error handling', () => {
		it('should throw error when tool name is missing', async () => {
			const toolCall: ToolCall = {
				name: undefined as any,
				arguments: {},
			}

			await expect(browserTool.call(toolCall)).rejects.toThrow('Tool name is required')
		})

		it('should return error message for unimplemented tool', async () => {
			const toolCall: ToolCall = {
				name: 'unknown_tool',
				arguments: {},
			}

			const result = await browserTool.call(toolCall)
			expect(result).toContain('Browser tool not implemented: unknown_tool')
		})
	})

	describe('navigate', () => {
		it('should navigate to URL and capture snapshot', async () => {
			const toolCall: ToolCall = {
				name: BrowserTool.TOOL_NAVIGATE,
				arguments: { url: 'https://example.com', goal: 'test' },
			}

			const result = await browserTool.call(toolCall)

			expect(mockPage.goto).toHaveBeenCalledWith('https://example.com')
			expect(result).toBe('mocked snapshot content')
		})

		it('should throw error when URL is missing', async () => {
			const toolCall: ToolCall = {
				name: BrowserTool.TOOL_NAVIGATE,
				arguments: { url: '', goal: 'test' },
			}

			await expect(browserTool.call(toolCall)).rejects.toThrow('valid URL is required')
		})

		it('should throw error when URL is undefined', async () => {
			const toolCall: ToolCall = {
				name: BrowserTool.TOOL_NAVIGATE,
				arguments: { goal: 'test' },
			}

			await expect(browserTool.call(toolCall)).rejects.toThrow('valid URL is required')
		})

		it('should handle navigation errors', async () => {
			vi.mocked(mockPage.goto).mockRejectedValue(new Error('Network error'))

			const toolCall: ToolCall = {
				name: BrowserTool.TOOL_NAVIGATE,
				arguments: { url: 'https://example.com', goal: 'test' },
			}

			await expect(browserTool.call(toolCall)).rejects.toThrow('Failed to navigate to URL')
		})
	})

	describe('click', () => {
		it('should click element and capture snapshot', async () => {
			const toolCall: ToolCall = {
				name: BrowserTool.TOOL_CLICK_OR_HOVER,
				arguments: { ref: 'e123', name: 'Submit Button', hover: false, goal: 'submit form' },
			}

			const result = await browserTool.call(toolCall)

			expect(mockPage.click).toHaveBeenCalledWith('aria-ref=e123')
			expect(result).toBe('mocked snapshot content')
		})

		it('should hover element when hover is true (via tool call)', async () => {
			const toolCall: ToolCall = {
				name: BrowserTool.TOOL_CLICK_OR_HOVER,
				arguments: { ref: 'e321', name: 'Menu', hover: true, goal: 'open menu' },
			}

			const result = await browserTool.call(toolCall)

			expect(mockPage.hover).toHaveBeenCalledWith('aria-ref=e321')
			expect(mockPage.click).not.toHaveBeenCalled()
			expect(result).toBe('mocked snapshot content')
		})

		it('should hover element when hover is true', async () => {
			const result = await (browserTool as any).clickElement('e321', true)

			expect(mockPage.hover).toHaveBeenCalledWith('aria-ref=e321')
			expect(result).toBe('mocked snapshot content')
		})

		it('should include transient state timeline when available', async () => {
			trackerMocks.formatTimelineMock.mockReturnValueOnce('timeline: click flow')

			const toolCall: ToolCall = {
				name: BrowserTool.TOOL_CLICK_OR_HOVER,
				arguments: { ref: 'e123', name: 'Submit Button', hover: false, goal: 'submit form' },
			}

			const result = await browserTool.call(toolCall)

			expect(result).toBe('timeline: click flow\nmocked snapshot content')
		})

		it('should return error message on click failure', async () => {
			vi.mocked(mockPage.click).mockRejectedValue(new Error('Element not found'))

			const toolCall: ToolCall = {
				name: BrowserTool.TOOL_CLICK_OR_HOVER,
				arguments: { ref: 'e999', name: 'Button', hover: false, goal: 'click' },
			}

			const result = await browserTool.call(toolCall)

			expect(result).toContain("failed to click element with ref 'e999'")
			expect(result).toContain('try with different element type or ref')
		})
	})

	describe('type', () => {
		it('should type text into element and capture snapshot', async () => {
			const toolCall: ToolCall = {
				name: BrowserTool.TOOL_TYPE_OR_SELECT,
				arguments: {
					elements: [{ ref: 'e456', text: 'Hello World', name: 'Input', clear: true }],
					goal: 'enter text',
				},
			}

			const result = await browserTool.call(toolCall)

			expect(mockPage.locator).toHaveBeenCalledWith('aria-ref=e456')
			expect(mockPage.locator('aria-ref=e456').clear).toHaveBeenCalledOnce()
			expect(mockPage.locator('aria-ref=e456').pressSequentially).toHaveBeenCalledWith('Hello World', {
				delay: 50,
			})
			expect(result).toBe('mocked snapshot content')
		})

		it('should support empty string to clear existing text', async () => {
			const toolCall: ToolCall = {
				name: BrowserTool.TOOL_TYPE_OR_SELECT,
				arguments: {
					elements: [{ ref: 'e456', text: '', name: 'Input', clear: true }],
					goal: 'clear text',
				},
			}

			const result = await browserTool.call(toolCall)

			expect(mockPage.locator).toHaveBeenCalledWith('aria-ref=e456')
			expect(mockPage.locator('aria-ref=e456').clear).toHaveBeenCalledOnce()
			expect(mockPage.locator('aria-ref=e456').pressSequentially).not.toHaveBeenCalled()
			expect(result).toBe('mocked snapshot content')
		})

		it('should return error message when ref is missing', async () => {
			const toolCall: ToolCall = {
				name: BrowserTool.TOOL_TYPE_OR_SELECT,
				arguments: {
					elements: [{ ref: '', text: 'Hello', name: 'Input', clear: true }],
					goal: 'enter text',
				},
			}

			const result = await browserTool.call(toolCall)
			expect(result).toContain("failed to type 'Hello' in element with ref ''")
			expect(result).toContain("both 'ref' and 'text' are required")
		})

		it('should return error message when text is missing', async () => {
			const toolCall: ToolCall = {
				name: BrowserTool.TOOL_TYPE_OR_SELECT,
				arguments: {
					elements: [{ ref: 'e456', text: undefined as any, name: 'Input', clear: true }],
					goal: 'enter text',
				},
			}

			const result = await browserTool.call(toolCall)
			expect(result).toContain("failed to type 'undefined' in element with ref 'e456'")
			expect(result).toContain("both 'ref' and 'text' are required")
		})

		it('should return error message on type failure', async () => {
			vi.mocked(mockPage.locator).mockReturnValue({
				clear: vi.fn().mockResolvedValue(undefined),
				pressSequentially: vi.fn().mockRejectedValue(new Error('Element not found')),
			} as any)

			const toolCall: ToolCall = {
				name: BrowserTool.TOOL_TYPE_OR_SELECT,
				arguments: {
					elements: [{ ref: 'e999', text: 'test', name: 'Input', clear: true }],
					goal: 'enter text',
				},
			}

			const result = await browserTool.call(toolCall)

			expect(result).toContain("failed to type 'test' in element with ref 'e999'")
			expect(result).toContain('try with different element type or ref')
		})
	})

	describe('select', () => {
		it('should select option from dropdown', async () => {
			const toolCall: ToolCall = {
				name: BrowserTool.TOOL_TYPE_OR_SELECT,
				arguments: {
					elements: [{ ref: 'e789', text: 'Option 2', name: 'Dropdown', clear: false, select: true }],
					goal: 'select option',
				},
			}

			const result = await browserTool.call(toolCall)

			expect(mockPage.locator).toHaveBeenCalledWith('aria-ref=e789')
			expect(mockPage.locator('aria-ref=e789').selectOption).toHaveBeenCalledWith('Option 2')
			expect(mockPage.locator('aria-ref=e789').clear).not.toHaveBeenCalled()
			expect(result).toBe('mocked snapshot content')
		})

		it('should not clear before selecting when select is true', async () => {
			const toolCall: ToolCall = {
				name: BrowserTool.TOOL_TYPE_OR_SELECT,
				arguments: {
					elements: [{ ref: 'e789', text: 'Option 1', name: 'Dropdown', clear: true, select: true }],
					goal: 'select option',
				},
			}

			const result = await browserTool.call(toolCall)

			expect(mockPage.locator('aria-ref=e789').clear).not.toHaveBeenCalled()
			expect(mockPage.locator('aria-ref=e789').selectOption).toHaveBeenCalledWith('Option 1')
		})

		it('should skip empty text when selecting', async () => {
			const toolCall: ToolCall = {
				name: BrowserTool.TOOL_TYPE_OR_SELECT,
				arguments: {
					elements: [{ ref: 'e789', text: '', name: 'Dropdown', clear: false, select: true }],
					goal: 'select option',
				},
			}

			const result = await browserTool.call(toolCall)

			expect(mockPage.locator('aria-ref=e789').selectOption).not.toHaveBeenCalled()
			expect(result).toBe('mocked snapshot content')
		})

		it('should handle multiple elements with mixed type and select', async () => {
			const toolCall: ToolCall = {
				name: BrowserTool.TOOL_TYPE_OR_SELECT,
				arguments: {
					elements: [
						{ ref: 'e456', text: 'John', name: 'Name Input', clear: true, select: false },
						{ ref: 'e789', text: 'USA', name: 'Country Dropdown', clear: false, select: true },
					],
					goal: 'fill form',
				},
			}

			const result = await browserTool.call(toolCall)

			expect(mockPage.locator).toHaveBeenCalledWith('aria-ref=e456')
			expect(mockPage.locator).toHaveBeenCalledWith('aria-ref=e789')
			expect(mockPage.locator('aria-ref=e456').clear).toHaveBeenCalledOnce()
			expect(mockPage.locator('aria-ref=e456').pressSequentially).toHaveBeenCalledWith('John', { delay: 50 })
			expect(mockPage.locator('aria-ref=e789').selectOption).toHaveBeenCalledWith('USA')
			expect(result).toBe('mocked snapshot content')
		})

		it('should return error message on select failure', async () => {
			vi.mocked(mockPage.locator).mockReturnValue({
				selectOption: vi.fn().mockRejectedValue(new Error('Option not found')),
			} as any)

			const toolCall: ToolCall = {
				name: BrowserTool.TOOL_TYPE_OR_SELECT,
				arguments: {
					elements: [{ ref: 'e999', text: 'Invalid Option', name: 'Dropdown', clear: false, select: true }],
					goal: 'select option',
				},
			}

			const result = await browserTool.call(toolCall)

			expect(result).toContain("failed to select 'Invalid Option' in element with ref 'e999'")
			expect(result).toContain('try with different element type or ref')
		})

		it('should return error message when elements array is empty', async () => {
			const toolCall: ToolCall = {
				name: BrowserTool.TOOL_TYPE_OR_SELECT,
				arguments: {
					elements: [],
					goal: 'fill form',
				},
			}

			const result = await browserTool.call(toolCall)

			expect(result).toContain('failed to type text or select option')
			expect(result).toContain('Invalid parameters received')
		})

		it('should return error message when elements is not an array', async () => {
			const toolCall: ToolCall = {
				name: BrowserTool.TOOL_TYPE_OR_SELECT,
				arguments: {
					elements: 'not an array' as any,
					goal: 'fill form',
				},
			}

			const result = await browserTool.call(toolCall)

			expect(result).toContain('failed to type text or select option')
			expect(result).toContain('Invalid parameters received')
		})
	})

	describe('pressKey', () => {
		it('should press key and capture snapshot', async () => {
			const toolCall: ToolCall = {
				name: BrowserTool.TOOL_PRESS_KEY,
				arguments: { key: 'Enter', goal: 'submit' },
			}

			const result = await browserTool.call(toolCall)

			expect(mockPage.keyboard.press).toHaveBeenCalledWith('Enter')
			expect(result).toBe('mocked snapshot content')
		})

		it('should throw error when key is missing', async () => {
			const toolCall: ToolCall = {
				name: BrowserTool.TOOL_PRESS_KEY,
				arguments: { key: '', goal: 'submit' },
			}

			await expect(browserTool.call(toolCall)).rejects.toThrow("'key' is required")
		})

		it('should handle press key errors', async () => {
			vi.mocked(mockPage.keyboard.press).mockRejectedValue(new Error('Key not recognized'))

			const toolCall: ToolCall = {
				name: BrowserTool.TOOL_PRESS_KEY,
				arguments: { key: 'InvalidKey', goal: 'test' },
			}

			await expect(browserTool.call(toolCall)).rejects.toThrow("Failed to press key 'InvalidKey'")
		})
	})

	describe('snapshot', () => {
		it('should capture snapshot', async () => {
			const toolCall: ToolCall = {
				name: BrowserTool.TOOL_SNAPSHOT,
				arguments: { goal: 'capture current state' },
			}

			const result = await browserTool.call(toolCall)

			expect(result).toBe('mocked snapshot content')
		})
	})

	describe('wait', () => {
		it('should wait for specified seconds and capture snapshot', async () => {
			const toolCall: ToolCall = {
				name: BrowserTool.TOOL_WAIT,
				arguments: { seconds: 5, goal: 'wait for animation' },
			}

			const result = await browserTool.call(toolCall)

			expect(mockPage.waitForTimeout).toHaveBeenCalledWith(5000)
			expect(result).toBe('mocked snapshot content')
		})

		it('should convert seconds to milliseconds correctly', async () => {
			const toolCall: ToolCall = {
				name: BrowserTool.TOOL_WAIT,
				arguments: { seconds: 2.5, goal: 'wait for content' },
			}

			const result = await browserTool.call(toolCall)

			expect(mockPage.waitForTimeout).toHaveBeenCalledWith(2500)
			expect(result).toBe('mocked snapshot content')
		})

		it('should return error message when seconds is zero', async () => {
			const toolCall: ToolCall = {
				name: BrowserTool.TOOL_WAIT,
				arguments: { seconds: 0, goal: 'wait' },
			}

			const result = await browserTool.call(toolCall)

			expect(result).toContain('failed to wait')
			expect(result).toContain('invalid seconds value received: 0')
			expect(mockPage.waitForTimeout).not.toHaveBeenCalled()
		})

		it('should return error message when seconds is negative', async () => {
			const toolCall: ToolCall = {
				name: BrowserTool.TOOL_WAIT,
				arguments: { seconds: -5, goal: 'wait' },
			}

			const result = await browserTool.call(toolCall)

			expect(result).toContain('failed to wait')
			expect(result).toContain('invalid seconds value received: -5')
			expect(mockPage.waitForTimeout).not.toHaveBeenCalled()
		})

		it('should return error message when seconds is undefined', async () => {
			const toolCall: ToolCall = {
				name: BrowserTool.TOOL_WAIT,
				arguments: { goal: 'wait' },
			}

			const result = await browserTool.call(toolCall)

			expect(result).toContain('failed to wait')
			expect(result).toContain('invalid seconds value')
			expect(mockPage.waitForTimeout).not.toHaveBeenCalled()
		})

		it('should include transient state timeline when available', async () => {
			trackerMocks.formatTimelineMock.mockReturnValueOnce('timeline: wait period')

			const toolCall: ToolCall = {
				name: BrowserTool.TOOL_WAIT,
				arguments: { seconds: 3, goal: 'wait for load' },
			}

			const result = await browserTool.call(toolCall)

			expect(result).toBe('timeline: wait period\nmocked snapshot content')
		})
	})

	describe('tool name constants', () => {
		it('should have correct tool name constants', () => {
			expect(BrowserTool.TOOL_NAVIGATE).toBe('browser_navigate')
			expect(BrowserTool.TOOL_CLICK_OR_HOVER).toBe('browser_click_or_hover')
			expect(BrowserTool.TOOL_TYPE_OR_SELECT).toBe('browser_type_or_select')
			expect(BrowserTool.TOOL_PRESS_KEY).toBe('browser_press_key')
			expect(BrowserTool.TOOL_SNAPSHOT).toBe('browser_snapshot')
			expect(BrowserTool.TOOL_WAIT).toBe('browser_wait')
		})
	})
})
