import type { Html } from './html.ts'
import type { Page } from './layout.ts'
import { glyph, html, icon, pill } from './html.ts'
import { banner, crumbBar, downloads, emptyNotice, heading } from './layout.ts'

export type Token = { name: string; value: string }

export function tokensOf(css: string): Token[] {
	const start = css.indexOf(':root {')
	const block = css.slice(start, css.indexOf('\n}', start))
	return [...block.matchAll(/^\t(--[a-z0-9-]+): (.+);$/gm)].map(([, name, value]) => ({ name, value }))
}

function modes(value: string) {
	const both = /^light-dark\((.+), (.+)\)$/.exec(value)
	return both ? [both[1], both[2]] : [value, value]
}

function section(id: string, title: string, intro: Html | string, body: Html) {
	return html`<section class="ds-sec" id="${id}" aria-labelledby="${id}-h">
		<h2 class="sp-sec" id="${id}-h">${title}</h2>
		<p class="sp-sub">${intro}</p>
		${body}
	</section>`
}

function tokenTable(tokens: Token[], sample: (token: Token) => Html, columns = ['Token', 'Sample', 'Value']) {
	return html`<div class="scroll">
		<table>
			<thead>
				<tr>
					${columns.map((column) => html`<th scope="col">${column}</th>`)}
				</tr>
			</thead>
			<tbody>
				${tokens.map(
					(token) =>
						html`<tr>
							<td><code>${token.name}</code></td>
							<td>${sample(token)}</td>
							<td><code>${token.value}</code></td>
						</tr>`
				)}
			</tbody>
		</table>
	</div>`
}

function colors(tokens: Token[]) {
	const list = tokens.filter((token) => token.value.startsWith('light-dark('))
	return html`<div class="scroll">
		<table>
			<thead>
				<tr>
					<th scope="col">Token</th>
					<th scope="col">Sample</th>
					<th scope="col">Light</th>
					<th scope="col">Dark</th>
				</tr>
			</thead>
			<tbody>
				${list.map((token) => {
					const [light, dark] = modes(token.value)
					return html`<tr>
						<td><code>${token.name}</code></td>
						<td><span class="ds-swatch" data-style="background: var(${token.name})"></span></td>
						<td><code>${light}</code></td>
						<td><code>${dark}</code></td>
					</tr>`
				})}
			</tbody>
		</table>
	</div>`
}

function pick(tokens: Token[], prefix: string) {
	return tokens.filter((token) => token.name.startsWith(prefix))
}

function foundations(tokens: Token[]) {
	const type = pick(tokens, '--type-')
	const space = pick(tokens, '--sp-')
	const size = pick(tokens, '--size-')
	const shape = tokens.filter((token) =>
		[
			'--radius',
			'--radius-round',
			'--line-w',
			'--mark-w',
			'--line',
			'--focus-ring',
			'--sep',
			'--mark-inset',
		].includes(token.name)
	)
	const motion = pick(tokens, '--motion-')
	return html`
		${section(
			'color',
			'Color',
			'One value per mode. The browser picks light or dark from the color scheme. The theme button in the top bar switches it.',
			colors(tokens)
		)}
		${section(
			'type',
			'Type',
			'Each style is a full font shorthand. Line heights are multiples of 4px. Labels are uppercase with the track token.',
			tokenTable(
				type,
				(token) => html`<span class="ds-type" data-style="font: var(${token.name})">Verify checkout 0123</span>`
			)
		)}
		${section(
			'space',
			'Spacing',
			'The unit is 4px. Padding, margin and gap use only these steps.',
			tokenTable(space, (token) => html`<span class="ds-bar" data-style="width: var(${token.name})"></span>`)
		)}
		${section(
			'size',
			'Sizes',
			'Fixed heights of controls and rows. Each is a multiple of 4px and includes its own border.',
			tokenTable(
				size,
				(token) =>
					html`<span
						class="ds-box"
						data-style="height: var(${token.name}); width: var(${token.name})"
					></span>`
			)
		)}
		${section(
			'shape',
			'Radius, lines and focus',
			'Corners are nearly square. A line never adds to the size of a box: frames and separators draw inside it.',
			tokenTable(shape, (token) => html`<span class="ds-shape" data-token="${token.name}"></span>`)
		)}
		${section(
			'motion',
			'Motion',
			'Motion is short and stops when the system asks for reduced motion.',
			tokenTable(motion, () => html`<span class="muted">—</span>`)
		)}
	`
}

