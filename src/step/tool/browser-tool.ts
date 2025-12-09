import { ChatCompletionFunctionTool } from "openai/resources"
import { OpenAITool, ToolCallArgs } from "../../mcp/tool/openai-tool"
import { Page } from "@playwright/test"
import AriaSnapshotMapper, { AriaSnapshotStore } from "./page-snapshot"

export class BrowserTool implements OpenAITool {
    static readonly TOOL_NAVIGATE = 'browser_navigate'
    static readonly TOOL_CLICK = 'browser_click'
    static readonly TOOL_TYPE = 'browser_type'
    static readonly TOOL_PRESS_KEY = 'browser_press_key'
    static readonly TOOL_SNAPSHOT = 'browser_snapshot'
    private readonly page: Page
    private readonly store: AriaSnapshotStore
    private readonly mapper: AriaSnapshotMapper

    functionDeclarations: ChatCompletionFunctionTool[]
    constructor(page: Page) {
        this.page = page
        this.store = new AriaSnapshotStore()
        this.mapper = new AriaSnapshotMapper()
        this.functionDeclarations = [
            {
                type: 'function',
                function: {
                    name: BrowserTool.TOOL_NAVIGATE,
                    description: 'Navigate to a specified URL in the browser, example: https://www.example.com',
                    parameters: {
                        type: 'object',
                        properties: {
                            url: { type: 'string', description: 'The URL to navigate to' }
                        },
                        required: ['url']
                    }
                }
            },
            {
                type: 'function',
                function: {
                    name: BrowserTool.TOOL_CLICK,
                    description: 'Click a specified element reference in the browser',
                    parameters: {
                        type: 'object',
                        properties: {
                            ref: { type: 'string', description: 'ref value of the element from the snapshot, example: 4Fgt' }
                        },
                        required: ['ref']
                    }
                }
            },
            {
                type: 'function',
                function: {
                    name: BrowserTool.TOOL_TYPE,
                    description: 'Type text into a specified element reference in the browser',
                    parameters: {
                        type: 'object',
                        properties: {
                            ref: { type: 'string', description: 'ref value of the element from the snapshot, example: 4Fgt' },
                            text: { type: 'string', description: 'The text to type into the element, example: Hello World' }
                        },
                        required: ['ref', 'text']
                    }
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
                            key: { type: 'string', description: 'The key to press, example: Enter, Escape, ArrowDown' }
                        },
                        required: ['key']
                    }
                }
            },
            {
                type: 'function',
                function: {
                    name: BrowserTool.TOOL_SNAPSHOT,
                    description: 'Capture the ARIA snapshot of the current page'
                }
            }
        ]
    }

    async call(specified: ToolCallArgs, ...args: any[]) {
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
            const snapshot = await this.page.locator('body').ariaSnapshot()
            const mapping = await this.mapper.map(snapshot, this.page)
            this.store.set(mapping)
            return mapping.snapshot
        } catch (error) {
            throw new Error(`Failed to capture page snapshot:\n${error}`)
        }
    }

    private async navigateToUrl(url: string) {
        try {
            if (!url) {
                throw new Error(`valid URL is required for ${BrowserTool.TOOL_NAVIGATE} but received: '${url}'`)
            }
            await this.page.goto(url)
            return this.captureSnapshot()
        } catch (error) {
            throw new Error(`Failed to navigate to URL ${url}:\n${error}`)
        }
    }

    private async clickElement(ref: string) {
        try {
            await this.store.getLocator(ref).click()
            return this.captureSnapshot()
        } catch (error) {
            throw new Error(`Failed to click element with ref '${ref}':\n${error}`)
        }
    }

    private async typeInElement(ref: string, text: string) {
        try {
            if (!ref || !text) {
                throw new Error(`Both 'ref' and 'text' are required for ${BrowserTool.TOOL_TYPE} but received ref='${ref}' and text='${text}'`)
            }
            await this.store.getLocator(ref).fill(text)
            return this.captureSnapshot()
        } catch (error) {
            throw new Error(`Failed to type text '${text}' in element with ref '${ref}':\n${error}`)
        }
    }

    private async pressKey(key: string) {
        try {
            if (!key) {
                throw new Error(`'key' is required for ${BrowserTool.TOOL_PRESS_KEY} but received: '${key}'`)
            }
            await this.page.keyboard.press(key)
            return this.captureSnapshot()
        } catch (error) {
            throw new Error(`Failed to press key '${key}':\n${error}`)
        }
    }
}