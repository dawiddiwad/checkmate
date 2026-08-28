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

const NETWORK_HEADER =
	'Network requests since the last browser action (call again after the next action; numbers shown here become stale once you do):'

export class NetworkRequestRecorder {
	static readonly MAX_RECORDS = 200
	static readonly API_RESOURCE_TYPES = ['fetch', 'xhr']

	private readonly records: RecordedNetworkRequest[] = []
	private readonly recordsByRequest = new Map<Request, RecordedNetworkRequest>()
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
		if (options.includeStatic) {
			return [...this.records]
		}

		return this.records.filter((record) => NetworkRequestRecorder.API_RESOURCE_TYPES.includes(record.resourceType))
	}

	format(options: NetworkRequestListOptions = {}): string {
		const records = this.list(options)
		if (records.length === 0) {
			return ''
		}

		return [NETWORK_HEADER, ...records.map((record) => formatRecord(record))].join('\n')
	}

	private handleRequest = (request: Request): void => {
		const record: RecordedNetworkRequest = {
			sequence: this.nextSequence++,
			method: request.method(),
			url: request.url(),
			resourceType: request.resourceType(),
			status: 'PENDING',
			statusText: '',
			startedAt: this.elapsed(),
			completedAt: null,
		}

		this.records.push(record)
		this.recordsByRequest.set(request, record)
		this.dropOldestRecordsOverLimit()
	}

	private handleResponse = (response: Response): void => {
		const record = this.recordsByRequest.get(response.request())
		if (!record) {
			return
		}

		record.status = response.status()
		record.statusText = response.statusText()
		record.completedAt = this.elapsed()
	}

	private handleRequestFailed = (request: Request): void => {
		const record = this.recordsByRequest.get(request)
		if (!record || record.status !== 'PENDING') {
			return
		}

		record.status = 'FAILED'
		record.statusText = request.failure()?.errorText ?? 'request failed'
		record.completedAt = this.elapsed()
	}

	private dropOldestRecordsOverLimit(): void {
		while (this.records.length > NetworkRequestRecorder.MAX_RECORDS) {
			const dropped = this.records.shift()
			if (!dropped) {
				return
			}

			for (const [request, record] of this.recordsByRequest) {
				if (record === dropped) {
					this.recordsByRequest.delete(request)
					break
				}
			}
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