function grid() {
	const cells = Array.from({ length: 12 }, (_, index) => html`<span>${index + 1}</span>`)
	return section(
		'grid',
		'Grid',
		'Turn on the overlay to see the columns and the 4px rows on every page of this UI.',
		html`<dl class="sp-facts">
				<dt>Unit</dt>
				<dd>
					4px. Every space, size and line height is a multiple of it. Only 1px lines and 2px marks are
					smaller.
				</dd>
				<dt>Columns</dt>
				<dd>12 above 1100px, 8 from 761px to 1100px, 4 at 760px and below.</dd>
				<dt>Gutter</dt>
				<dd>16px between columns.</dd>
				<dt>Margin</dt>
				<dd>16px at both sides of the page, or the safe area if it is larger.</dd>
				<dt>Plan nav</dt>
				<dd>Columns 1 to 3. The page content takes columns 4 to 12.</dd>
				<dt>Drawer</dt>
				<dd>
					Columns 8 to 12 and the right margin. The page content stops at column 7. At 1100px and below the
					drawer covers the page.
				</dd>
				<dt>Rows</dt>
				<dd>
					Boxes stack on the 4px rows. Lines draw inside boxes, so a 1px frame does not move the next box.
				</dd>
				<dt>Inset</dt>
				<dd>
					Text in a framed box starts 16px from the frame. Rows have 12px vertical padding, or a fixed height.
				</dd>
				<dt>Breakpoints</dt>
				<dd>
					400px small phone, 760px phone, 1100px tablet, 1240px narrow desktop. Content width: 560px, 976px,
					1100px.
				</dd>
			</dl>
			<div class="ds-cols" aria-hidden="true">${cells}</div>`
	)
}

function states(items: Array<[string, Html]>) {
	return html`<div class="ds-states">
		${items.map(([label, sample]) => html`<div><span class="lab">${label}</span>${sample}</div>`)}
	</div>`
}

function part(title: string, body: Html) {
	return html`<div class="panel ds-part">
		<h2>${title}</h2>
		${body}
	</div>`
}

function button(look: string, label: string, extra: Html | string = '') {
	return html`<button type="button" class="sp-btn ${look}" ${extra}>${label}</button>`
}

function listRows() {
	const row = (look: string, tag: Html, id: string, title: string, meta: string) =>
		html`<div class="sp-row ${look}" role="listitem">
			<label class="sp-c-cb"><input type="checkbox" tabindex="-1" aria-label="Select ${id}" /></label>
			<span class="sp-c-tag">${tag}</span>
			<span class="sp-c-id">${id}</span>
			<a class="sp-c-title ell" tabindex="-1" href="#components">${title}</a>
			<span class="sp-c-meta ell">${meta}</span>
		</div>`
	return html`<div class="sp-list" role="list" aria-label="Example items">
		<div class="sp-gh" role="presentation">Tests <span>3</span></div>
		${row('', pill('passed'), 'T1', 'Standard order total', 'default')}
		${row('is-hover', pill('failed'), 'T2', 'Promotion replaces loyalty', 'hover')}
		${row('sel', pill('inconclusive'), 'T4', 'Promotion banner', 'selected')}
		${row('hl', pill('high'), 'F1', 'The promotion stacks with the loyalty credit', 'highlighted (keyboard)')}
		${row('cur', pill('open'), 'G4', 'Must the banner text wrap?', 'current')}
		${row('dim', pill('answered'), 'Q2', 'Answered question', 'dim')}
	</div>`
}

