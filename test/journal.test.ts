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
	assert.deepEqual(gaps(workspace, 'b1'), [])
	assert(
		cli(workspace, ['journal', 'guide', 'cart']).lines.includes('open_defect\tD1\tb1\thigh\tNo discount at 5 items')
	)
	assert.deepEqual(kinds(gaps(workspace, 'b2')), [
		'baseline',
		'retest',
		'build',
		'criterion',
		'answer',
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
			field: '[1].severity',
			reason: '[1]/severity must be one of: critical, high, medium, low',
			hint: 'Fix the named fields. Run checkmate journal guide to read the fields of defect.',
			fix: {
				kind: 'defect',
				title: 'Wrong total',
				expected: '45.00',
				actual: '50.00',
				severity: 'critical|high|medium|low',
			},
		},
		{
			index: 2,
			field: '[2].evidence',
			reason: 'Evidence file not found: evidence/missing.png',
			hint: 'Save the file in the workspace first. Or give the text of what you saw.',
			fix: { kind: 'observation', saw: 'x', evidence: '<a file in the workspace, or the text that you saw>' },
		},
		{
			index: 3,
			field: '[3].defect',
			reason: '[3].defect names no defect: D9.',
			hint: 'Use the ID of an earlier defect. Run checkmate journal show to read the IDs.',
			fix: { kind: 'verdict', defect: '<defect ID>', result: 'fixed', saw: 'ok' },
		},
		{
			index: 4,
			field: '[4].kind',
			reason: '[4]/kind must be one of: criterion, observation, defect, question, verdict, note',
			hint: 'Fix the named fields. Run checkmate journal guide to read the fields of guess.',
			fix: { kind: 'criterion|observation|defect|question|verdict|note' },
		},
	])
	const text = cli(workspace, ['journal', 'log', 'cart'], { kind: 'observation', saw: 'No build.' })
	assert.equal(text.code, 1)
	assert(
		text.lines.includes(
			'reason: [0] needs field "build". Send: {"kind":"observation","saw":"No build.","build":"<build>"}'
		),
		text.output
	)
	assert(text.lines.includes('hint: Give the build in the entry, or with --build on the call.'), text.output)
	assert.equal(JSON.parse(cli(workspace, ['journal', 'export', 'cart']).output).entries.length, 1)
})

test('gaps lists each kind of uncovered work as an idea', (t) => {
	const workspace = opened(t)
	assert.deepEqual(kinds(gaps(workspace, 'b1')), ['baselines', 'build', 'criteria', 'entry_point', 'entry_point'])
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
	assert.deepEqual(kinds(gaps(workspace, 'base')), [
		'baselines',
		'baseline_area',
		'baseline_area',
		'entry_point',
		'entry_point',
	])
	log(workspace, 'b1', [
		{ kind: 'observation', about: 'C1', saw: '45.00', verdict: 'ok', via: 'api' },
		{ kind: 'observation', id: 'W1', about: 'C1', saw: 'The badge is missing', verdict: 'wrong', via: 'api' },
		{ kind: 'defect', title: 'Coupon fails', expected: '5.00 off', actual: 'No change', severity: 'medium' },
	])
	const found = gaps(workspace, 'b1')
	assert.deepEqual(kinds(found), [
		'baseline',
		'wrong',
		'evidence',
		'criterion',
		'area',
		'area',
		'answer',
		'entry_point',
		'entry_point',
	])
	assert.deepEqual(
		found.map((gap) => gap.subject),
		[
			'B1 on base: 23.00',
			'W1 The badge is missing',
			'D1 Coupon fails',
			'C2 A coupon takes 5.00 off.',
			'src/coupon.js',
			'src/tax.js',
			'Q1 No.',
			'no observation on b1 used the UI',
			'C1 was observed only through the API',
		]
	)
	assert.equal(found[0].idea, 'Do it again on b1: GET /api/tax?net=100. Log the value with "repeats": "B1".')
	log(workspace, 'b2', [{ kind: 'observation', about: 'C1', saw: '45.00', verdict: 'ok', via: 'ui' }])
	const later = gaps(workspace, 'b2')
	assert.deepEqual(kinds(later), [
		'baseline',
		'retest',
		'happy_path',
		'criterion',
		'area',
		'area',
		'answer',
		'entry_point',
	])
	assert.equal(
		later[2].idea,
		'One observation, only through the UI. Try a boundary value, invalid input, the API, or the state after a change.'
	)
	const printed = cli(workspace, ['journal', 'gaps', 'cart'])
	assert.equal(printed.lines[0], 'completed cart build=b2')
	assert.equal(printed.lines.at(-1), 'count\t8\topen items on b2: things your record does not show yet.')
})

