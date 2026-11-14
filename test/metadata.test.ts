import test from 'node:test'
import assert from 'node:assert/strict'
import type { Store } from '../plugin/src/store.ts'
import { patchPlan, planRevision } from '../plugin/src/plans.ts'
import { closeTest, finishRun, recordFinding, runResult } from '../plugin/src/runs.ts'
import { exportPlan, exportRun } from '../plugin/src/render.ts'
import { validate } from '../plugin/src/contracts.ts'
import { findingList } from '../plugin/src/views.ts'
import {
	accept,
	actor,
	approved,
	begin,
	candidate,
	check,
	cli,
	json,
	passRun,
	plan,
	planRequest,
	revised,
	store,
	target,
} from './support.ts'

const jira = { blocker: true, component: 'pricing', jiraKey: 'SHOP-142', labels: 'checkout,regression', storyPoints: 3 }

function tagged(opened: Store) {
	target(opened)
	const request = planRequest()
	request.requirements![1].metadata = { jira: 'SHOP-41' }
	const value = candidate()
	value.tests[1].metadata = { priority: 'high', component: 'pricing', xrayKey: 'SHOP-T7' }
	plan(opened, 'checkout', value, request)
	revised(opened)
	approved(opened)
}

function failed(opened: Store, runId = 'run-1', build = 'build-1', extra = {}) {
	begin(opened, runId, ['T1', 'T2'], build, extra)
	check(opened, runId, 'T1.A1', 'passed')
	check(opened, runId, 'T1.A2', 'passed')
	closeTest(opened, actor, { runId, testId: 'T1' })
	check(opened, runId, 'T2.A1', 'passed')
	const reply = check(opened, runId, 'T2.A2', 'failed', { observed: 'totalPLN is 220 & <b>bold</b>' })
	recordFinding(opened, actor, {
		runId,
		finding: {
			id: 'F1',
			type: 'defect',
			severity: 'high',
			assertionIds: ['T2.A2'],
			requirementIds: ['R2'],
			title: 'Promotion stacks with "loyalty" & <credit>',
			expected: 'totalPLN equals 240.',
			observed: 'totalPLN is 220.\u0001',
			reproduction: ['Apply SPRING40.', "Read the quote's totalPLN."],
			evidenceIds: reply.data.evidenceIds as string[],
			metadata: jira,
		},
	})
	closeTest(opened, actor, { runId, testId: 'T2' })
	finishRun(opened, actor, { runId, completion: 'completed', cleanup: 'completed', cleanupReason: 'Done.' })
}

