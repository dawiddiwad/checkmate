import { describe, test, expect, beforeAll, afterAll, beforeEach } from 'vitest'
import { chromium, Browser, BrowserContext, Page } from 'playwright'
import { NetworkRequestRecorder } from '../tools/browser/network-request-recorder'

describe('NetworkRequestRecorder', () => {
	let browser: Browser
	let context: BrowserContext
	let page: Page
	let recorder: NetworkRequestRecorder

	beforeAll(async () => {
		browser = await chromium.launch({ headless: true })
		context = await browser.newContext()
		page = await context.newPage()

		await page.route('**/api/ok', (route) =>
			route.fulfill({ status: 200, contentType: 'application/json', body: '{"orderId":"ORD-8231"}' })
		)
		await page.route('**/api/boom', (route) =>
			route.fulfill({ status: 500, contentType: 'application/json', body: '{"error":"nope"}' })
		)
		await page.route('**/api/dead', (route) => route.abort('connectionrefused'))
		await page.route('**/static.css', (route) => route.fulfill({ status: 200, contentType: 'text/css', body: '' }))
		await page.route('https://shop.example.com/', (route) =>
			route.fulfill({ status: 200, contentType: 'text/html', body: '<html><head></head><body></body></html>' })
		)

		await page.goto('https://shop.example.com/')
		recorder = new NetworkRequestRecorder(context)
		recorder.attach()
	})

	afterAll(async () => {
		recorder?.detach()
		await page?.close()
		await context?.close()
		await browser?.close()
	})

	beforeEach(() => {
		recorder.reset()
	})

	test('lists page-initiated fetch calls with real statuses and durations', async () => {
		await page.evaluate(async () => {
			await fetch('/api/ok', { method: 'POST', body: '{}' })
			await fetch('/api/boom')
		})

		const records = recorder.list()
		expect(records).toHaveLength(2)
		expect(records[0]).toMatchObject({
			sequence: 1,
			method: 'POST',
			url: 'https://shop.example.com/api/ok',
			resourceType: 'fetch',
			status: 200,
			statusText: 'OK',
		})
		expect(records[0].completedAt).not.toBeNull()
		expect(records[1]).toMatchObject({ sequence: 2, method: 'GET', status: 500 })

		const formatted = recorder.format()
		expect(formatted).toContain('1. [POST] https://shop.example.com/api/ok => [200] OK (')
		expect(formatted).toContain('2. [GET] https://shop.example.com/api/boom => [500]')
	})

	test('surfaces an aborted route as FAILED', async () => {
		await page.evaluate(async () => {
			try {
				await fetch('/api/dead')
			} catch {
				/* expected */
			}
		})

		expect(recorder.format()).toContain(
			'1. [GET] https://shop.example.com/api/dead => [FAILED] net::ERR_CONNECTION_REFUSED'
		)
	})

	test('hides document and stylesheet requests unless static is requested', async () => {
		await page.evaluate(async () => {
			const link = document.createElement('link')
			link.rel = 'stylesheet'
			link.href = '/static.css'
			const loaded = new Promise<void>((resolve) => link.addEventListener('load', () => resolve()))
			document.head.appendChild(link)
			await loaded
			await fetch('/api/ok')
		})

		expect(recorder.list().map((record) => record.url)).toEqual(['https://shop.example.com/api/ok'])
		expect(recorder.list({ includeStatic: true }).map((record) => record.url)).toContain(
			'https://shop.example.com/static.css'
		)
	})

	test('reset drops requests captured before it', async () => {
		await page.evaluate(async () => {
			await fetch('/api/ok')
		})
		expect(recorder.list()).toHaveLength(1)

		recorder.reset()
		expect(recorder.list()).toHaveLength(0)
		expect(recorder.format()).toBe('')
	})
})
