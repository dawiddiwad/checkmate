/**
 * @fileoverview End-to-end Playwright test that creates a new Account record in a Salesforce Developer org.
 *
 * @summary
 * This test suite contains a single focused test that:
 * 1. Obtains a Salesforce login URL via SalesforceTool.TOOL_GET_SALESFORCE_LOGIN_URL and authenticates the session.
 * 2. Launches the Sales app via the App Launcher.
 * 3. Switches to the Accounts tab.
 * 4. Starts creating a new Account with a unique name (Agentic Test Account + random alphanumeric suffix).
 * 5. Saves the Account record and verifies the Account detail view is displayed.
 *
 * @description
 * The test uses an AI-powered fixture (ai) to perform UI actions in discrete steps with explicit expectations.
 * Each step is executed with ai.run containing an 'action' directive for the UI interaction and an 'expect'
 * directive that expresses the expected outcome of that action.
 *
 * Preconditions:
 * - A Salesforce Developer or trial org is required. Sign-up: https://www.salesforce.com/form/developer-signup/
 * - Salesforce CLI is recommended for authorizing the org: https://developer.salesforce.com/tools/salesforcecli
 * - The org must be authorized (for example: `sf org login web --set-default`) before running the test.
 * - The user executing the test should have access to the Sales app and the Accounts tab in Lightning Experience.
 *
 * Important details:
 * - The test marks the case as focused/test.only, so it will run exclusively when executed.
 * - The Salesforce login URL is retrieved via the SalesforceTool constant TOOL_GET_SALESFORCE_LOGIN_URL.
 * - The Account name is created with a fixed prefix ("Agentic Test Account") plus a random alphanumeric suffix to avoid collisions.
 * - The test assumes Lightning UI elements (App Launcher, Sales app, Accounts tab, New/Save buttons) are available and interactable.
 *
 * @see {@link https://developer.salesforce.com/tools/salesforcecli} - Salesforce CLI installation and documentation.
 * @see {@link https://www.salesforce.com/form/developer-signup/} - Sign up for a Salesforce Developer org.
 */
import { SalesforceTool } from "../../../src/salesforce/salesforce-tool"
import { test } from "../../fixtures/checkmate"

test.describe('trial dev org', async () => {
    test('create new account in salesforce', async ({ ai }) => {
        await test.step('Login to Salesforce Org', async () => {
            await ai.run({
            action: `
            Login to Salesforce org: 
            call ${SalesforceTool.TOOL_GET_SALESFORCE_LOGIN_URL} tool to get the URL, 
            open the browser and navigate to this URL`,
            expect: `
            Salesforce org loads successfully and user is authenticated/not on the login page.`
            })
        })

        await test.step('Open Sales App from App Launcher', async () => {
            await ai.run({
            action: `
            Click the App Launcher icon (nine dots) in the top left corner,
            type 'Sales' into the App Launcher search bar,
            click on app that is named exactly the 'Sales' app from the results`,
            expect: `
            Sales app opens successfully in Lightning context.`
            })
        })

        await test.step('Switch to Accounts tab', async () => {
            await ai.run({
            action: `
            Click the 'Accounts' tab within the Sales app.`,
            expect: `
            The Accounts tab is active and a list of accounts is displayed.`
            })
        })

        await test.step('Start creating a new Account', async () => {
            await ai.run({
            action: `
            Click the 'New' button on the Accounts tab to create a new Account record.
            Fill 'Account Name' field with 'Agentic Test Account' followed by space and some random alphanumeric string`,
            expect: `
            'New Account' form is displayed and filled with random data`
            })
        })

        await test.step('Save new Account record', async () => {
            await ai.run({
            action: `
            Clicking the 'Save' button on the 'New Account' form.`,
            expect: `
            Account record is saved successfully and details view is displayed.`
            })
        })
    })
})