function wellFormed(text: string) {
	const name = '[A-Za-z_][A-Za-z0-9_.-]*'
	const attribute = `\\s+${name}="[^"<&]*(?:&(?:amp|lt|gt|quot|apos|#[0-9]+);[^"<&]*)*"`
	const token = new RegExp(`<(/?)(${name})((?:${attribute})*)\\s*(/?)>|([^<]+)|(<)`, 'gy')
	const body = text.replace(/^<\?xml version="1\.0" encoding="UTF-8"\?>\n/, '')
	assert.notEqual(body, text, 'XML declaration')
	const open: string[] = []
	let roots = 0
	for (const match of body.matchAll(token)) {
		const [, closing, tag, , empty, content, stray] = match
		assert.equal(stray, undefined, `Stray < at ${match.index}`)
		if (content !== undefined) {
			assert.doesNotMatch(content, /&(?!(?:amp|lt|gt|quot|apos|#[0-9]+);)|>/, 'Unescaped text')
			assert(open.length || !content.trim(), 'Text outside the root element')
			continue
		}
		if (!open.length) roots++
		if (closing) assert.equal(open.pop(), tag, `Closing tag ${tag}`)
		else if (!empty) open.push(tag)
	}
	assert.deepEqual(open, [])
	assert.equal(roots, 1)
}

test('metadata goes unchanged from the request, candidate, patch, and finding into the plan and result', (t) => {
	const opened = store(t)
	tagged(opened)
	const latest = planRevision(opened, 'checkout').plan
	assert.deepEqual(latest.requirements[1].metadata, { jira: 'SHOP-41' })
	assert.equal(latest.requirements[0].metadata, undefined)
	assert.deepEqual(latest.tests[1].metadata, { priority: 'high', component: 'pricing', xrayKey: 'SHOP-T7' })
	failed(opened)
	assert.deepEqual(runResult(opened, 'run-1')!.result.findings[0].metadata, jira)
	const patched = patchPlan(opened, actor, {
		reference: 'checkout@2',
		patch: {
			tests: { T1: { metadata: { priority: 'low' } } },
			requirements: { R1: { metadata: { jira: 'SHOP-40' } } },
		},
	})
	assert.equal(patched.data.edit, 'new_revision')
	const next = planRevision(opened, 'checkout').plan
	assert.deepEqual(next.tests[0].metadata, { priority: 'low' })
	assert.deepEqual(next.requirements[0].metadata, { jira: 'SHOP-40' })
	assert.deepEqual(next.tests[1].metadata, latest.tests[1].metadata)
	const before = planRevision(opened, 'checkout')
	patchPlan(opened, actor, {
		reference: `checkout@${before.plan.revision}`,
		patch: { tests: { T1: { metadata: { priority: 'low' } } } },
	})
	const cleared = patchPlan(opened, actor, {
		reference: `checkout@${before.plan.revision}`,
		patch: { tests: { T1: { metadata: {} } }, requirements: { R1: { metadata: {} } } },
	})
	const after = planRevision(opened, 'checkout').plan
	assert.equal('metadata' in after.tests[0], false)
	assert.equal('metadata' in after.requirements[0], false)
	const plain = patchPlan(opened, actor, {
		reference: `checkout@${before.plan.revision}`,
		patch: { tests: { T1: { title: after.tests[0].title } } },
	})
	assert.equal(plain.data.sha256, cleared.data.sha256)
})

test('an empty metadata object on a finding is not stored', (t) => {
	const opened = store(t)
	tagged(opened)
	begin(opened, 'run-1', ['T1'], 'build-1')
	const reply = check(opened, 'run-1', 'T1.A1', 'failed')
	recordFinding(opened, actor, {
		runId: 'run-1',
		finding: {
			id: 'F1',
			type: 'defect',
			severity: 'low',
			assertionIds: ['T1.A1'],
			requirementIds: ['R1'],
			title: 'Wrong total',
			expected: '400 PLN',
			observed: '380 PLN',
			reproduction: ['Check out.'],
			evidenceIds: reply.data.evidenceIds as string[],
			metadata: {},
		},
	})
	assert.deepEqual(findingList(opened)[0].metadata, {})
	assert.equal(cli(opened.workspace, ['finding', 'list']).lines[1].split('\t')[7], '-')
	const stored = opened.db.prepare("SELECT body FROM findings WHERE id = 'F1'").get() as { body: string }
	assert.equal('metadata' in JSON.parse(stored.body), false)
})

test('metadata takes up to 20 named string, number, or boolean values', () => {
	const finding = {
		id: 'F1',
		type: 'defect',
		severity: 'low',
		assertionIds: ['T1.A1'],
		requirementIds: ['R1'],
		title: 'Title',
		expected: 'E',
		observed: 'O',
		reproduction: ['Step'],
		evidenceIds: ['E1'],
	}
	const refused = (metadata: unknown) => assert.throws(() => validate('finding', { ...finding, metadata }))
	validate('finding', { ...finding, metadata: { 'xray.key': 'SHOP-1', count: 2, open: false } })
	refused({ nested: { a: 1 } })
	refused({ list: ['a'] })
	refused({ none: null })
	refused({ '1st': 'a' })
	refused({ 'has space': 'a' })
	refused({ long: 'x'.repeat(501) })
	refused(Object.fromEntries(Array.from({ length: 21 }, (_, i) => [`k${i}`, i])))
})

test('a schema error names the unknown field, the allowed values, and the bad metadata key', () => {
	const finding = {
		id: 'F1',
		type: 'defect',
		severity: 'urgent',
		assertionIds: ['T1.A1'],
		requirementIds: ['R1'],
		title: 'Title',
		expected: 'E',
		observed: 'O',
		reproduction: ['Step'],
		evidenceIds: ['E1'],
		priority: 'high',
	}
	assert.throws(
		() => validate('finding', finding),
		new Error(
			'Invalid finding: finding has unknown field "priority", finding/severity must be one of: low, medium, high, critical'
		)
	)
	assert.throws(
		() => validate('plan-patch', { tests: { T1: { priority: 'high' } } }),
		new Error('Invalid plan-patch: plan-patch/tests/T1 has unknown field "priority"')
	)
	assert.throws(
		() => validate('plan-patch', { tests: { T1: { assertions: { A1: { check: 'x', weight: 2 } } } } }),
		new Error('Invalid plan-patch: plan-patch/tests/T1/assertions/A1 has unknown field "weight"')
	)
	assert.throws(
		() => validate('plan-patch', { tests: { T1: { title: 5 } } }),
		new Error('Invalid plan-patch: plan-patch/tests/T1/title must be string')
	)
	assert.throws(
		() => validate('finding', { ...finding, severity: 'low', priority: undefined, metadata: { 'bad key': 1 } }),
		/finding\/metadata field name "bad key" must match pattern/
	)
	assert.throws(() => validate('finding', { ...finding, severity: 'low', title: '' }), /finding\/title must NOT have/)
	const request = { objective: 'o', context: { sources: ['a'] } }
	assert.throws(
		() => validate('plan-request', { ...request, tools: [{ name: 'x', kind: 'binary', purpose: 'p' }] }),
		new Error('Invalid plan-request: plan-request/tools/0/kind must be one of: cli, mcp, skill')
	)
	assert.throws(
		() => validate('plan-request', { ...request, tools: [5] }),
		new Error('Invalid plan-request: plan-request/tools/0 must be string or object')
	)
	assert.throws(
		() => validate('plan-patch', { tests: { T1: 5 } }),
		new Error('Invalid plan-patch: plan-patch/tests/T1 must be object or null')
	)
	assert.throws(
		() => validate('finding', { ...finding, severity: 'low', priority: undefined, metadata: { tags: ['a'] } }),
		/, finding\/metadata\/tags must be string, number, or boolean$/
	)
})

test('finding list prints one row per finding across runs, and --open keeps only open defects', (t) => {
	const opened = store(t)
	tagged(opened)
	failed(opened)
	const workspace = opened.workspace
	const all = json(workspace, ['finding', 'list'])
	assert.equal(all.code, 0)
	assert.deepEqual(all.body.findings, [
		{
			runId: 'run-1',
			planId: 'checkout',
			revision: 2,
			build: 'build-1',
			instanceId: 'local',
			testIds: ['T2'],
			findingId: 'F1',
			type: 'defect',
			severity: 'high',
			title: 'Promotion stacks with "loyalty" & <credit>',
			expected: 'totalPLN equals 240.',
			observed: 'totalPLN is 220.\u0001',
			reproduction: ['Apply SPRING40.', "Read the quote's totalPLN."],
			requirementIds: ['R2'],
			assertionIds: ['T2.A2'],
			evidenceIds: all.body.findings[0].evidenceIds,
			metadata: jira,
		},
	])
	assert.equal(json(workspace, ['finding', 'list', '--open']).body.findings.length, 1)
	const compact = cli(workspace, ['finding', 'list', '--open'])
	assert.equal(compact.lines[0], 'completed findings count=1')
	assert.equal(
		compact.lines[1],
		'run-1/F1\tcheckout@2\tbuild-1\tlocal\tdefect\thigh\tT2\tblocker=true; component=pricing; jiraKey=SHOP-142; labels=checkout,regression; storyPoints=3\tPromotion stacks with "loyalty" & <credit>'
	)
	passRun(opened, 'run-2', 'build-2', ['T1'])
	assert.equal(findingList(opened, { open: true }).length, 1)
	failed(opened, 'run-3', 'build-3', { retestOf: 'run-1' })
	assert.deepEqual(
		findingList(opened, { open: true }).map((row) => row.runId),
		['run-3']
	)
	assert.equal(findingList(opened).length, 2)
	assert.equal(findingList(opened, { planId: 'checkout' }).length, 2)
	const unknown = cli(workspace, ['finding', 'list', '--plan', 'nothing'])
	assert.equal(unknown.code, 1)
	assert.match(unknown.output, /Unknown plan: nothing/)
})

test('finding list --open drops the defects of a run that a retest replaces', (t) => {
	const opened = store(t)
	tagged(opened)
	failed(opened)
	begin(opened, 'run-2', ['T1', 'T2'], 'build-2', { retestOf: 'run-1' })
	for (const testId of ['T1', 'T2']) {
		for (const assertionId of ['A1', 'A2']) check(opened, 'run-2', `${testId}.${assertionId}`, 'passed')
		closeTest(opened, actor, { runId: 'run-2', testId })
	}
	finishRun(opened, actor, { runId: 'run-2', completion: 'completed', cleanup: 'completed', cleanupReason: 'Done.' })
	assert.deepEqual(findingList(opened, { open: true }), [])
	assert.equal(findingList(opened).length, 1)
})

test('the JUnit export is well-formed XML with one suite, one case per selected test, and escaped text', (t) => {
	const opened = store(t)
	tagged(opened)
	failed(opened)
	const xml = exportRun(opened, 'run-1', 'junit')
	wellFormed(xml)
	assert.match(xml, /<testsuites name="run-1" tests="2" failures="1" errors="0" skipped="0" time="[0-9.]+">/)
	assert.match(
		xml,
		/<testsuite name="checkout@2" tests="2" failures="1" errors="0" skipped="0" time="[0-9.]+" timestamp="\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}">/
	)
	assert.match(xml, /<property name="build" value="build-1"\/><property name="instance" value="local"\/>/)
	assert.match(
		xml,
		/<testcase classname="checkout" name="T1" time="[0-9.]+"><properties><property name="title" value="Standard order total"\/><property name="requirements" value="R1"\/><\/properties><\/testcase>/
	)
	assert.match(
		xml,
		/<testcase classname="checkout" name="T2" time="[0-9.]+"><properties><property name="title" value="Promotion quote"\/><property name="requirements" value="R2"\/><property name="metadata.component" value="pricing"\/><property name="metadata.priority" value="high"\/><property name="metadata.xrayKey" value="SHOP-T7"\/><\/properties>/
	)
	assert.match(
		xml,
		/<failure type="defect" message="Promotion stacks with &quot;loyalty&quot; &amp; &lt;credit&gt;">/
	)
	assert.match(
		xml,
		/Expected: totalPLN equals 240\.\nObserved: totalPLN is 220\.�\nReproduction:\n1\. Apply SPRING40\.\n2\. Read the quote's totalPLN\.<\/failure>/
	)
	assert.equal(exportRun(opened, 'run-1', 'junit'), xml)
	assert.throws(() => exportPlan(opened, 'checkout@2', 'junit'), /Invalid format \(--format\): junit/)
})

test('the JUnit failure names the first defect by finding ID, and every export replaces control characters', (t) => {
	const opened = store(t)
	tagged(opened)
	begin(opened, 'run-1', ['T1', 'T2'], 'build-1')
	check(opened, 'run-1', 'T1.A1', 'passed')
	check(opened, 'run-1', 'T1.A2', 'passed')
	closeTest(opened, actor, { runId: 'run-1', testId: 'T1' })
	check(opened, 'run-1', 'T2.A1', 'passed')
	const reply = check(opened, 'run-1', 'T2.A2', 'failed', { observed: 'totalPLN is 220.' })
	for (const [id, title] of [
		['F10', 'Tenth defect'],
		['F2', 'Second defect\u0007'],
	])
		recordFinding(opened, actor, {
			runId: 'run-1',
			finding: {
				id,
				type: 'defect',
				severity: 'high',
				assertionIds: ['T2.A2'],
				requirementIds: ['R2'],
				title,
				expected: 'totalPLN equals 240.',
				observed: 'totalPLN is 220.',
				reproduction: ['Apply SPRING40.'],
				evidenceIds: reply.data.evidenceIds as string[],
			},
		})
	closeTest(opened, actor, { runId: 'run-1', testId: 'T2' })
	finishRun(opened, actor, { runId: 'run-1', completion: 'completed', cleanup: 'completed', cleanupReason: 'Done.' })
	const xml = exportRun(opened, 'run-1', 'junit')
	wellFormed(xml)
	assert.match(xml, /<failure type="defect" message="Second defect\uFFFD">F2 defect high/)
	assert(xml.indexOf('F2 defect') < xml.indexOf('F10 defect'))
	assert.match(xml, /<testcase classname="checkout" name="T2" time="[0-9.]+">/)
	for (const format of ['md', 'html']) {
		const text = exportRun(opened, 'run-1', format)
		assert(![...text].some((character) => character < ' ' && !'\t\n\r'.includes(character)), format)
		assert.match(text, /Second defect\uFFFD/, format)
	}
})

test('the JUnit export skips tests that did not run and reports errors and inconclusive tests', (t) => {
	const opened = store(t)
	tagged(opened)
	begin(opened, 'run-1', ['T1', 'T2'], 'build-1')
	check(opened, 'run-1', 'T1.A1', 'inconclusive', { reason: 'The <page> did not load.' })
	check(opened, 'run-1', 'T1.A2', 'passed')
	closeTest(opened, actor, { runId: 'run-1', testId: 'T1' })
	closeTest(opened, actor, { runId: 'run-1', testId: 'T2', outcome: 'blocked', reason: 'T1 did not pass.' })
	finishRun(opened, actor, { runId: 'run-1', completion: 'completed', cleanup: 'completed', cleanupReason: 'Done.' })
	const xml = exportRun(opened, 'run-1', 'junit')
	wellFormed(xml)
	assert.match(xml, /tests="2" failures="0" errors="1" skipped="1"/)
	assert.match(xml, /<error type="inconclusive" message="The &lt;page&gt; did not load\."\/>/)
	assert.match(xml, /<skipped message="blocked: T1 did not pass\."\/>/)
	assert.match(xml, /<testcase classname="checkout" name="T2" time="0">/)
})

test('the exports show metadata and the JSON run export names who approved the plan and accepted the result', (t) => {
	const opened = store(t)
	tagged(opened)
	failed(opened)
	accept(opened, 'run-1')
	const plan = exportPlan(opened, 'checkout@2', 'md')
	assert.match(plan, /\| R2 \| .* \| brief#promotion \| planned \| jira=SHOP-41 \|/)
	assert.match(plan, /\| T2 \| Promotion quote \| .* \| component=pricing, priority=high, xrayKey=SHOP-T7 \|/)
	assert.match(plan, /\| T1 \| Standard order total \| .* \| — \|/)
	assert.match(
		exportPlan(opened, 'checkout@2', 'html'),
		/<td>component=pricing, priority=high, xrayKey=SHOP-T7<\/td>/
	)
	const markdown = exportRun(opened, 'run-1', 'md')
	assert.match(
		markdown,
		/\| Metadata \| blocker=true, component=pricing, jiraKey=SHOP-142, labels=checkout,regression, storyPoints=3 \|/
	)
	assert.match(
		markdown,
		/\| T2 \| Promotion quote \| failed \| .* \| component=pricing, priority=high, xrayKey=SHOP-T7 \|/
	)
	assert.match(
		markdown,
		/## Plan approval \(checkout@2\)\n\n\| Verdict \| Actor \| At \| Rationale \| Digest \|\n\| --- \| --- \| --- \| --- \| --- \|\n\| approved \| tester \| /
	)
	assert.match(
		exportRun(opened, 'run-1', 'html'),
		/<td>Metadata<\/td><td>blocker=true, component=pricing, jiraKey=SHOP-142/
	)
	const record = JSON.parse(exportRun(opened, 'run-1', 'json'))
	assert.deepEqual(record.result.findings[0].metadata, jira)
	assert.deepEqual(record.plan.tests[1].metadata, { priority: 'high', component: 'pricing', xrayKey: 'SHOP-T7' })
	assert.deepEqual(record.plan.requirements[1].metadata, { jira: 'SHOP-41' })
	assert.equal(record.planApproval.state, 'approved')
	assert.equal(record.planApproval.latest.verdict, 'approved')
	assert.equal(record.planApproval.latest.actor, actor)
	assert.match(record.planApproval.latest.at, /^\d{4}-\d{2}-\d{2}T/)
	assert.equal(record.acceptance.latest.actor, actor)
	assert.match(record.acceptance.latest.at, /^\d{4}-\d{2}-\d{2}T/)
	assert.deepEqual(
		JSON.parse(exportPlan(opened, 'checkout@2', 'json')).tests[1].metadata,
		record.plan.tests[1].metadata
	)
})
