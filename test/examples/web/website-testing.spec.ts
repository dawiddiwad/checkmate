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
 *   - NYPL: check availability for "The Catcher in the Rye" - with and without fuzzy search.
 *
 * - Multi-step (polymer-shop):
 *   - Full AI mode: all steps executed via `ai.run`.
 *   - Hybrid mode: mix of `ai.run` steps and direct Playwright commands.
 *
 * @note
 * All tests use the `ai` fixture and call `ai.run({ action, expect })`
 * to describe actions and assert visible outcomes.
 */
import { test } from '../../fixtures/checkmate'

test.describe('single-step : quick examples', async () => {
	test('browsing ollama models', async ({ ai }) => {
		await test.step('Navigate to ollama.com and search for model details', async () => {
			await ai.run({
				action: `
                Navigate to https://ollama.com/cloud
                Type 'qwen3' into the 'Search models' search bar
                Click on 'qwen3-vl' link from the results,
                Click on 'qwen3-vl:235b' link from the models list,`,
				expect: `
				qwen3-vl:235b model page is displayed with model details,
                describing its features and capabilities.`,
			})
		})
	})

	test('browsing huggingface models', async ({ ai }) => {
		await test.step('Navigate to huggingface.co', async () => {
			await ai.run({
				action: `
				Navigate to the https://huggingface.co website.
				Type 'Qwen3-VL-4B' in the search bar.
				Click on the 'Qwen/Qwen3-VL-4B-Instruct' link from the search results.`,
				expect: `
				Qwen3-VL-4B-Instruct model page is displayed with model details`,
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
                Search for 'The Catcher in the Rye'.`,
				expect: `
				'The Catcher in the Rye' physical branch's bookshelf availability information is displayed.`,
			})
		})
	})

	test('searching new york public library - fuzzy search enabled', async ({ ai }) => {
		await test.step('the catcher in the rye availability', async () => {
			await ai.run({
				action: `
                Navigate to https://www.nypl.org. 
                Search for 'The Catcher in the Rye'.`,
				expect: `
				'The Catcher in the Rye' physical branch's bookshelf availability information is displayed.`,
				search: ['search', 'the catcher in the rye', 'shelf'], // fuzzy search (~50-70% token savings)
			})
		})
	})
})

