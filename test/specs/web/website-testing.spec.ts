import { test } from "../../fixtures/checkmate"

test.describe.parallel('website testing', async () => {
    test('google search for playwright test automation', async ({ ai }) => {
        await test.step('Open the browser and navigate to the google.com', async () => {
            await ai.run({
                action: `Open the browser and navigate to the google.com and accept any consents.`,
                expect: `google.com is loaded successfully and the search bar is visible on the page`
            })
        })
        await test.step('Search for playwright test automation', async () => {
            await ai.run({
                action: `Search for 'playwright test automation' in the search bar`,
                expect: `The search results contains the 'https://playwright.dev/' link`
            })
        })
        await test.step('Click on the playwright website result', async () => {
            await ai.run({
                action: `Click on the result with 'https://playwright.dev/' link`,
                expect: `The page title contains 'Playwright'`
            })
        })
        await test.step('Search for documentation item in the search results', async () => {
            await ai.run({
                action: `Type in 'Agent' into the search bar`,
                expect: `The search results contains 'Planner' item`
            })
        })
        await test.step(`Click on the 'Planner' item in the search results`, async () => {
            await ai.run({
                action: `Click on the Planner item in the search results`,
                expect: `Planner Agent documetnation is displayed 
                explaing how to use this agent`
            })
        })
    })

    test('search for an article and attempt to comment without logging in', async ({ ai }) => {
        await test.step(`Navigate to Threshold homepage and open the first article`, async () => {
            await ai.run({
                action: `Navigate to 'https://www.thresholdx.net' 
                and click on the first article displayed on the homepage. Accept any consents.`,
                expect: `The browser navigates to the first article page, displaying its content. 
                The comments section is visible, and the comment input area is ready for interaction.`
            })
        })
        await test.step(`Wait for newsletter subscribe popup`, async () => {
            await ai.run({
                action: `Wait for newsletter subscribe popup to appear and skip it. 
                It should take about 30s for the popup to appear.`,
                expect: `The newsletter subscribe popup is skipped.`
            })
        })
        await test.step(`Scroll trough the article content to disqus section`, async () => {
            await ai.run({
                action: `Scroll trough the article content until the disqus section,
                this means to scroll to the page bottom and then 1000 pixels up,
                skip any consents if prompted.`,
                expect: `The user is able to scroll through the article content,
                and the disqus section is in the view.`
            })
        })
        await test.step(`Attempt to comment 'test comment' without logging in`, async () => {
            await ai.run({
                action: `First click in the comments section to activate the comment input area, 
                then type 'test comment' into the 'Join the discussion...' text area 
                and click the 'Comment' button. Skip any consents if prompted.`,
                expect: `A sign-up form appears below the comment box 
                with 'test comment' visible in the input area. 
                Red validation error messages are displayed for the 
                'Name', 'Email', 'Password' fields, 
                indicating they are required.`
            })
        })
    })


    test('verify stock chart customization and navigation', async ({ ai }) => {
        await test.step(`Navigate to stooq.pl website`, async () => {
            await ai.run({
                action: `Navigate to the stooq.pl website.`,
                expect: `The website loads and a cookie consent modal is displayed over the main content.`
            })
        })
        await test.step(`Accept cookie consent`, async () => {
            await ai.run({
                action: `Click the agreebutton on the cookie consent modal.`,
                expect: `The cookie consent modal closes, 
                and the main homepage of stooq.pl is fully visible.`
            })
        })
        await test.step(`Search for EURUSD symbol`, async () => {
            await ai.run({
                action: `Type 'eurusd' into the 'Symbol' search input field at the top of the page.`,
                expect: `A dropdown list of suggestions appears, 
                with 'Euro / U.S. Dollar' as one of the options.`
            })
        })
        await test.step(`Select EUR/USD from suggestions`, async () => {
            await ai.run({
                action: `Click on the 'Euro / U.S. Dollar (EURUSD)' option from the suggestion list.`,
                expect: `The page navigates to the detailed view for the EUR/USD currency pair. 
                A line chart and detailed financial data are displayed.`
            })
        })
        await test.step(`Change chart to '1m' (1 month)`, async () => {
            await ai.run({
                action: `Scroll down and click on the '1m' (1 month) link in the chart options.`,
                expect: `The page reloads, and the chart updates to display the data for the last month.`
            })
        })
        await test.step(`Change chart size to 'Duży' (Large)`, async () => {
            await ai.run({
                action: `Click on the 'Duży' (Large) link in the chart size options.`,
                expect: `The page reloads, and the chart is rendered in a larger format.`
            })
        })
        await test.step(`Change chart type to 'Świece' (Candles)`, async () => {
            await ai.run({
                action: `Click on the 'Świece' (Candles) link in the chart type options.`,
                expect: `The chart is now displayed as a candlestick chart.`
            })
        })
        await test.step(`Change chart type to 'P&F' (Point & Figure)`, async () => {
            await ai.run({
                action: `Click on the 'P&F' (Point & Figure) link in the chart type options.`,
                expect: `The chart is now displayed as a Point & Figure chart.`
            })
        })
        await test.step(`Navigate to Money Market Funds section`, async () => {
            await ai.run({
                action: `Hover over the 'Notowania' (Quotes) menu item, then hover over 'Fundusze' (Funds), 
                and click on 'Fundusze pieniężne' (Money market funds).`,
                expect: `The page navigates to the 'Fundusze pieniężne' section, 
                displaying a table listing various money market funds.`
            })
        })
        await test.step(`Scroll through the list of funds`, async () => {
            await ai.run({
                action: `Scroll down the page.`,
                expect: `The user is able to scroll through the entire list of 
                money market funds in the table.`
            })
        })
    })

    test('E-commerce Checkout Flow with Form Validation', async ({ ai }) => {
        await test.step('Navigate to the e-commerce website homepage', async () => {
            await ai.run({
                action: `Navigate to the https://sweetshop.netlify.app/ website.`,
                expect: `The Sweet Shop homepage loads successfully.`
            })
        })
        await test.step('Click the Browse Sweets button', async () => {
            await ai.run({
                action: `Click the 'Browse Sweets' button.`,
                expect: `The user is navigated to the 'Browse sweets' page, which displays a grid of available sweets.`
            })
        })
        await test.step('Add Bon Bons to basket 3 times', async () => {
            await ai.run({
                action: `Click the 'Add to Basket' button for the 'Bon Bons' product until the basket icon in the header reaches 3.`,
                expect: `The basket icon in the header updates its count to '3'.`
            })
        })
        await test.step('Click on the Basket link', async () => {
            await ai.run({
                action: `Click on the 'Basket' link in the header.`,
                expect: `The 'Your Basket' page is displayed, showing 'Strawberry Bon Bons' with a quantity of 3 and a total price of £3.00.`
            })
        })
        await test.step('Fill in the Billing address form', async () => {
            await ai.run({
                action: `Fill in the 'Billing address' form with the following details: First name: 'Agentio', Last name: 'Testing', Email: 'yolo@123.pl', Address: '126B Main Street', Address 2: '2', Country: 'United Kingdom', City: 'Swansea', Zip: '1001'.`,
                expect: `The corresponding input fields in the 'Billing address' section are populated with the entered data.`
            })
        })
        await test.step('Attempt to continue to checkout without payment details', async () => {
            await ai.run({
                action: `Scroll down to the 'Payment' section and click the 'Continue to checkout' button without filling in any payment details.`,
                expect: `Validation error messages appear under the 'Name on card', 'Credit card number', 'Expiration', and 'CVV' fields. The borders of these input fields turn red to indicate an error.`
            })
        })
    })

    test('browse ollama models', async ({ ai }) => {
        await test.step('Navigate to ollama.com and search for model details', async () => {
            await ai.run({
            action: `
                Navigate to https://ollama.com/
                type 'qwen3' into the 'Search models' search bar
                click on 'qwen3-vl' link from the results,
                click on 'qwen3-vl:235b' linik from the models list,
            `,
            expect: `qwen3-vl:235b model page is displayed with model details,
                describing its features and capabilities.`
            })
        })
    })

    test('browse hugginface docs', async ({ ai }) => {
        await test.step('Navigate to huggingface docs and open Gemini documentation', async () => {
            await ai.run({
            action: `
                Navigate to https://huggingface.co, click the 'Docs' link in the top navigation bar,
                type 'gemini' into the 'Search across all docs' search bar,
                and click the 'Using Google Gemini Models' link from the results.
            `,
            expect: `The Hugging Face docs page loads, the search results include 'Using Google Gemini Models',
            and the documentation page for using Google Gemini models is displayed with initialization and usage details.`
            })
        })
    })

        test('browse hugginface models', async ({ ai }) => {
        await test.step('Navigate to huggingface.co', async () => {
            await ai.run({
                action: `
                    Navigate to the https://huggingface.co website.
                    Type 'Qwen3-VL-4B' in the search bar.
                    Click on the 'Qwen/Qwen3-VL-4B-Instruct' link from the search results.
                    `,
                expect: `Qwen3-VL-4B-Instruct model page is displayed with model details`
            })
        })
    })
})