import type { Html } from '../html.ts'
import { html } from '../html.ts'
import { emptyLine, emptyNotice } from './empty-state.ts'

export const examples: Array<[string, Html | string]> = [
	['emptyNotice', emptyNotice({ what: 'No run yet.', next: 'Open a plan to review its tests and start a run.' })],
	[
		'emptyNotice with extra',
		emptyNotice({
			what: 'No run matches these filters.',
			next: html`<a href="#">Clear the filters</a>`,
			extra: html`<p>Or start a test.</p>`,
		}),
	],
	['emptyLine', emptyLine({ text: 'Nothing waits for you in this plan.' })],
]
