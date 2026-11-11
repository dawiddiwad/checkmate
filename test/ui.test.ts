import type { TestContext } from 'node:test'
import type { IncomingHttpHeaders } from 'node:http'
import type { Ui } from '../plugin/src/ui/server.ts'
import test from 'node:test'
import assert from 'node:assert/strict'
import { request } from 'node:http'
import { execFileSync } from 'node:child_process'
import { join } from 'node:path'
import { startUi } from '../plugin/src/ui/server.ts'
import { agent, human, seedDemo } from '../scripts/ui-demo.ts'
import {
	answerGap,
	checkAssertion,
	closeStore,
	openPlan,
	openStore,
	operationLog,
	planCandidate,
	planDetail,
	revisePlan,
	runDetail,
	savePlan,
} from '../plugin/src/index.ts'
import { directory, evidenceFile, root } from './support.ts'

const payload = '<script>alert("gap")</script>'

function seedPayload(workspace: string) {
	const store = openStore(workspace)
	openPlan(store, agent, {
		planId: 'xss',
		target: 'shop-local@1',
		request: {
			objective: 'Escape stored text.',
			requirements: [{ id: 'X1', text: 'Stored text is data.', source: 'brief://xss' }],
			sourceContext: [],
		},
	})
	savePlan(store, agent, {
		planId: 'xss',
		candidate: {
			tests: [
				{
					id: 'T1',
					title: 'Payload test',
					requirementIds: ['X1'],
					capability: 'browser',
					operations: ['read_catalog'],
					dependsOn: [],
					preconditions: [],
					action: 'Read the page.',
					assertions: [{ id: 'A1', check: 'Nothing runs.', oracleKind: 'deterministic' }],
				},
			],
			gaps: ['G1', 'G2'].map((id) => ({
				id,
				severity: 'blocking' as const,
				status: 'open' as const,
				requirementIds: ['X1'],
				testIds: ['T1'],
				question: `${id} ${payload}`,
				consequence: 'Unknown.',
				decisionId: null,
			})),
		},
	})
	closeStore(store)
}

async function start(t: TestContext) {
	const workspace = directory(t)
	seedDemo(workspace)
	seedPayload(workspace)
	const ui = await startUi({ workspace, defaultActor: '' })
	t.after(() => ui.close())
	return { ui, workspace, port: new URL(ui.url).port }
}

type Reply = { status: number; headers: IncomingHttpHeaders; body: string }

function call(
	ui: Ui,
	path: string,
	options: { method?: string; form?: Record<string, string> | URLSearchParams; headers?: Record<string, string> } = {}
): Promise<Reply> {
	const url = new URL(path, ui.url)
	const body = options.form ? new URLSearchParams(options.form).toString() : undefined
	return new Promise((resolve, reject) => {
		const req = request(
			url,
			{
				method: options.method ?? (body ? 'POST' : 'GET'),
				headers: {
					...(body ? { 'Content-Type': 'application/x-www-form-urlencoded' } : {}),
					...options.headers,
				},
			},
			(res) => {
				const chunks: Buffer[] = []
				res.on('data', (chunk) => chunks.push(chunk))
				res.on('end', () =>
					resolve({
						status: res.statusCode ?? 0,
						headers: res.headers,
						body: Buffer.concat(chunks).toString(),
					})
				)
			}
		)
		req.on('error', reject)
		req.end(body)
	})
}

function field(html: string, name: string) {
	const match = new RegExp(`name="${name}" value="([^"]*)"`).exec(html)
	assert(match, `No field ${name}`)
	return match[1]
}

const actorCookie = { Cookie: `checkmate_actor=${human}` }

function read<T>(workspace: string, view: (store: ReturnType<typeof openStore>) => T) {
	const store = openStore(workspace)
	try {
		return view(store)
	} finally {
		closeStore(store)
	}
}

