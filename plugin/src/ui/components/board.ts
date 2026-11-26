import type { CellStatus } from '../../rulemap.ts'
import { glyph, html, plural, words } from '../html.ts'
import { statusLookOf } from './status-mark.ts'

export type CellState = CellStatus | 'running'

const cellLook: Record<CellState, [string, string]> = {
	failed: ['✗', 'k-fail'],
	question: ['?', 'k-q'],
	passed: ['✓', 'k-pass'],
	not_checked: ['', 'k-none'],
	running: ['●', 'k-run'],
}

export type BoardCell = { state: CellState; label?: string; build?: string; buildLabel?: string }

export function boardCell({ state, label, build, buildLabel }: BoardCell) {
	const [symbol, look] = cellLook[state]
	if (label === undefined) return html`<span class="sp-mk ${look}">${glyph(symbol)}</span>`
	return html`<span
		class="sp-mk ${look}"
		role="img"
		aria-label="${label}"
		title="${label}"
		data-mark="${build}"
		data-b="${buildLabel}"
		>${glyph(symbol)}</span
	>`
}

const resultLook: Record<string, string> = { pass: 'k-pass', fail: 'k-fail', warn: 'k-q', unsure: 'k-q', acc: 'k-run' }

export function resultCell({ result }: { result: string | null }) {
	const [symbol, tone] = statusLookOf(result)
	return html`<span
		class="sp-mk ${resultLook[tone] ?? 'k-none'}"
		role="img"
		aria-label="${result ? words(result) : 'no result yet'}"
		>${glyph(symbol)}</span
	>`
}

export type BoardBuild = { build: string; label: string }
export type BoardColumn = { label: string; title: string; cells: CellStatus[] }

export function board({ builds, columns }: { builds: BoardBuild[]; columns: BoardColumn[] }) {
	if (!builds.length) return html`<span></span>`
	return html`<div
		class="sp-mm"
		data-builds="${builds.length}"
		role="img"
		aria-label="Rules against the last ${plural(builds.length, 'build')}"
	>
		<span></span>${builds.map((build) => html`<span class="sp-mm-b" title="${build.build}">${build.label}</span>`)}
		${columns.map(
			(column) =>
				html`<span class="sp-mm-l" title="${column.title}">${column.label}</span>${column.cells.map((state) =>
						boardCell({ state })
					)}`
		)}
	</div>`
}

export const boardKey = html`<ul class="sp-legend" aria-label="Board key">
	<li><span class="sp-mk k-pass" aria-hidden="true"></span>passed</li>
	<li><span class="sp-mk k-fail" aria-hidden="true">${glyph('✗')}</span>failed</li>
	<li><span class="sp-mk k-run" aria-hidden="true"></span>running</li>
	<li><span class="sp-mk k-q" aria-hidden="true">?</span>needs you</li>
	<li><span class="sp-mk k-none" aria-hidden="true"></span>not run</li>
</ul>`
