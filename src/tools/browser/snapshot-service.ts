import { Page } from '@playwright/test'
import { parse } from 'yaml'
import { ResolvedConfig } from '../../config/resolved-config.js'
import { logger } from '../../logging/index.js'
import { Step } from '../../runtime/types.js'
import { filterSnapshot } from './snapshot-filter/index.js'

export type BrowserSnapshot = string | null

export interface SnapshotServiceOptions {
	skipFilter?: boolean
}

const STABILITY_POLL_INTERVAL_MS = 500
const STABILITY_TIMEOUT_MS = 30_000

export class SnapshotService {
	constructor(
		private readonly page: Page | null,
		private readonly config: ResolvedConfig,
		private readonly step?: Step,
		private readonly options: SnapshotServiceOptions = {}
	) {}

	/**
	 * Waits for two consecutive reads of the page's HTML to match before a snapshot is captured.
	 *
	 * This is an ordinary wait, not a Playwright assertion: `expect.poll` would record every
	 * rejected attempt as its own failed child step, so a page that settles on its second read
	 * would render as a green step containing a red ✗ that had nothing to do with the step's
	 * actual outcome. An ordinary wait — the same thing `page.waitForLoadState` already does for
	 * navigation — reports only a plain error if the page genuinely never settles.
	 */
	private async waitForStableHtml(page: Page): Promise<void> {
		const deadline = Date.now() + STABILITY_TIMEOUT_MS
		for (;;) {
			const before = await page.locator('html').innerHTML()
			await page.waitForTimeout(STABILITY_POLL_INTERVAL_MS)
			const after = await page.locator('html').innerHTML()
			if (before === after) {
				return
			}

			if (Date.now() >= deadline) {
				throw new Error(`page snapshot did not stabilize within ${STABILITY_TIMEOUT_MS}ms`)
			}
		}
	}

	private async getHeader(): Promise<string> {
		if (!this.page) {
			throw new Error('Page is not initialized')
		}

		return ['page data:', `url: '${this.page.url()}'`, `title: '${await this.page.title()}'`].join('\n')
	}

	private minify(snapshot: string): string {
		return snapshot
			.replaceAll('  ', '')
			.replaceAll('"', '')
			.replaceAll('\\', '')
			.replaceAll(' [', '[')
			.replaceAll('] ', ']')
	}

	private redactAds(snapshot: string): string {
		const adPatterns = [
			/googleadservices\.com/i,
			/doubleclick\.net/i,
			/googlesyndication\.com/i,
			/googleads/i,
			/pagead\/aclk/i,
			/adurl=/i,
			/\bgad_source\b/i,
			/\bgclid\b/i,
		]
		const snapshotUrlWrapperRegex = /\{\/url:([^}]+)\}/g

		return snapshot.replace(snapshotUrlWrapperRegex, (match, urlContent) => {
			return adPatterns.some((pattern) => pattern.test(urlContent)) ? '{/url:ADVERT}' : match
		})
	}

	private async compress(snapshot: string): Promise<string> {
		const snapshotTree = parse(snapshot)?.[0] ?? { state: 'page is blank - navigate to a relevant page url' }
		const shouldSkipFilter = this.options.skipFilter || !this.config.snapshotFilter
		const processed = shouldSkipFilter
			? snapshotTree
			: await filterSnapshot(snapshotTree, this.step, this.config.snapshotTopPercent)
		const minifiedSnapshot = `page snapshot:\n${this.minify(JSON.stringify(processed))}`
		return this.redactAds(`${await this.getHeader()}\n${minifiedSnapshot}`)
	}

	async get(): Promise<BrowserSnapshot> {
		try {
			if (!this.page) {
				throw new Error('Page is not initialized')
			}

			await this.waitForStableHtml(this.page)
			const rawSnapshot = await this.page.ariaSnapshot({ mode: 'ai' })
			const compressedSnapshot = await this.compress(rawSnapshot)
			logger.debug(`created aria page snapshot:\n${compressedSnapshot}`)
			return compressedSnapshot
		} catch (error) {
			throw new Error(`Failed to create aria page snapshot:\n${error}`, { cause: error })
		}
	}
}
