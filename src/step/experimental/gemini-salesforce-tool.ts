import { FunctionDeclaration, FunctionCall, Type } from "@google/genai"
import { SalesforceCliHandler } from "../../salesforce/salesforce-cli-handler"
import { SalesforceCliAuthenticator } from "../../salesforce/salesforce-cli-authenticator"
import { SalesforceTool } from "../../salesforce/salesforce-tool"

export type Response = {
    url: string
}

export class GeminiSalesforceTool {
    functionDeclarations: FunctionDeclaration[]
    
    constructor() {
        this.functionDeclarations = [
            {
                name: SalesforceTool.TOOL_LOGIN_TO_SALESFORCE_ORG,
                description: 'Get the login url of the salesforce org, so user can open it in the browser to login to the org',
                response: {
                    type: Type.OBJECT,
                    properties: {
                        url: { type: Type.STRING, description: 'The login url of the salesforce org' }
                    }
                }
            }
        ]
    }

    async call(specified: FunctionCall): Promise<Response> {
        if (specified.name === SalesforceTool.TOOL_LOGIN_TO_SALESFORCE_ORG) {
            return { url: await this.getSalesforceLoginUrl() }
        }
        throw new Error(`salesforce tool not found: ${specified.name}`)
    }

    private async getSalesforceLoginUrl(): Promise<string> {
        return new SalesforceCliAuthenticator(new SalesforceCliHandler()).ready
            .then(authenticator => authenticator.getFrontDoorUrl())
    }
}
