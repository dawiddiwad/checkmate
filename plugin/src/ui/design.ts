import type { Html } from './html.ts'
import type { Page } from './layout.ts'
import { glyph, html, icon, pill } from './html.ts'
import { viewer } from './evidence.ts'

export type Token = { name: string; value: string }

const keptData = [
	'act-error',
	'b',
	'block',
	'builds',
	'cap',
	'chat-view',
	'kind',
	'mark',
	'panel',
	'stale-slot',
	'wide',
	'zoomed',
]
const keptRegions = ['exploration-head', 'chat-list']

export function tokensOf(css: string): Token[] {
	const start = css.indexOf(':root {')
	const block = css.slice(start, css.indexOf('\n}', start))
	return [...block.matchAll(/^\t(--[a-z0-9-]+): (.+);$/gm)].map(([, name, value]) => ({ name, value }))
}

export function inert(markup: string) {
	return markup
		.replace(/\sdata-([a-z-]+)(="[^"]*"|='[^']*')?/g, (attribute, name: string, value = '') => {
			if (name === 'region') return keptRegions.some((region) => value.includes(region)) ? attribute : ''
			return keptData.includes(name) ? attribute : ''
		})
		.replace(/\s(id|for|aria-labelledby|aria-describedby|aria-controls)="([^"]+)"/g, ' $1="ds-$2"')
		.replace(/\s(method|action)="[^"]*"/g, '')
		.replace(/<dialog(?![^>]*\sopen)([^>]*)>/g, '<dialog$1 open>')
}

function modes(value: string) {
	const both = /^light-dark\((.+), (.+)\)$/.exec(value)
	return both ? [both[1], both[2]] : [value, value]
}

function table(head: string[], rows: Array<Array<Html | string>>) {
	return html`<div class="scroll">
		<table>
			<thead>
				<tr>
					${head.map((cell) => html`<th scope="col">${cell}</th>`)}
				</tr>
			</thead>
			<tbody>
				${rows.map(
					(row) =>
						html`<tr>
							${row.map((cell) => html`<td>${cell}</td>`)}
						</tr>`
				)}
			</tbody>
		</table>
	</div>`
}

function section(id: string, title: string, intro: string, body: Html) {
	return html`<section class="ds-sec" id="${id}" aria-labelledby="${id}-h">
		<h2 class="sp-sec" id="${id}-h">${title}</h2>
		<p class="sp-sub">${intro}</p>
		${body}
	</section>`
}

function tokenRows(tokens: Token[], sample: (token: Token) => Html) {
	return table(
		['Token', 'Sample', 'Value'],
		tokens.map((token) => [html`<code>${token.name}</code>`, sample(token), html`<code>${token.value}</code>`])
	)
}

function pick(tokens: Token[], test: (name: string) => boolean) {
	return tokens.filter((token) => test(token.name))
}