test('each page renders and escapes stored text', async (t) => {
	const { ui } = await start(t)
	const paths = [
		'/',
		'/plans',
		'/plans?q=check&show=awaiting_approval',
		'/plans/checkout@2',
		'/plans/checkout@1',
		'/plans/xss@1',
		'/plans/xss@1/gaps/G1',
		'/runs',
		'/runs?plan=login&status=started',
		'/runs/run-7',
		'/runs/run-8',
		'/log',
		'/log?subject=run:run-7&actor=qa-lead',
		'/actor',
	]
	for (const path of paths) {
		const reply = await call(ui, path)
		assert.equal(reply.status, 200, path)
		assert(!reply.body.includes('<script>alert'), path)
		assert.match(String(reply.headers['content-security-policy']), /script-src 'self'/)
		assert.equal(reply.headers['x-content-type-options'], 'nosniff')
	}
	for (const path of ['/', '/plans/xss@1', '/plans/xss@1/gaps/G1'])
		assert.match((await call(ui, path)).body, /&lt;script&gt;alert\(&quot;gap&quot;\)&lt;\/script&gt;/, path)
	assert.equal((await call(ui, '/plans/checkout')).headers.location, '/plans/checkout@2')
	const missing = await call(ui, '/plans/nothing@1')
	assert.equal(missing.status, 404)
	assert.match(missing.body, /Unknown plan: nothing/)
	assert.doesNotMatch(missing.body, /at .*\.ts:\d+/)
	assert.equal((await call(ui, '/nowhere')).status, 404)
})

test('a decision needs a rationale, a confirm step, and redirects to the next inbox item', async (t) => {
	const { ui, workspace } = await start(t)
	const page = (await call(ui, '/plans/search@1', { headers: actorCookie })).body
	const form = { csrf: field(page, 'csrf'), sha: field(page, 'sha'), verdict: 'approve' }
	const empty = await call(ui, '/plans/search@1', {
		form: { ...form, rationale: '  ', confirmed: '1' },
		headers: actorCookie,
	})
	assert.equal(empty.status, 422)
	assert.match(empty.body, /Write a rationale/)
	const confirm = await call(ui, '/plans/search@1', {
		form: { ...form, rationale: 'Clear scope.' },
		headers: actorCookie,
	})
	assert.equal(confirm.status, 200)
	assert.match(confirm.body, /Confirm approval/)
	assert.match(confirm.body, /name="rationale" value="Clear scope."/)
	assert.equal(
		read(workspace, (store) => planDetail(store, 'search').approval.state),
		'pending'
	)
	const done = await call(ui, '/plans/search@1', {
		form: { ...form, rationale: 'Clear scope.', confirmed: '1' },
		headers: actorCookie,
	})
	assert.equal(done.status, 303)
	assert.equal(done.headers.location, '/plans/checkout@2/gaps/G2#answer')
	const toast = String(done.headers['set-cookie']).match(/checkmate_toast=([^;]*)/)
	assert(toast)
	assert.equal(decodeURIComponent(toast[1]), 'Approved search@1')
	const next = await call(ui, '/plans/checkout@2/gaps/G2', {
		headers: { Cookie: `checkmate_actor=${human}; checkmate_toast=${toast[1]}` },
	})
	assert.match(next.body, /class="toast"[^>]*>Approved search@1</)
	const approval = read(workspace, (store) => planDetail(store, 'search').approval)
	assert.equal(approval.state, 'approved')
	assert.equal(approval.latest?.actor, human)
})

test('a gap answer asks for a name once and refuses a stale digest with the typed text kept', async (t) => {
	const { ui, workspace } = await start(t)
	const page = (await call(ui, '/plans/xss@1/gaps/G1')).body
	assert.match(page, /name="actor"/)
	const form = {
		csrf: field(page, 'csrf'),
		sha: field(page, 'sha'),
		kind: 'clarify',
		value: 'Typed answer that must survive.',
		source: '',
		rationale: 'Because.',
		actor: 'reviewer',
	}
	const noSource = await call(ui, '/plans/xss@1/gaps/G1', { form })
	assert.equal(noSource.status, 422)
	assert.match(noSource.body, /A clarification needs a source/)
	assert.match(noSource.body, /Typed answer that must survive\.<\/textarea/)
	read(workspace, (store) => {
		answerGap(store, agent, { planId: 'xss', gapId: 'G2', kind: 'defer', value: 'Later.', rationale: 'Scope.' })
		revisePlan(store, agent, { planId: 'xss', delta: { tests: {} } })
	})
	const stale = await call(ui, '/plans/xss@1/gaps/G1', { form: { ...form, source: 'caller://answers' } })
	assert.equal(stale.status, 422)
	assert.match(stale.body, /xss has a newer revision \(2\)/)
	assert.match(stale.body, /Typed answer that must survive\.<\/textarea/)
	assert.match(stale.body, /Revision 2 is available/)
	assert.match(String(stale.headers['set-cookie']), /checkmate_actor=reviewer/)
	const current = (await call(ui, '/plans/xss@2/gaps/G1')).body
	const done = await call(ui, '/plans/xss@2/gaps/G1', {
		form: { ...form, sha: field(current, 'sha'), source: 'caller://answers' },
	})
	assert.equal(done.status, 303)
	assert.equal(
		read(workspace, (store) => planDetail(store, 'xss').pendingDecisions[0].actor),
		'reviewer'
	)
})

