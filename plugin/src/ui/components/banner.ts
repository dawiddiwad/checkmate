import { html } from '../html.ts'

export function blockingBanner({ count, href }: { count: number; href: string }) {
	return html`<div class="sc-banner">
		<b class="sc-banner-n">${count}</b>
		<div class="sc-banner-t">
			<b>${count === 1 ? 'question blocks' : 'questions block'} testing</b>
			<span>Testers wait on these answers. Everything else can wait.</span>
		</div>
		<a class="sc-btn is-you is-lg" href="${href}">Answer the first</a>
	</div>`
}
