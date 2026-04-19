import { createBrowserExtension, createWebProfile } from './browser'
import { createSalesforceExtension, createSalesforceProfile } from './salesforce'

/**
 * Built-in composable runtime extensions.
 */
export const extensions = {
	/** Create the built-in browser extension. */
	browser: createBrowserExtension,
	/** Create the built-in Salesforce extension. */
	salesforce: createSalesforceExtension,
}

/**
 * Built-in runner profiles.
 */
export const profiles = {
	/** Create the default web profile. */
	web: createWebProfile,
	/** Create the Salesforce profile built on top of the web profile. */
	salesforce: createSalesforceProfile,
}

export { createBrowserExtension, createSalesforceExtension, createSalesforceProfile, createWebProfile }
