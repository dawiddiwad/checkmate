import { ChatCompletionFunctionTool } from "openai/resources"
import { OpenAITool, ToolCall } from "./openai-tool"
import { expect, Page } from "@playwright/test"
import { PageSnapshot } from "./page-snapshot"
import { logger } from "../openai/openai-test-manager"
import { TransientStateTracker } from "./transient-state-tracker"

export class BrowserTool implements OpenAITool {
    static readonly TOOL_NAVIGATE = 'browser_navigate'
    static readonly TOOL_CLICK = 'browser_click'
    static readonly TOOL_TYPE = 'browser_type'
    static readonly TOOL_PRESS_KEY = 'browser_press_key'
    static readonly TOOL_SNAPSHOT = 'browser_snapshot'
    private readonly page: Page
    private readonly pageSnapshot: PageSnapshot

    functionDeclarations: ChatCompletionFunctionTool[]
    constructor(page: Page) {
        this.page = page
        this.pageSnapshot = new PageSnapshot(page)
        this.functionDeclarations = [
            {
                type: 'function',
                function: {
                    name: BrowserTool.TOOL_NAVIGATE,
                    description: 'Navigate to a specified URL in the browser, example: https://www.example.com',
                    parameters: {
                        type: 'object',
                        properties: {
                            url: { type: 'string', description: 'The URL to navigate to' },
                            goal: { type: 'string', description: 'The goal or purpose of navigating to this URL' }
                        },
                        additionalProperties: false,
                        required: ['url', 'goal']
                    },
                    strict: true
                }
            },
            {
                type: 'function',
                function: {
                    name: BrowserTool.TOOL_CLICK,
                    description: 'Click or hover a specified element reference in the browser',
                    parameters: {
                        type: 'object',
                        properties: {
                            ref: { type: 'string', description: 'ref value of the element from the snapshot, example: e123' },
                            name: { type: 'string', description: 'name of the element to click or hover, example: Submit Button' },
                            hover: { type: 'boolean', description: 'If true, hover the element instead of clicking it' },
                            goal: { type: 'string', description: 'The goal or purpose of clicking this element' }
                        },
                        additionalProperties: false,
                        required: ['ref', 'name', 'hover', 'goal']
                    },
                    strict: true
                }
            },
            {
                type: 'function',
                function: {
                    name: BrowserTool.TOOL_TYPE,
                    description: 'Type text into a specified element reference in the browser. You can also use it to select options in dropdowns - just type the option text. To clear existing text, use empty string.',
                    parameters: {
                        type: 'object',
                        properties: {
                            ref: { type: 'string', description: 'ref value of the element from the snapshot, example: e123' },
                            text: { type: 'string', description: 'The text to type into the element, example: Hello World' },
                            name: { type: 'string', description: 'name of the element to type into, example: Username Input' },
                            goal: { type: 'string', description: 'The goal or purpose of typing this text into the element' }
                        },
                        additionalProperties: false,
                        required: ['ref', 'text', 'name', 'goal']
                    },
                    strict: true
                }
            },
            {
                type: 'function',
                function: {
                    name: BrowserTool.TOOL_PRESS_KEY,
                    description: 'Press a specified key in the browser',
                    parameters: {
                        type: 'object',
                        properties: {
                            key: { type: 'string', description: 'The key to press, example: Enter, Escape, ArrowDown' },
                            goal: { type: 'string', description: 'The goal or purpose of pressing this key' }
                        },
                        additionalProperties: false,
                        required: ['key', 'goal']
                    },
                    strict: true
                }
            },
            {
                type: 'function',
                function: {
                    name: BrowserTool.TOOL_SNAPSHOT,
                    description: 'Capture the ARIA snapshot of the current page',
                    parameters: {
                        type: 'object',
                        properties: {
                            goal: { type: 'string', description: 'The goal or purpose of capturing the snapshot' }
                        },
                        additionalProperties: false,
                        required: ['goal']
                    },
                    strict: true
                }
            }
        ]
    }

