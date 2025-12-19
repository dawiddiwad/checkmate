/**
 * @fileoverview End‑to‑end Playwright tests that demonstrate AI‑driven web navigation.
 *
 * @summary This file contains several single‑step and multi‑step flow examples:
 *   - Browsing AI model repositories (Ollama, HuggingFace)
 *   - Interacting with e‑commerce demo sites
 *   - Performing searches on various public search engines (Mojeek, NYPL)
 *   - Job search on justjoin.it
 *
 * @description Each test uses the `ai` fixture to execute natural‑language actions via
 * `ai.run({ action, expect })`. Steps are kept atomic to improve reliability and make
 * debugging easier. The tests are written for demonstration purposes and can be
 * extended or adapted to other sites.
 */
import { test } from "../../fixtures/checkmate"

test.describe('single-step flows - quick examples', async () => {
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
                Delivery options are switched successfully recalculating Total price correctly.
                All Billing Address, Payment and Promo Code form fields are interactable.`
            })
        })
    })

    test('mojeek search', async ({ ai }) => {
        await test.step('Search for Playwright docs using mojeek.com', async () => {
            await ai.run({
                action: `
                Test: Mojeek Search
                Navigate to the Mojeek search engine at https://www.mojeek.com/.
                In the search field, type playwright test automation and press Enter.
                From the search results, click on the link that goes to playwright.dev.
                Once on the Playwright website, click the site's search icon and type Agent into the Search docs field.
                Click on the Planner result displayed in the documentation search.
                `,
                expect: `
                The Planner Agent documentation page is displayed, providing details on how to use this agent within Playwright.`
            })
        })
    })

    test('new york public library search', async ({ ai }) => {
        await test.step('the catcher in the rye availability', async () => {
            await ai.run({
                action: `
                Navigate to https://www.nypl.org. Search for 'The Catcher in the Rye.' 
                Check if it's available at any physical branch's bookshelf. 
                If yes, provide the location. 
                If not, check if an e-book version is available. 
                If neither, tell the user they're out of luck.`,
                expect: `
                Successfully navigated the NYPL website and searched for 'The Catcher in the Rye'.`
            })
        })
    })
})

