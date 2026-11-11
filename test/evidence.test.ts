import test from 'node:test'
import assert from 'node:assert/strict'
import { existsSync, readFileSync, symlinkSync, truncateSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { checkAssertion } from '../plugin/src/runs.ts'
import { evidenceBytes, runDetail } from '../plugin/src/views.ts'
import { actor, begin, cli, evidenceFile, ready, store } from './support.ts'

function started(t: Parameters<typeof store>[0]) {
	const opened = store(t)
	ready(opened)
	begin(opened, 'run-1', ['T1'])
	return opened
}

const passed = (evidence: string[]) => ({
	runId: 'run-1',
	testId: 'T1',
	result: 'passed',
	observed: 'The confirmation shows 400 PLN.',
	evidence,
})

test('evidence is stored once per digest, the file is deleted, and the bytes come back equal', (t) => {
	const opened = started(t)
	const bytes = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0, 1, 2, 3, 255])
	const first = evidenceFile(opened, 'run-1', 'confirmation.png', bytes)
	const copy = evidenceFile(opened, 'run-1', 'copy.png', bytes)
	const quote = evidenceFile(opened, 'run-1', 'quote.json', '{"totalPLN":400}')
	const one = checkAssertion(opened, actor, { ...passed([first, `${quote}:observation`]), assertionId: 'A1' })
	const two = checkAssertion(opened, actor, { ...passed([copy]), assertionId: 'A2' })
	for (const path of [first, copy, quote]) assert.equal(existsSync(join(opened.workspace, path)), false, path)
	assert.equal(opened.db.prepare('SELECT count(*) AS n FROM blobs').get()!.n, 2)
	assert.equal(opened.db.prepare('SELECT count(*) AS n FROM evidence').get()!.n, 3)
	const [screenshot, observation] = one.data.evidenceIds as string[]
	const stored = evidenceBytes(opened, screenshot)
	assert.deepEqual(Buffer.from(stored.bytes), bytes)
	assert.deepEqual(
		[stored.kind, stored.mediaType, stored.name, stored.size],
		['screenshot', 'image/png', 'confirmation.png', 9]
	)
	const json = evidenceBytes(opened, observation)
	assert.deepEqual([json.kind, json.mediaType], ['observation', 'application/json'])
	assert.equal(evidenceBytes(opened, (two.data.evidenceIds as string[])[0]).sha256, stored.sha256)
	const exported = cli(opened.workspace, ['evidence', 'get', screenshot, '--out', 'out/confirmation.png'])
	assert.equal(exported.code, 0, exported.output)
	assert.deepEqual(readFileSync(join(opened.workspace, 'out/confirmation.png')), bytes)
	const again = cli(opened.workspace, ['evidence', 'get', screenshot, '--out', 'out/confirmation.png'])
	assert.deepEqual(again.lines, [
		'rejected ' + screenshot,
		'reason: Output file exists: out/confirmation.png. Choose a new path.',
	])
	assert.equal(runDetail(opened, 'run-1').tests[0].assertions[0].evidence.length, 2)
})

test('evidence must be a file inside .checkmate/tmp/<runId>/ and at most 32 MiB', (t) => {
	const opened = started(t)
	const attempt = (path: string) => () => checkAssertion(opened, actor, { ...passed([path]), assertionId: 'A1' })
	writeFileSync(join(opened.workspace, 'outside.txt'), 'x')
	assert.throws(attempt('outside.txt'), /Evidence file must be inside .checkmate\/tmp\/run-1\/: outside.txt/)
	assert.throws(attempt('.checkmate/tmp/run-1/../../../outside.txt'), /must be inside/)
	assert.throws(attempt(join(opened.workspace, 'outside.txt')), /Evidence path must be relative to the workspace/)
	evidenceFile(opened, 'run-2', 'other.txt')
	assert.throws(attempt('.checkmate/tmp/run-2/other.txt'), /must be inside .checkmate\/tmp\/run-1\//)
	assert.throws(
		attempt('.checkmate/tmp/run-1/missing.txt'),
		/Evidence file not found: .checkmate\/tmp\/run-1\/missing.txt/
	)
	symlinkSync(join(opened.workspace, 'outside.txt'), join(opened.workspace, '.checkmate/tmp/run-1/link.txt'))
	assert.throws(attempt('.checkmate/tmp/run-1/link.txt'), /must be inside/)
	assert.throws(attempt('.checkmate/tmp/run-1'), /must be inside|must be a file/)
	const large = evidenceFile(opened, 'run-1', 'large.zip', '')
	truncateSync(join(opened.workspace, large), 32 * 1024 * 1024 + 1)
	assert.throws(attempt(large), /Evidence file exceeds 32 MiB: .checkmate\/tmp\/run-1\/large.zip/)
	assert.equal(existsSync(join(opened.workspace, large)), true)
	const listed = evidenceFile(opened, 'run-1', 'twice.txt')
	assert.throws(
		() => checkAssertion(opened, actor, { ...passed([listed, listed]), assertionId: 'A1' }),
		/An evidence file is listed twice/
	)
	assert.equal(existsSync(join(opened.workspace, listed)), true)
	assert.equal(opened.db.prepare('SELECT count(*) AS n FROM evidence').get()!.n, 0)
})
