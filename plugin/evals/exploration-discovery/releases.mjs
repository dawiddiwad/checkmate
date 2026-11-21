import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

function fixtureText(file) {
	return readFileSync(new URL(file, import.meta.url), 'utf8')
}

const base = fixtureText('app.mjs')
const csvFormat = fixtureText('csv-format.txt')
const bulkPage = fixtureText('bulk-page.txt')
const bulkRoute = fixtureText('bulk-route.txt')

function replace(source, edits) {
	for (const [before, after] of edits) {
		assert(source.includes(before), 'Missing fixture source fragment ' + before)
		source = source.replace(before, after)
	}
	return source
}

const featureEdits = [
	['${exportControl}<span>', '${exportControl}<a href="/bulk">Bulk reschedule</a><span>'],
	['async function input(request)', bulkPage + 'async function input(request)'],
	[
		"if (pathname === '/api/assets')",
		"if (pathname === '/bulk') return text(bulkPage())\n\t\t\t\tif (pathname === '/api/assets')",
	],
	['\t\t\tconst match =', bulkRoute + '\t\t\tconst match ='],
]

const regressionEdits = [
	["if (status) params.set('status', status)", ''],
	[
		'const items = selected.slice(start, start + size)',
		`const page = start > 0 ? rows : selected
					const items = selectStatus(page.slice(start, start + size), q)`,
	],
	[
		"item.status === 'confirmed' || item.status === 'checked-out'",
		"item.status === 'confirmed' || (item.status === 'checked-out' && item.depot === 'quay')",
	],
	['Math.round(regular / 10)', 'Math.round((regular + weekend) / 10)'],
	[
		'bookings.set(item.id, updated)',
		"if (item.channel === 'partner' && data.note === undefined) updated.note = ''\n\t\t\t\t\tbookings.set(item.id, updated)",
	],
	['refundCents: item.depositCents', "refundCents: item.channel === 'prepaid' ? 0 : item.depositCents"],
]

const fixedEdits = [
	['const attr = escape', 'const attr = escape\n' + csvFormat],
	[
		'const exportControl = `<a id="export" href="/api/export?${attr(params)}">Download CSV</a>`',
		`const exportControl = rows.length
		? \`<a id="export" href="/api/export?\${attr(params)}">Download CSV</a>\`
		: '<button id="export" disabled>Download CSV</button>'`,
	],
	["{ action: 'checked-in' }", "{ action: 'returned' }"],
	['const needle = term.toLowerCase()', 'const needle = term.trim().toLowerCase()'],
	['.map(String).join', '.map(csv).join'],
	['item.to >= from', 'item.to > from'],
	["annual && asset.depot !== 'ridge'", 'annual'],
]

export function buildSource(release, clean = false) {
	const source = clean ? replace(base, fixedEdits) : base
	if (release === 'base') return source
	assert.equal(release, 'pr')
	return replace(source, clean ? featureEdits : [...featureEdits, ...regressionEdits])
}

export async function deploy(source) {
	const url = 'data:text/javascript;base64,' + Buffer.from(source).toString('base64')
	const { serve } = await import(url)
	return serve()
}
