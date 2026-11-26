import type { Html } from '../html.ts'
import { html } from '../html.ts'

export type BannerKind = 'warn' | 'info' | 'fail'

export function banner({ kind, content }: { kind: BannerKind; content: Html | string }) {
	return html`<div class="banner ${kind}" role="${kind === 'info' ? 'status' : 'alert'}">${content}</div>`
}

export function blockingBanner({ count, href }: { count: number; href: string }) {
	return html`<div class="sp-banner">
		<b class="sp-banner-n">${count}</b>
		<div class="sp-banner-t">
			<b>${count === 1 ? 'question blocks' : 'questions block'} testing</b>
			<span>Testers wait on these answers. Everything else can wait.</span>
		</div>
		<a class="sp-btn pri you big" href="${href}">Answer the first</a>
	</div>`
}
