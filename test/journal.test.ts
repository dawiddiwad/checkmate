import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import type { TestContext } from 'node:test'
import { cli, directory, json } from './support.ts'
import { journalSchema } from '../plugin/src/guide.ts'

function opened(t: TestContext, capabilities = 'browser,http') {
	const workspace = directory(t)
	const steps = [
		[
			'target',
			'open',
			'shop',
			'--entry-point',
			'web:url:The shop UI and its HTTP API.',
			'--capabilities',
			capabilities,
			'--operations',
			'read_data',
		],
		['target', 'instance', 'add', 'shop', 'local', '--entry', 'web=http://127.0.0.1:4173'],
		['journal', 'open', 'cart', '--target', 'shop', '--instance', 'local'],
	]
	for (const args of steps) assert.equal(cli(workspace, args).code, 0, args.join(' '))
	mkdirSync(join(workspace, 'evidence'))
	writeFileSync(join(workspace, 'evidence', 'total.txt'), 'Total: 450.00')
	return workspace
}

function log(workspace: string, build: string, entries: unknown) {
	return json(workspace, ['journal', 'log', 'cart', '--build', build], entries)
}

function gaps(workspace: string, build: string) {
	const reply = json(workspace, ['journal', 'gaps', 'cart', '--build', build])
	assert.equal(reply.code, 0)
	return reply.body.gaps as Array<{ kind: string; subject: string; idea: string }>
}

const kinds = (list: Array<{ kind: string }>) => list.map((gap) => gap.kind)

test('a change goes from base over b1 to b2 with answers, verdicts, and a decision', (t) => {
	const workspace = opened(t)
	assert.equal(
		log(workspace, 'base', [
			{ kind: 'criterion', id: 'C1', text: 'Five items get 10% off.', source: 'ticket.md#AC1' },
			{
				kind: 'observation',
				saw: 'Total of 5 pens is 50.00',
				value: '50.00',
				steps: 'GET /api/cart',
				via: 'api',
			},
			{ kind: 'question', question: 'Does the discount stack with a coupon?' },
		]).code,
		0
	)
	assert.equal(json(workspace, ['journal', 'answer', 'cart', 'Q1', '--answer', 'No. Use the larger one.']).code, 0)
	const guide = cli(workspace, ['journal', 'guide', 'cart'])
	assert(guide.lines.includes('answer\tQ1\tDoes the discount stack with a coupon?\tNo. Use the larger one.'))
	const b1 = log(workspace, 'b1', [
		{ kind: 'observation', id: 'O2', repeats: 'O1', about: 'C1 Q1', saw: '50.00', value: '50.00', via: 'api' },
		{
			kind: 'observation',
			id: 'O3',
			about: 'C1',
			saw: 'No discount in the cart page',
			verdict: 'wrong',
			via: 'ui',
		},
		{
			kind: 'defect',
			id: 'D1',
			title: 'No discount at 5 items',
			expected: '45.00 (ticket.md#AC1)',
			actual: '50.00',
			severity: 'high',
			links: ['O3'],
			evidence: ['evidence/total.txt', 'GET /api/cart returned 50.00'],
		},
	])
	assert.equal(b1.code, 0)
	assert.match(b1.body.saved[0].compare, /^same as O1 on base: 50.00$/)
	assert.deepEqual(gaps(workspace, 'b1'), [])
	assert(
		cli(workspace, ['journal', 'guide', 'cart']).lines.includes('open_defect\tD1\tb1\thigh\tNo discount at 5 items')
	)
	assert.deepEqual(kinds(gaps(workspace, 'b2')), [
		'build',
		'criterion',
		'answer',
		'baseline',
		'retest',
		'entry_point',
		'entry_point',
	])
	assert.equal(
		log(workspace, 'b2', [
			{ kind: 'verdict', defect: 'D1', result: 'fixed', saw: 'Total 45.00', evidence: 'evidence/total.txt' },
			{
				kind: 'observation',
				repeats: 'O1',
				about: 'C1 Q1',
				saw: '45.00',
				value: '45.00',
				verdict: 'ok',
				via: 'api',
			},
			{ kind: 'observation', about: 'C1', saw: 'Discount shows in the cart page', verdict: 'ok', via: 'ui' },
			{ kind: 'note', about: 'O4', text: 'The total is lower by the intended discount.' },
		]).code,
		0
	)
	assert.deepEqual(kinds(gaps(workspace, 'b2')), ['happy_path'])
	const accept = cli(workspace, ['journal', 'accept', 'cart', '--build', 'b2', '--rationale', 'The discount works.'])
	assert.equal(accept.code, 0)
	assert.equal(accept.lines[0], 'completed cart decision=accepted build=b2')
	assert.equal(accept.lines.at(-1)?.split('\t').slice(0, 2).join('\t'), 'count\t1')
	const show = cli(workspace, ['journal', 'show', 'cart'])
	assert.deepEqual(show.lines, [
		'completed cart target=shop instance=local builds=base,b1,b2',
		'criterion\tC1\tFive items get 10% off.\tticket.md#AC1',
		'matrix\tC1\tbase=-\tb1=wrong1,seen1\tb2=ok2',
		'matrix\t-\tbase=seen1\tb1=-\tb2=-',
		'defect\tD1\tb1\thigh\tNo discount at 5 items\tb2=fixed',
		'question\tQ1\tanswered\tDoes the discount stack with a coupon?\tNo. Use the larger one.',
		'decision\tR1\tb2\taccepted\tThe discount works.\tgaps=1',
	])
	const record = JSON.parse(cli(workspace, ['journal', 'export', 'cart']).output)
	assert.deepEqual(record.openDefects, [])
	assert.equal(
		record.entries.find((entry: { id: string }) => entry.id === 'D1').evidence[0].path,
		'evidence/total.txt'
	)
	assert.deepEqual(record.entries.find((entry: { id: string }) => entry.id === 'D1').evidence[1], {
		text: 'GET /api/cart returned 50.00',
	})
	assert.deepEqual(Object.keys(record.gaps), ['base', 'b1', 'b2'])
})

