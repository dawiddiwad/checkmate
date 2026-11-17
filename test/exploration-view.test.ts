import test from 'node:test'
import assert from 'node:assert/strict'
import type { TestContext } from 'node:test'
import type { Store } from '../plugin/src/store.ts'
import { request } from 'node:http'
import { closeStore } from '../plugin/src/store.ts'
import { openPlan } from '../plugin/src/plans.ts'
import { lastEntry } from '../plugin/src/recorder.ts'
import { startUi } from '../plugin/src/ui/server.ts'
import { explorationLive, inbox, planExplorations, planList, planStatus } from '../plugin/src/views.ts'
import { actor, directory, planRequest, store, target } from './support.ts'
import {
	coupon,
	done,
	ended,
	entries,
	event,
	files,
	keptWork,
	launched,
	openTest,
	report,
	stacks,
} from './explorations.ts'

function seeded(t: TestContext) {
	const workspace = directory(t)
	const opened = store(t, workspace)
	target(opened)
	openPlan(opened, actor, {
		planId: 'checkout',
		target: 'checkout-local@1',
		request: { ...planRequest(), context: { sources: ['brief://checkout'] } },
	})
	return { workspace, opened }
}

function running(opened: Store) {
	openTest(opened, 'checkout', 'x-1', 'b1')
	launched(opened, 'x-1', 'a1')
	launched(opened, 'x-1', 'a2')
	event(opened, 'x-1', { step: 'turn', explorer: 'a2', detail: { turn: 'test', activity: 'Opens the cart.' } })
	ended(opened, 'x-1', 'a1', [coupon, stacks])
	report(opened, 'x-1', 'a1', '# Report of a1\n\nD1: Two coupons stack.\n')
}

function completed(opened: Store) {
	running(opened)
	ended(opened, 'x-1', 'a2', [])
	done(opened, 'x-1')
}

const waiting = (opened: Store) => {
	const items = inbox(opened)
	return {
		gaps: items.gaps.map((gap) => gap.gapId),
		claims: items.claims.map((claim) => claim.claimId),
	}
}

test('a running exploration shows nothing in the inbox, the status, or the plan list', (t) => {
	const { opened } = seeded(t)
	running(opened)
	assert.deepEqual(waiting(opened), { gaps: [], claims: [] })
	const status = planStatus(opened, 'checkout')
	assert.equal(status.state, 'exploring')
	assert.deepEqual([status.claims, status.questions], [[], []])
	const row = planList(opened).find((item) => item.planId === 'checkout')!
	assert.deepEqual([row.openGaps, row.loop.state], [[], 'exploring'])
	assert.deepEqual(
		planExplorations(opened, 'checkout').map((item) => [item.explorationId, item.state, item.running]),
		[['x-1', 'recording', true]]
	)
})

test('the live view of a running exploration shows each explorer, the phases, and the raw items as not merged', (t) => {
	const { opened } = seeded(t)
	running(opened)
	const live = explorationLive(opened, 'x-1')
	assert.deepEqual([live.state, live.running, live.phase], ['recording', true, 'record and merge'])
	assert.deepEqual(
		live.explorers.map((item) => [item.explorer, item.turn, item.state, item.activity, item.recorded]),
		[
			['a1', 'test', 'completed', null, 'completed'],
			['a2', 'test', 'running', 'Opens the cart.', null],
		]
	)
	assert(live.explorers.every((item) => item.startedAt !== null && item.elapsedMs !== null))
	assert.deepEqual(
		live.explorers.map((item) => item.files),
		[[], []]
	)
	assert.deepEqual(
		live.phases.map((item) => [item.phase, item.state]),
		[
			['record', 'running'],
			['merge', 'pending'],
			['verify', 'not_in_level'],
			['follow-up', 'not_run'],
		]
	)
	assert.deepEqual(
		live.unmerged.map((item) => [item.id, item.explorer, item.kind]),
		[
			['a1/Q1', 'a1', 'question'],
			['a1/D1', 'a1', 'defect'],
		]
	)
	assert.deepEqual([live.claims, live.questions], [[], []])
})

test('an explorer in its study turn shows study until the test turn starts', (t) => {
	const { opened } = seeded(t)
	openTest(opened, 'checkout', 'x-1', 'b1')
	launched(opened, 'x-1', 'a1')
	const study = explorationLive(opened, 'x-1').explorers[0]
	assert.deepEqual([study.turn, study.state, study.activity, study.files], ['study', 'running', null, []])
	event(opened, 'x-1', { step: 'turn', explorer: 'a1', detail: { turn: 'test' } })
	assert.equal(explorationLive(opened, 'x-1').explorers[0].turn, 'test')
})

