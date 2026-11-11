import test from 'node:test'
import assert from 'node:assert/strict'
import { closeTest, finishRun, recordGap } from '../plugin/src/runs.ts'
import { exportRun, runReport } from '../plugin/src/render.ts'
import { checkAssertion } from '../plugin/src/runs.ts'
import { accept, actor, begin, check, evidenceFile, failT2, ready, store } from './support.ts'

function reported(t: Parameters<typeof store>[0]) {
	const opened = store(t)
	ready(opened)
	begin(opened)
	const small = Buffer.from([0x89, 0x50, 0x4e, 0x47, 1, 2, 3])
	checkAssertion(opened, actor, {
		runId: 'run-1',
		testId: 'T1',
		assertionId: 'A1',
		result: 'passed',
		observed: 'Order confirmed: 400 PLN',
		evidence: [evidenceFile(opened, 'run-1', 'confirmation.png', small), { text: 'Order confirmed: 400 PLN' }],
	})
	checkAssertion(opened, actor, {
		runId: 'run-1',
		testId: 'T1',
		assertionId: 'A2',
		result: 'passed',
		observed: 'One item.',
		evidence: [evidenceFile(opened, 'run-1', 'large.png', Buffer.alloc(600 * 1024, 1))],
	})
	closeTest(opened, actor, { runId: 'run-1', testId: 'T1' })
	check(opened, 'run-1', 'T2.A1', 'passed')
	failT2(opened, 'run-1')
	closeTest(opened, actor, { runId: 'run-1', testId: 'T2' })
	recordGap(opened, actor, {
		runId: 'run-1',
		gap: {
			id: 'G9',
			severity: 'non_blocking',
			status: 'open',
			requirementIds: ['R2'],
			testIds: ['T2'],
			question: 'Is the <loyalty> label right?',
			consequence: 'The label is unchecked.',
			decisionId: null,
		},
	})
	finishRun(opened, actor, { runId: 'run-1', completion: 'completed', cleanup: 'completed', cleanupReason: 'Done.' })
	accept(opened, 'run-1')
	return opened
}

test('the HTML report is self-contained, prints cleanly, and inlines small evidence', (t) => {
	const opened = reported(t)
	const page = exportRun(opened, 'run-1', 'html')
	assert.match(page, /^<!doctype html>/)
	assert.match(page, /<style>[^<]*@media print\{[^<]*<\/style>/)
	assert.match(page, /@page\{size:A4/)
	assert.match(page, /img-src data:/)
	assert.doesNotMatch(page, /(src|href)="(https?:)?\/\//)
	assert.doesNotMatch(page, /<script/)
	assert.match(page, /<img src="data:image\/png;base64,iVBORwECAw==" alt="confirmation.png">/)
	assert.doesNotMatch(page, /alt="large.png"/)
	assert.match(page, /<figure><pre>Order confirmed: 400 PLN<\/pre>/)
	assert.match(page, /Is the &lt;loyalty&gt; label right\?/)
	for (const heading of [
		'Summary',
		'Acceptance',
		'Tests',
		'Assertions',
		'Findings',
		'New gaps',
		'Evidence',
		'Coverage',
	])
		assert.match(page, new RegExp(`<h2>${heading}</h2>`), heading)
	assert.match(page, /<h2>Plan gaps and decisions \(checkout@2\)<\/h2>/)
	assert.match(page, /<h3>F1 · defect · medium: Promotion stacks with loyalty<\/h3>/)
	assert.match(page, /<span class="pill pass">approved<\/span>/)
	assert.match(page, /<td>T2\.A2<\/td><td><span class="pill fail">failed<\/span><\/td>/)
	assert.match(page, /Promotion replaces loyalty\. Expected total is 240 PLN\./)
})

test('the Markdown and JSON reports carry the same summary, decisions, and acceptance', (t) => {
	const opened = reported(t)
	const markdown = exportRun(opened, 'run-1', 'md')
	assert.match(markdown, /^# Test report: run-1\n/)
	assert.match(markdown, /- \*\*Completion:\*\* completed/)
	assert.match(markdown, /- \*\*Acceptance:\*\* approved/)
	assert.match(markdown, /## Plan gaps and decisions \(checkout@2\)/)
	assert.match(
		markdown,
		/- T1\.A1: T1-A1\.txt \(text\/plain, 24 bytes\)\n\n {2}```\n {2}Order confirmed: 400 PLN\n {2}```/
	)
	assert.doesNotMatch(markdown, /base64/)
	const record = JSON.parse(exportRun(opened, 'run-1', 'json'))
	assert.deepEqual(Object.keys(record).sort(), ['acceptance', 'plan', 'result', 'sha256'])
	assert.equal(record.result.completion, 'completed')
	assert.equal(record.acceptance.state, 'approved')
	assert.deepEqual(
		record.plan.decisions.map((decision: { gapId: string }) => decision.gapId),
		['G1', 'G2']
	)
	assert.equal(runReport(opened, 'run-1').sha256, record.sha256)
	assert.throws(() => exportRun(opened, 'run-1', 'pdf'), /Invalid format \(--format\): pdf/)
})