function tile(look: string) {
	return html`<div class="sp-ct ${look}" role="listitem">
		<div class="sp-ct-main">
			<div class="sp-ct-head">
				<span class="sp-c-id">checkout</span>${pill('needs_answers')}
				<span class="sp-ct-when ell">shop-local@1 · waits on oracle</span>
			</div>
			<h2 class="sp-ct-title ell">Verify checkout totals and refund eligibility.</h2>
			<p class="sp-ct-verdict"><b>Build fixture-build-2: 1 failed.</b> 2 questions open.</p>
			<p class="sp-ct-cost">Total cost Unknown</p>
		</div>
		<div class="sp-nums">
			<div><b>1</b><span>defects</span></div>
			<div><b>0</b><span>to look at</span></div>
			<div><b class="att">2</b><span>questions</span></div>
			<div><b>0</b><span>handed over</span></div>
		</div>
		<div class="sp-ct-opts">
			<a class="sp-btn" href="#components"><kbd>1</kbd><span>Answer 1 blocking question</span></a>
		</div>
	</div>`
}

function nav() {
	const row = (look: string, id: string, text: string, end: Html | string) =>
		html`<a class="sp-nrow ${look}" role="treeitem" href="#components"
			><span class="sp-nid">${id}</span><span class="sp-ntx ell">${text}</span>${end}</a
		>`
	return html`<nav class="sp-nav ds-nav" aria-label="Example plan nav">
		<div class="sp-nlist" role="tree">
			${row('', '', 'Needs you', html`<span class="sp-ncount att">3</span>`)}
			${row('on', '', 'All items', html`<span class="sp-ncount">3</span>`)}
			${row('is-hover', '', 'Plan chats', '')}
			<div class="sp-sep" aria-hidden="true"></div>
			${row('hl', 'Out', 'Outside the rules', html`<span class="sp-nmarks">${icon('passed')}${icon('failed')}</span>`)}
			${row('', 'R1', 'Rule one', html`<span class="sp-nmarks">${icon('inconclusive')}${icon(null)}</span>`)}
		</div>
	</nav>`
}

