import { Page } from '@playwright/test'
import { describe, expect, it, vi } from 'vitest'
import { RuntimeConfig } from '../config/runtime-config'
import { ExtensionHost } from '../runtime/extension'
import { ToolRegistry } from '../tools/registry'
import { web } from '../playwright'
import { createMockBrowserContext, MockBrowserContext, MockLocator, MockPage } from './test-types'

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
	it('captures post-tool screenshots from the active page after a tab switch', async () => {
		vi.clearAllMocks()
		const context = createMockBrowserContext()
		const page = createMockPage(context)
		const extension = web({ page: page as unknown as Page })
		const activePage = createMockPage(context)
		const host = new ExtensionHost(
			{ includeScreenshotInSnapshot: () => true } as RuntimeConfig,
			{ register: vi.fn() } as unknown as ToolRegistry,
			[extension]
		)
		const aiClient = {
			getRuntimeConfig: () => ({ includeScreenshotInSnapshot: () => true }),
			addCurrentSnapshotMessage: vi.fn(),
			addCurrentScreenshotMessage: vi.fn(),
		}

		await host.handleToolResponses({
			aiClient: aiClient as never,
			step: { action: 'act', expect: 'done' },
			resolveStepResult: vi.fn(),
			toolResponses: [{ toolResponse: { response: 'ok' } }] as never,
		})

		expect(screenshotMocks.constructorMock).toHaveBeenCalledWith(activePage)
		expect(aiClient.addCurrentScreenshotMessage).toHaveBeenCalledWith('image-data', 'image/png')
	})
})
