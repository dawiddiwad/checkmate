/**
 * @fileoverview
 * Playwright E2E tests for various websites.
 *
 * @summary
 * Examples of single-step and multi-step AI-driven web interactions using Playwright and _checkmate_.
 *
 * @description
 * - Single-step:
 *   - Ollama: search for "qwen3" and open the qwen3-vl model page.
 *   - HuggingFace: search for "Qwen3-VL-4B" and open the model page.
 *   - Mojeek: search Playwright docs and open the Planner Agent page.
 *   - NYPL: check availability for "The Catcher in the Rye".
 *
 * - Multi-step (automationexercise.com):
 *   - Full AI mode: all steps executed via `ai.run`.
 *   - Hybrid mode: mix of `ai.run` steps and direct Playwright commands.
 *
 * @note
 * All tests use the `ai` fixture and call `ai.run({ action, expect })`
 * to describe actions and assert visible outcomes.
 */
import { test } from '../../fixtures/checkmate'

test.describe('single-step flows - quick examples', async () => {
	test('browsing ollama models', async ({ ai }) => {
		await test.step('Navigate to ollama.com', async () => {
			await ai.run({
				action: `Navigate to https://ollama.com/`,
				expect: `Ollama homepage is visible`,
			})
		})

		await test.step("Search for 'qwen3' in the models search bar", async () => {
			await ai.run({
				action: `Type 'qwen3' into the 'Search models' search bar and submit the search.`,
				expect: `Search results include qwen3-related models`,
			})
		})

		await test.step("Open the 'qwen3-vl' model page", async () => {
			await ai.run({
				action: `Click on the 'qwen3-vl' link from the search results.`,
				expect: `qwen3-vl model page is displayed`,
			})
		})

		await test.step("Open the 'qwen3-vl:235b' variant and verify details", async () => {
			await ai.run({
				action: `Click on the 'qwen3-vl:235b' link from the models list.`,
				expect: `qwen3-vl:235b model page is displayed with model details describing its features and capabilities.`,
			})
		})
	})

	test('browsing huggingface models', async ({ ai }) => {
		await test.step('Navigate to huggingface.co', async () => {
			await ai.run({
				action: `
                    Navigate to the https://huggingface.co website.
                    Type 'Qwen3-VL-4B' in the search bar.
                    Click on the 'Qwen/Qwen3-VL-4B-Instruct' link from the search results.
                    `,
				expect: `Qwen3-VL-4B-Instruct model page is displayed with model details`,
			})
		})
	})

	test('searching with mojeek', async ({ ai }) => {
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
                The Planner Agent documentation page is displayed, providing details on how to use this agent within Playwright.`,
			})
		})
	})

	test('searching new york public library', async ({ ai }) => {
		await test.step('the catcher in the rye availability', async () => {
			await ai.run({
				action: `
                Navigate to https://www.nypl.org. 
                Search for 'The Catcher in the Rye.`,
				expect: `
                'The Catcher in the Rye' physical branch's bookshelf availability information is displayed.`,
			})
		})
	})
})

