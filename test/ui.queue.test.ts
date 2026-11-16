import type { TestContext } from 'node:test'
import test from 'node:test'
import assert from 'node:assert/strict'
import { request } from 'node:http'
import { rmSync } from 'node:fs'
import { startUi } from '../plugin/src/ui/server.ts'
import { closeStore, openStore } from '../plugin/src/index.ts'
import { mergedClaims, mergedQuestions, needsYou, operationLog } from '../plugin/src/views.ts'
import { journal } from '../plugin/src/journal.ts'
import { seedVolume } from '../scripts/ui-volume.ts'
import { copied, directory } from './support.ts'

const template = directory()
test.before(() => seedVolume(template))
test.after(() => rmSync(template, { recursive: true, force: true }))

type Reply = { status: number; location: string | undefined; body: string }

async function start(t: TestContext) {
	const workspace = copied(t, template)
	const ui = await startUi({ workspace, defaultActor: 'qa-lead' })
	t.after(() => ui.close())
	const call = (path: string, form?: Record<string, string> | URLSearchParams) =>
		new Promise<Reply>((resolve, reject) => {
			const body = form ? new URLSearchParams(form).toString() : undefined
			const req = request(
				new URL(path, ui.url),
				{
					method: body ? 'POST' : 'GET',
					headers: body ? { 'Content-Type': 'application/x-www-form-urlencoded' } : {},
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
	const read = <T>(view: (store: ReturnType<typeof openStore>) => T) => {
		const store = openStore(workspace)
		try {
			return view(store)
		} finally {
			closeStore(store)
		}
	}
	return { call, read }
}

const keys = (body: string) => [...body.matchAll(/class="q-row"[^>]*data-key="([^"]+)"/g)].map((match) => match[1])
const field = (body: string, name: string) => new RegExp(`name="${name}" value="([^"]*)"`).exec(body)![1]

test('the home lists what needs you in order and shows the first item next to the list', async (t) => {
	const { call, read } = await start(t)
	const home = await call('/')
	assert.equal(home.status, 200)
	const waiting = read(needsYou)
	assert.deepEqual(
		keys(home.body),
		waiting.items.map((item) => item.key)
	)
	assert.match(home.body, new RegExp(`data-region="nav-count">${waiting.urgent}<`))
	assert.match(home.body, new RegExp(`data-selected="${waiting.items[0].key}"`))
	assert.match(home.body, /<h2 class="q-group-h" id="q-blocking">/)
	assert.match(home.body, /<details class="q-group q-fold" data-open-key="queue:questions"\s*>/)
	assert.match(home.body, /data-key="running:x-9"/)
	assert.match(home.body, /Waits for you in Claude Code: The explorer needs a second test account/)
	assert.match(home.body, /data-key="failed:x-6"/)
	assert.match(home.body, /<nav aria-label="Breadcrumb">/)
	assert.doesNotMatch(home.body, /data-open[ >]/)
	assert.match((await call('/inbox')).body, /Gaps to answer/)
})

test('filters and the selected item live in the URL', async (t) => {
	const { call, read } = await start(t)
	const login = await call('/?plan=login')
	assert(keys(login.body).every((key) => key.includes(':login')))
	assert.match(login.body, /<option value="login" selected>/)
	const searched = await call('/?q=coupons%20stack%20checkout')
	assert.deepEqual(keys(searched.body), ['claim:checkout:a1/D1'])
	const claim = read(needsYou).items.find((item) => item.kind === 'claim')!
	const selected = await call(`/?plan=${claim.planId}&item=${encodeURIComponent(claim.key)}`)
	assert.match(selected.body, new RegExp(`data-selected="${claim.key}"\\s+data-open`))
	assert.match(selected.body, /href="\/\?plan=[a-z]+&amp;item=[^"]+&amp;view=list" data-queue-back>Needs you<\/a>/)
	assert.match(selected.body, /<h3 class="lab" id="decide-title">Is [^ ]+ a defect\?<\/h3>/)
	const gone = await call('/?item=claim:checkout:none')
	assert.match(gone.body, /This item does not wait for you now\./)
})

test('a claim is accepted without a reason, and a reject needs one', async (t) => {
	const { call, read } = await start(t)
	const claims = read(needsYou).items.filter((item) => item.kind === 'claim')
	const [first, second] = claims
	const page = await call(`/?item=${encodeURIComponent(first.key)}`)
	assert.match(page.body, /<p class="lab">Evidence<\/p>/)
	const form = {
		csrf: field(page.body, 'csrf'),
		item: first.key,
		return: field(page.body, 'return'),
		rationale: '',
	}
	assert.equal(form.return, `/?item=${encodeURIComponent(second.key)}`)
	const action = `/explorations/${first.explorationId}/claims/${first.id}`
	const missing = await call(action, { ...form, verdict: 'rejected' })
	assert.equal(missing.status, 422)
	assert.match(missing.body, /Write a short reason for the reject\./)
	assert.match(missing.body, new RegExp(`data-selected="${first.key}"`))
	const accepted = await call(action, { ...form, verdict: 'approved' })
	assert.equal(accepted.status, 303)
	assert.equal(accepted.location, form.return)
	const decided = read((store) => mergedClaims(store, first.planId).find((item) => item.id === first.id)!)
	assert.equal(decided.state, 'accepted')
	assert.equal(decided.decision?.rationale, 'Accepted in the review UI. No reason was given.')
	const rejected = await call(`/explorations/${second.explorationId}/claims/${second.id}`, {
		...form,
		item: second.key,
		verdict: 'rejected',
		rationale: 'Intended.',
	})
	assert.equal(rejected.status, 303)
	assert(!keys((await call('/')).body).includes(first.key))
})

test('a question needs only the answer; the record names the review UI as the source', async (t) => {
	const { call, read } = await start(t)
	const [question, other] = read(needsYou).items.filter((item) => item.kind === 'question')
	const page = await call(`/?item=${encodeURIComponent(question.key)}`)
	const action = `/explorations/${question.explorationId}/questions/${question.id}`
	assert.match(page.body, new RegExp(`action="${action}"`))
	assert.match(page.body, /<input\s+type="radio"\s+id="kind-clarify"\s+name="kind"\s+value="clarify"\s+checked/)
	assert.match(page.body, /<summary>Add source and reason<\/summary>/)
	const form = { csrf: field(page.body, 'csrf'), item: question.key, return: field(page.body, 'return') }
	const empty = await call(action, { ...form, kind: 'clarify', value: '' })
	assert.equal(empty.status, 422)
	assert.match(empty.body, /Write the answer\./)
	const answered = await call(action, { ...form, kind: 'clarify', value: 'Card and bank transfer only.' })
	assert.equal(answered.status, 303)
	assert.equal(answered.location, form.return)
	const entry = read((store) =>
		journal(store, question.planId).team.findLast((row) => row.kind === 'answer')
	) as unknown as Record<string, string>
	assert.equal(entry.answer, 'Card and bank transfer only.')
	assert.equal(entry.source, 'qa-lead, in the review UI')
	assert.equal(entry.rationale, 'Answered in the review UI. No reason was given.')
	const deferred = await call(`/explorations/${other.explorationId}/questions/${other.id}`, {
		...form,
		item: other.key,
		kind: 'defer',
		value: '',
	})
	assert.equal(deferred.status, 303)
	assert.equal(
		read((store) => mergedQuestions(store, other.planId).find((item) => item.id === other.id)!.answer),
		'Deferred in the review UI.'
	)
})

test('a second decision on a claim or a question is refused and names the first', async (t) => {
	const { call, read } = await start(t)
	const items = read(needsYou).items
	const claim = items.find((item) => item.kind === 'claim')!
	const question = items.find((item) => item.kind === 'question')!
	const decisions = () =>
		read((store) => operationLog(store, { limit: 1000 }).map((row) => row.command)).filter((command) =>
			['claim accept', 'claim reject', 'gap answer'].includes(command)
		).length
	const before = decisions()
	const page = await call(`/?item=${encodeURIComponent(claim.key)}`)
	const base = { csrf: field(page.body, 'csrf'), return: '/' }
	const claimAction = `/explorations/${claim.explorationId}/claims/${claim.id}`
	const first = await call(claimAction, { ...base, item: claim.key, verdict: 'approved', rationale: '' })
	assert.equal(first.status, 303)
	const again = await call(claimAction, {
		...base,
		item: claim.key,
		verdict: 'rejected',
		rationale: 'Typed in tab B.',
	})
	assert.equal(again.status, 422)
	assert.match(again.body, new RegExp(`${claim.id} was accepted by qa-lead\\.`))
	assert.match(again.body, /<blockquote>Typed in tab B\.<\/blockquote>/)
	const questionAction = `/explorations/${question.explorationId}/questions/${question.id}`
	for (const status of [303, 422])
		assert.equal(
			(await call(questionAction, { ...base, item: question.key, kind: 'defer', value: '' })).status,
			status
		)
	assert.equal(decisions(), before + 2)
})

test('the queue follows its filters and records the same default source for each kind of answer', async (t) => {
	const { call, read } = await start(t)
	const login = read(needsYou).items.filter((item) => item.planId === 'login')
	const urgent = login.filter((item) => item.group !== 'questions').length
	const page = await call('/?plan=login')
	assert.match(page.body, new RegExp(`${urgent} items need your decision`))
	assert.doesNotMatch(page.body, /data-key="running:x-9"/)
	assert.match((await call('/?plan=checkout')).body, /data-key="running:x-9"/)
	const result = (await call('/?item=run%3Arun-7')).body
	assert.doesNotMatch(result, /\[object Object\]/)
	assert.match(result, /coverage\s*<span class="st warn"><span aria-hidden="true">◐<\/span> partial<\/span>/)
	const question = login.find((item) => item.kind === 'question')!
	const form = await call(`/?item=${encodeURIComponent(question.key)}`)
	assert.match(form.body, /<kbd aria-hidden="true">c<\/kbd>/)
	const sent = await call(`/explorations/${question.explorationId}/questions/${question.id}`, {
		csrf: field(form.body, 'csrf'),
		item: question.key,
		return: '/',
		kind: 'accept_assumption',
		value: 'Yes, for all customers.',
	})
	assert.equal(sent.status, 303)
	const answer = read((store) => journal(store, 'login').team.findLast((entry) => entry.kind === 'answer'))
	assert.equal((answer as { source?: string }).source, 'qa-lead, in the review UI')
})

test('an empty workspace says once that nothing waits and how to start', async (t) => {
	const workspace = directory(t)
	const ui = await startUi({ workspace, defaultActor: 'qa-lead' })
	t.after(() => ui.close())
	const body = await (await fetch(ui.url)).text()
	assert.equal(body.match(/Nothing waits for you|No decision waits for you/g)?.length, 1)
	assert.doesNotMatch(body, /0 explorations/)
	assert.doesNotMatch(body, /id="queue-plan"/)
	assert.match(body, /<code>\/checkmate:test<\/code>/)
})

test('several questions take one answer and several claims one decision after a confirm step', async (t) => {
	const { call, read } = await start(t)
	const items = read(needsYou).items
	const questions = items.filter((item) => item.kind === 'question').slice(0, 2)
	const claims = items.filter((item) => item.kind === 'claim').slice(0, 3)
	const picked = await call(
		`/?${[...questions, ...claims].map((item) => `pick=${encodeURIComponent(item.key)}`).join('&')}`
	)
	assert.match(picked.body, /5 items selected/)
	assert.match(
		picked.body,
		/<input\s+class="pick"\s+type="checkbox"\s+name="pick"\s+value="question:[^"]+"[^>]*checked/
	)
	const csrf = field(picked.body, 'csrf')
	const ask = (form: Record<string, string>, keys: string[]) => {
		const body = new URLSearchParams({ csrf, return: '/', ...form })
		for (const key of keys) body.append('pick', key)
		return call('/bulk', body)
	}
	const review = await ask(
		{ what: 'questions', kind: 'defer' },
		questions.map((item) => item.key)
	)
	assert.equal(review.status, 200)
	assert.match(review.body, /This records <strong>Defer<\/strong> for 2 questions,\s+as\s+qa-lead\./)
	assert.match(review.body, /<dd>Deferred in the review UI\.<\/dd>/)
	assert.match(review.body, /<dd>qa-lead, in the review UI<\/dd>/)
	const sent = await ask(
		{ what: 'questions', kind: 'defer', confirmed: '1' },
		questions.map((item) => item.key)
	)
	assert.equal(sent.status, 303)
	assert.equal(sent.location, '/')
	for (const question of questions)
		assert.equal(
			read((store) => mergedQuestions(store, question.planId).find((item) => item.id === question.id)!.answer),
			'Deferred in the review UI.'
		)
	const again = await ask(
		{ what: 'questions', kind: 'defer', confirmed: '1' },
		questions.map((item) => item.key)
	)
	assert.equal(again.status, 422)
	assert.match(again.body, /do not wait for a decision now\. Nothing is recorded\./)
	const keys = claims.map((item) => item.key)
	const bare = await ask({ what: 'claims', verdict: 'rejected', confirmed: '1' }, keys)
	assert.equal(bare.status, 422)
	assert.match(bare.body, /Write a short reason for the reject\./)
	const rejected = await ask(
		{ what: 'claims', verdict: 'rejected', rationale: 'Known and intended.', confirmed: '1' },
		keys
	)
	assert.equal(rejected.status, 303)
	for (const claim of claims)
		assert.equal(
			read((store) => mergedClaims(store, claim.planId).find((item) => item.id === claim.id)!.state),
			'rejected'
		)
	const list = await call(`/claims?pick=${encodeURIComponent(keys[0])}`)
	assert.doesNotMatch(list.body, /1 item selected/)
})

test('a plan is approved inside the queue with its confirm step', async (t) => {
	const { call, read } = await start(t)
	const plan = read(needsYou).items.find((item) => item.kind === 'plan')!
	const page = await call(`/?item=${encodeURIComponent(plan.key)}`)
	assert.match(page.body, /data-verdict-form/)
	const action = `/plans/${plan.id}`
	const form = {
		csrf: field(page.body, 'csrf'),
		sha: field(page.body, 'sha'),
		decision: field(page.body, 'decision'),
		item: plan.key,
		return: field(page.body, 'return'),
		verdict: 'approve',
		rationale: 'The tests cover the request.',
	}
	const confirm = await call(action, form)
	assert.equal(confirm.status, 200)
	assert.match(confirm.body, /class="queue"/)
	assert.match(confirm.body, /Confirm approval/)
	const done = await call(action, { ...form, confirmed: '1' })
	assert.equal(done.status, 303)
	assert.equal(done.location, form.return)
	assert(!keys((await call('/')).body).includes(plan.key))
	const result = read(needsYou).items.find((item) => item.kind === 'result')!
	assert.match((await call(`/?item=${encodeURIComponent(result.key)}`)).body, /Accept run-7/)
})

test('the claims list filters by state, severity, plan, build, time, and text in the address', async (t) => {
	const { call } = await start(t)
	const all = await call('/claims')
	assert.equal(all.status, 200)
	assert.equal(keys(all.body).length, 50)
	assert.match(all.body, /href="\/claims\?item=[^"]+&amp;limit=100"[^>]*>Show 10 more<\/a/)
	assert.equal(keys((await call('/claims?limit=100')).body).length, 60)
	const week = await call('/claims?since=7&severity=high')
	assert(keys(week.body).length > 0 && keys(week.body).length < 60)
	assert.match(week.body, /<option value="7" selected>Last 7 days<\/option>/)
	const found = await call('/claims?q=coupons%20stack&plan=checkout')
	assert.deepEqual(keys(found.body), ['claim:checkout:a1/D1'])
	assert.match(found.body, /data-selected="claim:checkout:a1\/D1"/)
	assert.match(found.body, /href="\/explorations\/x-1\/claims\/a1\/D1\/evidence\/0"/)
	assert.match(
		found.body,
		/href="\/claims\?q=coupons\+stack&amp;plan=checkout&amp;item=claim%3Acheckout%3Aa1%2FD1&amp;view=list" data-queue-back>Claims<\/a>/
	)
	const accepted = await call('/claims?state=accepted')
	assert.match(accepted.body, /<h2 class="lab" id="decide-title">Decision<\/h2>/)
	assert.equal(keys((await call('/claims?state=none&limit=100')).body).length, 60)
})

test('pages that are not rebuilt have a breadcrumb and a back link', async (t) => {
	const { call } = await start(t)
	for (const [path, crumb] of [
		['/explorations/x-1/claims/a1/D1', 'a1/D1'],
		['/explorations/x-1', 'x-1'],
		['/runs/run-7', 'run-7'],
		['/plans/checkout@2/gaps/G2', 'G2'],
		['/plans/checkout@2/edit', 'Edit'],
		['/plans/checkout@2', 'checkout@2'],
		['/plans/basket@1', 'basket@1'],
	]) {
		const body = (await call(path)).body
		assert.match(body, /<a class="back-link" href="[^"]+" data-back>← Back<\/a>/, path)
		assert.match(body, new RegExp(`<li aria-current="page">${crumb}</li>`), path)
	}
})

test('the evidence of a raw entry opens from the explorer of the live view', async (t) => {
	const { call } = await start(t)
	const page = (await call('/explorations/x-1?item=explorer%3Aa1')).body
	assert.match(page, /href="\/explorations\/x-1\/entries\/a1\/D1\/evidence\/0"\s+data-view="image"/)
	assert.match(page, /<pre tabindex="0" data-view-source>Both SPRING40 and WELCOME10 apply/)
	const image = await call('/explorations/x-1/entries/a1/D1/evidence/0')
	assert.equal(image.body.slice(1, 4), 'PNG')
	assert.equal((await call('/explorations/x-1/entries/a1/D1/evidence/9')).status, 404)
	assert.equal((await call('/explorations/x-1/entries/b1/D1/evidence/0')).status, 404)
})

test('the evidence of a claim opens from its own address', async (t) => {
	const { call } = await start(t)
	const image = await call('/explorations/x-1/claims/a1/D1/evidence/0')
	assert.equal(image.status, 200)
	assert.equal(image.body.slice(1, 4), 'PNG')
	const text = await call('/explorations/x-1/claims/a1/D1/evidence/1')
	assert.match(text.body, /Request id: x-1-1/)
	assert.equal((await call('/explorations/x-1/claims/a1/D1/evidence/7')).status, 404)
	assert.match(
		(await call('/explorations/x-1/claims/a1/D1')).body,
		/href="\/explorations\/x-1\/claims\/a1\/D1\/evidence\/0"/
	)
})