test('the UI prefills the default actor and records it without a name cookie', async (t) => {
	const workspace = directory(t)
	seedDemo(workspace)
	seedPayload(workspace)
	const ui = await startUi({ workspace, defaultActor: 'git-user' })
	t.after(() => ui.close())
	const page = (await call(ui, '/plans/xss@1/gaps/G1')).body
	assert.doesNotMatch(page, /name="actor" required/)
	assert.match(page, /actor: git-user/)
	assert.match((await call(ui, '/actor')).body, /value="git-user"/)
	const done = await call(ui, '/plans/xss@1/gaps/G1', {
		form: {
			csrf: field(page, 'csrf'),
			sha: field(page, 'sha'),
			kind: 'defer',
			value: 'Later.',
			rationale: 'Scope.',
		},
	})
	assert.equal(done.status, 303)
	assert.equal(
		read(workspace, (store) => planDetail(store, 'xss').pendingDecisions[0].actor),
		'git-user'
	)
	const named = await call(ui, '/plans/xss@1', { headers: { Cookie: 'checkmate_actor=reviewer' } })
	assert.match(named.body, /actor: reviewer/)
})

test('the server refuses another host, another origin, and a missing form token', async (t) => {
	const { ui, workspace, port } = await start(t)
	const page = (await call(ui, '/plans/search@1')).body
	const form = {
		csrf: field(page, 'csrf'),
		sha: field(page, 'sha'),
		verdict: 'approve',
		rationale: 'Yes.',
		confirmed: '1',
	}
	assert.equal((await call(ui, '/', { headers: { Host: `evil.test:${port}` } })).status, 421)
	assert.equal((await call(ui, '/', { headers: { Host: `localhost:${port}` } })).status, 200)
	const origin = await call(ui, '/plans/search@1', { form, headers: { ...actorCookie, Origin: 'http://evil.test' } })
	assert.equal(origin.status, 403)
	const token = await call(ui, '/plans/search@1', { form: { ...form, csrf: 'wrong' }, headers: actorCookie })
	assert.equal(token.status, 403)
	assert.match(token.body, /Load the page again/)
	assert.equal(
		read(workspace, (store) => planDetail(store, 'search').approval.state),
		'pending'
	)
	const allowed = await call(ui, '/plans/search@1', {
		form,
		headers: { ...actorCookie, Origin: `http://127.0.0.1:${port}` },
	})
	assert.equal(allowed.status, 303)
})

