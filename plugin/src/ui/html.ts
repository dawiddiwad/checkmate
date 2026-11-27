export type Html = { readonly html: string }

export const actorLimit = 64

const entities: Record<string, string> = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }

export function escape(text: string) {
	return text.replace(/[&<>"']/g, (character) => entities[character])
}

function isHtml(value: unknown): value is Html {
	return typeof value === 'object' && value !== null && 'html' in value
}

function piece(value: unknown): string {
	if (value === null || value === undefined || value === false) return ''
	if (Array.isArray(value)) return value.map(piece).join('')
	if (isHtml(value)) return value.html
	return escape(String(value))
}

export function html(strings: TemplateStringsArray, ...values: unknown[]): Html {
	let text = strings[0]
	for (let i = 0; i < values.length; i++) text += piece(values[i]) + strings[i + 1]
	return { html: text }
}

export type Attrs = Record<string, string | number | boolean | null | undefined> & { html?: never }

export function attributes(values: Attrs = {}): Html {
	return {
		html: Object.entries(values)
			.filter(([, value]) => value !== false && value !== null && value !== undefined)
			.map(([name, value]) => (value === true ? name : `${name}="${escape(String(value))}"`))
			.join(' '),
	}
}

export function join(items: Html[], separator: Html | string) {
	return html`${items.flatMap((item, i) => (i ? [separator, item] : [item]))}`
}

export function money(costUsd: number) {
	return costUsd > 0 && costUsd < 0.01 ? '<$0.01' : `$${costUsd.toFixed(2)}`
}

export function costText(costUsd: number | null, partial: boolean) {
	return costUsd === null ? '—' : `${money(costUsd)}${partial ? ' (partial)' : ''}`
}

export function words(status: string) {
	return status.replace(/_/g, ' ')
}

const glyphNames: Record<string, string> = {
	'✓': 'check',
	'✗': 'cross',
	'●': 'dot',
	'○': 'ring',
	'◐': 'half',
	'≈': 'approx',
	'‖': 'pause',
	'↑': 'up',
	'↓': 'down',
	'←': 'left',
	'→': 'right',
	'▸': 'closed',
	'▾': 'open',
}

export function glyph(symbol: string) {
	const name = glyphNames[symbol]
	return name ? html`<span class="glyph g-${name}" aria-hidden="true"></span>` : html`${symbol}`
}

export function short(sha256: string) {
	return `${sha256.slice(0, 4)}…${sha256.slice(-4)}`
}

export function age(iso: string, now = Date.now()) {
	const seconds = Math.max(0, Math.round((now - Date.parse(iso)) / 1000))
	if (seconds < 45) return 'now'
	const minutes = Math.round(seconds / 60)
	if (minutes < 60) return `${minutes} min`
	const hours = Math.round(minutes / 60)
	if (hours < 48) return `${hours} h`
	return `${Math.round(hours / 24)} d`
}

export function clock(iso: string) {
	const date = new Date(iso)
	const pad = (value: number) => String(value).padStart(2, '0')
	return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}`
}

export function time(iso: string, text = age(iso)) {
	return html`<time datetime="${iso}" title="${clock(iso)}">${text}</time>`
}

export function ago(iso: string, now = Date.now()) {
	const text = age(iso, now)
	return time(iso, text === 'now' ? 'just now' : `${text} ago`)
}

export function hasMetadata(values: Record<string, unknown> | undefined) {
	return Object.keys(values ?? {}).length > 0
}

export function metadataList(values: Record<string, string | number | boolean> = {}) {
	const entries = Object.entries(values)
	return html`<span class="sc-chips" aria-label="Metadata"
		>${entries.map(([key, value]) => html`<span class="sc-chip">${key}=${String(value)}</span>`)}</span
	>`
}

export function plural(count: number, one: string, many = `${one}s`) {
	return `${count} ${count === 1 ? one : many}`
}

export function duration(ms: number) {
	const seconds = Math.round(ms / 1000)
	if (seconds < 60) return `${seconds} s`
	const minutes = Math.floor(seconds / 60)
	if (minutes < 60) return `${minutes} min ${seconds % 60} s`
	return `${Math.floor(minutes / 60)} h ${minutes % 60} min`
}

export function asList<T>(item: T | null) {
	return item ? [item] : []
}
