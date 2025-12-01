import { ChatCompletionFunctionTool } from "openai/resources/chat/completions"
import { SalesforceCliHandler } from "./salesforce-cli-handler"
import { SalesforceCliAuthenticator } from "./salesforce-cli-authenticator"
import { OpenAITool, ToolCallArgs } from "../mcp/tool/openai-tool"
import { PlaywrightTool } from "../mcp/tool/playwright-tool"
import { PlaywrightToolNames } from "../mcp/tool/playwright-tool-names"


export class SalesforceTool implements OpenAITool {
    static readonly TOOL_LOGIN_TO_SALESFORCE_ORG = 'login_to_salesforce_org'
    private readonly browserTool: PlaywrightTool

    functionDeclarations: ChatCompletionFunctionTool[]

    constructor(browserTool: PlaywrightTool) {
        this.browserTool = browserTool
        this.functionDeclarations = [
            {
                type: 'function',
                function: {
                    name: SalesforceTool.TOOL_LOGIN_TO_SALESFORCE_ORG,
                    description: 'Login to a Salesforce org in a browser'
                }
            }
        ]
    }

    async call(specified: ToolCallArgs): Promise<any> {
        if (specified.name === SalesforceTool.TOOL_LOGIN_TO_SALESFORCE_ORG) {
            try {
                const frontDoorUrl = await this.getSalesforceLoginUrl()
                return this.browserTool.call({
                    name: PlaywrightToolNames.BROWSER_NAVIGATE,
                    arguments: { url: frontDoorUrl }
                })
            } catch (error) {
                throw new Error(`Failed to login to Salesforce org due to\n:${error}`)
            }
        } else throw new Error(`salesforce tool not found: ${specified.name}`)
    }

    private async getSalesforceLoginUrl(): Promise<string> {
        return new SalesforceCliAuthenticator(new SalesforceCliHandler()).ready
            .then(authenticator => authenticator.getFrontDoorUrl())
    }
}
