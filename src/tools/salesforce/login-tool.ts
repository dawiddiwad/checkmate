import { ChatCompletionFunctionTool } from 'openai/resources/chat/completions'
import { logger } from '../../logging'
import { SalesforceAuthenticator } from '../../integrations/salesforce/authenticator'
import { SalesforceCliHandler } from '../../integrations/salesforce/cli-handler'
import { BrowserTool } from '../browser/tool'
import { ToolCall, ToolCallResult, ToolContract, ToolExecutionContext } from '../tool-contract'

export class SalesforceLoginTool extends ToolContract {
	static readonly TOOL_LOGIN_TO_SALESFORCE_ORG = 'login_to_salesforce_org'

	functionDeclarations: ChatCompletionFunctionTool[] = [
		{
			type: 'function',
			function: {
				name: SalesforceLoginTool.TOOL_LOGIN_TO_SALESFORCE_ORG,
				description:
					'Login to a Salesforce org in a browser. Do not use if Salesforce org is opened and logged in.',
				parameters: {
					type: 'object',
					properties: {
						goal: { type: 'string', description: 'The goal or purpose of logging into the Salesforce org' },
					},
					additionalProperties: false,
					required: ['goal'],
				},
				strict: true,
			},
		},
	]

	constructor(private readonly browserTool: BrowserTool) {
		super()
	}

	async call(specified: ToolCall): Promise<ToolCallResult> {
		if (specified.name !== SalesforceLoginTool.TOOL_LOGIN_TO_SALESFORCE_ORG) {
			logger.error(`model tried to call not implemented tool: ${specified.name}`)
			return `Salesforce login tool not implemented: ${specified.name}, use one of: ${this.getFunctionNames().join(', ')}`
		}

		try {
			const frontDoorUrl = await this.getSalesforceLoginUrl()
			return this.browserTool.executeWithState({
				name: BrowserTool.TOOL_NAVIGATE,
				arguments: { url: frontDoorUrl, goal: 'Login to Salesforce org' },
			})
		} catch (error) {
			throw new Error(`Failed to login to Salesforce org due to\n:${error}`, { cause: error })
		}
	}

	execute(specified: ToolCall, _context: ToolExecutionContext): Promise<ToolCallResult> {
		return this.call(specified)
	}

	private async getSalesforceLoginUrl(): Promise<string> {
		return new SalesforceAuthenticator(new SalesforceCliHandler()).ready.then((authenticator) =>
			authenticator.getFrontDoorUrl()
		)
	}
}
