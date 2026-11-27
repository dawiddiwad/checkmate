import type { RequestSelection } from '../../requests.ts'
import { html } from '../html.ts'
import { formButton } from './button.ts'

export type Composer = { csrf: string; action: string; selection: RequestSelection; screen?: string; back?: string }

export function composer({ csrf, action, selection, screen = '', back = '' }: Composer) {
	const model = selection.provider && selection.model ? `${selection.provider}/${selection.model}` : selection.model
	return html`<form method="post" action="${action}" class="sc-chat-form" data-chat-composer>
		<input type="hidden" name="csrf" value="${csrf}" />
		${screen ? html`<input type="hidden" name="screen" value="${screen}" />` : ''}
		${back ? html`<input type="hidden" name="return" value="${back}" />` : ''}
		<div class="sc-composer">
			<label class="sc-sr" for="chat-text">Message</label>
			<textarea
				id="chat-text"
				name="text"
				required
				maxlength="4000"
				rows="4"
				placeholder="Ask Checkmate…"
			></textarea>
			<div class="sc-composer-bar">
				<label
					>Harness
					<select name="harness" data-chat-harness>
						<option value="claude" ${selection.harness === 'claude' ? 'selected' : ''}>Claude Code</option>
						<option value="pi" ${selection.harness === 'pi' ? 'selected' : ''}>Pi</option>
					</select></label
				>
				<label
					>Search models
					<input type="search" data-chat-model-search autocomplete="off" placeholder="Provider or name"
				/></label>
				<label
					>Model
					<select name="model" data-chat-model>
						${model ? html`<option value="${model}" selected>${model}</option>` : ''}
						<option value="">Host default</option>
					</select></label
				>
				<label hidden
					>Effort
					<select name="effort" data-chat-effort data-selected="${selection.effort ?? ''}">
						<option value="">Host default</option>
					</select></label
				>
				<span class="sc-grow"></span>
				${formButton({ label: 'Send', emphasis: 'primary', attrs: { type: 'submit' } })}
			</div>
		</div>
		<p class="sc-help" data-chat-model-status aria-live="polite"></p>
		<p class="sc-error" data-chat-error role="alert" hidden></p>
	</form>`
}
