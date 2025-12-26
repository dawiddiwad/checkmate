/**
 * @fileoverview
 * Playwright E2E test for Salesforce Developer org.
 *
 * @summary
 * Example of a multi-step test that creates a new Account record in the Sales app.
 *
 * @description
 * This test automates the following user journey in a Salesforce Developer or trial org:
 * 1. Log in to the Salesforce org.
 * 2. Open the Sales app via the App Launcher.
 * 3. Navigate to the Accounts tab.
 * 4. Create a new Account with a random name.
 * 5. Save the new Account record.
 *
 * @preconditions
 * - A Salesforce Developer or trial org is required. Sign-up: https://www.salesforce.com/form/developer-signup/
 * - Salesforce CLI is recommended for authorizing the org: https://developer.salesforce.com/tools/salesforcecli
 * - The org must be authorized (for example: `sf org login web --set-default`) before running the test.
 * - The user executing the test should have access to the Sales app and the Accounts tab in Lightning Experience.
 *
 * @see {@link https://developer.salesforce.com/tools/salesforcecli} - Salesforce CLI installation and documentation.
 * @see {@link https://www.salesforce.com/form/developer-signup/} - Sign up for a Salesforce Developer org.
 *
 * @note
 * All tests use the `ai` fixture and call `ai.run({ action, expect })`
 * to describe actions and assert visible outcomes.
 */
import { test } from '../../fixtures/checkmate'

test.describe('trial dev org', async () => {
	test('creating new account in sales app', async ({ ai }) => {
		await test.step('Login to Salesforce Org', async () => {
			await ai.run({
				action: `
            Login to Salesforce org`,
				expect: `
            Salesforce org loads successfully and user is authenticated/not on the login page.`,
			})
		})

		await test.step('Open Sales App from App Launcher', async () => {
			await ai.run({
				action: `
            Click the App Launcher icon (nine dots) in the top left corner.
            Type 'Sales' into the App Launcher 'Search apps and items' search bar.
            Click on the app that is named exactly the 'Sales' app from the results.`,
				expect: `
            Sales app opens successfully in Lightning context.`,
			})
		})

		await test.step('Switch to Accounts tab', async () => {
			await ai.run({
				action: `
            Click the 'Accounts' tab within the Sales app.`,
				expect: `
            The Accounts tab is active and a list of accounts is displayed.`,
			})
		})

		await test.step('Start creating a new Account', async () => {
			await ai.run({
				action: `
            Click the 'New' button on the Accounts tab to create a new Account record.
            Fill 'Account Name' field with 'Agentic Test Account' followed by space and some random alphanumeric string
            Don't save the record or fill any other fields.`,
				expect: `
            'New Account' form is displayed and filled with random data`,
			})
		})

		await test.step('Save new Account record', async () => {
			await ai.run({
				action: `
            Click the 'Save' button on the 'New Account' form.`,
				expect: `
            Account record is saved successfully and details view is displayed.`,
			})
		})
	})
})