test('a batch saves each valid entry and refuses each malformed entry with its index, field, and hint', (t) => {
	const workspace = opened(t)
	const reply = log(workspace, 'b1', [
		{ kind: 'observation', saw: 'The cart loads.' },
		{ kind: 'defect', title: 'Wrong total', expected: '45.00', actual: '50.00', severity: 'bad' },
		{ kind: 'observation', saw: 'x', evidence: 'evidence/missing.png' },
		{ kind: 'verdict', defect: 'D9', result: 'fixed', saw: 'ok' },
		{ kind: 'guess' },
	])
	assert.equal(reply.code, 0)
	assert.deepEqual(
		reply.body.saved.map((entry: { id: string }) => entry.id),
		['O1']
	)
	assert.deepEqual(reply.body.refused, [
		{
			index: 1,
			reason: '[1]/severity must be one of: critical, high, medium, low',
			hint: 'Fix the named fields. Run checkmate journal guide to read the fields of defect.',
		},
		{
			index: 2,
			reason: 'Evidence file not found: evidence/missing.png',
			hint: 'Save the file in the workspace first. Or give the text of what you saw.',
		},
		{
			index: 3,
			reason: '[3].defect names no defect: D9.',
			hint: 'Use the ID of an earlier defect. Run checkmate journal show to read the IDs.',
		},
		{
			index: 4,
			reason: '[4]/kind must be one of: criterion, observation, defect, question, verdict, note',
			hint: 'Fix the named fields. Run checkmate journal guide to read the fields of guess.',
		},
	])
	const text = cli(workspace, ['journal', 'log', 'cart'], { kind: 'observation', saw: 'No build.' })
	assert.equal(text.code, 1)
	assert(text.lines.includes('reason: [0] needs field "build"'), text.output)
	assert(text.lines.includes('hint: Give the build in the entry, or with --build on the call.'), text.output)
	assert.equal(JSON.parse(cli(workspace, ['journal', 'export', 'cart']).output).entries.length, 1)
})

