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
	const ui = await startUi({ workspace })
	t.after(() => ui.close())
	return { ui, workspace, port: new URL(ui.url).port }
}

type Reply = { status: number; headers: IncomingHttpHeaders; body: string }

function call(
	ui: Ui,
	path: string,
	options: { method?: string; form?: Record<string, string>; headers?: Record<string, string> } = {}
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
