import { SalesforceCliHandler } from "./salesforce-cli-handler"
import { SalesforceCliAuthenticator } from "./salesforce-cli-authenticator"
import { OpenAITool, ToolCall } from "../step/tool/openai-tool"
import { BrowserTool } from "../step/tool/browser-tool"
import { Tool } from "openai/resources/responses/responses.mjs"


export class SalesforceTool implements OpenAITool {
    static readonly TOOL_LOGIN_TO_SALESFORCE_ORG = 'login_to_salesforce_org'
    private readonly browserTool: BrowserTool

    functionDeclarations: Tool[]

    constructor(browserTool: BrowserTool) {
        this.browserTool = browserTool
        this.functionDeclarations = [
            {
                type: 'function',
                name: SalesforceTool.TOOL_LOGIN_TO_SALESFORCE_ORG,
                description: 'Login to a Salesforce org in a browser. Do not use if Salesforce org is opened and logged in.',
                parameters: {
                    type: 'object',
                    properties: {
                        goal: { type: 'string', description: 'The goal or purpose of logging into the Salesforce org' }
                    },
                    additionalProperties: false,
                    required: ['goal']
                },
                strict: true
            }
        ]
    }

    async call(specified: ToolCall): Promise<any> {
        if (specified.name === SalesforceTool.TOOL_LOGIN_TO_SALESFORCE_ORG) {
            try {
                const frontDoorUrl = await this.getSalesforceLoginUrl()
                return this.browserTool.call({
                    name: BrowserTool.TOOL_NAVIGATE,
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