test.describe('multi-step : Polymer Shop : full AI mode', async () => {
	test.beforeEach(async ({ ai }) => {
		await ai.run({
			action: `Navigate to https://shop.polymer-project.org/`,
			expect: `Polymer Shop home page is loaded`,
		})
	})

	test('successful end-to-end purchase flow', async ({ ai }) => {
		await test.step('Navigate to shop and select product', async () => {
			await ai.run({
				action: `
				Click "Shop Now" on "Men's Outerwear" category
				Click on the first product: "Men's Tech Shell Full-Zip"`,
				expect: `Product detail page is displayed with title, price, and selectors`,
			})
		})

		await test.step('Add product to cart and proceed to checkout', async () => {
			await ai.run({
				action: `
				Click "Add to Cart"
				Click "Checkout" in the "Added to cart" dialog`,
				expect: `Checkout page loads showing the 'Order Summary' with correct total`,
			})
		})

		await test.step('Fill checkout details and place order', async () => {
			await ai.run({
				action: `
				Fill in the required fields in one go:
				- Email: 'test@example.com'
				- Phone: '1234567890'
				- Address: '123 Test St'
				- City: 'Test City'
				- State: 'Test State'
				- Zip: '12345'
				- Country: 'Canada'
				- Cardholder: 'Test User'
				- Card Number: '1111222233334444'
				- Expiry month: 'Dec'
				- Expiry year: '2026'
				- CVV: '123'
				Click "Place Order"`,
				expect: `Demo checkout process completed message is displayed along with Finish button`,
			})
		})

		await test.step('Finish and return to home', async () => {
			await ai.run({
				action: `Click the "Finish" button on the confirmation page.`,
				expect: `User is returned to the home page`,
			})
		})
	})

	test('cart management - adding multiple items & verifying total', async ({ ai }) => {
		await test.step('Add items from different categories', async () => {
			await ai.run({
				action: `
				Go to 'Ladies Outerwear' and add an item to the cart.
				Press page up to return to the top.
				Go back to home page, navigate to 'Men's T-Shirts' and add an item to the cart.`,
				expect: `Cart counter in the header updates to '2'`,
			})
		})

		await test.step('Verify cart total', async () => {
			await ai.run({
				action: `Click the Cart icon in the header.`,
				expect: `The 'Your Cart' page shows both items and the 'Total' matches the sum of individual prices.`,
			})
		})
	})

	test('cart management - updating quantity and removing items', async ({ ai }) => {
		await test.step('Add item and update quantity', async () => {
			await ai.run({
				action: `
				Add "Men's Tech Shell Full-Zip" to cart and click "View Cart".
				Select "2" from the "Quantity" dropdown for the item.`,
				expect: `The quantity is updated and total price reflects the change.`,
			})
		})

		await test.step('Remove item from cart', async () => {
			await ai.run({
				action: `Click the 'Delete' (trash icon) button for the item.`,
				expect: `The item is removed, cart shows 'Your cart is empty', and header counter is '0'.`,
			})
		})
	})

	test('category navigation & product display consistency', async ({ ai }) => {
		await test.step('Navigate between categories', async () => {
			await ai.run({
				action: `
				Click "Ladies T-Shirts" in the top navigation menu.
				Click "Men's Outerwear" in the top navigation menu.`,
				expect: `User can navigate between categories correctly.`,
			})
		})

		await test.step('Return to home via SHOP logo', async () => {
			await ai.run({
				action: `Click "SHOP" logo in the header.`,
				expect: `User is returned to the home page.`,
			})
		})
	})

	test('checkout form validation (error handling)', async ({ ai }) => {
		await test.step('Submit empty checkout form', async () => {
			await ai.run({
				action: `
				Add any item to cart and proceed to "Checkout".
				Click "Place Order" without filling any fields.`,
				expect: `Validation error messages like "Invalid Email" and "Invalid Address" are visible.`,
			})
		})

		await test.step('Verify persistent errors for invalid input', async () => {
			await ai.run({
				action: `Type 'invalid-email' in the Email field and click "Place Order".`,
				expect: `"Invalid Email" error message is still displayed.`,
			})
		})
	})
})

test.describe('multi-step : Polymer Shop : hybrid mode', async () => {
	test.beforeEach(async ({ page }) => {
		await page.goto('https://shop.polymer-project.org/')
	})

	test('successful end-to-end purchase flow', async ({ page, ai }) => {
		await test.step('Navigate to shop and select product', async () => {
			await page.getByRole('link', { name: "Men's Outerwear Shop Now" }).click()
			await page.getByRole('link', { name: "Men's Tech Shell Full-Zip Men" }).click()
			await ai.run({
				action: ``,
				expect: `Product detail page is displayed with title, price, and selectors`,
			})
		})

		await test.step('Add product to cart and proceed to checkout', async () => {
			await page.getByRole('button', { name: 'Add this item to cart' }).click()
			await page.getByRole('link', { name: 'Checkout' }).click()
			await ai.run({
				action: ``,
				expect: `Checkout page loads showing the 'Order Summary' with correct total`,
			})
		})

		await test.step('Fill checkout details and place order', async () => {
			await ai.run({
				action: `
				Fill in the required fields in one go:
				- Email: 'test@example.com'
				- Phone: '1234567890'
				- Address: '123 Test St'
				- City: 'Test City'
				- State: 'Test State'
				- Zip: '12345'
				- Country: 'Canada'
				- Cardholder: 'Test User'
				- Card Number: '1111222233334444'
				- Expiry month: 'Dec'
				- Expiry year: '2026'
				- CVV: '123'
				Click "Place Order"`,
				expect: `Demo checkout process completed message is displayed along with Finish button`,
			})
		})

		await test.step('Finish and return to home', async () => {
			await ai.run({
				action: `Click the "Finish" button on the confirmation page.`,
				expect: `User is returned to the home page`,
			})
		})
	})
})
