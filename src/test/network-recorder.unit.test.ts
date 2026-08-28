import { describe, test, expect, beforeEach } from 'vitest'
import { EventEmitter } from 'events'
import { NetworkRequestRecorder } from '../tools/browser/network-request-recorder'
import type { BrowserContext, Request, Response } from '@playwright/test'

class FakeContext extends EventEmitter {
	on(event: string | symbol, listener: (...args: unknown[]) => void): this {
		this.addListener(event, listener)
		return this
	}

	off(event: string | symbol, listener: (...args: unknown[]) => void): this {
		this.removeListener(event, listener)
		return this
	}

	[key: string]: unknown
}

type FakeRequest = Request & { __setResponse: (response: Response) => void }

const makeRequest = (
	method: string,
	url: string,
	resourceType = 'fetch',
	errorText: string | null = null,
	options: { headers?: Record<string, string>; postData?: string | null } = {}
): FakeRequest => {
	let response: Response | null = null
	return {
		method: () => method,
		url: () => url,
		resourceType: () => resourceType,
		failure: () => (errorText === null ? null : { errorText }),
		headers: () => options.headers ?? {},
		postData: () => options.postData ?? null,
		response: () => Promise.resolve(response),
		__setResponse: (nextResponse: Response) => {
			response = nextResponse
		},
	} as unknown as FakeRequest
}

const makeResponse = (
	request: FakeRequest,
	status: number,
	statusText: string,
	options: { headers?: Record<string, string>; text?: string } = {}
): Response => {
	const response = {
		request: () => request,
		status: () => status,
		statusText: () => statusText,
		headers: () => options.headers ?? {},
		text: () => Promise.resolve(options.text ?? ''),
	} as unknown as Response
	request.__setResponse(response)
	return response
}

