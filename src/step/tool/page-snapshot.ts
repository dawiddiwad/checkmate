import { Page } from '@playwright/test'
import { parse } from 'yaml'
import { logger } from '../openai/openai-test-manager'
import { Step } from '../types'
import { filterSnapshot } from './fuzzy-search'

export type AriaPageSnapshot = string | null

export class PageSnapshot {
	private page: Page | null = null
	private step: Step | undefined
	static lastSnapshot: AriaPageSnapshot = null

	constructor(page: Page, step?: Step) {
		this.page = page
		this.step = step
	}

	private async getHeader() {
		const lines: string[] = []
		lines.push('page snapshot:')
		lines.push(`url: '${this.page.url()}'`)
		lines.push(`title: '${await this.page.title()}'`)
		return lines.join('\n')
	}

	private minify(snapshot: AriaPageSnapshot): AriaPageSnapshot {
		return snapshot
			.replaceAll('  ', '')
			.replaceAll('"', '')
			.replaceAll('\\', '')
			.replaceAll(' [', '[')
			.replaceAll('] ', ']')
	}

	private removeAds(snapshot: string): string {
		const AD_PATTERNS = [
			/googleadservices\.com/i,
			/doubleclick\.net/i,
			/googlesyndication\.com/i,
			/googleads/i,
			/pagead\/aclk/i,
			/adurl=/i,
			/\bgad_source\b/i,
			/\bgclid\b/i,
		]
		const SNAPSHOT_URL_WRAPPER_REGEX = /\{\/url:([^}]+)\}/g
		return snapshot.replace(SNAPSHOT_URL_WRAPPER_REGEX, (match, urlContent) => {
			const isAd = AD_PATTERNS.some((pattern) => pattern.test(urlContent))
			if (isAd) {
				return '{/url:ADVERT}'
			}
			return match
		})
	}

	private async compress(snapshot: AriaPageSnapshot): Promise<AriaPageSnapshot> {
		const asJson = parse(snapshot)?.[0] ?? { state: 'page is blank - navigate to a relevant page url' }
		const filtered = await filterSnapshot(asJson, this.step)
		const asMinified = `page snapshot:\n${this.minify(JSON.stringify(filtered))}`
		const withHeader = `${await this.getHeader()}\n${asMinified}`
		const withoutAds = this.removeAds(withHeader)
		return withoutAds
	}

	async get(): Promise<AriaPageSnapshot> {
		try {
			const snapshotYAML = await (this.page as any)
				._snapshotForAI()
				.then((snapshot: { full: string }) => snapshot.full)
			PageSnapshot.lastSnapshot = await this.compress(snapshotYAML)
			logger.debug(`created aria page snapshot:\n${PageSnapshot.lastSnapshot}`)
			return PageSnapshot.lastSnapshot
		} catch (error) {
			throw new Error(`Failed to create aria page snapshot:\n${error}`)
		}
	}
}