test('a repeated baseline compares normalised values, and a difference needs a note or a defect', (t) => {
	const workspace = opened(t, 'http')
	log(workspace, 'base', [
		{ kind: 'observation', id: 'B1', saw: 'Two items', value: ' 2  items ', via: 'api' },
		{ kind: 'observation', id: 'B2', saw: 'Total', value: '420.0', via: 'api' },
		{ kind: 'observation', id: 'B3', saw: 'Fee', value: '1.50', via: 'api' },
	])
	log(workspace, 'b1', [
		{ kind: 'observation', id: 'R1', repeats: 'B1', saw: 'Two items', value: '2 items', via: 'api' },
		{ kind: 'observation', id: 'R2', repeats: 'B2', saw: 'Total', value: '0420', via: 'api' },
		{ kind: 'observation', id: 'R3', repeats: 'B3', saw: 'Fee', value: '2.00', via: 'api' },
	])
	assert.deepEqual(gaps(workspace, 'b1').slice(0, 1), [
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
		['O1 repeats B3: b1 "2.00", b2 "2.5"', 'B1 on base:  2  items ', 'B2 on base: 420.0', 'no criterion']
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
	assert.deepEqual(kinds(gaps(workspace, 'b1')), ['baselines', 'build', 'criteria', 'entry_point', 'entry_point'])
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
	assert(guide.length / 4 < 1000, `${guide.length / 4} tokens`)
	writeFileSync(join(workspace, 'evidence', 'cart-5.png'), 'png')
	const entries = JSON.parse(guide.split("<<'EOF'\n")[1].split('\nEOF')[0])
	const reply = log(workspace, 'b1', entries)
	assert.deepEqual(reply.body.refused, [])
	assert.equal(reply.body.saved.length, 3)
})

test('a log call prints only the saved IDs and the refused entries', (t) => {
	const workspace = opened(t)
	const text = cli(
		workspace,
		['journal', 'log', 'cart', '--build', 'b1'],
		[
			{ kind: 'note', text: 'The coupon page is not tested.' },
			{ kind: 'observation', saw: 'Fee 2.00', value: '2.00', repeats: 'nothing' },
			{ kind: 'criterion', text: 'A fee is 1.50.', source: 'ticket.md#AC3' },
		]
	)
	assert.equal(text.lines[1], 'saved\tN1,C1')
	assert.deepEqual(
		text.lines.filter((line) => /^(open|link|compare)/.test(line)),
		[]
	)
	assert.equal(text.lines.filter((line) => line.startsWith('refused\t')).length, 1)
	const reply = log(workspace, 'b1', { kind: 'note', text: 'Explored.' })
	assert.equal('open' in reply.body, false)
})

test('on the first build, few baselines give one suggestion and each area without a baseline is named', (t) => {
	const workspace = opened(t, 'http')
	log(workspace, 'base', [
		{ kind: 'criterion', text: 'Five items get 10% off.', source: 'ticket.md#AC1', area: 'src/cart.js' },
		{ kind: 'note', text: 'The diff changes the tax code.', area: 'src/tax.js' },
		{ kind: 'observation', about: 'src/tax.js', saw: 'Tax 23.00', value: '23.00', via: 'api' },
	])
	const first = gaps(workspace, 'base')
	assert.deepEqual(
		first.slice(0, 2).map((gap) => gap.subject),
		['1 baseline on base', 'src/cart.js']
	)
	assert.match(
		first[0].idea,
		/the same totals and calculations, validation and error messages, lists, exports, and counters/
	)
	log(workspace, 'base', [
		{ kind: 'observation', about: 'src/cart.js', saw: 'Total 50.00', value: '50.00', via: 'api' },
		{ kind: 'observation', saw: 'Count 3', value: '3', via: 'api' },
	])
	assert.deepEqual(kinds(gaps(workspace, 'base')), [])
	log(workspace, 'b1', { kind: 'observation', saw: 'The cart loads.', via: 'api' })
	assert(!kinds(gaps(workspace, 'b1')).includes('baselines'))
})

test('an observation with a value links itself to one earlier baseline, and gaps shows the difference', (t) => {
	const workspace = opened(t, 'http')
	log(workspace, 'base', [
		{ kind: 'observation', id: 'B1', about: 'C1', steps: 'GET /api/cart', saw: '50.00', value: '50.00' },
		{ kind: 'observation', id: 'fee-base', saw: 'Fee', value: '1.50' },
		{ kind: 'observation', id: 'X1', about: 'tax', steps: 'GET /api/tax', saw: '23', value: '23' },
		{ kind: 'observation', id: 'X2', about: 'tax', steps: 'get  /api/tax', saw: '23', value: '23' },
	])
	log(workspace, 'b1', [
		{ kind: 'observation', about: 'C1', steps: ' get /API/cart ', saw: '45.00', value: '45.00' },
		{ kind: 'observation', id: 'fee-b1', saw: 'Fee', value: '1.5' },
		{ kind: 'observation', about: 'tax', steps: 'GET /api/tax', saw: '23', value: '23' },
		{ kind: 'observation', about: 'C1', steps: 'GET /api/cart', saw: '45.00', value: '45.00', repeats: 'none' },
	])
	const record = JSON.parse(cli(workspace, ['journal', 'export', 'cart']).output)
	const entry = (id: string) => record.entries.find((item: { id: string }) => item.id === id)
	assert.equal(entry('O1').repeats, 'B1')
	assert.equal(entry('O1').linked, 'the same about and steps')
	assert.equal(entry('fee-b1').repeats, 'fee-base')
	assert.equal(entry('fee-b1').linked, 'the same ID without the build name')
	assert.equal(entry('O3').repeats, undefined)
	assert.equal(entry('O2').repeats, undefined)
	assert.deepEqual(
		gaps(workspace, 'b1')
			.filter((gap) => gap.kind === 'difference')
			.map((gap) => gap.subject),
		['O1 repeats B1: base "50.00", b1 "45.00"']
	)
	log(workspace, 'b2', { kind: 'observation', id: 'fee-b2', saw: 'Fee', value: '2.00' })
	assert.equal(JSON.parse(cli(workspace, ['journal', 'export', 'cart']).output).entries.at(-1).repeats, 'fee-b1')
})

test('a PM answer without a decision gives no open item', (t) => {
	const workspace = opened(t, 'http')
	log(workspace, 'base', [
		{ kind: 'question', id: 'Q1', question: 'Does the discount stack?' },
		{ kind: 'question', id: 'Q2', question: 'Is 5 inclusive?' },
		{ kind: 'question', id: 'Q3', question: 'Round up?' },
		{ kind: 'question', id: 'Q4', question: 'Coupon first?' },
	])
	json(workspace, ['journal', 'answer', 'cart', 'Q1', '--answer', 'No decision; use the ticket and existing docs.'])
	json(workspace, ['journal', 'answer', 'cart', 'Q2', '--answer', 'Yes.'])
	json(workspace, ['journal', 'answer', 'cart', 'Q3', '--answer', 'See the docs.'])
	json(workspace, ['journal', 'answer', 'cart', 'Q4', '--answer', 'No, see the docs.'])
	assert.deepEqual(
		gaps(workspace, 'b1')
			.filter((gap) => gap.kind === 'answer')
			.map((gap) => gap.subject),
		['Q2 Yes.', 'Q4 No, see the docs.']
	)
})

test('notes and observations that say something is open are open ends until an entry is about them', (t) => {
	const workspace = opened(t, 'http')
	log(workspace, 'b1', [
		{ kind: 'note', text: 'The export was not tested.' },
		{ kind: 'note', text: 'Refunds skipped: no time.' },
		{ kind: 'note', text: 'TODO: try a negative quantity.' },
		{ kind: 'observation', saw: 'The error is not captured in the log.', via: 'api' },
		{ kind: 'observation', saw: 'The checkbox is not checked after reload.', via: 'api' },
		{ kind: 'note', text: 'The cart page works.' },
	])
	const ends = () =>
		gaps(workspace, 'b1')
			.filter((gap) => gap.kind === 'open_end')
			.map((gap) => gap.subject)
	assert.deepEqual(ends(), [
		'N1 The export was not tested.',
		'N2 Refunds skipped: no time.',
		'N3 TODO: try a negative quantity.',
		'O1 The error is not captured in the log.',
	])
	log(workspace, 'b1', { kind: 'observation', about: 'N1', saw: 'The export has 3 rows.', via: 'api' })
	assert.equal(ends().length, 3)
})

test('the log input can be one object, an array, a wrapper, JSON lines, a code fence, or have trailing commas', (t) => {
	const workspace = opened(t, 'http')
	const ids = (stdin: string) => {
		const reply = json(workspace, ['journal', 'log', 'cart', '--build', 'b1'], stdin)
		return [reply.body.saved?.map((entry: { id: string }) => entry.id), reply.body.refused]
	}
	assert.deepEqual(ids('{"kind":"note","text":"One."}'), [['N1'], []])
	assert.deepEqual(ids('```json\n[{"kind":"note","text":"Two.",},]\n```'), [['N2'], []])
	assert.deepEqual(ids('{"entries":[{"kind":"note","text":"Three, with a comma, }"}]}'), [['N3'], []])
	assert.deepEqual(ids('{"kind":"note","text":"Four."}\n{"kind":"note","text":"Five."}\n'), [['N4', 'N5'], []])
	const [saved, refused] = ids(
		'[{"kind":"note","text":"Six."},\n{"kind":"note","text":"a "quote""},\n{"kind":"note","text":"[Seven]"}]'
	)
	assert.deepEqual(saved, ['N6', 'N7'])
	assert.equal(refused[0].index, 1)
	assert.equal(refused[0].field, '[1]')
	assert.match(refused[0].reason, /^\[1\] is not valid JSON \(.+\): \{"kind":"note","text":"a "quote""\}$/)
	const broken = cli(workspace, ['journal', 'log', 'cart', '--build', 'b1'], '{"kind": "note", "text": oops}')
	assert.equal(broken.code, 1)
	assert.match(broken.output, /reason: Standard input is not valid JSON/)
	const empty = cli(workspace, ['journal', 'log', 'cart', '--build', 'b1'], ' ')
	assert(empty.lines.includes('reason: Missing JSON payload on standard input'), empty.output)
	assert.deepEqual(ids('{"kind":"observation","saw":"x","evidence":"http://127.0.0.1:4173/api/cart"}'), [['O1'], []])
})

test('gaps prints at most 8 lines of a kind and about 40 lines, with the count of the rest, and --all prints all', (t) => {
	const workspace = opened(t, 'http')
	log(
		workspace,
		'base',
		Array.from({ length: 12 }, (_, i) => ({ kind: 'observation', saw: `Value ${i}`, value: String(i), via: 'api' }))
	)
	log(
		workspace,
		'b1',
		Array.from({ length: 40 }, (_, i) => ({ kind: 'criterion', text: `Rule ${i}`, source: 'ticket.md' }))
	)
	const short = cli(workspace, ['journal', 'gaps', 'cart', '--build', 'b1'])
	const lines = short.lines.filter((line) => line.startsWith('gap\t'))
	assert.equal(lines.length, 18)
	assert.equal(new Set(lines).size, lines.length)
	assert.equal(short.lines.at(-2), 'count\t54\topen items on b1: things your record does not show yet.')
	assert.equal(
		short.lines.at(-1),
		'not_shown\t36\tbaseline 4, criterion 32\tRun checkmate journal gaps cart --build b1 --all to see all of them.'
	)
	const every = cli(workspace, ['journal', 'gaps', 'cart', '--build', 'b1', '--all'])
	assert.equal(every.lines.filter((line) => line.startsWith('gap\t')).length, 54)
	assert.equal(every.lines.at(-1), 'count\t54\topen items on b1: things your record does not show yet.')
})