describe('NetworkRequestRecorder (unit)', () => {
	let context: FakeContext
	let clock: number
	const asContext = () => context as unknown as BrowserContext
	const createRecorder = () => new NetworkRequestRecorder(asContext(), () => clock)

	beforeEach(() => {
		context = new FakeContext()
		clock = 0
	})

	test('attaches and detaches with matching listener references', () => {
		const recorder = createRecorder()

		recorder.attach()
		expect(context.listenerCount('request')).toBe(1)
		expect(context.listenerCount('response')).toBe(1)
		expect(context.listenerCount('requestfailed')).toBe(1)

		recorder.detach()
		expect(context.listenerCount('request')).toBe(0)
		expect(context.listenerCount('response')).toBe(0)
		expect(context.listenerCount('requestfailed')).toBe(0)
	})

	test('records method, url, and status from request and response events', () => {
		const recorder = createRecorder()
		recorder.attach()

		const request = makeRequest('POST', 'https://shop.example.com/api/checkout')
		context.emit('request', request)
		clock = 231
		context.emit('response', makeResponse(request, 200, 'OK'))

		expect(recorder.list()).toEqual([
			{
				sequence: 1,
				method: 'POST',
				url: 'https://shop.example.com/api/checkout',
				resourceType: 'fetch',
				status: 200,
				statusText: 'OK',
				startedAt: 0,
				completedAt: 231,
			},
		])
		expect(recorder.format()).toBe(
			'Network requests since the last browser action (call again after the next action; numbers shown here become stale once you do):\n' +
				'1. [POST] https://shop.example.com/api/checkout => [200] OK (231ms)'
		)
	})

	test('marks failed requests FAILED with the error text', () => {
		const recorder = createRecorder()
		recorder.attach()

		const request = makeRequest(
			'POST',
			'https://shop.example.com/api/track',
			'fetch',
			'net::ERR_CONNECTION_REFUSED'
		)
		context.emit('request', request)
		context.emit('requestfailed', request)

		expect(recorder.format()).toContain(
			'1. [POST] https://shop.example.com/api/track => [FAILED] net::ERR_CONNECTION_REFUSED'
		)
	})

	test('keeps the observed status when a request fails after its response arrived', () => {
		const recorder = createRecorder()
		recorder.attach()

		const request = makeRequest('GET', 'https://shop.example.com/api/cart', 'fetch', 'net::ERR_ABORTED')
		context.emit('request', request)
		context.emit('response', makeResponse(request, 500, 'Internal Server Error'))
		context.emit('requestfailed', request)

		expect(recorder.format()).toContain(
			'1. [GET] https://shop.example.com/api/cart => [500] Internal Server Error (0ms)'
		)
	})

	test('leaves a response-less request PENDING', () => {
		const recorder = createRecorder()
		recorder.attach()

		context.emit('request', makeRequest('GET', 'https://shop.example.com/api/profile'))

		expect(recorder.format()).toContain('1. [GET] https://shop.example.com/api/profile => [PENDING]')
	})

	test('ignores responses for requests captured before the last reset', () => {
		const recorder = createRecorder()
		recorder.attach()

		const request = makeRequest('GET', 'https://shop.example.com/api/cart')
		context.emit('request', request)
		recorder.reset()
		context.emit('response', makeResponse(request, 200, 'OK'))

		expect(recorder.list({ includeStatic: true })).toEqual([])
	})

	test('drops static resource types by default', () => {
		const recorder = createRecorder()
		recorder.attach()

		context.emit('request', makeRequest('GET', 'https://shop.example.com/logo.png', 'image'))
		context.emit('request', makeRequest('GET', 'https://shop.example.com/', 'document'))
		context.emit('request', makeRequest('GET', 'https://shop.example.com/app.css', 'stylesheet'))
		context.emit('request', makeRequest('GET', 'https://shop.example.com/api/cart', 'xhr'))

		expect(recorder.list().map((record) => record.url)).toEqual(['https://shop.example.com/api/cart'])
	})

	test('includeStatic reveals hidden rows without renumbering the API rows', () => {
		const recorder = createRecorder()
		recorder.attach()

		context.emit('request', makeRequest('GET', 'https://shop.example.com/api/cart', 'fetch'))
		context.emit('request', makeRequest('GET', 'https://shop.example.com/app.css', 'stylesheet'))
		context.emit('request', makeRequest('GET', 'https://shop.example.com/api/user', 'xhr'))

		expect(recorder.list().map((record) => record.sequence)).toEqual([1, 3])
		expect(recorder.list({ includeStatic: true }).map((record) => record.sequence)).toEqual([1, 2, 3])
		expect(recorder.format({ includeStatic: true })).toContain('2. [GET] https://shop.example.com/app.css')
	})

	test('reset clears the buffer, restarts sequence at 1, and rebases elapsed timings', () => {
		const recorder = createRecorder()
		recorder.attach()

		context.emit('request', makeRequest('GET', 'https://shop.example.com/api/first'))
		clock = 1_000
		recorder.reset()

		const second = makeRequest('GET', 'https://shop.example.com/api/second')
		context.emit('request', second)
		clock = 1_050
		context.emit('response', makeResponse(second, 200, 'OK'))

		expect(recorder.list()).toEqual([
			{
				sequence: 1,
				method: 'GET',
				url: 'https://shop.example.com/api/second',
				resourceType: 'fetch',
				status: 200,
				statusText: 'OK',
				startedAt: 0,
				completedAt: 50,
			},
		])
	})

	test('drops the oldest records beyond MAX_RECORDS', () => {
		const recorder = createRecorder()
		recorder.attach()

		for (let index = 1; index <= NetworkRequestRecorder.MAX_RECORDS + 5; index++) {
			context.emit('request', makeRequest('GET', `https://shop.example.com/api/${index}`))
		}

		const records = recorder.list()
		expect(records).toHaveLength(NetworkRequestRecorder.MAX_RECORDS)
		expect(records[0].sequence).toBe(6)
		expect(records.at(-1)?.sequence).toBe(NetworkRequestRecorder.MAX_RECORDS + 5)
	})

	test('format returns an empty string when nothing matched the filter', () => {
		const recorder = createRecorder()
		recorder.attach()

		expect(recorder.format()).toBe('')

		context.emit('request', makeRequest('GET', 'https://shop.example.com/logo.png', 'image'))
		expect(recorder.format()).toBe('')
		expect(recorder.format({ includeStatic: true })).not.toBe('')
	})

	test('detail renders headers and timing for a recorded sequence', async () => {
		const recorder = createRecorder()
		recorder.attach()

		const request = makeRequest('POST', 'https://shop.example.com/api/checkout', 'fetch', null, {
			headers: { 'content-type': 'application/json', accept: 'application/json' },
		})
		context.emit('request', request)
		clock = 231
		context.emit(
			'response',
			makeResponse(request, 200, 'OK', {
				headers: { 'content-type': 'application/json', 'cache-control': 'no-store' },
			})
		)

		const detail = await recorder.detail(1)
		expect(detail).toContain('1. [POST] https://shop.example.com/api/checkout => [200] OK (231ms)')
		expect(detail).toContain('resourceType: fetch')
		expect(detail).toContain('request headers: content-type: application/json, accept: application/json')
		expect(detail).toContain('response headers: content-type: application/json, cache-control: no-store')
	})

	test("body('response') returns response.text(); body('request') returns postData()", async () => {
		const recorder = createRecorder()
		recorder.attach()

		const request = makeRequest('POST', 'https://shop.example.com/api/checkout', 'fetch', null, {
			postData: '{"item":"widget"}',
		})
		context.emit('request', request)
		context.emit(
			'response',
			makeResponse(request, 200, 'OK', {
				headers: { 'content-type': 'application/json' },
				text: '{"orderId":"ORD-8231"}',
			})
		)

		const responseBody = await recorder.body(1, 'response')
		expect(responseBody).toContain('response body (application/json):')
		expect(responseBody).toContain('{"orderId":"ORD-8231"}')

		const requestBody = await recorder.body(1, 'request')
		expect(requestBody).toContain('request body:')
		expect(requestBody).toContain('{"item":"widget"}')
	})

	test('a request with no post data reports no request body', async () => {
		const recorder = createRecorder()
		recorder.attach()

		context.emit('request', makeRequest('GET', 'https://shop.example.com/api/cart'))

		expect(await recorder.body(1, 'request')).toBe(
			'1. [GET] https://shop.example.com/api/cart has no request body.'
		)
	})

	test('unknown sequence returns an error string, not a throw', async () => {
		const recorder = createRecorder()
		recorder.attach()

		await expect(recorder.detail(99)).resolves.toContain("'99'")
		await expect(recorder.body(99, 'response')).resolves.toContain("'99'")
	})

	test('a body over MAX_BODY_CHARS is truncated with the total-length suffix', async () => {
		const recorder = createRecorder()
		recorder.attach()

		const longText = 'a'.repeat(NetworkRequestRecorder.MAX_BODY_CHARS + 500)
		const request = makeRequest('GET', 'https://shop.example.com/api/cart')
		context.emit('request', request)
		context.emit('response', makeResponse(request, 200, 'OK', { text: longText }))

		const body = await recorder.body(1, 'response')
		expect(body).toContain(`... (truncated, ${longText.length} chars total)`)
		expect(body.length).toBeLessThan(longText.length)
	})
})