test('a completed exploration shows its merged questions and claims only', (t) => {
	const { opened } = seeded(t)
	completed(opened)
	assert.deepEqual(waiting(opened), { gaps: ['a1/Q1'], claims: ['a1/D1'] })
	assert.equal(planStatus(opened, 'checkout').state, 'needs_triage')
	const live = explorationLive(opened, 'x-1')
	assert.deepEqual([live.state, live.running, live.unmerged], ['completed', false, []])
	assert.deepEqual(
		live.claims.map((claim) => claim.id),
		['a1/D1']
	)
	assert.deepEqual(
		live.questions.map((question) => question.id),
		['a1/Q1']
	)
	assert.deepEqual(
		live.explorers.map((item) => item.files),
		[[{ phase: 'test', name: 'report.md' }], []]
	)
})

test('a verify step that ends as skipped shows its reason', (t) => {
	const { opened } = seeded(t)
	completed(opened)
	event(opened, 'x-1', {
		step: 'verify',
		status: 'skipped',
		detail: { reason: 'The verifier gave no usable reply after one repair.' },
	})
	assert.deepEqual(explorationLive(opened, 'x-1').phases[2], {
		phase: 'verify',
		state: 'skipped',
		reason: 'The verifier gave no usable reply after one repair.',
	})
})

test('a failed follow-up keeps the exploration completed, shows its reason, and keeps its entries out', (t) => {
	const { opened } = seeded(t)
	completed(opened)
	keptWork(opened, 'x-1')
	event(opened, 'x-1', { step: 'follow', detail: { after: lastEntry(opened), answers: [] } })
	entries(opened, 'x-1', 'a1', [{ kind: 'question', id: 'Q2', question: 'Is the coupon limit per order?' }])
	files(opened, 'x-1', 'a1', 'follow-1', { 'follow-up-report.md': 'Follow-up of a1.\n' })
	event(opened, 'x-1', { step: 'followed', status: 'failed', detail: { reason: 'No session was recorded.' } })
	const live = explorationLive(opened, 'x-1')
	assert.deepEqual(
		[live.state, live.follow, live.followReason, live.data],
		['completed', 'failed', 'No session was recorded.', ['.checkmate/work/x-1']]
	)
	assert.deepEqual(live.phases[3], { phase: 'follow-up', state: 'failed', reason: 'No session was recorded.' })
	assert.deepEqual(live.explorers[0].files, [
		{ phase: 'test', name: 'report.md' },
		{ phase: 'follow-1', name: 'follow-up-report.md' },
	])
	assert.deepEqual(waiting(opened), { gaps: ['a1/Q1'], claims: ['a1/D1'] })
	const [listed] = planExplorations(opened, 'checkout')
	assert.deepEqual(
		[listed.state, listed.follow, listed.followReason],
		['completed', 'failed', 'No session was recorded.']
	)
})

test('the entries of a running follow-up wait until the follow-up is completed', (t) => {
	const { opened } = seeded(t)
	completed(opened)
	event(opened, 'x-1', { step: 'follow', detail: { after: lastEntry(opened), answers: [] } })
	entries(opened, 'x-1', 'a1', [{ kind: 'question', id: 'Q2', question: 'Is the coupon limit per order?' }])
	assert.deepEqual(waiting(opened), { gaps: ['a1/Q1'], claims: ['a1/D1'] })
	const live = explorationLive(opened, 'x-1')
	assert.deepEqual(
		[live.state, live.explorers[0].turn, live.explorers[0].state],
		['following', 'follow-up', 'running']
	)
	assert.deepEqual(
		live.unmerged.map((item) => item.id),
		['a1/Q2']
	)
	event(opened, 'x-1', { step: 'followed', status: 'completed', detail: { recorded: 1 } })
	assert.deepEqual(waiting(opened), { gaps: ['a1/Q1', 'a1/Q2'], claims: ['a1/D1'] })
})

test('a failed exploration gives its reason and where its data is, and its entries stay out', (t) => {
	const { opened } = seeded(t)
	running(opened)
	keptWork(opened, 'x-1')
	done(opened, 'x-1', 'failed', { reason: 'The merger stopped.' })
	assert.deepEqual(waiting(opened), { gaps: [], claims: [] })
	const [listed] = planExplorations(opened, 'checkout')
	assert.deepEqual(
		[listed.state, listed.reason, listed.data],
		['failed', 'The merger stopped.', ['.checkmate/work/x-1']]
	)
	assert.equal(explorationLive(opened, 'x-1').phases[3].state, 'not_run')
})

