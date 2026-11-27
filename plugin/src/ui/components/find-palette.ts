import type { Harness } from '../../pi.ts'
import { glyph, html } from '../html.ts'
import { key } from './key.ts'

export function findPalette({ harness }: { harness: Harness }) {
	return html`<dialog class="sc-find" data-find data-harness="${harness}" aria-label="Find or ask">
		<div class="sc-find-input">
			<input
				type="search"
				data-find-input
				aria-label="Find a plan, a defect, or a question. Or ask Checkmate."
				autocomplete="off"
			/>
		</div>
		<ul class="sc-find-list" role="listbox" aria-label="Results" data-find-results></ul>
		<p class="sc-find-none" data-find-none hidden>Nothing matches.</p>
		<p class="sc-find-none" data-find-more hidden></p>
		<p class="sc-find-none" data-find-asking role="status" hidden></p>
		<p class="sc-find-none" data-find-error role="alert" hidden></p>
		<div class="sc-find-foot">
			<span class="sc-key-hint">${key({ name: glyph('↑') })}${key({ name: glyph('↓') })}Choose</span
			><span class="sc-key-hint">${key({ name: 'Enter' })}<span data-find-enter>Go</span></span
			><span class="sc-key-hint">${key({ name: 'Esc' })}Close</span>
		</div>
		<p class="sc-find-note" data-find-note>
			Ask Checkmate starts ${harness === 'pi' ? 'Pi' : 'Claude Code'} on this computer. It can read this workspace
			and change records.
		</p>
	</dialog>`
}
