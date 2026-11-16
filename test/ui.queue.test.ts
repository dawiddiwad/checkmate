import type { TestContext } from 'node:test'
import test from 'node:test'
import assert from 'node:assert/strict'
import { request } from 'node:http'
import { rmSync } from 'node:fs'
import { startUi } from '../plugin/src/ui/server.ts'
import { closeStore, openStore } from '../plugin/src/index.ts'
import { mergedClaims, mergedQuestions, needsYou } from '../plugin/src/views.ts'
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
	const call = (path: string, form?: Record<string, string>) =>
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
	assert.match(searched.body, /<details class="q-group q-fold"[^>]*\sopen>|<section class="q-group"/)
	const claim = read(needsYou).items.find((item) => item.kind === 'claim')!
	const selected = await call(`/?plan=${claim.planId}&item=${encodeURIComponent(claim.key)}`)
	assert.match(selected.body, new RegExp(`data-selected="${claim.key}"\\s+data-open`))
	assert.match(selected.body, /href="\/\?plan=[a-z]+" data-queue-back>Needs you<\/a>/)
	assert.match(selected.body, /<legend class="lab">Is [^ ]+ a defect\?<\/legend>/)
	const gone = await call('/?item=claim:checkout:none')
	assert.match(gone.body, /This item does not wait for you now\./)
})

test('a claim is decided inline and the list moves to the next item', async (t) => {
	const { call, read } = await start(t)
	const claims = read(needsYou).items.filter((item) => item.kind === 'claim')
	const [first, second] = claims
	const page = await call(`/?item=${encodeURIComponent(first.key)}`)
	assert.match(page.body, /<p class="lab">Evidence<\/p>/)
	const form = {
		csrf: field(page.body, 'csrf'),
		item: first.key,
		return: field(page.body, 'return'),
		rationale: 'The steps show it on the fixture.',
	}
	assert.equal(form.return, `/?item=${encodeURIComponent(second.key)}`)
	const action = `/explorations/${first.explorationId}/claims/${first.id}`
	const missing = await call(action, form)
	assert.equal(missing.status, 422)
	assert.match(missing.body, /Choose Accept as a defect or Reject\./)
	assert.match(missing.body, new RegExp(`data-selected="${first.key}"`))
	assert.match(missing.body, /The steps show it on the fixture\.<\/textarea>/)
	const decided = await call(action, { ...form, verdict: 'rejected' })
	assert.equal(decided.status, 303)
	assert.equal(decided.location, form.return)
	assert.equal(
		read((store) => mergedClaims(store, first.planId).find((item) => item.id === first.id)!.state),
		'rejected'
	)
	assert(!keys((await call('/')).body).includes(first.key))
})

test('a question is answered inline; a refusal keeps the text in the queue', async (t) => {
	const { call, read } = await start(t)
	const question = read(needsYou).items.find((item) => item.kind === 'question' && item.group === 'blocking')!
	const page = await call(`/?item=${encodeURIComponent(question.key)}`)
	const action = `/explorations/${question.explorationId}/questions/${question.id}`
	assert.match(page.body, new RegExp(`action="${action}"`))
	const form = {
		csrf: field(page.body, 'csrf'),
		item: question.key,
		return: field(page.body, 'return'),
		kind: 'clarify',
		value: 'Card and bank transfer only.',
		source: '',
		rationale: 'The payment policy says so.',
	}
	const refused = await call(action, form)
	assert.equal(refused.status, 422)
	assert.match(refused.body, /A clarification needs a source/)
	assert.match(refused.body, /Card and bank transfer only\.<\/textarea>/)
	assert.match(refused.body, /class="queue"/)
	const answered = await call(action, { ...form, source: 'oracle://payments#limits' })
	assert.equal(answered.status, 303)
	assert.equal(answered.location, form.return)
	assert.equal(
		read((store) => mergedQuestions(store, question.planId).find((item) => item.id === question.id)!.answer),
		'Card and bank transfer only.'
	)
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
