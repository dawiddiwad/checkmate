import type { Html } from '../html.ts'
import { html } from '../html.ts'
import { fold } from './fold.ts'

export const examples: Array<[string, Html | string]> = [
	[
		'fold open with count',
		fold({
			key: 'catalogue:open',
			title: 'Stored tests',
			headingId: 'catalogue-fold-open',
			count: 4,
			open: true,
			body: html`<p>Four stored tests.</p>`,
		}),
	],
	[
		'fold closed',
		fold({
			key: 'catalogue:closed',
			title: 'History',
			headingId: 'catalogue-fold-closed',
			body: html`<p>Earlier revisions.</p>`,
		}),
	],
	[
		'fold without heading id',
		fold({
			key: 'catalogue:plain',
			title: 'Permission requests',
			count: 0,
			open: true,
			listRegion: true,
			body: html`<p>None.</p>`,
		}),
	],
]