function components() {
	const statuses = ['passed', 'failed', 'inconclusive', 'needs_approval', 'running', 'blocked', 'critical']
	return section(
		'components',
		'Components',
		'Each sample is the real markup and the real style sheet. Forced states copy the real :hover, :focus-visible and :active rules.',
		html`<div class="ds-parts">
				${part(
					'Button',
					html`${states([
						['Default', button('', 'Open the plan')],
						['Hover', button('is-hover', 'Open the plan')],
						['Focus', button('is-focus', 'Open the plan')],
						['Active', button('is-active', 'Open the plan')],
						['Disabled', button('', 'Open the plan', 'disabled')],
					])}
					${states([
						['Primary', button('pri', 'Accept run-7')],
						['Hover', button('pri is-hover', 'Accept run-7')],
						['Focus', button('pri is-focus', 'Accept run-7')],
						['Active', button('pri is-active', 'Accept run-7')],
						[
							'With key',
							html`<a class="sp-btn" href="#components"><kbd>1</kbd><span>New change</span></a>`,
						],
					])}`
				)}
				${part(
					'Status pill',
					states(statuses.map((status) => [status.replace('_', ' '), pill(status)] as [string, Html]))
				)}
				${part(
					'Result mark',
					states([
						['Pass', icon('passed')],
						['Fail', icon('failed')],
						['Question', icon('inconclusive')],
						['Running', icon('running')],
						['None', icon(null)],
					])
				)}
				${part(
					'Key and tag',
					states([
						['Key', html`<kbd>?</kbd>`],
						['Tag', html`<span class="tag">shop-local@1</span>`],
						[
							'Glyphs',
							html`<span>${glyph('✓')} ${glyph('✗')} ${glyph('●')} ${glyph('○')} ${glyph('◐')}</span>`,
						],
					])
				)}
				${part(
					'Field',
					html`<div class="field-group">
							<label for="ds-text">Name <span class="req">*</span></label>
							<input id="ds-text" type="text" placeholder="qa-lead" />
							<p class="help">Checkmate records it with each decision.</p>
						</div>
						<div class="field-group">
							<label for="ds-focus">Focus</label>
							<input id="ds-focus" class="is-focus" type="text" value="Focused field" />
						</div>
						<div class="field-group">
							<label for="ds-read">Read only</label>
							<input id="ds-read" type="text" value="sha256 c388…a71b" readonly />
						</div>
						<div class="field-group">
							<label for="ds-area">Rationale</label>
							<textarea id="ds-area" placeholder="Why do you decide this?"></textarea>
							<p class="form-error" role="alert">Enter a rationale.</p>
						</div>
						<div class="field-group">
							<label for="ds-select">Model</label>
							<select id="ds-select">
								<option>Default</option>
								<option>Other</option>
							</select>
						</div>
						<fieldset>
							<legend>Choice</legend>
							<div class="seg">
								<label><input type="radio" name="ds-seg" checked /> Clarify</label>
								<label><input type="radio" name="ds-seg" /> Accept</label>
								<label><input type="radio" name="ds-seg" disabled /> Defer</label>
							</div>
						</fieldset>
						<label class="check"><input type="checkbox" checked /> Block release</label>`
				)}
				${part(
					'Banner',
					html`${banner('info', 'Checkmate made a new plan revision.')}
					${banner('warn', 'One question blocks testing.')}
					${banner('fail', 'The run stopped with an error.')}`
				)}
				${part(
					'Empty, loading and error',
					html`${emptyNotice('No chats yet.', 'Start a new chat to ask Checkmate.')}
					${states([
						['Loading', html`<span class="who"><span class="live">Connecting</span></span>`],
						['Live', html`<span class="who"><span class="live">● Live</span></span>`],
						['Lost', html`<span class="who"><span class="live down">Reconnecting</span></span>`],
					])}`
				)}
				${part(
					'Facts',
					html`<dl class="sp-facts">
						<dt>Completion</dt>
						<dd>completed</dd>
						<dt>Coverage</dt>
						<dd>partial</dd>
					</dl>`
				)}
				${part(
					'Fold and menu',
					html`<details class="fold" open>
							<summary><h2>Rules of the plan</h2></summary>
							<div class="fold-b">Four rules. Each rule has checks.</div>
						</details>
						${downloads('Download report', '#', 'Pick a format.')}`
				)}
				${part(
					'Path',
					crumbBar([
						['Runs', '#'],
						['checkout@2', '#'],
						['run-7', null],
					])
				)}
			</div>
			<h3 class="ds-h">List</h3>
			${listRows()}
			<h3 class="ds-h">Plan tile</h3>
			<div class="sp-home" role="list" aria-label="Example plans">
				${tile('')} ${tile('is-hover')} ${tile('hl')}
			</div>
			<h3 class="ds-h">Plan nav</h3>
			${nav()}
			<h3 class="ds-h">Table</h3>
			<div class="scroll">
				<table>
					<thead>
						<tr>
							<th scope="col">Run</th>
							<th scope="col">State</th>
							<th scope="col">Cost</th>
						</tr>
					</thead>
					<tbody>
						<tr>
							<td>run-7</td>
							<td>${pill('pending', 'awaiting acceptance')}</td>
							<td>Unknown</td>
						</tr>
						<tr>
							<td>run-6</td>
							<td>${pill('approved', 'accepted')}</td>
							<td>$0.42</td>
						</tr>
					</tbody>
				</table>
			</div>`
	)
}

export function designPage(css: string): Page {
	const tokens = tokensOf(css)
	return {
		title: 'Design system',
		section: null,
		subjects: [],
		script: '/assets/design.js',
		body: html`<div class="ds" data-design>
			${heading(
				'Design system',
				'The reference for this UI. It reads the tokens from the style sheet and shows the real components.',
				html`<div class="btns">
					<button type="button" class="sp-btn" data-grid-toggle aria-pressed="false">Grid overlay</button>
				</div>`
			)}
			<nav class="jump" aria-label="Sections">
				${[
					['grid', 'Grid'],
					['color', 'Color'],
					['type', 'Type'],
					['space', 'Spacing'],
					['size', 'Sizes'],
					['shape', 'Lines'],
					['motion', 'Motion'],
					['components', 'Components'],
				].map(([id, label]) => html`<a href="#${id}">${label}</a>`)}
			</nav>
			${grid()} ${foundations(tokens)} ${components()}
		</div>`,
	}
}
