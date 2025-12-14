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

    test('adding items to cart on demo e-commerce site', async ({ ai }) => {
        await test.step('Navigate to the e-commerce demo site and add items to cart', async () => {
            await ai.run({
                action: `
                Navigate to the https://sweetshop.netlify.app/ website.
                Browse Sweets and add 3 items to the basket.
                In the Basket detail view:
                 - switch Delivery options.
                 - check Billing Address, Payment and Promo Code fields.
            `,
                expect: `The basket icon in the header updates its count to '3'.
                Basket detail view displays added items with price for each and total price.
                Delivery options are switched successfully recalculating Total price.
                All Billing Address, Payment and Promo Code form fields are interactable.`
            })
        })
    })
})

test.use({ headless: false })
test.describe('multi-step flows', async () => {
    test('mojeek search', async ({ ai }) => {
        await test.step('Open the browser and navigate to mojeek.com', async () => {
            await ai.run({
                action: `Navigate to the https://www.mojeek.com/`,
                expect: `mojeek page is loaded successfully`
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
                expect: `Playwright home page is displayed`
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

    test('search jobs on justjoin.it', async ({ ai }) => {
        await test.step('Navigate to justjoin.it homepage', async () => {
            await ai.run({
                action: `Navigate to 'https://justjoin.it' and accept cookie consent.`,
                expect: `justjoin.it homepage loads successfully and cookie consent are accepted.`
            })
        })
        await test.step('Search for Python jobs in Warsaw', async () => {
            await ai.run({
                action: `Click to activate the 'Location' field and type 'Warsaw' into it.
                In the 'Search: Job' field type 'Python' into it.
                Click on the 'Search' button to apply filters`,
                expect: `The job listings are filtered to show Python jobs in Warsaw.`
            })
        })
        await test.step('Open one of job listing', async () => {
            await ai.run({
                action: `Click on one of the job listings in the results.`,
                expect: `The job details page is displayed, 
                showing job description, requirements, and application instructions as well as tech stack`
            })
        })
    })
})

test.describe('tests that should fail', async () => {
    test.fail('E-commerce Checkout Flow with Form Validation', async ({ ai }) => {
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
        await test.step('Add 4 Bon Bons to the basket', async () => {
            await ai.run({
                action: `Click the 'Add to Basket' button for the 'Bon Bons' product until the basket icon in the header reaches 4.`,
                expect: `The basket icon in the header updates its count to '4'.`
            })
        })

        //this step should fail, as the basket count will be 4 (£4.00) instead of 3 (£3.00)
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