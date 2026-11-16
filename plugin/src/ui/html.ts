export type Html = { readonly html: string }

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

export function join(items: Html[], separator: Html | string) {
	return html`${items.flatMap((item, i) => (i ? [separator, item] : [item]))}`
}

export type Tone = 'pass' | 'fail' | 'block' | 'warn' | 'unsure' | 'acc' | 'muted'

const statusLook: Record<string, [string, Tone]> = {
	passed: ['✓', 'pass'],
	failed: ['✗', 'fail'],
	blocked: ['–', 'block'],
	ready: ['✓', 'pass'],
	completed: ['✓', 'pass'],
	interrupted: ['!', 'warn'],
	operational_error: ['!', 'fail'],
	rejected: ['✗', 'fail'],
	active: ['●', 'pass'],
	retired: ['–', 'block'],
	rejected_operation: ['✗', 'fail'],
	needs_decision: ['?', 'warn'],
	invalid_request: ['✗', 'fail'],
	accepted: ['✓', 'pass'],
	found: ['✗', 'fail'],
	suspected: ['?', 'unsure'],
	refuted: ['–', 'block'],
	fixed: ['✓', 'pass'],
	not_fixed: ['✗', 'fail'],
	disputed: ['!', 'warn'],
	confirmed: ['✓', 'acc'],
	open: ['?', 'warn'],
	answered: ['✓', 'pass'],
	critical: ['!', 'fail'],
	high: ['!', 'fail'],
	medium: ['·', 'warn'],
	low: ['·', 'muted'],
}

export function words(status: string) {
	return status.replace(/_/g, ' ')
}

export function pill(status: string, label: string = words(status)) {
	const [icon, tone] = statusLook[status] ?? ['·', 'muted']
	return html`<span class="st ${tone}"><span aria-hidden="true">${icon}</span> ${label}</span>`
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

export function plural(count: number, one: string, many = `${one}s`) {
	return `${count} ${count === 1 ? one : many}`
}
