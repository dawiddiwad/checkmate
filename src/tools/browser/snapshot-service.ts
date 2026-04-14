import { Page } from '@playwright/test'
import { parse } from 'yaml'
import { RuntimeConfig } from '../../config/runtime-config'
import { logger } from '../../logging'
import { Step } from '../../runtime/types'
import { filterSnapshot } from './snapshot-filter'

export type BrowserSnapshot = string | null

export interface SnapshotServiceOptions {
	skipFilter?: boolean
}

export class SnapshotService {
	private readonly runtimeConfig = new RuntimeConfig()

	constructor(
		private readonly page: Page | null,
		private readonly step?: Step,
		private readonly options: SnapshotServiceOptions = {}
	) {}

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
		const shouldSkipFilter = this.options.skipFilter || !this.runtimeConfig.isSnapshotFilteringEnabled()
		const processed = shouldSkipFilter ? snapshotTree : await filterSnapshot(snapshotTree, this.step)
		const minifiedSnapshot = `page snapshot:\n${this.minify(JSON.stringify(processed))}`
		return this.redactAds(`${await this.getHeader()}\n${minifiedSnapshot}`)
	}

	async get(): Promise<BrowserSnapshot> {
		try {
			if (!this.page) {
				throw new Error('Page is not initialized')
			}

			const rawSnapshot = await this.page.ariaSnapshot({ mode: 'ai' })
			const compressedSnapshot = await this.compress(rawSnapshot)
			logger.debug(`created aria page snapshot:\n${compressedSnapshot}`)
			return compressedSnapshot
		} catch (error) {
			throw new Error(`Failed to create aria page snapshot:\n${error}`, { cause: error })
		}
	}
}
