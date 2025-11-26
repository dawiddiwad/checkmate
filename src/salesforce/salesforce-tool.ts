import { ChatCompletionFunctionTool } from "openai/resources/chat/completions"
import { SalesforceCliHandler } from "./salesforce-cli-handler"
import { SalesforceCliAuthenticator } from "./salesforce-cli-authenticator"
import { OpenAITool, ToolCallArgs } from "../mcp/tool/openai-tool"

export type Response = {
    url: string
}

export class SalesforceTool implements OpenAITool {
    static readonly TOOL_GET_SALESFORCE_LOGIN_URL = 'get_salesforce_login_url'

    functionDeclarations: ChatCompletionFunctionTool[]
    
    constructor() {
        this.functionDeclarations = [
            {
                type: 'function',
                function: {
                    name: SalesforceTool.TOOL_GET_SALESFORCE_LOGIN_URL,
                    description: 'Get the login url of the salesforce org, so user can open it in the browser to login to the org',
                    parameters: {
                        type: 'object',
                        properties: {
                            url: { type: 'string', description: 'The login url of the salesforce org' }
                        }
                    }
                }
            }
        ]
    }

    async call(specified: ToolCallArgs): Promise<Response> {
        if (specified.name === SalesforceTool.TOOL_GET_SALESFORCE_LOGIN_URL) {
            return { url: await this.getSalesforceLoginUrl() }
        }
        throw new Error(`salesforce tool not found: ${specified.name}`)
    }

    private async getSalesforceLoginUrl(): Promise<string> {
        return new SalesforceCliAuthenticator(new SalesforceCliHandler()).ready
            .then(authenticator => authenticator.getFrontDoorUrl())
    }
}
