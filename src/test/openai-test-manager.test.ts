import { describe, it, expect, beforeEach, vi } from 'vitest'
import { OpenAITestManager } from '../step/openai/openai-test-manager'
import { Step } from '../step/types'
import { Page } from '@playwright/test'

// Mock all dependencies
vi.mock('../../src/step/configuration-manager', () => ({
    ConfigurationManager: class {
        getLogLevel = vi.fn().mockReturnValue('off')
        getApiKey = vi.fn().mockReturnValue('test-key')
        getBaseURL = vi.fn().mockReturnValue(undefined)
        getModel = vi.fn().mockReturnValue('gpt-4o-mini')
        getTimeout = vi.fn().mockReturnValue(60000)
        getMaxRetries = vi.fn().mockReturnValue(3)
        getTemperature = vi.fn().mockReturnValue(1)
    },
}))

vi.mock('../../src/step/logger', () => ({
    CheckmateLogger: {
        create: vi.fn().mockReturnValue({
            info: vi.fn(),
            warn: vi.fn(),
            error: vi.fn(),
            debug: vi.fn(),
        }),
    },
}))

vi.mock('../../src/step/tool/step-tool', () => ({
    StepTool: class {
        functionDeclarations = []
    },
}))

vi.mock('../../src/step/tool/browser-tool', () => ({
    BrowserTool: class {
        functionDeclarations = []
    },
}))

vi.mock('../../src/salesforce/salesforce-tool', () => ({
    SalesforceTool: class {
        functionDeclarations = []
    },
}))

vi.mock('../../src/step/tool/tool-registry', () => ({
    ToolRegistry: class {
        getTools = vi.fn().mockResolvedValue([])
    },
}))

vi.mock('../../src/step/openai/openai-client', () => ({
    OpenAIClient: class {
        initialize = vi.fn().mockResolvedValue(undefined)
        sendMessage = vi.fn().mockResolvedValue(undefined)
    },
}))

let addInitialSnapshotInstance: any

vi.mock('../../src/step/openai/history-manager', () => {
    class MockHistoryManager {
        addInitialSnapshot = vi.fn()
        constructor() {
            addInitialSnapshotInstance = this
        }
    }

    return {
        HistoryManager: MockHistoryManager,
        getAddInitialSnapshotMock: () => addInitialSnapshotInstance?.addInitialSnapshot,
    }
})

vi.mock('../../src/step/tool/page-snapshot', () => ({
    PageSnapshot: {
        lastSnapshot: null,
    },
}))

vi.mock('../../src/step/openai/prompts', () => ({
    RUN_STEP_PROMPT: vi.fn((step) => `Execute: ${step.action}`),
}))

describe('OpenAITestManager', () => {
    let testManager: OpenAITestManager
    let mockPage: Page

    beforeEach(() => {
        mockPage = {} as any
        testManager = new OpenAITestManager(mockPage)
    })

    describe('constructor', () => {
        it('should create test manager instance', () => {
            expect(testManager).toBeDefined()
        })
    })

    describe('teardown', () => {
        it('should complete teardown without error', async () => {
            await expect(testManager.teardown()).resolves.toBeUndefined()
        })
    })

    describe('run', () => {
        let mockStep: Step

        beforeEach(() => {
            mockStep = {
                action: 'Click the submit button',
                expect: 'Button should be clicked',
            }

            // Create a fresh testManager for each test
            testManager = new OpenAITestManager(mockPage)
        })

        it('should successfully run when step passes', async () => {
            // Mock the OpenAIClient to call the callback with success
            const mockClient = (testManager as any).openaiClient
            mockClient.initialize.mockImplementation((step: Step, callback: any) => {
                setTimeout(() => callback({ passed: true, actual: 'Success' }), 0)
                return Promise.resolve()
            })

            await expect(testManager.run(mockStep)).resolves.toBeUndefined()
            expect(mockClient.initialize).toHaveBeenCalled()
            expect(mockClient.sendMessage).toHaveBeenCalled()
        })

        it('should throw error when step fails', async () => {
            const mockClient = (testManager as any).openaiClient
            mockClient.initialize.mockImplementation((step: Step, callback: any) => {
                setTimeout(() => callback({ passed: false, actual: 'Button not found' }), 0)
                return Promise.resolve()
            })

            await expect(testManager.run(mockStep)).rejects.toThrow()
        })

        it('should include step action in error message when failing', async () => {
            const mockClient = (testManager as any).openaiClient
            mockClient.initialize.mockImplementation((step: Step, callback: any) => {
                setTimeout(() => callback({ passed: false, actual: 'Failed' }), 0)
                return Promise.resolve()
            })

            try {
                await testManager.run(mockStep)
                expect.fail('Should have thrown error')
            } catch (error: any) {
                expect(error.message).toContain('Click the submit button')
            }
        })

        it('should wrap errors from OpenAI client', async () => {
            const mockClient = (testManager as any).openaiClient
            mockClient.initialize.mockRejectedValue(new Error('API Error'))

            try {
                await testManager.run(mockStep)
                expect.fail('Should have thrown error')
            } catch (error: any) {
                expect(error.message).toContain('Failed to execute action')
                expect(error.message).toContain('Click the submit button')
                expect(error.message).toContain('API Error')
            }
        })

        it('should handle sendMessage errors', async () => {
            const mockClient = (testManager as any).openaiClient
            mockClient.initialize.mockResolvedValue(undefined)
            mockClient.sendMessage.mockRejectedValue(new Error('Send failed'))

            try {
                await testManager.run(mockStep)
                expect.fail('Should have thrown error')
            } catch (error: any) {
                expect(error.message).toContain('Failed to execute action')
            }
        })

        it('should add initial snapshot when present before sending first message', async () => {
            const mockClient = (testManager as any).openaiClient
            mockClient.initialize.mockImplementation((step: Step, callback: any) => {
                setTimeout(() => callback({ passed: true, actual: 'Success' }), 0)
                return Promise.resolve()
            })

            const { PageSnapshot } = await import('../../src/step/tool/page-snapshot')
            const historyModule: any = await import('../../src/step/openai/history-manager')

            PageSnapshot.lastSnapshot = { html: '<div>snap</div>' } as any

            await expect(testManager.run(mockStep)).resolves.toBeUndefined()

            expect(historyModule.getAddInitialSnapshotMock()).toHaveBeenCalled()

            PageSnapshot.lastSnapshot = null
        })
    })
})
