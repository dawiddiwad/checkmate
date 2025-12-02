import { test } from "../../fixtures/checkmate"

test.describe('single-step flows', async () => {
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

    test('browse huggingface docs', async ({ ai }) => {
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

    test('browse huggingface models', async ({ ai }) => {
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

test.describe.parallel('multi-step flows', async () => {
    test('google search', async ({ ai }) => {
        await test.step('Open the browser and navigate to google.com', async () => {
            await ai.run({
                action: `Navigate to the google.com`,
                expect: `google.com is loaded successfully and a consent prompt is visible`
            })
        })

        await test.step('Accept Google consents', async () => {
            await ai.run({
                action: `Accept cookie consent`,
                expect: `Consent is closed and the search bar is visible on the page`
            })
        })

        await test.step('Submit playwright search', async () => {
            await ai.run({
                action: `Type 'playwright test automation' into the search field
                and press the 'Enter' key`,
                expect: `The search results are displayed`
            })
        })

        await test.step('Click on the playwright website link', async () => {
            await ai.run({
                action: `Click on the result that contains 'playwright.dev' link`,
                expect: `Playwright home page is displayed.`
            })
        })

        await test.step('Search for Agent documentation', async () => {
            await ai.run({
                action: `Click on the Search icon or button on the playwright website 
                and type 'Agent' into the 'Search docs' input field`,
                expect: `The search results are displayed`
            })
        })

        await test.step(`View 'Planner' agent details`, async () => {
            await ai.run({
                action: `Click on the 'Planner' in the search results`,
                expect: `Planner Agent documentation is displayed explaing how to use this agent`
            })
        })
    })

    test('search for an article and attempt to comment without logging in', async ({ ai }) => {
        await test.step('Navigate to Threshold homepage', async () => {
            await ai.run({
            action: `Navigate to 'https://www.thresholdx.net'`,
            expect: `Navigated to Threshold homepage successfully.`
            })
        })
        await test.step('Accept privacy consents', async () => {
            await ai.run({
            action: `Accept privacy consents if they appear`,
            expect: `Privacy consents are accepted.`
            })
        })
        await test.step('Open the first article', async () => {
            await ai.run({
            action: `Click on the first article item displayed on the Headlines section to open it`,
            expect: `The browser navigates to the first article page, displaying the article content.`
            })
        })
        await test.step(`Wait for newsletter subscribe popup`, async () => {
            await ai.run({
                action: `Wait for ewsletter subscribe popup to appear and skip it. 
                It should take about 30s for the popup to appear.`,
                expect: `The newsletter subscribe popup is skipped.`
            })
        })
        await test.step(`Scroll trough the article content to disqus section`, async () => {
            await ai.run({
                action: `Scroll trough the article content until the disqus section,
                this means to scroll to the page down enough so that the disqus section is in view.,
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
                action: `Click the agree button on the cookie consent modal.`,
                expect: `The cookie consent modal closes, 
                and the stooq.pl landing page is visible with sections:
                'Rynek', 'Wszystkie', 'Sponsorowane', 'Statystyka Sesji', 'Kalendarium'`
            })
        })
        await test.step(`Search for EURUSD symbol`, async () => {
            await ai.run({
                action: `Type 'eurusd' into the 'Symbol' search input field next to 'Kwotuj' button.`,
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
                expect: `The page reloads, and the chart updates to display 1 month data '1 miesiąc'`
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
})