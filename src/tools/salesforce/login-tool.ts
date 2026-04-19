import { z } from 'zod/v4'
import { CheckmateServices } from '../../runtime/module'
import { defineAgentTool } from '../define-agent-tool'
import { AgentTool } from '../types'
import { CheckmateBrowserService, CheckmateSalesforceService } from '../../runtime/module'

export const SalesforceLoginTool = {
	TOOL_LOGIN_TO_SALESFORCE_ORG: 'login_to_salesforce_org',
} as const

export function createSalesforceTools<TServices extends CheckmateServices = CheckmateServices>(
	browserRuntime: CheckmateBrowserService,
	salesforce: CheckmateSalesforceService
): AgentTool<TServices>[] {
	return [
		defineAgentTool({
			name: SalesforceLoginTool.TOOL_LOGIN_TO_SALESFORCE_ORG,
			description:
				'Login to a Salesforce org in a browser. Do not use if Salesforce org is opened and logged in.',
			schema: z
				.object({
					goal: z.string().describe('The goal or purpose of logging into the Salesforce org'),
				})
				.strict(),
			handler: async (_args, context) => {
				const frontDoorUrl = await salesforce.getFrontDoorUrl()
				return browserRuntime.navigateToUrl(frontDoorUrl, context.step)
			},
		}),
	]
}
