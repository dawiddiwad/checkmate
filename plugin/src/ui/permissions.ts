import type { Store } from '../store.ts'
import type { Context, Page } from './layout.ts'
import { openPermissions } from '../permissions.ts'
import { ago, html, plural } from './html.ts'
import { emptyNotice, heading } from './layout.ts'
import { inputLine } from './hooks.ts'

export function permissionsPage(store: Store, context: Context): Page {
	const open = openPermissions(store)
	const rows = open.map((item) => {
		const action = `/permissions/${item.explorationId}/${item.id}`
		const shown = inputLine(item.input) || JSON.stringify(item.input).slice(0, 120)
		return html`<tr data-permission="${item.explorationId}/${item.id}">
			<td class="mono">${item.explorationId} ${item.id}</td>
			<td>${item.who}</td>
			<td class="mono">${item.tool}</td>
			<td class="mono">${shown}</td>
			<td>${ago(item.at)}</td>
			<td>
				<form method="post" action="${action}" class="decision-form">
					<input type="hidden" name="csrf" value="${context.csrf}" />
					${
						context.actor
							? ''
							: html`<label>Your name <input name="actor" maxlength="64" autocomplete="off" /></label>`
					}
					<div class="btns">
						<button class="btn primary" name="decision" value="allow">Allow once</button>
						${
							item.rule
								? html`<button class="btn" name="decision" value="allow-kind">
											Allow ${item.rule} for this test
										</button>
										<button class="btn" name="decision" value="always">
											Always allow ${item.rule} in this project
										</button>`
								: ''
						}
						<input name="reason" placeholder="Reason for a denial" maxlength="400" autocomplete="off" />
						<button class="btn" name="decision" value="deny">Deny</button>
						<button class="btn" name="decision" value="stop">
							Stop ${item.tester ? `tester ${item.tester}` : 'the run'}
						</button>
					</div>
				</form>
			</td>
		</tr>`
	})
	return {
		title: 'Permission requests',
		section: null,
		subjects: ['*'],
		back: '/',
		body: html`${heading(
			'Permission requests',
			open.length
				? `${plural(open.length, 'request')} of testers wait for an answer.`
				: 'No request of a tester waits for an answer.'
		)}
		${
			open.length
				? html`<div class="scroll">
						<table>
							<thead>
								<tr>
									<th scope="col">Request</th>
									<th scope="col">Who</th>
									<th scope="col">Tool</th>
									<th scope="col">Input</th>
									<th scope="col">Asked</th>
									<th scope="col">Answer</th>
								</tr>
							</thead>
							<tbody>
								${rows}
							</tbody>
						</table>
					</div>`
				: emptyNotice('Nothing waits for you.', 'A tester that needs a permission asks here while the UI runs.')
		}`,
	}
}
