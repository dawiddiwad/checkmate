import type { Html } from '../html.ts'
import { html } from '../html.ts'

export type BlockingBanner = { count: number; title: string; text: Html | string; action: string; href: string }

export function blockingBanner({ count, title, text, action, href }: BlockingBanner) {
	return html`<div class="sc-banner">
		<b class="sc-banner-n">${count}</b>
		<div class="sc-banner-t">
			<b>${title}</b>
			<span>${text}</span>
		</div>
		<a class="sc-btn is-you is-lg" href="${href}">${action}</a>
	</div>`
}
