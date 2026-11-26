import type { Attrs, Html } from '../html.ts'
import { attributes, glyph, html, words } from '../html.ts'

type Tone = 'pass' | 'fail' | 'block' | 'warn' | 'unsure' | 'acc' | 'muted'

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

const toneClass: Record<Tone, string> = {
	pass: 'pass',
	fail: 'fail',
	warn: 'you',
	unsure: 'you',
	acc: 'run',
	block: '',
	muted: '',
}

const unknown: [string, Tone] = ['·', 'muted']

export function statusLookOf(state: string | null) {
	return state ? (statusLook[state] ?? unknown) : unknown
}

function markClass(state: string) {
	return `sp-pill ${toneClass[statusLookOf(state)[1]]}`.trim()
}

export function statusMark({ state, label = labels[state] ?? words(state) }: { state: string; label?: string }) {
	return html`<span class="${markClass(state)}" data-status="${state}"
		><span aria-hidden="true">${glyph(statusLookOf(state)[0])}</span> ${label}</span
	>`
}

export function statusWord({ state, label }: { state: string; label: Html | string }) {
	return html`<span class="${markClass(state)}" title="${words(state)}">${label}</span>`
}

const countOrder = ['passed', 'failed', 'inconclusive', 'error', 'blocked', 'not_run'] as const

export function statusCounts({ counts }: { counts: Record<string, number> }) {
	const shown = countOrder.filter((key) => counts[key])
	if (!shown.length) return html`<span class="muted">no outcomes yet</span>`
	return html`<span class="counts"
		>${shown.map(
			(key) =>
				html`<span class="${markClass(key)}" title="${counts[key]} ${words(key)}"
					><span aria-hidden="true">${glyph(statusLook[key][0])}</span> ${counts[key]}<span class="sr-only">
						${words(key)}</span
					></span
				>`
		)}</span
	>`
}

const wordTones: Record<string, string> = {
	testing: 'run',
	running: 'run',
	given: 'run',
	custom: 'run',
	blocks: 'you',
	asks: 'you',
	paused: 'you',
	approval: 'you',
	uncertain: 'you',
	finding: 'you triage',
	passed: 'pass',
	answered: 'pass',
	finished: 'pass',
	handed_over: 'pass',
	allowed: 'pass',
	failed: 'fail',
	invalid: 'fail',
	high: 'fail',
	denied: 'fail',
	critical: 'crit',
}

export type WordMark = {
	state: string
	label: Html | string
	live?: boolean
	title?: string
	attrs?: Attrs
}

export function wordMark({ state, label, live = false, title, attrs }: WordMark) {
	return html`<span
		class="sp-pill ${wordTones[state] ?? ''}"
		${title === undefined ? '' : html`title="${title}"`}
		${attributes(attrs)}
		>${live ? html`<span class="dot" aria-hidden="true"></span>` : ''}${label}</span
	>`
}

export const statusStates = Object.keys(statusLook)
export const wordStates = Object.keys(wordTones)