test.describe('multi-step flow - Automation Exercise Regression', async () => {
    test('Test Case 6: Contact Us Form', async ({ ai }) => {
        await test.step('Navigate to automationexercise.com', async () => {
            await ai.run({
                action: `Navigate to http://automationexercise.com/ and accept data consent if prompted.`,
                expect: `Home page is visible successfully`
            })
        })

        await test.step('Click on Contact Us button', async () => {
            await ai.run({
                action: `Click on the 'Contact Us' button in the navigation menu.`,
                expect: `'GET IN TOUCH' section is visible on the contact page`
            })
        })

        await test.step('Fill contact form and submit', async () => {
            await ai.run({
                action: `Enter the following details in the contact form:
                - Name: 'Test User'
                - Email: 'testuser@example.com'
                - Subject: 'Test Inquiry'
                - Message: 'This is a test message for automation testing purposes.'
                Then click the 'Submit' button.`,
                expect: `The form is submitted successfully`
            })
        })

        await test.step('Handle alert and verify success message', async () => {
            await ai.run({
                action: `If an alert or confirmation dialog appears, click OK to dismiss it. 
                Then verify the success message is displayed.`,
                expect: `Success message 'Success! Your details have been submitted successfully.' is visible`
            })
        })

        await test.step('Return to home page', async () => {
            await ai.run({
                action: `Click the 'Home' button to navigate back to the home page.`,
                expect: `User is navigated back to the home page successfully`
            })
        })
    })

    test('Test Case 7: Verify Test Cases Page', async ({ ai }) => {
        await test.step('Navigate to automationexercise.com', async () => {
            await ai.run({
                action: `Navigate to http://automationexercise.com/ and accept data consent if prompted.`,
                expect: `Home page is visible successfully`
            })
        })

        await test.step('Click on Test Cases button', async () => {
            await ai.run({
                action: `Click on the 'Test Cases' button in the navigation menu.`,
                expect: `User is navigated to the test cases page successfully with a list of test cases displayed`
            })
        })
    })

    test('Test Case 8: Verify All Products and product detail page', async ({ ai }) => {
        await test.step('Navigate to automationexercise.com', async () => {
            await ai.run({
                action: `Navigate to http://automationexercise.com/ and accept data consent if prompted.`,
                expect: `Home page is visible successfully`
            })
        })

        await test.step('Click on Products button', async () => {
            await ai.run({
                action: `Click on the 'Products' button in the navigation menu.`,
                expect: `User is navigated to ALL PRODUCTS page successfully`
            })
        })

        await test.step('Verify products list is visible', async () => {
            await ai.run({
                action: `Verify that the products list is visible and displays multiple products.`,
                expect: `The products list is visible with multiple product cards`
            })
        })

        await test.step('View first product details', async () => {
            await ai.run({
                action: `Click on the 'View Product' button for the first product in the list.`,
                expect: `User is navigated to the product detail page`
            })
        })

        await test.step('Verify product details are visible', async () => {
            await ai.run({
                action: `Verify that the product detail page displays all required information including product name, category, price, availability, condition, and brand.`,
                expect: `Product detail page shows: product name, category, price, availability, condition, and brand`
            })
        })
    })

    test('Test Case 9: Search Product', async ({ ai }) => {
        await test.step('Navigate to automationexercise.com', async () => {
            await ai.run({
                action: `Navigate to http://automationexercise.com/ and accept data consent if prompted.`,
                expect: `Home page is visible successfully`
            })
        })

        await test.step('Click on Products button', async () => {
            await ai.run({
                action: `Click on the 'Products' button in the navigation menu.`,
                expect: `User is navigated to ALL PRODUCTS page successfully`
            })
        })

        await test.step('Search for a product', async () => {
            await ai.run({
                action: `Type 'dress' into the search input field and click the search button.`,
                expect: `Search is executed successfully`
            })
        })

        await test.step('Verify search results', async () => {
            await ai.run({
                action: `Verify that 'SEARCHED PRODUCTS' heading is visible and products related to the search term 'dress' are displayed.`,
                expect: `'SEARCHED PRODUCTS' is visible and search results show dress-related products`
            })
        })
    })

    test('Test Case 10: Verify Subscription in home page', async ({ ai }) => {
        await test.step('Navigate to automationexercise.com', async () => {
            await ai.run({
                action: `Navigate to http://automationexercise.com/ and accept data consent if prompted.`,
                expect: `Home page is visible successfully`
            })
        })

        await test.step('Scroll to footer and verify subscription section', async () => {
            await ai.run({
                action: `Scroll down to the footer of the page and verify that the 'SUBSCRIPTION' text is visible.`,
                expect: `'SUBSCRIPTION' text is visible in the footer`
            })
        })

        await test.step('Subscribe with email', async () => {
            await ai.run({
                action: `Enter email address 'testsubscriber@example.com' in the subscription input field and click the arrow button to submit.`,
                expect: `Subscription form is submitted`
            })
        })

        await test.step('Verify subscription success message', async () => {
            await ai.run({
                action: `Verify that the success message 'You have been successfully subscribed!' is displayed.`,
                expect: `Success message 'You have been successfully subscribed!' is visible`
            })
        })
    })

    test('Test Case 11: Verify Subscription in Cart page', async ({ ai }) => {
        await test.step('Navigate to automationexercise.com', async () => {
            await ai.run({
                action: `Navigate to http://automationexercise.com/ and accept data consent if prompted.`,
                expect: `Home page is visible successfully`
            })
        })

        await test.step('Navigate to Cart page', async () => {
            await ai.run({
                action: `Click on the 'Cart' button in the navigation menu.`,
                expect: `User is navigated to the cart page`
            })
        })

        await test.step('Scroll to footer and verify subscription section', async () => {
            await ai.run({
                action: `Scroll down to the footer of the page and verify that the 'SUBSCRIPTION' text is visible.`,
                expect: `'SUBSCRIPTION' text is visible in the footer`
            })
        })

        await test.step('Subscribe with email', async () => {
            await ai.run({
                action: `Enter email address 'cartsubscriber@example.com' in the subscription input field and click the arrow button to submit.`,
                expect: `Subscription form is submitted`
            })
        })

        await test.step('Verify subscription success message', async () => {
            await ai.run({
                action: `Verify that the success message 'You have been successfully subscribed!' is displayed.`,
                expect: `Success message 'You have been successfully subscribed!' is visible`
            })
        })
    })

    test('Test Case 12: Add Products in Cart', async ({ ai }) => {
        await test.step('Navigate to automationexercise.com', async () => {
            await ai.run({
                action: `Navigate to http://automationexercise.com/ and accept data consent if prompted.`,
                expect: `Home page is visible successfully`
            })
        })

        await test.step('Navigate to Products page', async () => {
            await ai.run({
                action: `Click on the 'Products' button in the navigation menu.`,
                expect: `User is navigated to ALL PRODUCTS page`
            })
        })

        await test.step('Add first product to cart', async () => {
            await ai.run({
                action: `Hover over the first product and click the 'Add to cart' button.`,
                expect: `First product is added to cart and a modal or notification appears`
            })
        })

        await test.step('Continue shopping', async () => {
            await ai.run({
                action: `Click the 'Continue Shopping' button to close the modal.`,
                expect: `Modal is closed and user remains on the products page`
            })
        })

        await test.step('Add second product to cart', async () => {
            await ai.run({
                action: `Hover over the second product and click the 'Add to cart' button.`,
                expect: `Second product is added to cart and a modal appears`
            })
        })

        await test.step('View cart', async () => {
            await ai.run({
                action: `Click the 'View Cart' button.`,
                expect: `User is navigated to the cart page`
            })
        })

        await test.step('Verify both products in cart', async () => {
            await ai.run({
                action: `Verify that both products are displayed in the cart with their prices, quantities, and total prices.`,
                expect: `Both products are visible in the cart with correct prices, quantity (1 each), and calculated total prices`
            })
        })
    })

    test('Test Case 13: Verify Product quantity in Cart', async ({ ai }) => {
        await test.step('Navigate to automationexercise.com', async () => {
            await ai.run({
                action: `Navigate to http://automationexercise.com/ and accept data consent if prompted.`,
                expect: `Home page is visible successfully`
            })
        })

        await test.step('View product details', async () => {
            await ai.run({
                action: `Click on 'View Product' button for any product visible on the home page.`,
                expect: `Product detail page is opened successfully`
            })
        })

        await test.step('Increase product quantity', async () => {
            await ai.run({
                action: `Find the quantity input field and increase the quantity to 4.`,
                expect: `Quantity is set to 4`
            })
        })

        await test.step('Add product to cart', async () => {
            await ai.run({
                action: `Click the 'Add to cart' button.`,
                expect: `Product is added to cart with the specified quantity`
            })
        })

        await test.step('View cart and verify quantity', async () => {
            await ai.run({
                action: `Click the 'View Cart' button and verify that the product is displayed with quantity 4.`,
                expect: `Product is displayed in cart with exact quantity of 4`
            })
        })
    })

    test('Test Case 17: Remove Products From Cart', async ({ ai }) => {
        await test.step('Navigate to automationexercise.com', async () => {
            await ai.run({
                action: `Navigate to http://automationexercise.com/ and accept data consent if prompted.`,
                expect: `Home page is visible successfully`
            })
        })

        await test.step('Add products to cart', async () => {
            await ai.run({
                action: `Click on the 'Products' button, then hover over a product and click 'Add to cart'. Click 'Continue Shopping' and add another product to cart.`,
                expect: `Multiple products are added to cart`
            })
        })

        await test.step('Navigate to cart', async () => {
            await ai.run({
                action: `Click on the 'Cart' button in the navigation menu.`,
                expect: `Cart page is displayed with added products`
            })
        })

        await test.step('Remove product from cart', async () => {
            await ai.run({
                action: `Click the 'X' button (remove icon) corresponding to the first product in the cart.`,
                expect: `Product is removed from the cart`
            })
        })

        await test.step('Verify product removal', async () => {
            await ai.run({
                action: `Verify that the removed product is no longer displayed in the cart.`,
                expect: `The removed product is not visible in the cart anymore`
            })
        })
    })

    test('Test Case 18: View Category Products', async ({ ai }) => {
        await test.step('Navigate to automationexercise.com', async () => {
            await ai.run({
                action: `Navigate to http://automationexercise.com/ and accept data consent if prompted.`,
                expect: `Home page is visible successfully`
            })
        })

        await test.step('Verify categories are visible', async () => {
            await ai.run({
                action: `Verify that product categories are visible in the left sidebar.`,
                expect: `Categories section is visible on the left side bar`
            })
        })

        await test.step('Click on Women category', async () => {
            await ai.run({
                action: `Click on the 'Women' category in the left sidebar to expand it.`,
                expect: `Women category is expanded showing sub-categories`
            })
        })

        await test.step('Select subcategory under Women', async () => {
            await ai.run({
                action: `Click on any sub-category link under 'Women' category, such as 'Dress' or 'Tops'.`,
                expect: `User is navigated to the selected category page`
            })
        })

        await test.step('Verify category page', async () => {
            await ai.run({
                action: `Verify that the category page is displayed with the appropriate category title (e.g., 'WOMEN - DRESS PRODUCTS' or 'WOMEN - TOPS PRODUCTS').`,
                expect: `Category page is displayed with category title and related products`
            })
        })

        await test.step('Navigate to Men category', async () => {
            await ai.run({
                action: `On the left sidebar, click on the 'Men' category to expand it, then click on any sub-category link under 'Men'.`,
                expect: `User is navigated to the selected Men category page`
            })
        })

        await test.step('Verify Men category page', async () => {
            await ai.run({
                action: `Verify that the Men category page is displayed with appropriate products.`,
                expect: `Men category page is displayed with category-specific products`
            })
        })
    })

    test('Test Case 19: View & Cart Brand Products', async ({ ai }) => {
        await test.step('Navigate to automationexercise.com', async () => {
            await ai.run({
                action: `Navigate to http://automationexercise.com/ and accept data consent if prompted.`,
                expect: `Home page is visible successfully`
            })
        })

        await test.step('Navigate to Products page', async () => {
            await ai.run({
                action: `Click on the 'Products' button in the navigation menu.`,
                expect: `User is navigated to ALL PRODUCTS page`
            })
        })

        await test.step('Verify brands are visible', async () => {
            await ai.run({
                action: `Verify that the 'Brands' section is visible in the left sidebar.`,
                expect: `Brands section is visible on the left side bar with a list of brand names`
            })
        })

        await test.step('Click on a brand', async () => {
            await ai.run({
                action: `Click on any brand name from the brands list in the left sidebar.`,
                expect: `User is navigated to the brand page`
            })
        })

        await test.step('Verify brand page and products', async () => {
            await ai.run({
                action: `Verify that the brand page is displayed with the brand name in the title and shows products from that brand.`,
                expect: `Brand page is displayed with brand-specific products`
            })
        })

        await test.step('Navigate to another brand', async () => {
            await ai.run({
                action: `On the left sidebar, click on a different brand name.`,
                expect: `User is navigated to the new brand page`
            })
        })

        await test.step('Verify second brand page', async () => {
            await ai.run({
                action: `Verify that the new brand page is displayed with products from the selected brand.`,
                expect: `Second brand page is displayed with correct brand products`
            })
        })
    })

    test('Test Case 21: Add review on product', async ({ ai }) => {
        await test.step('Navigate to automationexercise.com', async () => {
            await ai.run({
                action: `Navigate to http://automationexercise.com/ and accept data consent if prompted.`,
                expect: `Home page is visible successfully`
            })
        })

        await test.step('Navigate to Products page', async () => {
            await ai.run({
                action: `Click on the 'Products' button in the navigation menu.`,
                expect: `User is navigated to ALL PRODUCTS page successfully`
            })
        })

        await test.step('View product details', async () => {
            await ai.run({
                action: `Click on the 'View Product' button for any product.`,
                expect: `Product detail page is opened`
            })
        })

        await test.step('Verify review section is visible', async () => {
            await ai.run({
                action: `Scroll down to verify that 'Write Your Review' section is visible on the product detail page.`,
                expect: `'Write Your Review' section is visible`
            })
        })

        await test.step('Fill review form', async () => {
            await ai.run({
                action: `Enter the following review details:
                - Name: 'John Doe'
                - Email: 'johndoe@example.com'
                - Review: 'This is a great product! Highly recommend it for quality and value.'
                Then click the 'Submit' button.`,
                expect: `Review form is submitted`
            })
        })

        await test.step('Verify review success message', async () => {
            await ai.run({
                action: `Verify that the success message 'Thank you for your review.' is displayed.`,
                expect: `Success message 'Thank you for your review.' is visible`
            })
        })
    })

    test('Test Case 22: Add to cart from Recommended items', async ({ ai }) => {
        await test.step('Navigate to automationexercise.com', async () => {
            await ai.run({
                action: `Navigate to http://automationexercise.com/ and accept data consent if prompted.`,
                expect: `Home page is visible successfully`
            })
        })

        await test.step('Scroll to recommended items section', async () => {
            await ai.run({
                action: `Scroll down to the bottom of the home page to find the 'RECOMMENDED ITEMS' section.`,
                expect: `'RECOMMENDED ITEMS' section is visible`
            })
        })

        await test.step('Add recommended product to cart', async () => {
            await ai.run({
                action: `Click on the 'Add To Cart' button for one of the recommended products.`,
                expect: `Product is added to cart and a modal appears`
            })
        })

        await test.step('View cart', async () => {
            await ai.run({
                action: `Click the 'View Cart' button.`,
                expect: `User is navigated to the cart page`
            })
        })

        await test.step('Verify recommended product in cart', async () => {
            await ai.run({
                action: `Verify that the recommended product is displayed in the cart page.`,
                expect: `The recommended product is visible in the cart`
            })
        })
    })

    test('Test Case 25: Verify Scroll Up using Arrow button and Scroll Down functionality', async ({ ai }) => {
        await test.step('Navigate to automationexercise.com', async () => {
            await ai.run({
                action: `Navigate to http://automationexercise.com/ and accept data consent if prompted.`,
                expect: `Home page is visible successfully`
            })
        })

        await test.step('Scroll down to bottom', async () => {
            await ai.run({
                action: `Scroll down to the bottom of the page.`,
                expect: `Page is scrolled to the bottom`
            })
        })

        await test.step('Verify subscription section is visible', async () => {
            await ai.run({
                action: `Verify that the 'SUBSCRIPTION' text is visible in the footer.`,
                expect: `'SUBSCRIPTION' is visible at the bottom of the page`
            })
        })

        await test.step('Click arrow button to scroll up', async () => {
            await ai.run({
                action: `Click on the arrow button at the bottom right corner of the page to scroll up.`,
                expect: `Page scrolls up smoothly`
            })
        })

        await test.step('Verify page scrolled to top', async () => {
            await ai.run({
                action: `Verify that the page has scrolled to the top and the text 'Full-Fledged practice website for Automation Engineers' is visible.`,
                expect: `Page is scrolled to top and 'Full-Fledged practice website for Automation Engineers' text is visible`
            })
        })
    })

    test('Test Case 26: Verify Scroll Up without Arrow button and Scroll Down functionality', async ({ ai }) => {
        await test.step('Navigate to automationexercise.com', async () => {
            await ai.run({
                action: `Navigate to http://automationexercise.com/ and accept data consent if prompted.`,
                expect: `Home page is visible successfully`
            })
        })

        await test.step('Scroll down to bottom', async () => {
            await ai.run({
                action: `Scroll down to the bottom of the page.`,
                expect: `Page is scrolled to the bottom`
            })
        })

        await test.step('Verify subscription section is visible', async () => {
            await ai.run({
                action: `Verify that the 'SUBSCRIPTION' text is visible in the footer.`,
                expect: `'SUBSCRIPTION' is visible at the bottom of the page`
            })
        })

        await test.step('Scroll up to top without arrow button', async () => {
            await ai.run({
                action: `Scroll up to the top of the page without using the arrow button (using browser scroll functionality).`,
                expect: `Page scrolls up to the top`
            })
        })

        await test.step('Verify page scrolled to top', async () => {
            await ai.run({
                action: `Verify that the page has scrolled to the top and the text 'Full-Fledged practice website for Automation Engineers' is visible.`,
                expect: `Page is scrolled to top and 'Full-Fledged practice website for Automation Engineers' text is visible`
            })
        })
    })
})