import { z } from 'zod/v4'
import { BrowserToolRuntime } from '../browser/tool'
import { defineAgentTool } from '../define-agent-tool'
import { AgentTool } from '../types'
import { SalesforceAuthenticator } from '../../integrations/salesforce/authenticator'
import { SalesforceCliHandler } from '../../integrations/salesforce/cli-handler'

export const SalesforceLoginTool = {
	TOOL_LOGIN_TO_SALESFORCE_ORG: 'login_to_salesforce_org',
} as const

export function createSalesforceTools(browserRuntime: BrowserToolRuntime): AgentTool[] {
	return [
		defineAgentTool({
			name: SalesforceLoginTool.TOOL_LOGIN_TO_SALESFORCE_ORG,
			description:
				'Login to a Salesforce org in a browser. Do not use if Salesforce org is opened and logged in. You do not need to specify credentials, the tool will handle it for you.',
			schema: z
				.object({
					goal: z.string().describe('The goal or purpose of logging into the Salesforce org'),
				})
				.strict(),
			handler: async (_args, context) => {
				const frontDoorUrl = await new SalesforceAuthenticator(new SalesforceCliHandler()).ready.then(
					(authenticator) => authenticator.getFrontDoorUrl()
				)

				return browserRuntime.navigateToUrl(frontDoorUrl, context.step)
			},
		}),
	]
}
