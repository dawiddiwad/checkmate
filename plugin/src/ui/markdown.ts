import MarkdownIt from 'markdown-it'
import { html } from './html.ts'

const markdown = new MarkdownIt({ html: false, breaks: true, linkify: true, xhtmlOut: true })
const embeddedImage = /^data:image\/(?:png|jpeg|gif|webp);base64,[A-Za-z0-9+/]+=*$/i
const recordId = '[A-Za-z0-9][A-Za-z0-9_-]{0,95}'
const evidenceImage = new RegExp(
	`^/(?:evidence/[0-9A-Z]{26}|explorations/${recordId}/(?:claims|entries)/${recordId}/${recordId}/evidence/[0-9]{1,3})$`
)

function linkAddress(address: string) {
	if (/^(?:\/(?![/\\])|#)/.test(address)) return true
	const url = URL.parse(address)
	return url !== null && ['http:', 'https:', 'mailto:'].includes(url.protocol)
}

markdown.validateLink = (address) => linkAddress(address) || embeddedImage.test(address)

markdown.renderer.rules.link_open = (tokens, index, options, _env, renderer) => {
	const link = tokens[index]
	if (!linkAddress(String(link.attrGet('href') ?? ''))) link.attrs = null
	return renderer.renderToken(tokens, index, options)
}

const renderImage = markdown.renderer.rules.image!
markdown.renderer.rules.image = (tokens, index, options, env, renderer) => {
	const image = tokens[index]
	const source = String(image.attrGet('src') ?? '')
	if (evidenceImage.test(source) || embeddedImage.test(source)) {
		image.attrSet('loading', 'lazy')
		image.attrSet('decoding', 'async')
		return renderImage(tokens, index, options, env, renderer)
	}
	const label = renderer.renderInlineAsText(image.children ?? [], options, env) || 'Open image'
	return (linkAddress(source) ? html`<a href="${source}">${label}</a>` : html`${label}`).html
}

markdown.renderer.rules.table_open = (tokens, index, options, _env, renderer) =>
	`<div class="chat-table" role="region" aria-label="Table" tabindex="0">${renderer.renderToken(tokens, index, options)}`
markdown.renderer.rules.table_close = (tokens, index, options, _env, renderer) =>
	`${renderer.renderToken(tokens, index, options)}</div>`

for (const rule of ['th_open', 'td_open']) {
	markdown.renderer.rules[rule] = (tokens, index, options, _env, renderer) => {
		const cell = tokens[index]
		const alignment = String(cell.attrGet('style') ?? '').split(':')[1]
		if (alignment === 'left' || alignment === 'center' || alignment === 'right')
			cell.attrs = [['class', `chat-align-${alignment}`]]
		return renderer.renderToken(tokens, index, options)
	}
}

export function chatMarkdown(text: string) {
	return { html: markdown.render(text) }
}
