import type { Attrs, Html } from '../html.ts'
import { attributes, html } from '../html.ts'

export type TesterCard = {
	id: string
	key: string
	href: string
	label: string
	mark: Html
	phase: string
	line: Html | string
	stats: Array<Html | string>
	options?: Html | ''
	done?: boolean
	attrs?: Attrs
}

export function testerCard({
	id,
	key,
	href,
	label,
	mark,
	phase,
	line,
	stats,
	options = '',
	done = false,
	attrs,
}: TesterCard) {
	return html`<article
		class="sc-tcard${done ? ' is-done' : ''}"
		role="option"
		aria-selected="false"
		tabindex="-1"
		id="${id}"
		data-row
		data-key="${key}"
		data-href="${href}"
		data-label="${label}"
		${attributes(attrs)}
	>
		<a class="sc-tcard-id" href="${href}" tabindex="-1">${label}</a>
		<div class="sc-tcard-top">${mark}<span class="sc-tcard-phase">${phase}</span></div>
		<span class="sc-tcard-line">${line}</span>
		<div class="sc-tcard-stats">${stats.map((stat) => html`<span>${stat}</span>`)} ${options}</div>
	</article>`
}

export type TimelineEvent = {
	id: string
	key: string
	href: string
	label: string
	mark: Html
	text: Html | string
	meta: string
}

export function timeline({ label, events }: { label: string; events: TimelineEvent[] }) {
	return html`<ol class="sc-timeline" aria-label="${label}">
		${events.map(
			(event) =>
				html`<li
					class="sc-event"
					tabindex="-1"
					id="${event.id}"
					data-row
					data-key="${event.key}"
					data-href="${event.href}"
					data-label="${event.label}"
				>
					<a href="${event.href}" tabindex="-1"><time>${event.label}</time></a
					><span class="sc-event-n">${event.mark}</span><span class="sc-event-t">${event.text}</span
					><span class="sc-event-m">${event.meta}</span>
				</li>`
		)}
	</ol>`
}