type Reply = { status: number; location: string | undefined; body: string }

function call(url: string, path: string, form?: Record<string, string>): Promise<Reply> {
	const body = form ? new URLSearchParams(form).toString() : undefined
	return new Promise((resolve, reject) => {
		const req = request(
			new URL(path, url),
			{
				method: body ? 'POST' : 'GET',
				headers: {
					Cookie: 'checkmate_actor=qa-lead',
					...(body ? { 'Content-Type': 'application/x-www-form-urlencoded' } : {}),
				},
			},
			(res) => {
				const chunks: Buffer[] = []
				res.on('data', (chunk) => chunks.push(chunk))
				res.on('end', () =>
					resolve({
						status: res.statusCode ?? 0,
						location: res.headers.location,
						body: Buffer.concat(chunks).toString(),
					})
				)
			}
		)
		req.on('error', reject)
		req.end(body)
	})
}

async function ui(t: TestContext, workspace: string) {
	const started = await startUi({ workspace, defaultActor: '' })
	t.after(() => started.close())
	return started.url
}

const keyed = (body: string, key: string) => body.includes(`data-key="${key}"`)

test('a plan without a revision opens from the plan list and the inbox, and shows its request', async (t) => {
	const { workspace, opened } = seeded(t)
	openPlan(opened, actor, {
		planId: 'draft',
		target: 'checkout-local@1',
		request: { objective: 'Draft.', context: { sources: ['brief://draft'] } },
	})
	closeStore(opened)
	const url = await ui(t, workspace)
	assert.match((await call(url, '/')).body, /data-key="plan:checkout"/)
	assert.match((await call(url, '/')).body, /data-key="plan:draft"/)
	assert.match((await call(url, '/plans/checkout')).body, /href="\/plans\/checkout\/request"/)
	const page = await call(url, '/plans/checkout/request')
	assert.equal(page.status, 200)
	assert.match(page.body, /Verify checkout and identify missing acceptance decisions\./)
	assert.match(page.body, /href="\/settings\/targets\/checkout-local\?revision=1"/)
	assert.match(page.body, /<code>brief:\/\/checkout<\/code>/)
	assert.match(page.body, /No exploration yet/)
	assert(keyed(page.body, 'no-tests'))
	assert.match(page.body, /checkmate harvest &lt;explorationId&gt;/)
	assert.equal((await call(url, '/plans/nothing')).status, 404)
	assert.equal((await call(url, '/plans/nothing/request')).status, 404)
})

test('the plan page names a running exploration and links its live view, and shows none of its items', async (t) => {
	const { workspace, opened } = seeded(t)
	running(opened)
	closeStore(opened)
	const url = await ui(t, workspace)
	const page = (await call(url, '/plans/checkout/request')).body
	assert(keyed(page, 'running:x-1'))
	assert.match(page, /Exploration x-1 is running\.\s*<a href="\/explorations\/x-1">Open the live view<\/a>/)
	assert.doesNotMatch(page, /Can a coupon apply|Two coupons stack/)
	assert.match(page, /data-region="nav-count"\s+hidden/)
	const inboxPage = (await call(url, '/')).body
	assert.doesNotMatch(inboxPage, /Can a coupon apply|Two coupons stack/)
	const live = await call(url, '/explorations/x-1')
	assert.equal(live.status, 200)
	assert.match(live.body, /data-subjects="exploration:x-1,plan:checkout"/)
	assert.match(live.body, /Exploration x-1 is running\. Phase: record and merge\./)
	for (const key of ['explorer:a1', 'explorer:a2', 'phase:record', 'phase:follow-up', 'raw:a1/Q1', 'raw:a1/D1'])
		assert(keyed(live.body, key), key)
	assert.match(live.body, /Not merged yet/)
	assert.match(live.body, /Opens the cart\./)
	assert.match(live.body, /The claims show when the exploration is completed\./)
	assert.doesNotMatch(live.body, /\/explorers\/a1\/test\/report\.md/)
})