test('gaps lists each kind of uncovered work as an idea', (t) => {
	const workspace = opened(t)
	assert.deepEqual(kinds(gaps(workspace, 'b1')), ['build', 'criteria', 'entry_point', 'entry_point'])
	log(workspace, 'base', [
		{ kind: 'criterion', id: 'C1', text: 'Five items get 10% off.', source: 'ticket.md#AC1' },
		{
			kind: 'criterion',
			id: 'C2',
			text: 'A coupon takes 5.00 off.',
			source: 'ticket.md#AC2',
			area: 'src/coupon.js',
		},
		{ kind: 'note', text: 'The diff changes the tax code.', area: 'src/tax.js' },
		{ kind: 'observation', id: 'B1', saw: 'Tax of 100.00 is 23.00', value: '23.00', steps: 'GET /api/tax?net=100' },
		{ kind: 'question', id: 'Q1', question: 'Does the discount stack?' },
	])
	json(workspace, ['journal', 'answer', 'cart', 'Q1', '--answer', 'No.'])
	assert.deepEqual(kinds(gaps(workspace, 'base')), ['entry_point', 'entry_point'])
	log(workspace, 'b1', [
		{ kind: 'observation', about: 'C1', saw: '45.00', verdict: 'ok', via: 'api' },
		{ kind: 'observation', id: 'W1', about: 'C1', saw: 'The badge is missing', verdict: 'wrong', via: 'api' },
		{ kind: 'defect', title: 'Coupon fails', expected: '5.00 off', actual: 'No change', severity: 'medium' },
	])
	const found = gaps(workspace, 'b1')
	assert.deepEqual(kinds(found), [
		'criterion',
		'answer',
		'baseline',
		'evidence',
		'wrong',
		'entry_point',
		'area',
		'area',
	])
	assert.deepEqual(
		found.map((gap) => gap.subject),
		[
			'C2 A coupon takes 5.00 off.',
			'Q1 No.',
			'B1 on base: 23.00',
			'D1 Coupon fails',
			'W1 The badge is missing',
			'no observation on b1 used the UI',
			'src/coupon.js',
			'src/tax.js',
		]
	)
	assert.match(found[2].idea, /^Do it again on b1: GET \/api\/tax\?net=100\. Log an observation with "repeats": "B1"/)
	log(workspace, 'b2', [{ kind: 'observation', about: 'C1', saw: '45.00', verdict: 'ok', via: 'ui' }])
	assert.deepEqual(kinds(gaps(workspace, 'b2')), [
		'happy_path',
		'criterion',
		'answer',
		'baseline',
		'retest',
		'entry_point',
		'area',
		'area',
	])
	const printed = cli(workspace, ['journal', 'gaps', 'cart'])
	assert.equal(printed.lines[0], 'completed cart build=b2')
	assert.equal(printed.lines.at(-1), 'count\t8\tideas for build b2. They are suggestions. Nothing depends on them.')
})

test('a repeated baseline compares normalised values, and a difference needs a note or a defect', (t) => {
	const workspace = opened(t, 'http')
	log(workspace, 'base', [
		{ kind: 'observation', id: 'B1', saw: 'Two items', value: ' 2  items ', via: 'api' },
		{ kind: 'observation', id: 'B2', saw: 'Total', value: '420.0', via: 'api' },
		{ kind: 'observation', id: 'B3', saw: 'Fee', value: '1.50', via: 'api' },
	])
	const b1 = log(workspace, 'b1', [
		{ kind: 'observation', id: 'R1', repeats: 'B1', saw: 'Two items', value: '2 items', via: 'api' },
		{ kind: 'observation', id: 'R2', repeats: 'B2', saw: 'Total', value: '0420', via: 'api' },
		{ kind: 'observation', id: 'R3', repeats: 'B3', saw: 'Fee', value: '2.00', via: 'api' },
	])
	assert.deepEqual(
		b1.body.saved.map((entry: { compare: string }) => entry.compare),
		[
			'same as B1 on base: 2 items',
			'same as B2 on base: 0420',
			'differs from B3 on base: "1.50", now "2.00". Explain it with a note, or report a defect.',
		]
	)
	assert.deepEqual(gaps(workspace, 'b1').slice(1), [
		{
			kind: 'difference',
			subject: 'R3 repeats B3: base "1.50", b1 "2.00"',
			idea: 'Explain or report: log a note with "about": "R3", or a defect with "links": ["R3"].',
		},
	])
	log(workspace, 'b1', { kind: 'note', about: 'R3', text: 'The ticket raises the fee to 2.00.' })
	assert.deepEqual(kinds(gaps(workspace, 'b1')), ['criteria'])
	log(workspace, 'b2', { kind: 'observation', repeats: 'R3', saw: 'Fee', value: '2.5', via: 'api' })
	assert.deepEqual(
		gaps(workspace, 'b2').map((gap) => gap.subject),
		['no criterion', 'B1 on base:  2  items ', 'B2 on base: 420.0', 'O1 repeats B3: b1 "2.00", b2 "2.5"']
	)
})