function foundations(tokens: Token[]) {
	const colors = tokens.filter((token) => token.value.startsWith('light-dark('))
	const shape = [
		'--radius',
		'--radius-round',
		'--line-w',
		'--mark-w',
		'--line',
		'--focus-ring',
		'--sep',
		'--mark-inset',
	]
	return html`
		${section(
			'color',
			'Color',
			'One value per mode. The browser picks light or dark from the color scheme. The theme button in the top bar switches it.',
			table(
				['Token', 'Sample', 'Light', 'Dark'],
				colors.map((token) => {
					const [light, dark] = modes(token.value)
					return [
						html`<code>${token.name}</code>`,
						html`<span class="ds-swatch" data-style="background: var(${token.name})"></span>`,
						html`<code>${light}</code>`,
						html`<code>${dark}</code>`,
					]
				})
			)
		)}
		${section(
			'type',
			'Type',
			'Each style is a full font shorthand. Line heights are multiples of 4px.',
			tokenRows(
				pick(tokens, (name) => name.startsWith('--type-')),
				(token) => html`<span class="ds-type" data-style="font: var(${token.name})">Verify checkout 0123</span>`
			)
		)}
		${section(
			'space',
			'Spacing',
			'The unit is 4px. Padding, margin and gap use only these steps.',
			tokenRows(
				pick(tokens, (name) => name.startsWith('--sp-')),
				(token) => html`<span class="ds-bar" data-style="width: var(${token.name})"></span>`
			)
		)}
		${section(
			'size',
			'Sizes',
			'Fixed heights of controls and rows. Each is a multiple of 4px and includes its own border.',
			tokenRows(
				pick(tokens, (name) => name.startsWith('--size-')),
				(token) =>
					html`<span
						class="ds-box"
						data-style="height: var(${token.name}); width: var(${token.name})"
					></span>`
			)
		)}
		${section(
			'width',
			'Widths',
			'Fixed widths of columns, panels and dialogs. Each is a multiple of 8px.',
			tokenRows(
				pick(tokens, (name) => name.startsWith('--w-') || name.startsWith('--h-')),
				(token) =>
					html`<span class="ds-bar ds-bar-soft" data-style="width: min(100%, var(${token.name}))"></span>`
			)
		)}
		${section(
			'shape',
			'Radius, lines and focus',
			'Corners are nearly square. A line never adds to the size of a box: frames and separators draw inside it.',
			tokenRows(
				pick(tokens, (name) => shape.includes(name)),
				(token) => html`<span class="ds-shape" data-token="${token.name}"></span>`
			)
		)}
		${section(
			'layer',
			'Layers',
			'The stack from bottom to top. A layer is above every layer before it in this list.',
			tokenRows(
				pick(tokens, (name) => name.startsWith('--z-')),
				() => html`<span class="muted">—</span>`
			)
		)}
		${section(
			'motion',
			'Motion',
			'Motion is short and stops when the system asks for reduced motion.',
			tokenRows(
				pick(tokens, (name) => name.startsWith('--motion-')),
				() => html`<span class="muted">—</span>`
			)
		)}
	`
}

function grid() {
	const cells = Array.from({ length: 12 }, (_, index) => html`<span>${index + 1}</span>`)
	return section(
		'grid',
		'Grid',
		'Turn on the overlay to see the columns and the 4px rows on any page of this UI.',
		html`<dl class="sp-facts">
				<dt>Unit</dt>
				<dd>
					4px. Every space, size and line height is a multiple of it. Only 1px lines and 2px marks are
					smaller.
				</dd>
				<dt>Columns</dt>
				<dd>
					12 above 1100px, 8 from 761px to 1100px, 4 at 760px and below. Columns are whole pixels. The last
					column takes the rest.
				</dd>
				<dt>Gutter</dt>
				<dd>16px between columns.</dd>
				<dt>Margin</dt>
				<dd>16px at both sides of the page, or the safe area if it is larger.</dd>
				<dt>Plan nav</dt>
				<dd>Columns 1 to 3. The page content takes columns 4 to 12.</dd>
				<dt>Drawer</dt>
				<dd>Columns 8 to 12 and the right margin. At 1100px and below the drawer covers the page.</dd>
				<dt>Rows</dt>
				<dd>Every box top and height is on the 4px rows. Lines draw inside boxes.</dd>
				<dt>Small parts</dt>
				<dd>
					Key caps, pills, tags, marks and icon buttons have a fixed height. Their content is centred in it.
				</dd>
				<dt>Inset</dt>
				<dd>Text in a framed box starts 16px from the frame.</dd>
				<dt>Breakpoints</dt>
				<dd>400px, 760px, 1100px and 1240px. Content width: 560px, 976px and 1100px.</dd>
			</dl>
			<div class="ds-cols" aria-hidden="true">${cells}</div>`
	)
}