    async call(specified: ToolCall, ...args: any[]) {
        if (!specified.name) {
            throw new Error(`Tool name is required, received call\n: ${JSON.stringify(specified, null, 2)}`)
        }
        if (specified.name === BrowserTool.TOOL_NAVIGATE) {
            return this.navigateToUrl(specified.arguments?.url as string)
        } else if (specified.name === BrowserTool.TOOL_SNAPSHOT) {
            return this.captureSnapshot()
        } else if (specified.name === BrowserTool.TOOL_CLICK) {
            return this.clickElement(specified.arguments?.ref as string)
        } else if (specified.name === BrowserTool.TOOL_TYPE) {
            return this.typeInElement(specified.arguments?.ref as string, specified.arguments?.text as string)
        } else if (specified.name === BrowserTool.TOOL_PRESS_KEY) {
            return this.pressKey(specified.arguments?.key as string)
        } else {
            throw new Error(`Browser tool not implemented: ${specified.name}`)
        }
    }

    private async captureSnapshot() {
        try {
            await expect.poll(async () => {
                const getRawSnapshot = async () => await this.page.locator('html').innerHTML()
                const reference_1 = await getRawSnapshot()
                await this.page.waitForTimeout(500)
                const reference_2 = await getRawSnapshot()
                const difference = reference_1 !== reference_2
                return difference ? 'not stable' : 'stable'
            }, {
                timeout: 30_000,
                message: 'page snapshots should be stable'
            }).toEqual('stable')
            return this.pageSnapshot.get()
        } catch (error) {
            throw new Error(`Failed to capture page snapshot:\n${error}`)
        }
    }

    private async wrapWithTracker(action: () => Promise<any>): Promise<string> {
        const tracker = new TransientStateTracker(this.page)
        await tracker.start()
        try {
            const actionResult = await action()
            if (typeof actionResult === 'string' && actionResult.startsWith('failed to')) {
                await tracker.stop()
                return actionResult
            }
            const snapshot = await this.captureSnapshot()
            await tracker.stop()
            const formattedTimeline = tracker.formatTimeline()
            return formattedTimeline ? `${formattedTimeline}\n${snapshot}` : snapshot
        } catch (error) {
            await tracker.stop()
            throw error
        }
    }

    private async navigateToUrl(url: string) {
        return this.wrapWithTracker(async () => {
            try {
                if (!url) {
                    throw new Error(`valid URL is required for ${BrowserTool.TOOL_NAVIGATE} but received: '${url}'`)
                }
                await this.page.goto(url)
            } catch (error) {
                throw new Error(`Failed to navigate to URL ${url}:\n${error}`)
            }
        })
    }

    private async clickElement(ref: string, hover: boolean = false) {
        return this.wrapWithTracker(async () => {
            try {
                if (hover) {
                    await this.page.hover(`aria-ref=${ref}`)
                } else {
                    await this.page.click(`aria-ref=${ref}`)
                }
            } catch (error) {
                logger.error(`error clicking element with ref '${ref}' due to:\n${error}`)
                return `failed to click element with ref '${ref}':\n${error} try with different element type or ref`
            }
        })
    }

    private async typeInElement(ref: string, text: string) {
        return this.wrapWithTracker(async () => {
            try {
                if (!ref || !text) {
                    throw new Error(`both 'ref' and 'text' are required for ${BrowserTool.TOOL_TYPE} but received ref='${ref}' and text='${text}'`)
                }
                await this.page.locator(`aria-ref=${ref}`).clear()
                await this.page.locator(`aria-ref=${ref}`).pressSequentially(text, { delay: 50 })
            } catch (error) {
                logger.error(`error typing text '${text}' in element with ref '${ref}' due to:\n${error}`)
                return `failed to type text '${text}' in element with ref '${ref}':\n${error}\n try with different element type or ref`
            }
        })
    }

    private async pressKey(key: string) {
        return this.wrapWithTracker(async () => {
            try {
                if (!key) {
                    throw new Error(`'key' is required for ${BrowserTool.TOOL_PRESS_KEY} but received: '${key}'`)
                }
                await this.page.keyboard.press(key)
            } catch (error) {
                throw new Error(`Failed to press key '${key}':\n${error}`)
            }
        })
    }
}