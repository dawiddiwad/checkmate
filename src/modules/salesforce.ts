import { SalesforceAuthenticator } from '../integrations/salesforce/authenticator'
import { SalesforceCliHandler } from '../integrations/salesforce/cli-handler'
import {
	CheckmateBrowserService,
	CheckmateExtension,
	CheckmateProfile,
	CheckmateSalesforceService,
	CheckmateServices,
} from '../runtime/module'
import { createWebProfile } from './browser'
import { createSalesforceTools } from '../tools/salesforce/login-tool'

class SalesforceService implements CheckmateSalesforceService {
	async getFrontDoorUrl(): Promise<string> {
		const authenticator = await new SalesforceAuthenticator(new SalesforceCliHandler()).ready
		return authenticator.getFrontDoorUrl()
	}
}

/**
 * Create the built-in Salesforce extension.
 *
 * The Salesforce extension depends on the browser service and adds Salesforce
 * login tools on top of the standard web profile.
 *
 * @returns Salesforce extension definition.
 */
export function createSalesforceExtension<
	TServices extends CheckmateServices = CheckmateServices,
>(): CheckmateExtension<TServices> {
	return {
		name: 'salesforce',
		requires: ['browser'],
		setup: ({ services }) => {
			const browser = getBrowserService(services)
			if (!browser) {
				throw new Error('The salesforce extension requires the browser service')
			}

			const salesforce = getSalesforceService(services) ?? new SalesforceService()
			return {
				services: { salesforce },
				tools: createSalesforceTools<TServices>(browser, salesforce),
				prompt: ['Use the Salesforce login tool when you need to authenticate into a Salesforce org.'],
			}
		},
	}
}

function getBrowserService(services: Partial<CheckmateServices>): CheckmateBrowserService | undefined {
	return services.browser as CheckmateBrowserService | undefined
}

function getSalesforceService(services: Partial<CheckmateServices>): CheckmateSalesforceService | undefined {
	return services.salesforce as CheckmateSalesforceService | undefined
}

/**
 * Create the built-in Salesforce profile.
 *
 * @returns Profile containing the web profile plus the Salesforce extension.
 */
export function createSalesforceProfile<
	TServices extends CheckmateServices = CheckmateServices,
>(): CheckmateProfile<TServices> {
	const web = createWebProfile<TServices>()
	return {
		name: 'salesforce',
		extensions: [...web.extensions, createSalesforceExtension<TServices>()],
	}
}
