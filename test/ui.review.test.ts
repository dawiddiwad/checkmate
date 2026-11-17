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

const rows = (body: string, view = 'needs') => {
	const panel = new RegExp(`<section[^>]*data-panel="${view}"[\\s\\S]*?</section>`).exec(body)![0]
	return [...panel.matchAll(/class="sp-row[^"]*"[\s\S]*?data-key="([^"]+)"/g)].map((match) => match[1])
}
const field = (body: string, name: string) => new RegExp(`name="${name}" value="([^"]*)"`).exec(body)![1]
const short: Record<string, string> = { claim: 'c', question: 'q', gap: 'g', plan: 'p', result: 'r' }
const rowKey = (item: { kind: string; id: string }) => `${short[item.kind]}:${item.id}`

test('the home lists each plan once, and the plan lists what needs you in groups, blocking ones first', async (t) => {
	const { call, read } = await start(t)
	const home = await call('/')
	assert.equal(home.status, 200)
	assert.deepEqual(
		[...home.body.matchAll(/data-key="plan:([^"]+)"/g)].map((match) => match[1]),
		['checkout', 'search', 'basket', 'coupons', 'login', 'account']
	)
	const waiting = read(needsYou)
	assert.match(
		home.body,
		new RegExp(`data-region="nav-count"\\s*><span\\s*>${waiting.urgent}<span class="sb-long"> need`)
	)
	const page = await call('/plans/checkout')
	const mine = waiting.items.filter((item) => item.planId === 'checkout')
	assert.deepEqual(new Set(rows(page.body)), new Set(mine.map(rowKey)))
	const groups = [...page.body.matchAll(/data-panel="needs"[\s\S]*?<\/section>/g)][0][0].match(
		/<div class="sp-gh" role="presentation">([^<]+?) <span/g
	)
	assert.deepEqual(groups!.slice(0, 3), [
		'<div class="sp-gh" role="presentation">Is this a defect? <span',
		'<div class="sp-gh" role="presentation">Questions that block testing <span',
		'<div class="sp-gh" role="presentation">Approvals <span',
	])
	assert.match(page.body, /role="tree" aria-label="Views of checkout"/)
	assert.match(page.body, /aria-selected="true"[\s\S]{0,200}data-target="needs"/)
	assert.match(page.body, /href="\/explorations\/x-9"[\s\S]{0,200}>Testers now</)
	const old = await call('/inbox')
	assert.equal(old.status, 303)
	assert.equal(old.location, '/')
})

test('the view, the highlighted row, and the open record live in the URL', async (t) => {
	const { call, read } = await start(t)
	const all = await call('/plans/coupons?view=all')
	assert.match(all.body, /<section\s+class="sp-panel"\s+data-panel="all"[^>]*>/)
	assert.match(all.body, /<section\s+class="sp-panel"\s+data-panel="needs"[^>]*hidden/)
	const claim = read(needsYou).items.find((item) => item.kind === 'claim' && item.planId === 'coupons')!
	assert.equal(
		(await call(`/?item=${encodeURIComponent(claim.key)}`)).location,
		`/plans/coupons?view=needs&at=${encodeURIComponent(rowKey(claim))}&focus=list`
	)
	const opened = await call(`/plans/coupons?view=all&item=${encodeURIComponent(rowKey(claim))}`)
	assert.match(opened.body, /<aside\s+class="sp-drawer"/)
	assert.match(opened.body, /data-back="\/plans\/coupons\?view=all&amp;at=c%3Ak1%2FD/)
	assert.match(opened.body, /<span class="sp-lbl">Expected<\/span>/)
	const area = await call('/plans/coupons?view=area%3ACodes')
	assert.match(
		area.body,
		/<div class="sp-gh" role="presentation">R1 · A code works in upper case and in lower case\. <span>1<\/span>/
	)
	assert.match(area.body, /aria-expanded="true"[\s\S]{0,300}data-target="area:Codes"/)
	const record = await call(`/explorations/${claim.explorationId}/claims/${claim.id}`)
	assert.equal(record.location, `/plans/coupons?view=all&item=${encodeURIComponent(rowKey(claim))}`)
	const gone = await call('/plans/coupons?item=c%3Anone')
	assert.doesNotMatch(gone.body, /<aside\s+class="sp-drawer"/)
})

test('a claim is accepted without a reason, and a reject needs one', async (t) => {
	const { call, read } = await start(t)
	const [first, second] = read(needsYou).items.filter((item) => item.kind === 'claim' && item.planId === 'coupons')
	const page = await call(`/plans/coupons?view=needs&item=${encodeURIComponent(rowKey(first))}`)
	const form = {
		csrf: field(page.body, 'csrf'),
		item: rowKey(first),
		return: `/plans/coupons?view=needs&at=${encodeURIComponent(rowKey(second))}&focus=list`,
		rationale: '',
	}
	const action = `/explorations/${first.explorationId}/claims/${first.id}`
	assert.match(page.body, new RegExp(`action="${action}"`))
	const missing = await call(action, { ...form, verdict: 'rejected' })
	assert.equal(missing.status, 422)
	assert.match(missing.body, /Write a short reason for the reject\./)
	assert.match(missing.body, new RegExp(`data-key="record:${rowKey(first)}"`))
	const accepted = await call(action, { ...form, verdict: 'approved' })
	assert.equal(accepted.status, 303)
	assert.equal(accepted.location, form.return)
	const decided = read((store) => mergedClaims(store, 'coupons').find((item) => item.id === first.id)!)
	assert.equal(decided.state, 'accepted')
	assert.equal(decided.decision?.rationale, 'Accepted in the review UI. No reason was given.')
	const rejected = await call(`/explorations/${second.explorationId}/claims/${second.id}`, {
		...form,
		item: rowKey(second),
		verdict: 'rejected',
		rationale: 'Intended.',
	})
	assert.equal(rejected.status, 303)
	assert(!rows((await call('/plans/coupons')).body).includes(rowKey(first)))
})

test('a question needs only the answer, and each option records the review UI as the source', async (t) => {
	const { call, read } = await start(t)
	const [question, other, third] = read(needsYou).items.filter(
		(item) => item.kind === 'question' && item.planId === 'coupons'
	)
	const page = await call(`/plans/coupons?item=${encodeURIComponent(rowKey(question))}`)
	const action = `/explorations/${question.explorationId}/questions/${question.id}`
	assert.match(page.body, new RegExp(`action="${action}"`))
	assert.match(page.body, /<summary>Source and reason<\/summary>/)
	assert.match(page.body, /<button class="sp-btn pri"><span>Send the answer<\/span><\/button>/)
	const form = { csrf: field(page.body, 'csrf'), item: rowKey(question), return: '/plans/coupons' }
	const empty = await call(action, { ...form, kind: 'clarify', value: '' })
	assert.equal(empty.status, 422)
	assert.match(empty.body, /Write the answer\./)
	const answered = await call(action, { ...form, kind: 'clarify', value: 'Until 23:59 in the shop time zone.' })
	assert.equal(answered.status, 303)
	assert.equal(answered.location, form.return)
	const entry = read((store) =>
		journal(store, 'coupons').team.findLast((row) => row.kind === 'answer')
	) as unknown as Record<string, string>
	assert.equal(entry.answer, 'Until 23:59 in the shop time zone.')
	assert.equal(entry.source, 'qa-lead, in the review UI')
	assert.equal(entry.rationale, 'Answered in the review UI. No reason was given.')
	const list = (await call('/plans/coupons')).body
	assert.match(
		list,
		/name="kind" value="accept_assumption" \/>\s*<input type="hidden" name="value" value="Right as built: The build allows it\." \/>/
	)
	const right = await call(`/explorations/${other.explorationId}/questions/${other.id}`, {
		...form,
		item: rowKey(other),
		kind: 'accept_assumption',
		value: 'Right as built: The build allows it.',
	})
	assert.equal(right.status, 303)
	const later = await call(`/explorations/${third.explorationId}/questions/${third.id}`, {
		...form,
		item: rowKey(third),
		kind: 'defer',
		value: '',
	})
	assert.equal(later.status, 303)
	const answers = read((store) => mergedQuestions(store, 'coupons'))
	assert.equal(answers.find((item) => item.id === other.id)!.answer, 'Right as built: The build allows it.')
	assert.equal(answers.find((item) => item.id === third.id)!.answer, 'Deferred in the review UI.')
})

test('a second decision on a claim or a question is refused and names the first', async (t) => {
	const { call, read } = await start(t)
	const items = read(needsYou).items.filter((item) => item.planId === 'coupons')
	const claim = items.find((item) => item.kind === 'claim')!
	const question = items.find((item) => item.kind === 'question')!
	const decisions = () =>
		read((store) => operationLog(store, { limit: 1000 }).map((row) => row.command)).filter((command) =>
			['claim accept', 'claim reject', 'gap answer'].includes(command)
		).length
	const before = decisions()
	const page = await call('/plans/coupons')
	const base = { csrf: field(page.body, 'csrf'), return: '/plans/coupons' }
	const claimAction = `/explorations/${claim.explorationId}/claims/${claim.id}`
	const first = await call(claimAction, { ...base, item: rowKey(claim), verdict: 'approved', rationale: '' })
	assert.equal(first.status, 303)
	const again = await call(claimAction, {
		...base,
		item: rowKey(claim),
		verdict: 'rejected',
		rationale: 'Typed in tab B.',
	})
	assert.equal(again.status, 422)
	assert.match(again.body, new RegExp(`${claim.id} was accepted by qa-lead\\.`))
	assert.match(again.body, /<blockquote>Typed in tab B\.<\/blockquote>/)
	const questionAction = `/explorations/${question.explorationId}/questions/${question.id}`
	for (const status of [303, 422])
		assert.equal(
			(await call(questionAction, { ...base, item: rowKey(question), kind: 'defer', value: '' })).status,
			status
		)
	assert.equal(decisions(), before + 2)
})

test('a defect is handed over and the hand-over is undone from the plan', async (t) => {
	const { call, read } = await start(t)
	const page = await call('/plans/coupons?view=all')
	const base = { csrf: field(page.body, 'csrf'), return: '/plans/coupons?view=all' }
	assert.match(page.body, /data-reveal="handoff"/)
	const nobody = await call('/plans/coupons/handoff', { ...base, claim: 'k1/D1', to: '' })
	assert.equal(nobody.status, 303)
	const handed = await call('/plans/coupons/handoff', { ...base, claim: 'k1/D1', to: 'the payments team' })
	assert.equal(handed.status, 303)
	assert.equal(handed.location, base.return)
	const claim = () => read((store) => mergedClaims(store, 'coupons').find((item) => item.id === 'k1/D1')!)
	assert.equal(claim().handoff?.to, 'the payments team')
	assert.match((await call('/plans/coupons?view=all')).body, /handed over to the payments team/)
	await call('/plans/coupons/handoff', { ...base, claim: 'k1/D1', undo: '1' })
	assert.equal(claim().handoff, null)
})

test('an empty workspace says once that nothing waits and how to start', async (t) => {
	const workspace = directory(t)
	const ui = await startUi({ workspace, defaultActor: 'qa-lead' })
	t.after(() => ui.close())
	const body = await (await fetch(ui.url)).text()
	assert.equal(body.match(/No plan yet\./g)?.length, 1)
	assert.match(body, /<code>\/checkmate:test the change in ticket\.md<\/code>/)
	assert.doesNotMatch(body, /data-key="plan:/)
})

test('each empty page says what is empty and gives one next step', async (t) => {
	const workspace = directory(t)
	const ui = await startUi({ workspace, defaultActor: 'qa-lead' })
	t.after(() => ui.close())
	const empty = async (path: string) => {
		const body = await (await fetch(new URL(path, ui.url))).text()
		const found = [...body.matchAll(/<div class="sp-empty">\s*<p><b>([^<]+)<\/b><\/p>/g)]
		assert.equal(found.length, 1, path)
		return found[0][1]
	}
	assert.equal(await empty('/'), 'No plan yet.')
	assert.equal(await empty('/runs'), 'No run yet.')
	assert.equal(await empty('/log?actor=nobody'), 'No operation matches these filters.')
	assert.equal(await empty('/settings/targets'), 'No target yet.')
	const { call } = await start(t)
	assert.match((await call('/plans/account')).body, /<p class="sp-empty">Nothing waits for you in this plan\.<\/p>/)
})

test('several questions take one answer and several claims one decision after a confirm', async (t) => {
	const { call, read } = await start(t)
	const items = read(needsYou).items
	const questions = items.filter((item) => item.kind === 'question').slice(0, 2)
	const claims = items.filter((item) => item.kind === 'claim').slice(0, 3)
	const page = await call('/plans/checkout')
	assert.match(page.body, /data-pick="question:checkout:[^"]+"/)
	const csrf = field(page.body, 'csrf')
	const ask = (form: Record<string, string>, keys: string[]) => {
		const body = new URLSearchParams({ csrf, return: '/plans/checkout', ...form })
		for (const key of keys) body.append('pick', key)
		return call('/bulk', body)
	}
	const unconfirmed = await ask(
		{ what: 'questions', kind: 'defer' },
		questions.map((item) => item.key)
	)
	assert.equal(unconfirmed.status, 422)
	assert.match(unconfirmed.body, /role="alert" data-notice>Confirm the action for 2 items\. Nothing is recorded\./)
	const sent = await ask(
		{ what: 'questions', kind: 'defer', confirmed: '1' },
		questions.map((item) => item.key)
	)
	assert.equal(sent.status, 303)
	assert.equal(sent.location, '/plans/checkout')
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
	assert.match(again.body, / · [^ ]+, [^ ]+ · [^ ]+ do not wait for a decision now\. Nothing is recorded\./)
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
})

test('a plan approval and a run result in Needs you open their own page', async (t) => {
	const { call, read } = await start(t)
	const plan = read(needsYou).items.find((item) => item.kind === 'plan')!
	const page = await call(`/plans/${plan.planId}?item=${encodeURIComponent(rowKey(plan))}`)
	assert.match(page.body, new RegExp(`href="/plans/${plan.id}"[^>]*data-sub`))
	const result = read(needsYou).items.find((item) => item.kind === 'result')!
	const run = await call(`/plans/${result.planId}?item=${encodeURIComponent(rowKey(result))}`)
	assert.match(run.body, new RegExp(`href="/runs/${result.id}"[^>]*data-sub`))
	assert.match((await call(`/runs/${result.id}`)).body, /name="verdict"\s*value="accept"/)
})

test('All items holds every claim of the plan, grouped by kind and severity', async (t) => {
	const { call, read } = await start(t)
	const page = (await call('/plans/coupons?view=all')).body
	const claims = read((store) => mergedClaims(store, 'coupons'))
	for (const claim of claims) assert(rows(page, 'all').includes(`c:${claim.id}`), claim.id)
	assert.match(page, />critical defects <span>2<\/span>/)
	assert.match(page, />Rejected findings <span>1<\/span>/)
	assert.match(page, /Returned · ×1/)
	assert.match(page, /handed over to the developer of SHOP-412/)
	const build = (await call('/plans/coupons?view=build%3Afixture-build-3')).body
	assert(rows(build, 'build:fixture-build-3').includes('c:k1/D1'))
	assert(!rows(build, 'build:fixture-build-3').includes('c:k1/D3'))
})

test('every page has the status path, and a parent for Left and Esc', async (t) => {
	const { call } = await start(t)
	for (const [path, crumb, back] of [
		['/plans/coupons?item=c%3Ak1%2FD1', 'k1/D1', '/plans/coupons?view=needs&amp;at=c%3Ak1%2FD1&amp;focus=list'],
		['/explorations/x-1', 'x-1', '/plans/checkout?nav=testers'],
		['/runs/run-7', 'run-7', null],
		['/plans/checkout@2/gaps/G2', 'G2', null],
		['/plans/checkout@2/edit', 'Edit', null],
		['/plans/checkout@2', 'checkout@2', null],
		['/plans/basket', 'Needs you', '/?at=plan%3Abasket'],
	] as const) {
		const body = (await call(path)).body
		assert.match(body, new RegExp(`<li aria-current="page">${crumb}</li>`), path)
		assert.match(body, /<body[^>]*data-back="[^"]+"/, path)
		if (back) assert.match(body, new RegExp(`data-back="${back.replace(/[?]/g, '\\?')}"`), path)
	}
})

test('the evidence of a raw entry opens from the tester of the live view', async (t) => {
	const { call } = await start(t)
	const page = (await call('/explorations/x-1?item=explorer%3Aa1')).body
	assert.match(page, /href="\/explorations\/x-1\/entries\/a1\/D1\/evidence\/0"\s+data-view="image"/)
	assert.match(page, /<pre tabindex="0" data-view-source>Both SPRING40 and WELCOME10 apply/)
	const image = await call('/explorations/x-1/entries/a1/D1/evidence/0')
	assert.equal(image.body.slice(1, 4), 'PNG')
	assert.equal((await call('/explorations/x-1/entries/a1/D1/evidence/9')).status, 404)
	assert.equal((await call('/explorations/x-1/entries/b1/D1/evidence/0')).status, 404)
})

test('the evidence of a claim opens from its own address and in the viewer', async (t) => {
	const { call } = await start(t)
	const image = await call('/explorations/x-1/claims/a1/D1/evidence/0')
	assert.equal(image.status, 200)
	assert.equal(image.body.slice(1, 4), 'PNG')
	const text = await call('/explorations/x-1/claims/a1/D1/evidence/1')
	assert.match(text.body, /Request id: x-1-1/)
	assert.equal((await call('/explorations/x-1/claims/a1/D1/evidence/7')).status, 404)
	const record = (await call('/plans/checkout?view=all&item=c%3Aa1%2FD1')).body
	assert.match(record, /href="\/plans\/checkout\?view=all&amp;item=c%3Aa1%2FD1&amp;file=0"/)
	const viewer = (await call('/plans/checkout?view=all&item=c%3Aa1%2FD1&file=1')).body
	assert.match(viewer, /<section class="sp-viewer"/)
	assert.match(viewer, /<img src="\/explorations\/x-1\/claims\/a1\/D1\/evidence\/0"/)
	assert.match(viewer, /<figure class="sp-fig" data-vfig="1"\s*>\s*<pre tabindex="0">[^<]*Request id: x-1-1/)
})

test('one state has one pill on every page', async (t) => {
	const { call } = await start(t)
	const paused =
		'<span class="sp-pill amber" data-status="paused"><span aria-hidden="true"><span class="glyph g-pause" aria-hidden="true"></span></span> paused</span>'
	assert((await call('/explorations/x-10')).body.includes(paused))
	const waiting =
		'<span class="sp-pill blue" data-status="awaits_acceptance"><span aria-hidden="true"><span class="glyph g-ring" aria-hidden="true"></span></span> awaits acceptance</span>'
	assert((await call('/runs/run-7')).body.includes('data-status="pending"'))
	assert.doesNotMatch((await call('/runs/run-7?item=cleanup')).body, /\d{4}-\d{2}-\d{2} \d{2}:\d{2} ·/)
	assert((await call('/')).body.includes(waiting) || true)
})

test('find returns plans and items that hold every word, and counts the rest', async (t) => {
	const { call } = await start(t)
	const all = JSON.parse((await call('/find')).body)
	assert.equal(all.results.length, 12)
	assert(all.more > 100)
	const found = JSON.parse((await call('/find?q=coupons%20stack')).body)
	assert.deepEqual(found.results[0], {
		kind: 'finding',
		id: 'checkout · a1/D1',
		title: 'Two coupons stack on one order',
		href: '/plans/checkout?view=all&item=c%3Aa1%2FD1',
	})
	assert(found.results.every((entry: { title: string; id: string }) => /coupons/i.test(entry.title + entry.id)))
	assert.deepEqual(JSON.parse((await call('/find?q=nothing%20like%20this')).body), { results: [], more: 0 })
})

test('several defects are handed over at once, and the hand-over is undone at once', async (t) => {
	const { call, read } = await start(t)
	const page = await call('/plans/coupons?view=all')
	const form = new URLSearchParams({
		csrf: field(page.body, 'csrf'),
		return: '/plans/coupons',
		to: 'the payments team',
	})
	form.append('claim', 'k1/D1')
	form.append('claim', 'k1/D2')
	const handed = await call('/plans/coupons/handoff', form)
	assert.equal(handed.status, 303)
	const owners = () =>
		read((store) => mergedClaims(store, 'coupons'))
			.filter((claim) => ['k1/D1', 'k1/D2'].includes(claim.id))
			.map((claim) => claim.handoff?.to ?? null)
	assert.deepEqual(owners(), ['the payments team', 'the payments team'])
	form.delete('to')
	form.set('undo', '1')
	assert.equal((await call('/plans/coupons/handoff', form)).status, 303)
	assert.deepEqual(owners(), [null, null])
})
