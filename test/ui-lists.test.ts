import test from 'node:test'
import assert from 'node:assert/strict'
import { execute } from '../plugin/src/store.ts'
import {
	listOptions,
	listTimestamp,
	operationActors,
	operationLogPage,
	planListPage,
	runListPage,
} from '../plugin/src/views.ts'
import { logPage, plansPage, runsPage } from '../cli/src/ui/lists.ts'
import { begin, plan, ready, store } from './support.ts'

test('plan and run lists paginate fresh database rows and search displayed fields', (t) => {
	const opened = store(t)
	ready(opened)
	for (let index = 0; index < 30; index++) {
		plan(opened, `plan-${String(index).padStart(2, '0')}`)
		begin(opened, `run-${String(index).padStart(2, '0')}`, ['T1'], `release-${index}`)
	}
	const first = planListPage(opened)
	assert.equal(first.total, 31)
	assert.equal(first.rows.length, 25)
	assert.equal(first.size, 25)
	assert.equal(planListPage(opened, { page: 2 }).rows.length, 6)
	assert.equal(planListPage(opened, { size: 50 }).rows.length, 31)
	assert.equal(planListPage(opened, { size: 100 }).rows.length, 31)
	assert.equal(planListPage(opened, { page: 900 }).page, 2)
	assert.equal(planListPage(opened, { q: 'PENDING' }).total, 30)
	assert.equal(planListPage(opened, { q: 'G1' }).total, 30)
	assert.equal(planListPage(opened, { q: '3 tests' }).total, 31)
	assert.equal(planListPage(opened, { q: 'deferred', show: 'awaiting_approval' }).total, 0)
	const descending = planListPage(opened, { size: 100 }).rows.map((row) => row.planId)
	const ascending = planListPage(opened, { size: 100, order: 'asc' }).rows.map((row) => row.planId)
	assert.deepEqual(ascending, descending.toReversed())
	assert.equal(runListPage(opened).rows.length, 25)
	assert.equal(runListPage(opened, { page: 2 }).rows.length, 5)
	assert.equal(runListPage(opened, { q: 'release-29' }).rows[0].runId, 'run-29')
	assert.equal(runListPage(opened, { q: 'checkout@2' }).total, 30)
	assert.equal(runListPage(opened, { q: 'in progress' }).total, 30)
	assert.equal(runListPage(opened, { q: 'no outcomes yet' }).total, 30)
	assert.equal(runListPage(opened, { status: 'pending' }).total, 0)
	assert.equal(runListPage(opened, { plan: 'missing' }).total, 0)
	const runs = runListPage(opened, { size: 100 }).rows.map((row) => row.runId)
	assert.deepEqual(
		runListPage(opened, { size: 100, order: 'asc' }).rows.map((row) => row.runId),
		runs.toReversed()
	)
	begin(opened, 'newly-written', ['T1'], 'new-build')
	assert.equal(runListPage(opened, { q: 'new-build' }).total, 1)
})

test('the log queries all records and actor choices beyond the previous cap', (t) => {
	const opened = store(t)
	for (let index = 0; index < 1105; index++) {
		const old = index === 0
		execute(
			opened,
			'INSERT INTO operations (id, at, actor, command, arguments, status, response, subjects) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
			`op-${index}`,
			new Date(Date.UTC(2026, 0, 1, 0, 0, index)).toISOString(),
			old ? 'first-actor' : 'worker',
			old ? 'original-command' : 'recent-command',
			'{}',
			'completed',
			'{"reasons":[]}',
			'["plan:checkout"]'
		)
	}
	assert.deepEqual(operationActors(opened), ['first-actor', 'worker'])
	assert.equal(operationLogPage(opened).rows.length, 25)
	assert.equal(operationLogPage(opened).rows[0].id, 'op-1104')
	assert.equal(operationLogPage(opened, { order: 'asc' }).rows[0].id, 'op-0')
	assert.equal(operationLogPage(opened, { page: 45 }).rows.length, 5)
	assert.equal(operationLogPage(opened, { q: 'original-command' }).rows[0].id, 'op-0')
	assert.equal(operationLogPage(opened, { actor: 'first-actor' }).total, 1)
	assert.equal(operationLogPage(opened, { q: 'COMPLETED', subject: 'plan:checkout' }).total, 1105)
	assert.equal(operationLogPage(opened, { q: "%_' OR 1=1" }).total, 0)
	assert.equal(operationLogPage(opened, { q: '2026-01-01T00:00:00' }).total, 1)
	assert.equal(operationLogPage(opened, { q: 'op-1104' }).total, 1)
})

test('list pages expose accessible sort and pagination controls', (t) => {
	const opened = store(t)
	ready(opened)
	begin(opened)
	const pages = [
		plansPage(opened, { q: '', show: 'all' }),
		runsPage(opened, { plan: '', build: '', status: 'all' }),
		logPage(opened, { subject: '', actor: '' }),
	]
	for (const page of pages) {
		assert.match(page.body.html, /data-list-filters/)
		assert.match(page.body.html, /aria-sort="descending"/)
		assert.match(page.body.html, /aria-label="Pagination"/)
		assert.match(page.body.html, /name="size"/)
		assert.match(page.body.html, /value="25" selected/)
		assert.match(page.body.html, /value="50"/)
		assert.match(page.body.html, /value="100"/)
	}
	assert.deepEqual(listOptions({ page: -5, size: 999, order: 'DROP TABLE' }), {
		q: '',
		page: 1,
		size: 25,
		order: 'desc',
	})
	assert.match(plansPage(opened, { q: '<script>', show: 'all' }).body.html, /&lt;script&gt;/)
})

test('copied list timestamps match every list when the host timezone is not UTC', (t) => {
	const before = process.env.TZ
	process.env.TZ = 'Europe/Warsaw'
	t.after(() => {
		if (before === undefined) delete process.env.TZ
		else process.env.TZ = before
	})
	assert.equal(new Date('2026-11-11T15:51:00Z').getHours(), 16)
	assert.equal(listTimestamp('2026-11-11T15:51:00Z'), '2026-11-11 15:51 UTC')
	const opened = store(t)
	ready(opened)
	begin(opened)
	const cases = [
		{ page: plansPage(opened, { q: '', show: 'all' }), search: (q: string) => planListPage(opened, { q }) },
		{
			page: runsPage(opened, { plan: '', build: '', status: 'all' }),
			search: (q: string) => runListPage(opened, { q }),
		},
		{ page: logPage(opened, { subject: '', actor: '' }), search: (q: string) => operationLogPage(opened, { q }) },
	]
	for (const { page, search } of cases) {
		const displayed = page.body.html.match(/<time[^>]*>([^<]+)<\/time>/)?.[1]
		assert(displayed && displayed.endsWith(' UTC'))
		assert(search(displayed).total > 0, `No row matched copied timestamp ${displayed}`)
	}
})
