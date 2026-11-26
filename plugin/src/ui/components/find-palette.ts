import type { Harness } from '../../pi.ts'
import { glyph, html } from '../html.ts'

export function findPalette({ harness }: { harness: Harness }) {
	return html`<dialog class="sp-find" data-find data-harness="${harness}" aria-label="Find or ask">
		<input
			type="search"
			data-find-input
			aria-label="Find a plan, a defect, or a question. Or ask Checkmate."
			autocomplete="off"
		/>
		<ul role="listbox" aria-label="Results" data-find-results></ul>
		<p class="sp-find-none" data-find-none hidden>Nothing matches.</p>
		<p class="sp-find-none" data-find-more hidden></p>
		<p class="sp-find-none" data-find-asking role="status" hidden></p>
		<p class="sp-find-none" data-find-error role="alert" hidden></p>
		<div class="sp-foot">
			<span><kbd>${glyph('↑')}</kbd><kbd>${glyph('↓')}</kbd>Choose</span
			><span><kbd>Enter</kbd><span data-find-enter>Go</span></span
			><span><kbd>Esc</kbd>Close</span>
		</div>
		<p class="sp-find-note" data-find-note>
			Ask Checkmate starts ${harness === 'pi' ? 'Pi' : 'Claude Code'} on this computer. It can read this workspace
			and change records.
		</p>
	</dialog>`
}
