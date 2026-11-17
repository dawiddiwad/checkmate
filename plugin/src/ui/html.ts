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
	inconclusive: ['?', 'unsure'],
	not_checked: ['!', 'warn'],
	blocked: ['–', 'block'],
	not_run: ['–', 'block'],
	error: ['!', 'warn'],
	ready: ['✓', 'pass'],
	deferred: ['–', 'block'],
	planned: ['✓', 'pass'],
	tested: ['✓', 'pass'],
	uncovered: ['–', 'block'],
	complete: ['✓', 'pass'],
	partial: ['◐', 'warn'],
	not_executed: ['–', 'block'],
	completed: ['✓', 'pass'],
	interrupted: ['!', 'warn'],
	operational_error: ['!', 'fail'],
	not_applicable: ['–', 'block'],
	approved: ['✓', 'pass'],
	rejected: ['✗', 'fail'],
	pending: ['○', 'acc'],
	not_required: ['–', 'block'],
	started: ['●', 'acc'],
	given: ['○', 'acc'],
	not_needed: ['–', 'block'],
	ended: ['✓', 'pass'],
	active: ['●', 'pass'],
	retired: ['–', 'block'],
	finalized: ['✓', 'pass'],
	open: ['○', 'warn'],
	resolved: ['✓', 'pass'],
	blocking: ['●', 'fail'],
	non_blocking: ['○', 'warn'],
	clarify: ['✓', 'acc'],
	accept_assumption: ['≈', 'acc'],
	defer: ['–', 'block'],
	defect: ['✗', 'fail'],
	potential_issue: ['?', 'warn'],
	low: ['·', 'block'],
	medium: ['!', 'warn'],
	high: ['!', 'fail'],
	critical: ['!!', 'fail'],
	rejected_operation: ['✗', 'fail'],
	needs_decision: ['?', 'warn'],
	invalid_request: ['✗', 'fail'],
	needs_plan: ['○', 'acc'],
	ready_to_test: ['○', 'acc'],
	exploring: ['●', 'acc'],
	needs_triage: ['?', 'warn'],
	run_in_progress: ['●', 'acc'],
	needs_revision: ['○', 'acc'],
	plan_rejected: ['✗', 'fail'],
	needs_answers: ['?', 'warn'],
	needs_approval: ['○', 'acc'],
	ready_to_run: ['○', 'acc'],
	nothing_to_run: ['–', 'block'],
	defects_open: ['✗', 'fail'],
	needs_retest: ['!', 'warn'],
	awaits_acceptance: ['○', 'acc'],
	accepted: ['✓', 'pass'],
	running: ['●', 'acc'],
	starting: ['●', 'acc'],
	testing: ['●', 'acc'],
	recording: ['●', 'acc'],
	verifying: ['●', 'acc'],
	following: ['●', 'acc'],
	stopped: ['!', 'fail'],
	skipped: ['–', 'block'],
	not_in_level: ['–', 'block'],
	confirmed: ['✗', 'fail'],
	observed: ['✗', 'fail'],
	suspected: ['?', 'warn'],
	unresolved: ['?', 'warn'],
	answered: ['✓', 'pass'],
	requested: ['○', 'acc'],
	paused: ['‖', 'warn'],
	waiting: ['○', 'acc'],
}

const labels: Record<string, string> = {
	given: 'given to the session',
}

export function words(status: string) {
	return status.replace(/_/g, ' ')
}

const toneColor: Record<Tone, string> = {
	pass: 'green',
	fail: 'red',
	warn: 'amber',
	unsure: 'amber',
	acc: 'blue',
	block: '',
	muted: '',
}

export function pillClass(status: string) {
	const [, tone] = statusLook[status] ?? ['·', 'muted']
	return `sp-pill ${toneColor[tone]}`.trim()
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

export function pill(status: string, label: string = labels[status] ?? words(status)) {
	const [icon] = statusLook[status] ?? ['·', 'muted']
	const look = pillClass(status)
	const mark = glyph(icon)
	return html`<span class="${look}" data-status="${status}"><span aria-hidden="true">${mark}</span> ${label}</span>`
}

export function icon(status: string | null) {
	const [symbol, tone] = status ? (statusLook[status] ?? ['·', 'muted']) : ['·', 'muted']
	const mark =
		{ pass: 'k-pass', fail: 'k-fail', warn: 'k-q', unsure: 'k-q', acc: 'k-run' }[tone as string] ?? 'k-none'
	return html`<span class="sp-mk ${mark}" role="img" aria-label="${status ? words(status) : 'no result yet'}"
		>${glyph(symbol)}</span
	>`
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

export function hasMetadata(values: Record<string, unknown> | undefined) {
	return Object.keys(values ?? {}).length > 0
}

export function metadataList(values: Record<string, string | number | boolean> = {}) {
	const entries = Object.entries(values)
	return html`<span class="kv" aria-label="Metadata"
		>${entries.map(([key, value]) => html`<span class="tag">${key}=${String(value)}</span>`)}</span
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