test.describe('multi-step flow - Automation Exercise Regression - full ai mode', async () => {
	test('registering new user and deleting account', async ({ ai }) => {
		await test.step('Navigate to automationexercise.com and open signup', async () => {
			await ai.run({
				action: `Navigate to http://automationexercise.com/ and accept data consent if prompted.
                Click on the 'Signup / Login' button in the navigation menu.`,
				expect: `The 'New User Signup!' section is visible`,
			})
		})

		await test.step('Enter name and unique email, click Signup', async () => {
			await ai.run({
				action: `In the 'New User Signup!' form enter Name: 'Test User' and a unique Email address (for example: testuser+<timestamp>@example.com).
                Click the 'Signup' button.
                If Email already exists error appears, generate a new unique email and retry by clicking the 'Signup' button again.`,
				expect: `The 'ENTER ACCOUNT INFORMATION' section is visible`,
			})
		})

		await test.step('Fill account information and create account (single step)', async () => {
			await ai.run({
				action: `On the 'ENTER ACCOUNT INFORMATION' form fill all required fields in one step:
                - Title: 'Mr'
                - Password: 'P@ssw0rd123'
                - Date of birth: Day: 1, Month: January, Year: 1990
                - Check 'Sign up for our newsletter!'
                - Check 'Receive special offers from our partners!'
                - First name: 'Test'
                - Last name: 'User'
                - Company: 'TestCompany'
                - Address: '123 Test St'
                - Address2: 'Suite 100'
                - Country: 'United States'
                - State: 'TestState'
                - City: 'TestCity'
                - Zipcode: '12345'
                - Mobile Number: '+15551234567'
                Then click the 'Create Account' button.`,
				expect: `Account registration completes and 'ACCOUNT CREATED!' message is visible`,
			})
		})

		await test.step('Continue and verify user is logged in', async () => {
			await ai.run({
				action: `Click the 'Continue' button on the 'ACCOUNT CREATED!' page or modal. If any popups appear, accept them.
                Verify that 'Logged in as Test User' (or the provided name) is visible in the header.`,
				expect: `'Logged in as Test User' is visible`,
			})
		})

		await test.step('Click the Delete Account button', async () => {
			await ai.run({
				action: `Click the 'Delete Account' button from the header or account menu. If any popups appear, accept them.`,
				expect: `'ACCOUNT DELETED!' is visible and account deletion is confirmed`,
			})
		})

		await test.step('Verify account deletion and finish', async () => {
			await ai.run({
				action: `Click the 'Continue' button to finish deletion.`,
				expect: `User is redirected to home page and account deletion and is no longer logged in`,
			})
		})
	})

	test('verifying test cases page', async ({ ai }) => {
		await test.step('Navigate to automationexercise.com', async () => {
			await ai.run({
				action: `Navigate to http://automationexercise.com/ and accept data consent if prompted.`,
				expect: `Home page is visible successfully`,
			})
		})

		await test.step('Click on Test Cases button', async () => {
			await ai.run({
				action: `Click on the 'Test Cases' button in the navigation menu.`,
				expect: `User is navigated to the test cases page successfully with a list of test cases displayed`,
			})
		})
	})

	test('verifying all products and product detail page', async ({ ai }) => {
		await test.step('Navigate to automationexercise.com', async () => {
			await ai.run({
				action: `Navigate to http://automationexercise.com/ and accept data consent if prompted.`,
				expect: `Home page is visible successfully`,
			})
		})

		await test.step('Click on Products button', async () => {
			await ai.run({
				action: `Click on the 'Products' button in the navigation menu.`,
				expect: `User is navigated to ALL PRODUCTS page successfully`,
			})
		})

		await test.step('Verify products list is visible', async () => {
			await ai.run({
				action: `Verify that the products list is visible and displays multiple products.`,
				expect: `The products list is visible with multiple product cards`,
			})
		})

		await test.step('View first product details', async () => {
			await ai.run({
				action: `Click on the 'View Product' button for the first product in the list.`,
				expect: `User is navigated to the product detail page`,
			})
		})

		await test.step('Verify product details are visible', async () => {
			await ai.run({
				action: `Verify that the product detail page displays all required information including product name, category, price, availability, condition, and brand.`,
				expect: `Product detail page shows: product name, category, price, availability, condition, and brand`,
			})
		})
	})

	test('searching product', async ({ ai }) => {
		await test.step('Navigate to automationexercise.com', async () => {
			await ai.run({
				action: `Navigate to http://automationexercise.com/ and accept data consent if prompted.`,
				expect: `Home page is visible successfully`,
			})
		})

		await test.step('Click on Products button', async () => {
			await ai.run({
				action: `Click on the 'Products' button in the navigation menu.`,
				expect: `User is navigated to ALL PRODUCTS page successfully`,
			})
		})

		await test.step('Search for a product', async () => {
			await ai.run({
				action: `Type 'dress' into the search input field and click the search button.`,
				expect: `Search is executed successfully`,
			})
		})

		await test.step('Verify search results', async () => {
			await ai.run({
				action: `Verify that 'SEARCHED PRODUCTS' heading is visible and products related to the search term 'dress' are displayed.`,
				expect: `'SEARCHED PRODUCTS' is visible and search results show dress-related products`,
			})
		})
	})

	test('verifying subscription in home page', async ({ ai }) => {
		await test.step('Navigate to automationexercise.com', async () => {
			await ai.run({
				action: `Navigate to http://automationexercise.com/ and accept data consent if prompted.`,
				expect: `Home page is visible successfully`,
			})
		})

		await test.step('Scroll to footer and verify subscription section', async () => {
			await ai.run({
				action: `Scroll down to the footer of the page and verify that the 'SUBSCRIPTION' text is visible.`,
				expect: `'SUBSCRIPTION' text is visible in the footer`,
			})
		})

		await test.step('Subscribe with email', async () => {
			await ai.run({
				action: `Enter email address 'testsubscriber@example.com' in the subscription input field and click the arrow button to submit.`,
				expect: `Subscription form is submitted and message 'You have been successfully subscribed!' was displayed for at least 1 second`,
			})
		})
	})

	test('verifying subscription in cart page', async ({ ai }) => {
		await test.step('Navigate to automationexercise.com', async () => {
			await ai.run({
				action: `Navigate to http://automationexercise.com/ and accept data consent if prompted.`,
				expect: `Home page is visible successfully`,
			})
		})

		await test.step('Navigate to Cart page', async () => {
			await ai.run({
				action: `Click on the 'Cart' button in the navigation menu.`,
				expect: `User is navigated to the cart page`,
			})
		})

		await test.step('Scroll to footer and verify subscription section', async () => {
			await ai.run({
				action: `Scroll down to the footer of the page and verify that the 'SUBSCRIPTION' text is visible.`,
				expect: `'SUBSCRIPTION' text is visible in the footer`,
			})
		})

		await test.step('Subscribe with email', async () => {
			await ai.run({
				action: `Enter email address 'cartsubscriber@example.com' in the subscription input field and click the arrow button to submit.`,
				expect: `Subscription form is submitted and message 'You have been successfully subscribed!' was displayed for at least 1 second`,
			})
		})
	})

	test('adding products in cart', async ({ ai }) => {
		await test.step('Navigate to automationexercise.com', async () => {
			await ai.run({
				action: `Navigate to http://automationexercise.com/ and accept data consent if prompted.`,
				expect: `Home page is visible successfully`,
			})
		})

		await test.step('Navigate to Products page', async () => {
			await ai.run({
				action: `Click on the 'Products' button in the navigation menu.`,
				expect: `User is navigated to ALL PRODUCTS page`,
			})
		})

		await test.step('Add first product to cart', async () => {
			await ai.run({
				action: `Hover over the 1st product on the list and click the 'Add to cart' button.`,
				expect: `Product is added to cart and a modal or notification appears`,
			})
		})

		await test.step('Continue shopping', async () => {
			await ai.run({
				action: `Click the 'Continue Shopping' button to close the modal.`,
				expect: `Modal is closed and user remains on the products page`,
			})
		})

		await test.step('Add second product to cart', async () => {
			await ai.run({
				action: `Click 'View Product' for the 2nd product on the list and click the 'Add to cart' button.`,
				expect: `Product is added to cart and a modal appears`,
			})
		})

		await test.step('Continue shopping', async () => {
			await ai.run({
				action: `Click the 'Continue Shopping' button to close the modal.`,
				expect: `Modal is closed and user remains on the product details page`,
			})
		})

		await test.step('View cart', async () => {
			await ai.run({
				action: `Click the 'View Cart' button.`,
				expect: `User is navigated to the cart page`,
			})
		})

		await test.step('Verify both products in cart', async () => {
			await ai.run({
				action: `Verify that both products are displayed in the cart with their prices, quantities, and total prices.`,
				expect: `Both products are visible in the cart with correct prices, quantity (1 each), and calculated total prices`,
			})
		})
	})

	test('verifying product quantity in cart', async ({ ai }) => {
		await test.step('Navigate to automationexercise.com', async () => {
			await ai.run({
				action: `Navigate to http://automationexercise.com/ and accept data consent if prompted.`,
				expect: `Home page is visible successfully`,
			})
		})

		await test.step('View product details', async () => {
			await ai.run({
				action: `Click on 'View Product' button for any product visible on the home page.`,
				expect: `Product detail page is opened successfully`,
			})
		})

		await test.step('Increase product quantity', async () => {
			await ai.run({
				action: `Find the quantity input field and increase the quantity to 4.`,
				expect: `Quantity is set to 4`,
			})
		})

		await test.step('Add product to cart', async () => {
			await ai.run({
				action: `Click the 'Add to cart' button.`,
				expect: `'Your Product has been added to the cart' message is displayed`,
			})
		})

		await test.step('View cart and verify quantity', async () => {
			await ai.run({
				action: `Click the 'View Cart' button and verify that the product is displayed with quantity 4.`,
				expect: `Product is displayed in cart with exact quantity of 4`,
			})
		})
	})

	test('removing products from cart', async ({ ai }) => {
		await test.step('Navigate to automationexercise.com', async () => {
			await ai.run({
				action: `Navigate to http://automationexercise.com/ and accept data consent if prompted.`,
				expect: `Home page is visible successfully`,
			})
		})

		await test.step('Add products to cart', async () => {
			await ai.run({
				action: `Click on the 'Products' button and select to view first product details.
                Click 'Add to cart' button and then click 'Continue Shopping' button.
                Click on the 'Products' button and proceed to another product details.
                Click 'Add to cart' button and then click 'Continue Shopping' button.
                Proceed to the Cart view.
                .`,
				expect: `Cart page is displayed with 2 products`,
			})
		})

		await test.step('Remove product from cart', async () => {
			await ai.run({
				action: `Click the 'X' button (remove icon) corresponding to the first product in the cart.`,
				expect: `Product is removed and only one remains in the cart`,
			})
		})
	})

	test('viewing category products', async ({ ai }) => {
		await test.step('Navigate to automationexercise.com', async () => {
			await ai.run({
				action: `Navigate to http://automationexercise.com/ and accept data consent if prompted.`,
				expect: `Home page is visible successfully`,
			})
		})

		await test.step('Verify categories are visible', async () => {
			await ai.run({
				action: `Verify that product categories are visible in the left sidebar.`,
				expect: `Categories section is visible on the left side bar`,
			})
		})

		await test.step('Click on Women category', async () => {
			await ai.run({
				action: `Click on the 'Women' category in the left sidebar to expand it.`,
				expect: `Women category is expanded showing sub-categories`,
			})
		})

		await test.step('Select subcategory under Women', async () => {
			await ai.run({
				action: `Click on any sub-category link under 'Women' category, such as 'Dress' or 'Tops'.`,
				expect: `User is navigated to the selected category page`,
			})
		})

		await test.step('Verify category page', async () => {
			await ai.run({
				action: `Verify that the category page is displayed with the appropriate category title (e.g., 'WOMEN - DRESS PRODUCTS' or 'WOMEN - TOPS PRODUCTS').`,
				expect: `Category page is displayed with category title and related products`,
			})
		})

		await test.step('Navigate to Men category', async () => {
			await ai.run({
				action: `On the left sidebar, click on the 'Men' category to expand it.`,
				expect: `Men category is expanded showing sub-categories`,
			})
		})

		await test.step('Select subcategory under Men', async () => {
			await ai.run({
				action: `Click on any sub-category link under 'Men', such as 'JEANS' or 'Tops'.`,
				expect: `User is navigated to the selected Men category page`,
			})
		})

		await test.step('Verify Men category page', async () => {
			await ai.run({
				action: `Verify that the Men category page is displayed with appropriate products.`,
				expect: `Men category page is displayed with category-specific products`,
			})
		})
	})

	test('viewing & carting brand products', async ({ ai }) => {
		await test.step('Navigate to automationexercise.com', async () => {
			await ai.run({
				action: `Navigate to http://automationexercise.com/ and accept data consent if prompted.`,
				expect: `Home page is visible successfully`,
			})
		})

		await test.step('Navigate to Products page', async () => {
			await ai.run({
				action: `Click on the 'Products' button in the navigation menu.`,
				expect: `User is navigated to ALL PRODUCTS page`,
			})
		})

		await test.step('Verify brands are visible', async () => {
			await ai.run({
				action: `Verify that the 'Brands' section is visible in the left sidebar.`,
				expect: `Brands section is visible on the left side bar with a list of brand names`,
			})
		})

		await test.step('Click on a brand', async () => {
			await ai.run({
				action: `Click on any brand name from the brands list in the left sidebar.`,
				expect: `User is navigated to the brand page`,
			})
		})

		await test.step('Verify brand page and products', async () => {
			await ai.run({
				action: `Verify that the brand page is displayed with the brand name in the title and shows products from that brand.`,
				expect: `Brand page is displayed with brand-specific products`,
			})
		})

		await test.step('Navigate to another brand', async () => {
			await ai.run({
				action: `On the left sidebar, click on a different brand name.`,
				expect: `User is navigated to the new brand page`,
			})
		})

		await test.step('Verify second brand page', async () => {
			await ai.run({
				action: `Verify that the new brand page is displayed with products from the selected brand.`,
				expect: `Second brand page is displayed with correct brand products`,
			})
		})
	})

	test('adding review on product', async ({ ai }) => {
		await test.step('Navigate to automationexercise.com', async () => {
			await ai.run({
				action: `Navigate to http://automationexercise.com/ and accept data consent if prompted.`,
				expect: `Home page is visible successfully`,
			})
		})

		await test.step('Navigate to Products page', async () => {
			await ai.run({
				action: `Click on the 'Products' button in the navigation menu.`,
				expect: `User is navigated to ALL PRODUCTS page successfully`,
			})
		})

		await test.step('View product details', async () => {
			await ai.run({
				action: `Click on the 'View Product' button for any product.`,
				expect: `Product detail page is opened`,
			})
		})

		await test.step('Verify review section is visible', async () => {
			await ai.run({
				action: `Scroll down to verify that 'Write Your Review' section is visible on the product detail page.`,
				expect: `'Write Your Review' section is visible`,
			})
		})

		await test.step('Fill review form', async () => {
			await ai.run({
				action: `Enter the following review details:
                - Name: 'John Doe'
                - Email: 'johndoe@example.com'
                - Review: 'This is a great product! Highly recommend it for quality and value.'
                Then click the 'Submit' button.`,
				expect: `Review form is submitted and success message 'Thank you for your review.' was displayed for at least 2 seconds`,
			})
		})
	})
})

