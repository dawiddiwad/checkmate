import { Page } from '@playwright/test'
import { describe, expect, it, vi } from 'vitest'
import { testConfig } from './test-types'
import { ExtensionHost } from '../runtime/extension'
import { ToolRegistry } from '../tools/registry'
import { web } from '../playwright'
import { MockBrowserContext, MockLocator, MockPage } from './test-types'

const screenshotMocks = vi.hoisted(() => ({
	constructorMock: vi.fn(),
	getCompressedScreenshotMock: vi.fn().mockResolvedValue({ data: 'image-data', mimeType: 'image/png' }),
}))

vi.mock('../tools/browser/screenshot-service', () => ({
	BrowserScreenshotService: class {
		constructor(page: Page) {
			screenshotMocks.constructorMock(page)
		}

		getCompressedScreenshot = screenshotMocks.getCompressedScreenshotMock
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
		off: vi.fn((_event: string, handler: (page: MockPage) => void) => {
			const index = handlers.indexOf(handler)
			if (index >= 0) {
				handlers.splice(index, 1)
			}
			return context
		}),
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
		locator: vi.fn().mockReturnValue({
			clear: vi.fn().mockResolvedValue(undefined),
			pressSequentially: vi.fn().mockResolvedValue(undefined),
			selectOption: vi.fn().mockResolvedValue(undefined),
			dragTo: vi.fn().mockResolvedValue(undefined),
			setInputFiles: vi.fn().mockResolvedValue(undefined),
			innerHTML: vi.fn().mockResolvedValue('<html>content</html>'),
		} as MockLocator),
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

describe('Playwright web extension', () => {
	it('returns a fresh snapshot and screenshot from the active page after a tab switch', async () => {
		vi.clearAllMocks()
		const context = createMockContext()
		const page = createMockPage(context)
		const extension = web({ page: page as unknown as Page })
		const host = new ExtensionHost(
			testConfig({ checkmateScreenshots: true }),
			{ register: vi.fn() } as unknown as ToolRegistry,
			[extension]
		)
		const activePage = createMockPage(context)

		const contextMessages = await host.handleToolResponses({
			step: { action: 'act', expect: 'done' },
			turn: 1,
			toolResponses: [{ toolResponse: { response: 'ok', snapshot: 'page snapshot' } }] as never,
		})

		expect(screenshotMocks.constructorMock).toHaveBeenCalledWith(activePage)
		expect(contextMessages).toHaveLength(2)
		expect(contextMessages.every((message) => message.ephemeral)).toBe(true)
		expect(JSON.stringify(contextMessages[0].message)).toContain('page snapshot')
		expect(JSON.stringify(contextMessages[1].message)).toContain('data:image/png;base64,image-data')
	})

	it('returns no context when there is no snapshot and screenshots are disabled', async () => {
		vi.clearAllMocks()
		const context = createMockContext()
		const page = createMockPage(context)
		const host = new ExtensionHost(
			testConfig({ checkmateScreenshots: false }),
			{ register: vi.fn() } as unknown as ToolRegistry,
			[web({ page: page as unknown as Page })]
		)

		const contextMessages = await host.handleToolResponses({
			step: { action: 'act', expect: 'done' },
			turn: 2,
			toolResponses: [{ toolResponse: { response: 'ok', snapshot: null } }] as never,
		})

		expect(contextMessages).toEqual([])
		expect(screenshotMocks.constructorMock).not.toHaveBeenCalled()
	})
})