test('the live view selects an explorer or a phase from the address', async (t) => {
	const { workspace, opened } = seeded(t)
	running(opened)
	closeStore(opened)
	const url = await ui(t, workspace)
	assert.match((await call(url, '/explorations/x-1')).body, /data-key="detail:summary"/)
	const a1 = (await call(url, '/explorations/x-1?item=explorer%3Aa1')).body
	assert.match(a1, /data-key="detail:explorer:a1"/)
	assert.match(a1, /<h2 class="sp-sec">Tester a1<\/h2>/)
	assert.match(a1, /<li><a href="\/explorations\/x-1">x-1<\/a><\/li>/)
	assert.match(a1, /<li aria-current="page">a1<\/li>/)
	assert(keyed(a1, 'raw:a1/D1'))
	assert.match(a1, /The files show when the explorer ends\./)
	const merge = (await call(url, '/explorations/x-1?item=phase%3Amerge')).body
	assert.match(merge, /<h2 class="sp-sec">Phase merge<\/h2>/)
	assert.match((await call(url, '/explorations/x-1?item=explorer%3Anone')).body, /data-key="detail:summary"/)
})

test('after completion the plan page answers a merged question and decides a merged claim', async (t) => {
	const { workspace, opened } = seeded(t)
	completed(opened)
	closeStore(opened)
	const url = await ui(t, workspace)
	const page = (await call(url, '/plans/checkout/request')).body
	assert(!keyed(page, 'running:x-1'))
	assert.match(page, /href="\/plans\/checkout\?view=all&amp;item=q%3Aa1%2FQ1"/)
	assert.match(page, /href="\/plans\/checkout\?view=all&amp;item=c%3Aa1%2FD1"/)
	assert.match(page, /checkmate harvest x-1/)
	assert.match(
		(await call(url, '/')).body,
		/data-region="nav-count"\s*><span\s*>1<span class="sb-long"> needs you<\/span\s*><span class="sb-all"> · all plans<\/span><\/span/
	)
	const live = (await call(url, '/explorations/x-1')).body
	assert(!keyed(live, 'unmerged'))
	assert.match(live, /href="\/explorations\/x-1\/explorers\/a1\/test\/report\.md"/)
	assert.match((await call(url, '/explorations/x-1/explorers/a1/test/report.md')).body, /# Report of a1/)
	const a1 = (await call(url, '/explorations/x-1?item=explorer%3Aa1')).body
	assert.match(a1, /<pre tabindex="0" data-view-source># Report of a1/)
	assert.match(a1, /href="\/explorations\/x-1\/explorers\/a1\/test\/report\.md\?download=1" download="report\.md"/)
	assert(keyed(a1, 'found:a1/D1'))
	const saved = await call(url, '/explorations/x-1/explorers/a1/test/report.md?download=1')
	assert.equal(saved.body, '# Report of a1\n\nD1: Two coupons stack.\n')
	assert.equal((await call(url, '/explorations/x-1/explorers/a2/test/report.md')).status, 404)
	const form = (await call(url, '/plans/checkout?view=all&item=q%3Aa1%2FQ1')).body
	assert.match(form, /action="\/explorations\/x-1\/questions\/a1\/Q1"/)
	const csrf = /name="csrf" value="([^"]+)"/.exec(form)![1]
	const answered = await call(url, '/explorations/x-1/questions/a1/Q1', {
		csrf,
		kind: 'clarify',
		value: 'No.',
		source: 'brief://checkout',
		rationale: 'The brief says so.',
	})
	assert.equal(answered.status, 303)
	const decided = await call(url, '/explorations/x-1/claims/a1/D1', {
		csrf,
		verdict: 'approved',
		rationale: 'Seen by the product owner.',
	})
	assert.equal(decided.status, 303)
	const after = (await call(url, '/plans/checkout/request')).body
	assert.match(after, /href="\/plans\/checkout\?view=all&amp;item=q%3Aa1%2FQ1"/)
	assert.match(after, /accepted/)
	assert.match((await call(url, '/')).body, /data-region="nav-count"\s+hidden/)
})

test('the plan page shows the reason and the data of a failed exploration', async (t) => {
	const { workspace, opened } = seeded(t)
	running(opened)
	keptWork(opened, 'x-1')
	done(opened, 'x-1', 'failed', { reason: 'The merger stopped.' })
	closeStore(opened)
	const url = await ui(t, workspace)
	const page = (await call(url, '/plans/checkout/request')).body
	assert(keyed(page, 'failed:x-1'))
	assert.match(
		page,
		/The test failed: The merger stopped\.<\/strong>\s+Read the log of the run\. Then test again\.\s+Its data:\s+<code>\.checkmate\/work\/x-1<\/code>/
	)
	assert.match(
		(await call(url, '/explorations/x-1')).body,
		/The test failed: The merger stopped\.<\/strong>\s+Read the log of the run\./
	)
})
