import { Page } from '@playwright/test'
import { parse } from 'yaml'
import { logger } from '../openai/openai-test-manager'

export type AriaPageSnapshot = string | null

export class PageSnapshot {
	private page: Page | null = null
	static lastSnapshot: AriaPageSnapshot = null

	constructor(page: Page) {
		this.page = page
	}

	private async getHeader() {
		const lines: string[] = []
		lines.push('page snapshot:')
		lines.push(`url: '${this.page.url()}'`)
		lines.push(`title: '${await this.page.title()}'`)
		return lines.join('\n')
	}

	private minify(snapshot: AriaPageSnapshot): AriaPageSnapshot {
		return snapshot.replaceAll('"', '').replaceAll('\\', '').replaceAll(' [', '[').replaceAll('] ', ']')
	}

	async get(): Promise<AriaPageSnapshot> {
		try {
			const snapshotYAML = await (this.page as any)
				._snapshotForAI()
				.then((snapshot: { full: string }) => snapshot.full)
			const asJson = parse(snapshotYAML)?.[0] ?? { state: 'page content is empty' }
			const asMinified = `page snapshot:\n${this.minify(JSON.stringify(asJson))}`
			PageSnapshot.lastSnapshot = `${await this.getHeader()}\n${asMinified}`
			logger.debug(`created aria page snapshot:\n${PageSnapshot.lastSnapshot}`)
			return PageSnapshot.lastSnapshot
		} catch (error) {
			throw new Error(`Failed to create aria page snapshot:\n${error}`)
		}
	}
}