test('an entry supersedes an earlier entry of the same kind and keeps its ID', (t) => {
	const workspace = opened(t)
	log(workspace, 'b1', {
		kind: 'defect',
		id: 'D1',
		title: 'Total is wrong',
		expected: '45.00',
		actual: '50.00',
		severity: 'low',
	})
	const reply = log(workspace, 'b1', [
		{
			kind: 'defect',
			supersedes: 'D1',
			title: 'No discount at 5 items',
			expected: '45.00',
			actual: '50.00',
			severity: 'high',
			evidence: 'evidence/total.txt',
		},
		{ kind: 'defect', id: 'D1', title: 'Again', expected: 'x', actual: 'y', severity: 'low' },
		{ kind: 'observation', supersedes: 'D1', saw: 'x' },
	])
	assert.deepEqual(
		reply.body.saved.map((entry: { id: string }) => entry.id),
		['D1']
	)
	assert.deepEqual(
		reply.body.refused.map((entry: { reason: string }) => entry.reason),
		['[1].id D1 is in use.', '[2].supersedes names no earlier observation: D1.']
	)
	assert.equal(
		reply.body.refused[0].hint,
		'To replace that entry, give "supersedes": "D1". Or use a new ID, for example D2.'
	)
	const show = cli(workspace, ['journal', 'show', 'cart'])
	assert(show.lines.includes('defect\tD1\tb1\thigh\tNo discount at 5 items\t-'), show.output)
	const record = JSON.parse(cli(workspace, ['journal', 'export', 'cart']).output)
	assert.equal(record.entries.length, 1)
	assert.deepEqual(
		record.history.map((entry: { title: string }) => entry.title),
		['Total is wrong', 'No discount at 5 items']
	)
	assert.deepEqual(kinds(gaps(workspace, 'b1')), ['build', 'criteria', 'entry_point', 'entry_point'])
})

test('a change needs a known target, and a question ID for an answer', (t) => {
	const workspace = opened(t)
	const again = cli(workspace, ['journal', 'open', 'cart', '--target', 'shop'])
	assert.equal(again.code, 1)
	assert(again.lines.includes('reason: Change cart is open.'), again.output)
	assert.equal(cli(workspace, ['journal', 'open', 'other', '--target', 'nope']).code, 1)
	const answer = cli(workspace, ['journal', 'answer', 'cart', 'Q9', '--answer', 'Yes.'])
	assert(answer.lines.includes('reason: Unknown question: Q9.'), answer.output)
	const unknown = cli(workspace, ['journal', 'gaps', 'none'])
	assert(
		unknown.lines.includes('hint: Open it first: checkmate journal open none --target <targetId>.'),
		unknown.output
	)
})

test('the journal guide comes from the entry schemas and stays short', (t) => {
	const workspace = opened(t)
	const guide = cli(workspace, ['journal', 'guide', 'cart']).output
	const schema = journalSchema()
	for (const kind of schema.kinds) {
		assert(guide.includes(`kind\t${kind.kind}\t${kind.about}`), kind.kind)
		for (const field of kind.fields) assert(guide.includes(field.description), `${kind.kind}.${field.path}`)
	}
	assert(guide.includes(JSON.stringify(schema.example)))
	assert.doesNotMatch(guide, /checklist/i)
	assert(guide.length / 4 < 920, `${guide.length / 4} tokens`)
	writeFileSync(join(workspace, 'evidence', 'cart-5.png'), 'png')
	const entries = JSON.parse(guide.split("<<'EOF'\n")[1].split('\nEOF')[0])
	const reply = log(workspace, 'b1', entries)
	assert.deepEqual(reply.body.refused, [])
	assert.equal(reply.body.saved.length, 3)
})
