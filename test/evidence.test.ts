import test from 'node:test'
import assert from 'node:assert/strict'
import { existsSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import type { EvidenceInput } from '../plugin/src/runs.ts'
import { checkAssertion } from '../plugin/src/runs.ts'
import { evidenceBytes, runDetail } from '../plugin/src/views.ts'
import { actor, begin, cli, evidenceFile, ready, store } from './support.ts'

function started(t: Parameters<typeof store>[0]) {
	const opened = store(t)
	ready(opened)
	begin(opened, 'run-1', ['T1'])
	return opened
}

const passed = (evidence: EvidenceInput[]) => ({
	runId: 'run-1',
	testId: 'T1',
	result: 'passed',
	observed: 'The confirmation shows 400 PLN.',
	evidence,
})

test('--evidence - stores text from standard input as plain text or JSON, and no file is written', (t) => {
	const opened = started(t)
	const args = (assertion: string, ...extra: string[]) => [
		'run',
		'check',
		'run-1',
		'T1',
		assertion,
		'--result',
		'passed',
		'--observed',
		'Seen.',
		...extra,
	]
	const text = cli(opened.workspace, args('A1', '--evidence', '-'), 'Order confirmed: 400 PLN')
	assert.equal(text.code, 0, text.output)
	const exchange = cli(opened.workspace, args('A2', '--evidence', '-:http_exchange'), '{"status":200}')
	assert.equal(exchange.code, 0, exchange.output)
	const stored = runDetail(opened, 'run-1').tests[0].assertions.map((assertion) => assertion.evidence[0])
	assert.deepEqual(
		stored.map((item) => [item.name, item.kind, item.mediaType]),
		[
			['T1-A1.txt', 'observation', 'text/plain'],
			['T1-A2.json', 'http_exchange', 'application/json'],
		]
	)
	assert.equal(Buffer.from(evidenceBytes(opened, stored[0].id).bytes).toString(), 'Order confirmed: 400 PLN')
	assert.deepEqual(readdirSync(join(opened.workspace, '.checkmate/tmp/run-1')), [])
})

test('text evidence must be present, given once, and have a known kind', (t) => {
	const opened = started(t)
	const attempt = (evidence: Parameters<typeof checkAssertion>[2]['evidence']) => () =>
		checkAssertion(opened, actor, { ...passed([]), evidence, assertionId: 'A1' })
	assert.throws(attempt([{ text: '  ' }]), /Missing evidence text on standard input/)
	assert.throws(attempt([{ text: 'a' }, { text: 'b' }]), /Give one evidence text on standard input/)
	assert.throws(attempt([{ text: 'a', kind: 'video' }]), /Invalid evidence kind: video/)
	const screenshot = evidenceFile(opened, 'run-1', 'shot.png', 'png')
	const reply = checkAssertion(opened, actor, {
		...passed([screenshot, { text: 'Visible: 400 PLN' }]),
		assertionId: 'A1',
	})
	assert.equal((reply.data.evidenceIds as string[]).length, 2)
	assert.equal(existsSync(join(opened.workspace, screenshot)), false)
})

test('evidence files get a media type from the extension; a .json file is an observation by default', (t) => {
	const opened = started(t)
	const files = [
		evidenceFile(opened, 'run-1', 'response.xml', '<ok/>'),
		evidenceFile(opened, 'run-1', 'rows.csv', 'id,total\n1,400\n'),
		evidenceFile(opened, 'run-1', 'quote.json', '{"totalPLN":400}'),
		`${evidenceFile(opened, 'run-1', 'exchange.json', '{"status":200}')}:http_exchange`,
	]
	const reply = checkAssertion(opened, actor, { ...passed(files), assertionId: 'A1' })
	const stored = (reply.data.evidenceIds as string[]).map((id) => evidenceBytes(opened, id))
	assert.deepEqual(
		stored.map((item) => [item.name, item.kind, item.mediaType]),
		[
			['response.xml', 'observation', 'application/xml'],
			['rows.csv', 'observation', 'text/csv'],
			['quote.json', 'observation', 'application/json'],
			['exchange.json', 'http_exchange', 'application/json'],
		]
	)
})