test('evidence keeps its media type; only images and plain text show inline', async (t) => {
	const { ui, workspace } = await start(t)
	const evidence = read(workspace, (store) =>
		runDetail(store, 'run-7').tests.flatMap((test) => test.assertions.flatMap((assertion) => assertion.evidence))
	)
	const png = evidence.find((item) => item.mediaType === 'image/png')!
	const json = evidence.find((item) => item.mediaType === 'application/json')!
	const image = await call(ui, `/evidence/${png.id}`)
	assert.equal(image.headers['content-type'], 'image/png')
	assert.match(String(image.headers['content-disposition']), /^inline; filename="T1-confirmation.png"/)
	assert.equal(image.headers['x-content-type-options'], 'nosniff')
	const data = await call(ui, `/evidence/${json.id}`)
	assert.equal(data.headers['content-type'], 'application/json')
	assert.match(String(data.headers['content-disposition']), /^attachment; /)
	assert.equal((await call(ui, '/evidence/01ARZ3NDEKTSV4RRFFQ69G5FAV')).status, 404)
	const run = (await call(ui, '/runs/run-7')).body
	assert.match(run, /<img src="\/evidence\//)
	assert.match(run, /&quot;totalPLN&quot;: 220/)
})

type Event = { id: string; data: string }

function stream(ui: Ui, subjects: string, headers: Record<string, string> = {}) {
	const events: Event[] = []
	const waiters: Array<() => void> = []
	let buffer = ''
	const req = request(new URL(`/events?subjects=${encodeURIComponent(subjects)}`, ui.url), { headers }, (res) => {
		res.setEncoding('utf8')
		res.on('data', (chunk: string) => {
			buffer += chunk
			let end
			while ((end = buffer.indexOf('\n\n')) >= 0) {
				const block = buffer.slice(0, end)
				buffer = buffer.slice(end + 2)
				const id = /^id: (.*)$/m.exec(block)?.[1]
				const data = /^data: (.*)$/m.exec(block)?.[1]
				if (id && data !== undefined) events.push({ id, data })
				for (const wake of waiters.splice(0)) wake()
			}
		})
	})
	req.on('error', () => {})
	req.end()
	const ready = new Promise<void>((resolve) => req.on('response', () => resolve()))
	return {
		events,
		ready,
		async next(count: number, timeout = 1000) {
			const deadline = Date.now() + timeout
			while (events.length < count) {
				const left = deadline - Date.now()
				if (left <= 0) throw new Error(`Expected ${count} events, got ${events.length}`)
				await new Promise<void>((resolve) => {
					waiters.push(resolve)
					setTimeout(resolve, left)
				})
			}
			return events
		},
		close: () => req.destroy(),
	}
}

test('live events reach subscribed streams only and replay after Last-Event-ID', async (t) => {
	const { ui, workspace } = await start(t)
	const run = stream(ui, 'run:run-8,inbox')
	const other = stream(ui, 'plan:search')
	t.after(() => {
		run.close()
		other.close()
	})
	await Promise.all([run.ready, other.ready])
	const store = openStore(workspace)
	t.after(() => closeStore(store))
	const before = Date.now()
	checkAssertion(store, agent, {
		runId: 'run-8',
		testId: 'T1',
		assertionId: 'A2',
		result: 'passed',
		observed: 'HttpOnly is set.',
		evidence: [evidenceFile(store, 'run-8', 'cookie.txt', 'Set-Cookie: sid=x; HttpOnly')],
	})
	const [first] = await run.next(1)
	assert(Date.now() - before < 1000)
	assert.equal(first.data, 'run:run-8')
	const started = Date.now()
	execFileSync(process.execPath, [
		join(root, 'plugin/dist/checkmate.js'),
		'run',
		'close',
		'run-8',
		'T1',
		'--workspace',
		workspace,
		'--actor',
		'worker',
	])
	const exited = Date.now()
	const events = await run.next(2)
	assert(Date.now() - exited < 1000, `event took ${Date.now() - started} ms`)
	assert.equal(events[1].data, 'run:run-8')
	assert(Number(events[1].id) > Number(events[0].id))
	await new Promise((resolve) => setTimeout(resolve, 400))
	assert.deepEqual(other.events, [])
	const replay = stream(ui, 'run:run-8', { 'Last-Event-ID': String(Number(first.id) - 1) })
	t.after(() => replay.close())
	const replayed = await replay.next(2)
	assert.deepEqual(
		replayed.map((event) => event.id),
		events.map((event) => event.id)
	)
})

function rowKeys(body: string, prefix: string) {
	return [...body.matchAll(new RegExp(`data-key="${prefix}:([^"]+)" data-nav-row`, 'g'))].map((match) => match[1])
}

test('lists page, sort, and filter on the server with the state in the URL', async (t) => {
	const { ui } = await start(t)
	const plans = (await call(ui, '/plans')).body
	assert.deepEqual(rowKeys(plans, 'plan'), ['xss', 'search', 'checkout', 'account', 'login'])
	assert.match(plans, /aria-sort="descending">\s*<a class="sort on" href="\/plans\?dir=asc"/)
	assert.match(plans, /href="\/plans\?sort=plan&amp;dir=asc" data-list-link/)
	const byName = (await call(ui, '/plans?sort=plan&dir=asc')).body
	assert.deepEqual(rowKeys(byName, 'plan'), ['account', 'checkout', 'login', 'search', 'xss'])
	assert.match(byName, /aria-sort="ascending"/)
	assert.deepEqual(rowKeys((await call(ui, '/plans?show=awaiting_approval')).body, 'plan'), ['xss', 'search'])
	assert.deepEqual(rowKeys((await call(ui, '/plans?approval=approved&q=check')).body, 'plan'), ['checkout'])
	assert.deepEqual(rowKeys((await call(ui, '/runs')).body, 'run'), ['run-8', 'run-7', 'run-3'])
	assert.deepEqual(rowKeys((await call(ui, '/runs?q=fixture-build-3')).body, 'run'), ['run-8'])
	assert.deepEqual(rowKeys((await call(ui, '/runs?plan=login&status=started')).body, 'run'), ['run-8'])
	const ignored = await call(ui, '/runs?status=bogus&size=7&sort=nothing&page=-2')
	assert.equal(ignored.status, 200)
	assert.equal(rowKeys(ignored.body, 'run').length, 3)
	const log = (await call(ui, '/log')).body
	const total = Number(/Showing 1–25 of (\d+) operations/.exec(log)?.[1])
	assert(total > 50)
	assert.equal((log.match(/<tr data-key="op:/g) ?? []).length, 25)
	assert.match(log, /href="\/log\?page=2" rel="next"/)
	assert.match(log, /<option value="25" selected>25 rows<\/option>/)
	const bigger = (await call(ui, '/log?size=50&page=2')).body
	assert.match(bigger, new RegExp(`Showing 51–${total} of ${total} operations`))
	assert.match(bigger, /href="\/log\?size=50" rel="prev"/)
	assert.match((await call(ui, '/log?page=99')).body, /Page 3 of 3/)
	const filtered = (await call(ui, '/log?subject=run:run-7&actor=qa-lead')).body
	assert.equal((filtered.match(/<tr data-key="op:/g) ?? []).length, 0)
	assert.match(filtered, /No operation matches these filters/)
	assert.match(filtered, /href="\/log" data-list-clear>Clear</)
	const oldest = (await call(ui, '/log?sort=time&dir=asc')).body
	assert.match(oldest, /<span class="mono">target open<\/span>/)
	assert.match(oldest, /name="dir" value="asc" data-default="desc"/)
})

test('a plan page lists its runs, folds closed gaps, and folds older history', async (t) => {
	const { ui } = await start(t)
	const checkout = (await call(ui, '/plans/checkout@2')).body
	assert.match(checkout, /<h2 id="runs">Runs <span class="n">1<\/span><\/h2>/)
	assert.match(checkout, /<a class="mono" href="\/runs\/run-7">run-7<\/a>/)
	assert.match(checkout, /awaiting acceptance/)
	assert.match(checkout, /<li class="gap" id="G2"/)
	assert.match(checkout, /<li class="gap closed" id="G1"[^>]*>\s*<details data-open-key="gap:G1">/)
	assert.match(checkout, /<li class="gap closed" id="G3"/)
	assert(checkout.indexOf('id="G2"') < checkout.indexOf('id="G1"'))
	const account = (await call(ui, '/plans/account@7')).body
	const entries = (body: string) => (body.match(/data-open-key="revision:/g) ?? []).length
	assert.equal(entries(account), 6)
	assert.match(account, /<details open data-open-key="revision:7">/)
	assert.match(account, /<details\s+data-open-key="revision:6">/)
	assert.match(account, /data-history-more="\/plans\/account@7\/history"/)
	assert.match(account, /Show full history · 1 earlier revision/)
	const fragment = await call(ui, '/plans/account@7/history')
	assert.equal(fragment.headers['content-type'], 'text/html; charset=utf-8')
	assert.doesNotMatch(fragment.body, /<html/)
	assert.equal(entries(fragment.body), 7)
	assert.doesNotMatch(fragment.body, /data-history-more/)
	assert.equal(entries((await call(ui, '/plans/account@7?history=all')).body), 7)
	assert.doesNotMatch((await call(ui, '/plans/login@1')).body, /data-history-more/)
})

test('a finished run downloads its report as HTML, Markdown, or JSON', async (t) => {
	const { ui } = await start(t)
	const page = (await call(ui, '/runs/run-7')).body
	for (const format of ['html', 'md', 'json'])
		assert.match(page, new RegExp(`href="/runs/run-7/report.${format}" download`))
	assert.match(page, /print to PDF/)
	const html = await call(ui, '/runs/run-7/report.html')
	assert.equal(html.status, 200)
	assert.equal(html.headers['content-type'], 'text/html; charset=utf-8')
	assert.match(String(html.headers['content-disposition']), /^attachment; filename="run-7-report.html"/)
	assert.match(html.body, /^<!doctype html>/i)
	assert.match(html.body, /@media print/)
	assert.match(html.body, /The promotion stacks with the loyalty credit/)
	const markdown = await call(ui, '/runs/run-7/report.md')
	assert.equal(markdown.headers['content-type'], 'text/markdown; charset=utf-8')
	assert.match(String(markdown.headers['content-disposition']), /filename="run-7-report.md"/)
	assert.match(markdown.body, /^# /)
	const json = await call(ui, '/runs/run-7/report.json')
	assert.equal(json.headers['content-type'], 'application/json; charset=utf-8')
	assert.equal(JSON.parse(json.body).result.runId, 'run-7')
	assert.doesNotMatch((await call(ui, '/runs/run-8')).body, /report\.html/)
	assert.equal((await call(ui, '/runs/run-8/report.html')).status, 409)
	assert.equal((await call(ui, '/runs/nothing/report.html')).status, 404)
	const plan = await call(ui, '/plans/checkout@2/export.json')
	assert.match(String(plan.headers['content-disposition']), /^attachment; filename="checkout-2-plan.json"/)
	assert.equal(JSON.parse(plan.body).planId, 'checkout')
})

function unescape(text: string) {
	return text
		.replaceAll('&quot;', '"')
		.replaceAll('&#39;', "'")
		.replaceAll('&lt;', '<')
		.replaceAll('&gt;', '>')
		.replaceAll('&amp;', '&')
}

function editForm(page: string, changes: Record<string, string>) {
	const form: Record<string, string> = {}
	const editor = page.slice(page.indexOf('data-edit-form'), page.indexOf('class="edit-json"'))
	for (const match of editor.matchAll(/<input[^>]*name="([^"]+)" value="([^"]*)"/g)) form[match[1]] = match[2]
	for (const match of editor.matchAll(/<textarea[^>]*name="([^"]+)"[^>]*>\n?([^<]*)<\/textarea/g))
		form[match[1]] = match[2]
	for (const match of editor.matchAll(/<select[^>]*name="([^"]+)"[\s\S]*?<option\s+value="([^"]+)"\s+selected/g))
		form[match[1]] = match[2]
	for (const name of Object.keys(form)) form[name] = unescape(form[name])
	return { ...form, ...changes }
}

function formBody(form: Record<string, string>, covers: string[]) {
	const body = new URLSearchParams(form)
	for (const cover of covers) body.append('cover', cover)
	return body
}

test('an unapproved plan changes in place and an approved plan gets a new revision', async (t) => {
	const { ui, workspace } = await start(t)
	const search = (await call(ui, '/plans/search@1/edit', { headers: actorCookie })).body
	assert.match(search, /Edits change this revision in place/)
	assert.match(search, /Saving as <strong>qa-lead<\/strong>/)
	assert.match(search, /name="cover"\s+value="T1 S1"[^>]*checked/)
	const form = editForm(search, {
		'r0.text': 'Search returns matching products first.',
		't0.operations': 'read_catalog',
	})
	const saved = await call(ui, '/plans/search@1/edit', {
		form: formBody(form, ['T1 S1', 'T2 S2']),
		headers: actorCookie,
	})
	assert.equal(saved.status, 303)
	assert.equal(saved.headers.location, '/plans/search@1')
	assert.match(decodeURIComponent(String(saved.headers['set-cookie'])), /Saved search@1 in place/)
	const after = read(workspace, (store) => planDetail(store, 'search'))
	assert.equal(after.latestRevision, 1)
	assert.equal(after.plan.requirements[0].text, 'Search returns matching products first.')
	assert.notEqual(after.sha256, form.sha)
	const stale = await call(ui, '/plans/search@1/edit', {
		form: formBody({ ...form, 't0.title': 'Lost update' }, ['T1 S1', 'T2 S2']),
		headers: actorCookie,
	})
	assert.equal(stale.status, 422)
	assert.match(stale.body, /search changed after you opened the editor/)
	assert.match(stale.body, /value="Lost update"/)
	assert.notEqual(
		read(workspace, (store) => planDetail(store, 'search').plan.tests[0].title),
		'Lost update'
	)

	const checkout = (await call(ui, '/plans/checkout@2/edit', { headers: actorCookie })).body
	assert.match(checkout, /A run uses checkout@2\. Saving creates revision 3, which needs approval/)
	assert.match(checkout, />Save as checkout@3</)
	const fields = editForm(checkout, { 't3.title': 'Promotion banner on every width', 't3.a1.kind': 'deterministic' })
	const covers = ['T1 R1', 'T2 R2', 'T3 R3', 'T4 R4', 'T4 R2']
	const uncovered = await call(ui, '/plans/checkout@2/edit', {
		form: formBody(fields, ['T1 R1', 'T2 R2', 'T3 R3']),
		headers: actorCookie,
	})
	assert.equal(uncovered.status, 422)
	assert.match(uncovered.body, /class="form-error"/)
	assert.match(uncovered.body, /value="Promotion banner on every width"/)
	const next = await call(ui, '/plans/checkout@2/edit', {
		form: formBody(fields, covers),
		headers: actorCookie,
	})
	assert.equal(next.status, 303)
	assert.equal(next.headers.location, '/plans/checkout@3')
	assert.match(decodeURIComponent(String(next.headers['set-cookie'])), /Saved checkout@3\. It needs approval\./)
	const revised = read(workspace, (store) => planDetail(store, 'checkout'))
	assert.equal(revised.latestRevision, 3)
	assert.equal(revised.approval.state, 'pending')
	assert.deepEqual(revised.plan.tests[3].requirementIds, ['R2', 'R4'])
	assert.equal(revised.plan.tests[3].assertions[1].oracleKind, 'deterministic')
	const log = read(workspace, (store) => operationLog(store, { limit: 1 })[0])
	assert.equal(log.command, 'plan edit')
	assert.equal(log.actor, human)
	const old = (await call(ui, '/plans/checkout@2/edit')).body
	assert.match(old, /Only the latest revision can change/)
	assert.doesNotMatch((await call(ui, '/plans/checkout@2')).body, /\/edit"/)
})

test('the JSON editor reports invalid JSON and contract errors and keeps the text', async (t) => {
	const { ui, workspace } = await start(t)
	const page = (await call(ui, '/plans/search@1/edit')).body
	const base = { csrf: field(page, 'csrf'), sha: field(page, 'sha'), mode: 'json' }
	const broken = await call(ui, '/plans/search@1/edit', {
		form: { ...base, json: '{"tests": [', actor: 'reviewer' },
	})
	assert.equal(broken.status, 422)
	assert.match(broken.body, /The JSON is not valid/)
	assert.match(broken.body, /<details class="edit-json" open>/)
	assert.match(broken.body, /\{&quot;tests&quot;: \[<\/textarea/)
	const invalid = await call(ui, '/plans/search@1/edit', {
		form: { ...base, json: '{"tests": [], "gaps": [], "extra": 1}', actor: 'reviewer' },
	})
	assert.equal(invalid.status, 422)
	assert.match(invalid.body, /class="form-error"/)
	const candidate = read(workspace, (store) => planCandidate(planDetail(store, 'search').plan))
	candidate.tests[1].assertions.push({ id: 'A2', check: 'Popular items show.', oracleKind: 'agent_observation' })
	const done = await call(ui, '/plans/search@1/edit', {
		form: { ...base, json: JSON.stringify(candidate), actor: 'reviewer' },
	})
	assert.equal(done.status, 303)
	assert.match(String(done.headers['set-cookie']), /checkmate_actor=reviewer/)
	assert.equal(
		read(workspace, (store) => planDetail(store, 'search').plan.tests[1].assertions.length),
		2
	)
	assert.equal(
		read(workspace, (store) => operationLog(store, { limit: 1 })[0].actor),
		'reviewer'
	)
})