function block(title: string, body: Html | string) {
	const id = title
		.toLowerCase()
		.replace(/[^a-z0-9]+/g, '-')
		.replace(/^-|-$/g, '')
	return html`<section class="ds-spec" data-block="${id}">
		<h3 class="sp-sec">${title}</h3>
		<div class="ds-stage">${typeof body === 'string' ? { html: body } : body}</div>
	</section>`
}

function state(label: string, sample: Html) {
	return html`<div class="ds-state"><span class="ds-cap">${label}</span>${sample}</div>`
}

function keyCaps() {
	return html`<div class="ds-states">
		${state('alone', html`<kbd>1</kbd> <kbd>Esc</kbd> <kbd>Enter</kbd>`)}
		${state('glyphs', html`<kbd>${glyph('↑')}${glyph('↓')}</kbd> <kbd>${glyph('→')}</kbd> <kbd>${glyph('←')}</kbd>`)}
		${state('in a button', html`<button type="button" class="sp-btn"><kbd>1</kbd><span>Right</span></button>`)}
		${state('in a primary button', html`<button type="button" class="sp-btn pri"><kbd>Enter</kbd><span>Start</span></button>`)}
		${state(
			'in a status hint',
			html`<span class="sb-keys"
				><span class="sb-k"><kbd>${glyph('↑')}${glyph('↓')}</kbd>rows</span
				><span class="sb-k"><kbd>/</kbd>find</span></span
			>`
		)}
		${state('in text', html`<p class="sp-sub">Press <kbd>?</kbd> to see every key.</p>`)}
	</div>`
}

function liveStates() {
	return html`<div class="ds-states">
		${state('loading', html`<span class="who"><span class="live">Connecting</span></span>`)}
		${state('live', html`<span class="who"><span class="live">${glyph('●')} Live</span></span>`)}
		${state('lost', html`<span class="who"><span class="live down">Reconnecting</span></span>`)}
		${state('result marks', html`<span class="ds-row-inline">${icon('passed')}${icon('failed')}${icon('inconclusive')}${icon('running')}${icon(null)}</span>`)}
		${state('status pills', html`<span class="ds-row-inline">${pill('passed')}${pill('failed')}${pill('needs_answers')}</span>`)}
	</div>`
}

function components(parts: string) {
	return html`<section class="ds-sec" id="components" aria-labelledby="components-h">
		<h2 class="sp-sec" id="components-h">Components</h2>
		<p class="sp-sub">
			Each block is the markup of the real page and the real style sheet. Forced states copy the real :hover,
			:focus-visible and :active rules.
		</p>
		${block('Key caps', keyCaps())} ${block('Live, loading and lost', liveStates())} ${{ html: inert(parts) }}
		${block('Viewer', inert(viewer.html).replace(/\shidden(?=[\s>])/, ''))}
	</section>`
}

export function designPage(css: string, parts: string): Page {
	const tokens = tokensOf(css)
	return {
		title: 'Design system',
		section: null,
		subjects: [],
		script: '/assets/design.js',
		body: html`<div class="ds" data-design>
			<div class="sp-h">
				<div>
					<h1>Design system</h1>
					<p class="sp-sub">
						The reference for this UI. It reads the tokens from the style sheet and shows the real
						components.
					</p>
				</div>
				<div class="btns">
					<button type="button" class="sp-btn" data-grid-toggle aria-pressed="false">Grid overlay</button>
				</div>
			</div>
			<nav class="jump" aria-label="Sections">
				${[
					['grid', 'Grid'],
					['color', 'Color'],
					['type', 'Type'],
					['space', 'Spacing'],
					['size', 'Sizes'],
					['width', 'Widths'],
					['shape', 'Lines'],
					['layer', 'Layers'],
					['motion', 'Motion'],
					['components', 'Components'],
				].map(([id, label]) => html`<a href="#${id}">${label}</a>`)}
			</nav>
			${grid()} ${foundations(tokens)} ${components(parts)}
		</div>`,
	}
}