test.describe('multi-step flow - Automation Exercise Regression - hybrid ai mode + regular playwright', async () => {
	test.beforeEach(async ({ page }) => {
		await page.goto('http://automationexercise.com/')
		await page.getByRole('button', { name: 'Consent' }).click()
	})

	test('registering new user and deleting account', async ({ ai, page }) => {
		await test.step('Enter name and unique email, click Signup', async () => {
			await ai.run({
				action: `In the 'New User Signup!' form enter Name: 'Test User' and a unique Email address (for example: testuser+<timestamp>@example.com).
                Click the 'Signup' button.
                If Email already exists error appears, generate a new unique email and retry by clicking the 'Signup' button again.`,
				expect: `The 'ENTER ACCOUNT INFORMATION' section is visible`,
			})
		})

		await test.step('Fill account information and create account (single step)', async () => {
			await page.locator('#days').selectOption('1')
			await page.locator('#months').selectOption('1')
			await page.locator('#years').selectOption('1990')
			await page.getByLabel('Country *').selectOption('United States')
			await ai.run({
				action: `On the 'ENTER ACCOUNT INFORMATION' form fill all required fields in one step:
                - Title: 'Mr'
                - Password: 'P@ssw0rd123'
                - Check 'Sign up for our newsletter!'
                - Check 'Receive special offers from our partners!'
                - First name: 'Test'
                - Last name: 'User'
                - Company: 'TestCompany'
                - Address: '123 Test St'
                - Address2: 'Suite 100'
                - State: 'TestState'
                - City: 'TestCity'
                - Zipcode: '12345'
                - Mobile Number: '+15551234567'
                Then click the 'Create Account' button.`,
				expect: `Account registration completes and 'ACCOUNT CREATED!' message is visible`,
			})
		})

		await test.step('Continue and verify user is logged in', async () => {
			await ai.run({
				action: `Click the 'Continue' button on the 'ACCOUNT CREATED!' page or modal. If any popups appear, accept them.
                Verify that 'Logged in as Test User' (or the provided name) is visible in the header.`,
				expect: `'Logged in as Test User' is visible`,
			})
		})

		await test.step('Click the Delete Account button', async () => {
			await ai.run({
				action: `Click the 'Delete Account' button from the header or account menu. If any popups appear, accept them.`,
				expect: `'ACCOUNT DELETED!' is visible and account deletion is confirmed`,
			})
		})

		await test.step('Verify account deletion and finish', async () => {
			await ai.run({
				action: `Click the 'Continue' button to finish deletion.`,
				expect: `User is redirected to home page and account deletion and is no longer logged in`,
			})
		})
	})

	test('verifying test cases page', async ({ ai }) => {
		await test.step('Click on Test Cases button', async () => {
			await ai.run({
				action: `Click on the 'Test Cases' button in the navigation menu.`,
				expect: `User is navigated to the test cases page successfully with a list of test cases displayed`,
			})
		})
	})

	test('verifying all products and product detail page', async ({ ai, page }) => {
		await test.step('Click on Products button', async () => {
			await page.getByRole('link', { name: 'Products' }).click()
			await ai.run({
				action: `Verify ALL PRODUCTS page is displayed.`,
				expect: `User is navigated to ALL PRODUCTS page where list is visible with multiple product cards`,
			})
		})

		await test.step('View first product details', async () => {
			await page.getByRole('link', { name: 'View Product' }).first().click()
			await ai.run({
				action: `Verify that the product detail page displays required information`,
				expect: `Product detail page shows: product name, category, price, availability, condition, and brand`,
			})
		})
	})

	test('searching product', async ({ ai, page }) => {
		await test.step('Search for a dress products', async () => {
			await page.getByRole('link', { name: 'Products' }).click()
			await page.getByRole('textbox', { name: 'Search Product' }).fill('dress')
			await page.locator('#submit_search').click()
		})

		await test.step('Verify search results for dress products', async () => {
			await ai.run({
				action: `Verify that 'SEARCHED PRODUCTS' heading is visible and products related to the search term 'dress' are displayed.`,
				expect: `'SEARCHED PRODUCTS' is visible and search results show dress-related products`,
			})
		})
	})

	test('verifying subscription in home page', async ({ ai }) => {
		await test.step('Scroll to footer and verify subscription section', async () => {
			await ai.run({
				action: `Scroll down to the footer of the page and verify that the 'SUBSCRIPTION' text is visible.`,
				expect: `'SUBSCRIPTION' text is visible in the footer`,
			})
		})

		await test.step('Subscribe with email', async () => {
			await ai.run({
				action: `Enter email address 'testsubscriber@example.com' in the subscription input field and click the arrow button to submit.`,
				expect: `Subscription form is submitted and message 'You have been successfully subscribed!' was displayed for at least 1 second`,
			})
		})
	})

	test('verifying subscription in cart page', async ({ ai, page }) => {
		await test.step('Navigate to Cart page', async () => {
			await page.getByRole('link', { name: 'Cart' }).click()
		})

		await test.step('Verify subscription section', async () => {
			await ai.run({
				action: `Verify that the 'SUBSCRIPTION' text is visible.`,
				expect: `'SUBSCRIPTION' text is visible in the footer`,
			})
		})

		await test.step('Subscribe with email', async () => {
			await ai.run({
				action: `Enter email address 'cartsubscriber@example.com' in the subscription input field and click the arrow button to submit.`,
				expect: `Subscription form is submitted and message 'You have been successfully subscribed!' was displayed for at least 1 second`,
			})
		})
	})

	test('adding products in cart', async ({ ai, page }) => {
		await test.step('Navigate to Products page', async () => {
			await page.getByRole('link', { name: 'Products' }).click()
		})

		await test.step('Add first product to cart', async () => {
			await page.getByText('Add to cart').nth(0).hover()
			await page.getByText('Add to cart').nth(0).click()
			await page.getByRole('button', { name: 'Continue Shopping' }).click()
		})

		await test.step('Add second product to cart', async () => {
			await page.getByText('Add to cart').nth(2).hover()
			await page.getByText('Add to cart').nth(2).click()
			await page.getByRole('button', { name: 'Continue Shopping' }).click()
		})

		await test.step('Verify both products in cart', async () => {
			await page.getByRole('link', { name: 'Cart' }).click()
			await ai.run({
				action: `Verify that both products are displayed in the cart with their prices, quantities, and total prices.`,
				expect: `Both products are visible in the cart with correct prices, quantity (1 each), and calculated total prices`,
			})
		})
	})

	test('verifying product quantity in cart', async ({ ai, page }) => {
		await test.step('Add product to cart with quantity 4', async () => {
			await page.getByRole('link', { name: ' View Product' }).first().click()
			await page.locator('#quantity').fill('4')
			await page.getByText('Add to cart').click()
			await page.getByRole('link', { name: 'View Cart' }).click()
		})

		await test.step('View cart and verify quantity', async () => {
			await ai.run({
				action: `Verify Cart View is displayed with correct product count.`,
				expect: `Product is displayed in cart with exact quantity of 4`,
			})
		})
	})

	test('removing products from cart', async ({ ai, page }) => {
		await test.step('Navigate to Products page', async () => {
			await page.getByRole('link', { name: 'Products' }).click()
		})

		await test.step('Add first product to cart', async () => {
			await page.getByText('Add to cart').nth(0).hover()
			await page.getByText('Add to cart').nth(0).click()
			await page.getByRole('button', { name: 'Continue Shopping' }).click()
		})

		await test.step('Add second product to cart', async () => {
			await page.getByText('Add to cart').nth(2).hover()
			await page.getByText('Add to cart').nth(2).click()
			await page.getByRole('link', { name: 'View Cart' }).click()
		})

		await test.step('Remove product from cart', async () => {
			await ai.run({
				action: `Click the 'X' button (remove icon) corresponding to the first product in the cart.`,
				expect: `Product is removed and only one remains in the cart`,
			})
		})
	})

	test('viewing category products', async ({ ai }) => {
		await test.step('Verify categories are visible', async () => {
			await ai.run({
				action: `Verify that product categories are visible in the left sidebar.`,
				expect: `Categories section is visible on the left side bar`,
			})
		})

		await test.step('Click on Women category', async () => {
			await ai.run({
				action: `Click on the 'Women' category in the left sidebar to expand it.`,
				expect: `Women category is expanded showing sub-categories`,
			})
		})

		await test.step('Select subcategory under Women', async () => {
			await ai.run({
				action: `Click on any sub-category link under 'Women' category, such as 'Dress' or 'Tops'.`,
				expect: `User is navigated to the selected category page`,
			})
		})

		await test.step('Verify category page', async () => {
			await ai.run({
				action: `Verify that the category page is displayed with the appropriate category title (e.g., 'WOMEN - DRESS PRODUCTS' or 'WOMEN - TOPS PRODUCTS').`,
				expect: `Category page is displayed with category title and related products`,
			})
		})

		await test.step('Navigate to Men category', async () => {
			await ai.run({
				action: `On the left sidebar, click on the 'Men' category to expand it.`,
				expect: `Men category is expanded showing sub-categories`,
			})
		})

		await test.step('Select subcategory under Men', async () => {
			await ai.run({
				action: `Click on any sub-category link under 'Men', such as 'JEANS' or 'Tops'.`,
				expect: `User is navigated to the selected Men category page`,
			})
		})

		await test.step('Verify Men category page', async () => {
			await ai.run({
				action: `Verify that the Men category page is displayed with appropriate products.`,
				expect: `Men category page is displayed with category-specific products`,
			})
		})
	})

	test('viewing & carting brand products', async ({ ai }) => {
		await test.step('Navigate to Products page', async () => {
			await ai.run({
				action: `Click on the 'Products' button in the navigation menu.`,
				expect: `User is navigated to ALL PRODUCTS page`,
			})
		})

		await test.step('Verify brands are visible', async () => {
			await ai.run({
				action: `Verify that the 'Brands' section is visible in the left sidebar.`,
				expect: `Brands section is visible on the left side bar with a list of brand names`,
			})
		})

		await test.step('Click on a brand', async () => {
			await ai.run({
				action: `Click on any brand name from the brands list in the left sidebar.`,
				expect: `User is navigated to the brand page`,
			})
		})

		await test.step('Verify brand page and products', async () => {
			await ai.run({
				action: `Verify that the brand page is displayed with the brand name in the title and shows products from that brand.`,
				expect: `Brand page is displayed with brand-specific products`,
			})
		})

		await test.step('Navigate to another brand', async () => {
			await ai.run({
				action: `On the left sidebar, click on a different brand name.`,
				expect: `User is navigated to the new brand page`,
			})
		})

		await test.step('Verify second brand page', async () => {
			await ai.run({
				action: `Verify that the new brand page is displayed with products from the selected brand.`,
				expect: `Second brand page is displayed with correct brand products`,
			})
		})
	})

	test('adding review on product', async ({ ai, page }) => {
		await test.step('View product details', async () => {
			await page.getByRole('link', { name: 'Products' }).click()
			await page.getByRole('link', { name: 'View Product' }).first().click()
		})

		await test.step('Verify review section is visible', async () => {
			await ai.run({
				action: `Scroll down to verify that 'Write Your Review' section is visible on the product detail page.`,
				expect: `'Write Your Review' section is visible`,
			})
		})

		await test.step('Fill review form', async () => {
			await ai.run({
				action: `Enter the following review details:
                - Name: 'John Doe'
                - Email: 'johndoe@example.com'
                - Review: 'This is a great product! Highly recommend it for quality and value.'
                Then click the 'Submit' button.`,
				expect: `Review form is submitted and success message 'Thank you for your review.' was displayed for at least 2 seconds`,
			})
		})
	})
})
