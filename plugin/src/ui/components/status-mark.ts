import type { Attrs, Html } from '../html.ts'
import { attributes, html, words } from '../html.ts'

export type MarkKind = 'run' | 'pass' | 'fail' | 'crit' | 'you' | 'triage' | 'approve' | 'question' | 'stop' | 'none'

const statusKinds: Record<string, MarkKind> = {
	running: 'run',
	starting: 'run',
	testing: 'run',
	recording: 'run',
	verifying: 'run',
	following: 'run',
	exploring: 'run',
	run_in_progress: 'run',
	started: 'run',
	passed: 'pass',
	ready: 'pass',
	planned: 'pass',
	tested: 'pass',
	complete: 'pass',
	completed: 'pass',
	approved: 'pass',
	ended: 'pass',
	active: 'pass',
	finalized: 'pass',
	resolved: 'pass',
	answered: 'pass',
	accepted: 'pass',
	failed: 'fail',
	rejected: 'fail',
	defect: 'fail',
	high: 'fail',
	rejected_operation: 'fail',
	invalid_request: 'fail',
	plan_rejected: 'fail',
	defects_open: 'fail',
	confirmed: 'fail',
	observed: 'fail',
	operational_error: 'fail',
	error: 'fail',
	critical: 'crit',
	blocking: 'you',
	needs_decision: 'you',
	needs_answers: 'you',
	needs_approval: 'you',
	awaits_acceptance: 'you',
	paused: 'you',
	needs_triage: 'triage',
	potential_issue: 'triage',
	suspected: 'triage',
	unresolved: 'triage',
	inconclusive: 'triage',
	open: 'question',
	non_blocking: 'question',
	pending: 'question',
	given: 'question',
	requested: 'question',
	waiting: 'question',
	needs_plan: 'question',
	ready_to_test: 'question',
	needs_revision: 'question',
	ready_to_run: 'question',
	clarify: 'question',
	accept_assumption: 'question',
	medium: 'question',
	partial: 'question',
	needs_retest: 'question',
	stopped: 'stop',
	interrupted: 'stop',
	not_run: 'none',
	blocked: 'none',
	deferred: 'none',
	uncovered: 'none',
	not_executed: 'none',
	not_required: 'none',
	retired: 'none',
	not_needed: 'none',
	low: 'none',
	skipped: 'none',
	not_in_level: 'none',
	nothing_to_run: 'none',
	not_applicable: 'none',
	not_checked: 'none',
	defer: 'none',
}

const labels: Record<string, string> = {
	given: 'Given to the session',
}

function sentence(state: string) {
	const text = words(state)
	return text.charAt(0).toUpperCase() + text.slice(1)
}

export function markKindOf(state: string | null): MarkKind {
	return (state && statusKinds[state]) || 'none'
}

function mark(kind: MarkKind) {
	return `sc-mark is-${kind}`
}

export function statusMark({ state, label = labels[state] ?? sentence(state) }: { state: string; label?: string }) {
	return html`<span class="${mark(markKindOf(state))}" data-status="${state}">${label}</span>`
}

export function statusWord({ state, label }: { state: string; label: Html | string }) {
	return html`<span class="${mark(markKindOf(state))}" title="${words(state)}">${label}</span>`
}

const countOrder = ['passed', 'failed', 'inconclusive', 'error', 'blocked', 'not_run'] as const

export function statusCounts({ counts }: { counts: Record<string, number> }) {
	const shown = countOrder.filter((key) => counts[key])
	if (!shown.length) return html`<span class="sc-muted">no outcomes yet</span>`
	return html`<span class="sc-counts"
		>${shown.map(
			(key) =>
				html`<span class="${mark(markKindOf(key))}" title="${counts[key]} ${words(key)}"
					>${counts[key]}<span class="sc-sr"> ${words(key)}</span></span
				>`
		)}</span
	>`
}

const wordKinds: Record<string, MarkKind> = {
	testing: 'run',
	running: 'run',
	given: 'run',
	custom: 'run',
	blocks: 'you',
	asks: 'you',
	paused: 'you',
	uncertain: 'you',
	approval: 'approve',
	finding: 'triage',
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
	question: 'question',
	gap: 'question',
	medium: 'question',
	not_started: 'none',
	not_tested: 'none',
	low: 'none',
	deferred: 'stop',
	rejected: 'stop',
	closed: 'stop',
	not_running: 'stop',
}

const plainWords = ['cost', 'elapsed', 'phase', 'rule', 'stored', 'build_state', 'built-in']

export type WordMark = {
	state: string
	label: Html | string
	title?: string
	attrs?: Attrs
}

export function wordMark({ state, label, title, attrs }: WordMark) {
	const look = plainWords.includes(state) ? 'sc-word' : mark(wordKinds[state] ?? 'question')
	return html`<span class="${look}" ${title === undefined ? '' : html`title="${title}"`} ${attributes(attrs)}
		>${label}</span
	>`
}

export const statusStates = Object.keys(statusKinds)
export const wordStates = [...Object.keys(wordKinds), ...plainWords]
