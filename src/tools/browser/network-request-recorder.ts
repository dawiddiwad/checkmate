import { BrowserContext, Request, Response } from '@playwright/test'

type Clock = () => number

export type NetworkRequestStatus = number | 'PENDING' | 'FAILED'

export type RecordedNetworkRequest = {
	sequence: number
	method: string
	url: string
	resourceType: string
	status: NetworkRequestStatus
	statusText: string
	startedAt: number
	completedAt: number | null
}

export type NetworkRequestListOptions = {
	includeStatic?: boolean
}

export type NetworkRequestBodyPart = 'request' | 'response'

type NetworkRecord = {
	summary: RecordedNetworkRequest
	request: Request
}

const NETWORK_HEADER =
	'Network requests since the last browser action (call again after the next action; numbers shown here become stale once you do):'

const MAX_BODY_CHARS = 2000

export class NetworkRequestRecorder {
	static readonly MAX_RECORDS = 200
	static readonly API_RESOURCE_TYPES = ['fetch', 'xhr']
	static readonly MAX_BODY_CHARS = MAX_BODY_CHARS

	private readonly records: NetworkRecord[] = []
	private readonly recordsByRequest = new Map<Request, NetworkRecord>()
	private nextSequence = 1
	private startTime: number

	constructor(
		private readonly context: BrowserContext,
		private readonly clock: Clock = () => Date.now()
	) {
		this.startTime = this.clock()
	}

	attach(): void {
		this.context.on('request', this.handleRequest)
		this.context.on('response', this.handleResponse)
		this.context.on('requestfailed', this.handleRequestFailed)
	}

	detach(): void {
		this.context.off('request', this.handleRequest)
		this.context.off('response', this.handleResponse)
		this.context.off('requestfailed', this.handleRequestFailed)
	}

	reset(): void {
		this.records.length = 0
		this.recordsByRequest.clear()
		this.nextSequence = 1
		this.startTime = this.clock()
	}

	list(options: NetworkRequestListOptions = {}): RecordedNetworkRequest[] {
		const records = options.includeStatic
			? this.records
			: this.records.filter((record) =>
					NetworkRequestRecorder.API_RESOURCE_TYPES.includes(record.summary.resourceType)
				)

		return records.map((record) => record.summary)
	}

	format(options: NetworkRequestListOptions = {}): string {
		const summaries = this.list(options)
		if (summaries.length === 0) {
			return ''
		}

		return [NETWORK_HEADER, ...summaries.map((summary) => formatRecord(summary))].join('\n')
	}

	async detail(sequence: number): Promise<string> {
		const record = this.findRecord(sequence)
		if (!record) {
			return unknownSequenceMessage(sequence)
		}

		const response = await record.request.response().catch((): null => null)
		const lines = [
			formatRecord(record.summary),
			`resourceType: ${record.summary.resourceType}`,
			`request headers: ${formatHeaders(record.request.headers())}`,
			`response headers: ${response ? formatHeaders(response.headers()) : 'not available yet'}`,
		]

		return lines.join('\n')
	}

	async body(sequence: number, part: NetworkRequestBodyPart): Promise<string> {
		const record = this.findRecord(sequence)
		if (!record) {
			return unknownSequenceMessage(sequence)
		}

		if (part === 'request') {
			return this.requestBody(sequence, record)
		}

		return this.responseBody(sequence, record)
	}

	private requestBody(sequence: number, record: NetworkRecord): string {
		const postData = record.request.postData()
		if (postData === null) {
			return `${sequence}. [${record.summary.method}] ${record.summary.url} has no request body.`
		}

		return `${sequence}. [${record.summary.method}] ${record.summary.url} request body:\n${truncateBody(postData)}`
	}

	private async responseBody(sequence: number, record: NetworkRecord): Promise<string> {
		const response = await record.request.response().catch((): null => null)
		if (!response) {
			return `${sequence}. [${record.summary.method}] ${record.summary.url} has no response body yet.`
		}

		const text = await response.text().catch((error: unknown) => `<failed to read response body: ${error}>`)
		const contentType = (response.headers()['content-type'] ?? 'unknown').split(';')[0].trim()
		return `${sequence}. [${record.summary.method}] ${record.summary.url} response body (${contentType}):\n${truncateBody(text)}`
	}

	private findRecord(sequence: number): NetworkRecord | undefined {
		return this.records.find((record) => record.summary.sequence === sequence)
	}

	private handleRequest = (request: Request): void => {
		const summary: RecordedNetworkRequest = {
			sequence: this.nextSequence++,
			method: request.method(),
			url: request.url(),
			resourceType: request.resourceType(),
			status: 'PENDING',
			statusText: '',
			startedAt: this.elapsed(),
			completedAt: null,
		}

		const record: NetworkRecord = { summary, request }
		this.records.push(record)
		this.recordsByRequest.set(request, record)
		this.dropOldestRecordsOverLimit()
	}

	private handleResponse = (response: Response): void => {
		const record = this.recordsByRequest.get(response.request())
		if (!record) {
			return
		}

		record.summary.status = response.status()
		record.summary.statusText = response.statusText()
		record.summary.completedAt = this.elapsed()
	}

	private handleRequestFailed = (request: Request): void => {
		const record = this.recordsByRequest.get(request)
		if (!record || record.summary.status !== 'PENDING') {
			return
		}

		record.summary.status = 'FAILED'
		record.summary.statusText = request.failure()?.errorText ?? 'request failed'
		record.summary.completedAt = this.elapsed()
	}

	private dropOldestRecordsOverLimit(): void {
		while (this.records.length > NetworkRequestRecorder.MAX_RECORDS) {
			const dropped = this.records.shift()
			if (!dropped) {
				return
			}

			this.recordsByRequest.delete(dropped.request)
		}
	}

	private elapsed(): number {
		return this.clock() - this.startTime
	}
}

function formatRecord(record: RecordedNetworkRequest): string {
	const prefix = `${record.sequence}. [${record.method}] ${record.url} =>`

	if (record.status === 'PENDING') {
		return `${prefix} [PENDING]`
	}

	if (record.status === 'FAILED') {
		return `${prefix} [FAILED] ${record.statusText}`
	}

	const duration = record.completedAt === null ? '' : ` (${record.completedAt - record.startedAt}ms)`
	return `${prefix} [${record.status}]${record.statusText ? ` ${record.statusText}` : ''}${duration}`
}

function formatHeaders(headers: Record<string, string>): string {
	const entries = Object.entries(headers)
	if (entries.length === 0) {
		return 'none'
	}

	return entries.map(([key, value]) => `${key}: ${value}`).join(', ')
}

function unknownSequenceMessage(sequence: number): string {
	return `Network request '${sequence}' was not found. It may have been evicted from the buffer or cleared by a newer browser action. Call 'browser_network_requests' again to see the current list.`
}

function truncateBody(text: string): string {
	if (text.length <= MAX_BODY_CHARS) {
		return text
	}

	return `${text.slice(0, MAX_BODY_CHARS)}... (truncated, ${text.length} chars total)`
}
