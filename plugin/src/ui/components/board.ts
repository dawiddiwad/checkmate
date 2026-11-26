import type { CellStatus } from '../../rulemap.ts'
import { html, words } from '../html.ts'
import { markKindOf } from './status-mark.ts'

export type CellState = CellStatus | 'running'

const cellLook: Record<CellState, [string, string, string]> = {
	failed: ['×', 'k-fail', 'failed'],
	question: ['?', 'k-q', 'needs you'],
	passed: ['', 'k-pass', 'passed'],
	not_checked: ['', 'k-none', 'not run'],
	running: ['', 'k-run', 'running'],
}

export type BoardCell = { state: CellState; label?: string; build?: string; buildLabel?: string; decorative?: boolean }

export function boardCell({ state, label, build, buildLabel, decorative = false }: BoardCell) {
	const [symbol, look, name] = cellLook[state]
	if (decorative) return html`<span class="sc-cell ${look}" aria-hidden="true">${symbol}</span>`
	if (label === undefined) return html`<span class="sc-cell ${look}" role="img" aria-label="${name}">${symbol}</span>`
	return html`<span
		class="sc-cell ${look}"
		role="img"
		aria-label="${label}"
		title="${label}"
		data-mark="${build}"
		data-b="${buildLabel}"
		>${symbol}</span
	>`
}

const resultCells: Record<string, CellState> = {
	pass: 'passed',
	fail: 'failed',
	crit: 'failed',
	you: 'question',
	triage: 'question',
	run: 'running',
}

export function resultCell({ result }: { result: string | null }) {
	const [symbol, look] = cellLook[resultCells[markKindOf(result)] ?? 'not_checked']
	return html`<span class="sc-cell ${look}" role="img" aria-label="${result ? words(result) : 'no result yet'}"
		>${symbol}</span
	>`
}

export type BoardBuild = { build: string; label: string; cells: CellStatus[] }

export function board({ builds, label }: { builds: BoardBuild[]; label: string }) {
	if (!builds.length) return html`<span></span>`
	return html`<div class="sc-plan-board" role="img" aria-label="${label}">
		${builds.map(
			(build) =>
				html`<div title="${build.build}">
					<span>${build.label}</span>${build.cells.map((state) => boardCell({ state }))}
				</div>`
		)}
	</div>`
}

export const boardKey = html`<ul class="sc-legend" aria-label="Board key">
	<li>${boardCell({ state: 'passed', decorative: true })}passed</li>
	<li>${boardCell({ state: 'failed', decorative: true })}failed</li>
	<li>${boardCell({ state: 'running', decorative: true })}running</li>
	<li>${boardCell({ state: 'question', decorative: true })}needs you</li>
	<li>${boardCell({ state: 'not_checked', decorative: true })}not run</li>
</ul>`
