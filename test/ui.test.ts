import type { TestContext } from 'node:test'
import type { IncomingHttpHeaders } from 'node:http'
import type { Ui } from '../plugin/src/ui/server.ts'
import test from 'node:test'
import assert from 'node:assert/strict'
import { request } from 'node:http'
import { execFileSync } from 'node:child_process'
import { rmSync } from 'node:fs'
import { join } from 'node:path'
import { startUi } from '../plugin/src/ui/server.ts'
import {
	addInstance,
	closeStore,
	createStore,
	instanceList,
	logEntries,
	openChange,
	openStore,
	openTarget,
	operationLog,
	retireInstance,
	saveTarget,
} from '../plugin/src/index.ts'
import { copied, directory, profile, root } from './support.ts'

const human = 'qa-lead'
const agent = 'checkmate-agent'
const payload = '<script>alert("note")</script>'

function seed(workspace: string) {
	const store = createStore(workspace)
	const value = profile({
		targetId: 'shop-local',
		entryPoints: [{ name: 'web', kind: 'url', purpose: 'Shop web application and HTTP API.' }],
	})
	openTarget(store, agent, {
		targetId: value.targetId,
		entryPoints: value.entryPoints,
		capabilities: value.capabilities,
		allowedOperations: value.allowedOperations,
	})
	saveTarget(store, agent, { targetId: value.targetId, profile: value })
	const instances = [
		['preview', 'http://127.0.0.1:4100', 'Old preview build', []],
		['local', 'http://127.0.0.1:4173', 'Local fixture', []],
		['staging', 'https://staging.shop.example', 'Shared staging', ['STAGING_LOGIN']],
	] as const
	for (const [instanceId, web, environment, references] of instances)
		addInstance(store, agent, {
			targetId: value.targetId,
			instanceId,
			instance: { entries: { web }, environment, references: [...references] },
		})
	retireInstance(store, agent, { targetId: value.targetId, instanceId: 'preview' })
	openChange(store, agent, { changeId: 'cart', target: 'shop-local', instance: 'local' })
	for (let i = 1; i <= 50; i++)
		logEntries(store, i % 2 ? agent : 'qa:a1', {
			changeId: 'cart',
			build: 'b1',
			entries: { kind: 'note', text: i === 1 ? payload : `Note ${i}.` },
		})
	closeStore(store)
}

const template = directory()
test.before(() => seed(template))
test.after(() => rmSync(template, { recursive: true, force: true }))

async function start(t: TestContext) {
	const workspace = copied(t, template)
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

test('each page renders and escapes stored text; the pages of the old plan model are gone', async (t) => {
	const { ui } = await start(t)
	const home = await call(ui, '/')
	assert.equal(home.status, 303)
	assert.equal(home.headers.location, '/log')
	const paths = [
		'/log',
		'/log?subject=change:cart&actor=qa:a1',
		'/actor',
		'/settings/targets',
		'/settings/targets/shop-local',
	]
	for (const path of paths) {
		const reply = await call(ui, path)
		assert.equal(reply.status, 200, path)
		assert(!reply.body.includes('<script>alert'), path)
		assert.match(String(reply.headers['content-security-policy']), /script-src 'self'/)
		assert.equal(reply.headers['x-content-type-options'], 'nosniff')
		assert.doesNotMatch(reply.body, /Inbox|href="\/plans"|href="\/runs"/, path)
	}
	for (const path of ['/plans', '/runs', '/plans/checkout@1', '/runs/run-1', '/nowhere']) {
		const missing = await call(ui, path)
		assert.equal(missing.status, 404, path)
		assert.doesNotMatch(missing.body, /at .*\.ts:\d+/)
	}
})

test('the server refuses another host, another origin, and a missing form token', async (t) => {
	const { ui, workspace, port } = await start(t)
	const page = (await call(ui, '/settings/targets/shop-local')).body
	const form = { csrf: field(page, 'csrf'), instanceId: 'uat', 'entry.web': 'https://uat.shop.example' }
	const path = '/settings/targets/shop-local/instances'
	assert.equal((await call(ui, '/log', { headers: { Host: `evil.test:${port}` } })).status, 421)
	assert.equal((await call(ui, '/log', { headers: { Host: `localhost:${port}` } })).status, 200)
	const origin = await call(ui, path, { form, headers: { ...actorCookie, Origin: 'http://evil.test' } })
	assert.equal(origin.status, 403)
	const token = await call(ui, path, { form: { ...form, csrf: 'wrong' }, headers: actorCookie })
	assert.equal(token.status, 403)
	assert.match(token.body, /Load the page again/)
	const uat = () =>
		read(workspace, (store) => instanceList(store, 'shop-local')).some((item) => item.instanceId === 'uat')
	assert(!uat())
	const allowed = await call(ui, path, { form, headers: { ...actorCookie, Origin: `http://127.0.0.1:${port}` } })
	assert.equal(allowed.status, 303)
	assert(uat())
})

test('live events reach subscribed streams only and replay after Last-Event-ID', async (t) => {
	const { ui, workspace } = await start(t)
	const change = stream(ui, 'change:cart')
	const other = stream(ui, 'target:shop-local')
	t.after(() => {
		change.close()
		other.close()
	})
	await Promise.all([change.ready, other.ready])
	const store = openStore(workspace)
	t.after(() => closeStore(store))
	const before = Date.now()
	logEntries(store, agent, { changeId: 'cart', build: 'b1', entries: { kind: 'note', text: 'Live.' } })
	const [first] = await change.next(1)
	assert(Date.now() - before < 1000)
	assert.equal(first.data, 'change:cart')
	const started = Date.now()
	execFileSync(
		process.execPath,
		[
			join(root, 'plugin/dist/checkmate.js'),
			'log',
			'cart',
			'--build',
			'b1',
			'--workspace',
			workspace,
			'--actor',
			'worker',
		],
		{ input: JSON.stringify({ kind: 'note', text: 'From the CLI.' }) }
	)
	const exited = Date.now()
	const events = await change.next(2)
	assert(Date.now() - exited < 1000, `event took ${Date.now() - started} ms`)
	assert.equal(events[1].data, 'change:cart')
	assert(Number(events[1].id) > Number(events[0].id))
	addInstance(store, agent, {
		targetId: 'shop-local',
		instanceId: 'uat',
		instance: { entries: { web: 'https://uat.shop.example' } },
	})
	const [later] = await other.next(1)
	assert.deepEqual(
		other.events.map((event) => event.data),
		['target:shop-local'],
		'the other stream gets only the later change'
	)
	assert(Number(later.id) > Number(events[1].id))
	const replay = stream(ui, 'change:cart', { 'Last-Event-ID': String(Number(first.id) - 1) })
	t.after(() => replay.close())
	const replayed = await replay.next(2)
	assert.deepEqual(
		replayed.map((event) => event.id),
		events.slice(0, 2).map((event) => event.id)
	)
})

test('the log pages, sorts, and filters on the server with the state in the URL', async (t) => {
	const { ui } = await start(t)
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
	const filtered = (await call(ui, '/log?subject=target:shop-local&actor=qa:a1')).body
	assert.equal((filtered.match(/<tr data-key="op:/g) ?? []).length, 0)
	assert.match(filtered, /No operation matches these filters/)
	assert.match(filtered, /href="\/log" data-list-clear>Clear</)
	const tester = (await call(ui, '/log?subject=change:cart&actor=qa:a1&size=100')).body
	assert.equal((tester.match(/<tr data-key="op:/g) ?? []).length, 25)
	const oldest = (await call(ui, '/log?sort=time&dir=asc')).body
	assert.match(oldest, /<span class="mono">target open<\/span>/)
	assert.match(oldest, /name="dir" value="asc" data-default="desc"/)
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

test('the settings button opens Targets; a target page shows its shape, history, and instances', async (t) => {
	const { ui } = await start(t)
	const log = (await call(ui, '/log')).body
	assert.match(log, /<a class="icon-btn" href="\/settings" title="Settings" aria-label="Settings"\s*>/)
	assert.equal((await call(ui, '/settings')).headers.location, '/settings/targets')
	const list = await call(ui, '/settings/targets')
	assert.equal(list.status, 200)
	assert.match(list.body, /aria-label="Settings"\s+aria-current="page"/)
	assert.match(list.body, /<a href="\/settings\/targets"\s+aria-current="page"\s*>Targets<\/a/)
	assert.match(list.body, /href="\/settings\/targets\/shop-local" data-nav-item>shop-local<\/a>/)
	assert.match(list.body, /<td>2<\/td>/)
	const page = (await call(ui, '/settings/targets/shop-local')).body
	for (const text of [
		/Revision 1 \(latest\)/,
		/<td class="mono">web<\/td>\s*<td class="mono">url<\/td>/,
		/id="instance-staging"/,
		/<code>STAGING_LOGIN<\/code>/,
		/Confirm retire/,
		/name="entry.web"/,
		/shop-local@1<\/a/,
		/<code>none<\/code> · references/,
	])
		assert.match(page, text)
	assert.match(page, /id="instance-preview"[\s\S]*?retired/)
	assert.equal((await call(ui, '/settings/targets/nothing')).status, 404)
})

test('the Add instance form records the actor and the Retire button needs its confirm step', async (t) => {
	const { ui, workspace } = await start(t)
	const page = (await call(ui, '/settings/targets/shop-local')).body
	const csrf = field(page, 'csrf')
	assert.match(page, /id="instance-actor" name="actor"/)
	const form = { csrf, instanceId: 'uat', 'entry.web': 'not a url', environment: 'UAT', references: 'a\nb' }
	const nameless = await call(ui, '/settings/targets/shop-local/instances', { form })
	assert.equal(nameless.status, 422)
	assert.match(nameless.body, /Enter your name/)
	const invalid = await call(ui, '/settings/targets/shop-local/instances', { form, headers: actorCookie })
	assert.equal(invalid.status, 422)
	assert.match(invalid.body, /Entry point web needs a valid URL/)
	assert.match(invalid.body, /name="instanceId"[\s\S]*?value="uat"/)
	const added = await call(ui, '/settings/targets/shop-local/instances', {
		form: { ...form, 'entry.web': 'https://uat.shop.example' },
		headers: actorCookie,
	})
	assert.equal(added.status, 303)
	assert.equal(added.headers.location, '/settings/targets/shop-local#instance-uat')
	assert.match(decodeURIComponent(String(added.headers['set-cookie'])), /Added instance uat to shop-local/)
	const unconfirmed = await call(ui, '/settings/targets/shop-local/instances/uat/retire', {
		form: { csrf },
		headers: actorCookie,
	})
	assert.equal(unconfirmed.status, 422)
	assert.match(unconfirmed.body, /Confirm that you want to retire the instance/)
	const retired = await call(ui, '/settings/targets/shop-local/instances/uat/retire', {
		form: { csrf, confirmed: '1' },
		headers: actorCookie,
	})
	assert.equal(retired.status, 303)
	const log = read(workspace, (store) => operationLog(store, { subject: 'target:shop-local', limit: 2 }))
	assert.deepEqual(
		log.map((row) => [row.command, row.actor]),
		[
			['target instance retire', human],
			['target instance add', human],
		]
	)
	const uat = read(workspace, (store) => instanceList(store, 'shop-local')).find(
		(instance) => instance.instanceId === 'uat'
	)
	assert.deepEqual(uat?.references, ['a', 'b'])
	assert.equal(uat?.environment, 'UAT')
	assert(uat?.retired)
	assert.match((await call(ui, '/log')).body, /href="\/settings\/targets\/shop-local">target:shop-local/)
})

test('instance values are escaped in the table and the form; a javascript: URL entry is text only', async (t) => {
	const { ui, workspace } = await start(t)
	const hostile = 'javascript:alert("x")//<script>alert(1)</script>'
	read(workspace, (store) =>
		addInstance(store, agent, {
			targetId: 'shop-local',
			instanceId: 'hostile',
			instance: { entries: { web: hostile }, environment: '<script>alert(2)</script>"' },
		})
	)
	const page = (await call(ui, '/settings/targets/shop-local')).body
	assert(!page.includes('<script>alert'), 'raw script in the page')
	assert.match(
		page,
		/<span class="word">javascript:alert\(&quot;x&quot;\)\/\/&lt;script&gt;alert\(1\)&lt;\/script&gt;<\/span>/
	)
	assert.match(page, /&lt;script&gt;alert\(2\)&lt;\/script&gt;&quot;/)
	assert.doesNotMatch(page, /href="javascript:/i)
	const csrf = field(page, 'csrf')
	const refused = await call(ui, '/settings/targets/shop-local/instances', {
		form: { csrf, instanceId: 'x"><script>', 'entry.web': '"><script>alert(3)</script>' },
		headers: actorCookie,
	})
	assert.equal(refused.status, 422)
	assert(!refused.body.includes('<script>alert(3)'), 'raw script in the form')
	assert.match(refused.body, /value="&quot;&gt;&lt;script&gt;alert\(3\)&lt;\/script&gt;"/)
	assert.match(refused.body, /value="x&quot;&gt;&lt;script&gt;"/)
})

test('a retire of an unknown instance shows a visible error; each Retire control names its instance', async (t) => {
	const { ui } = await start(t)
	const page = (await call(ui, '/settings/targets/shop-local')).body
	assert.match(page, /aria-label="Retire staging"/)
	assert.match(page, /retired by checkmate-agent/)
	const unknown = await call(ui, '/settings/targets/shop-local/instances/nope/retire', {
		form: { csrf: field(page, 'csrf'), confirmed: '1' },
		headers: actorCookie,
	})
	assert.equal(unknown.status, 422)
	assert.match(unknown.body, /<p class="form-error" role="alert">Unknown instance: shop-local\/nope\./)
})

test('the back link accepts only a path on this server in printable ASCII', async (t) => {
	const { ui } = await start(t)
	const page = (await call(ui, '/log')).body
	const csrf = field(page, 'csrf')
	const refused = [
		'//evil.test',
		'/\\evil.test',
		'/%2F/evil.test',
		'%2F%2Fevil.test',
		'/%5Cevil.test',
		'/\t/evil.test',
		'/%E2%80%A8x',
		'/a%00b',
		'/\uFF0F\uFF0Fevil.test',
		'/a b',
		'/%ZZ',
	]
	for (const back of refused) {
		const reply = await call(ui, '/actor', { form: { csrf, actor: 'reviewer', back } })
		assert.equal(reply.status, 303, back)
		assert.equal(reply.headers.location, '/', back)
		const theme = await call(ui, '/theme', { form: { csrf, theme: 'dark', back } })
		assert.equal(theme.headers.location, '/', back)
		const shown = await call(ui, `/actor?back=${encodeURIComponent(back)}`)
		assert.equal(shown.status, 200, back)
		assert.match(shown.body, /<a class="btn" href="\/">Cancel<\/a>/, back)
	}
	const kept = await call(ui, '/actor', { form: { csrf, actor: 'reviewer', back: '/log?q=open' } })
	assert.equal(kept.headers.location, '/log?q=open')
})

test('a form over 256 KiB gets a 413 page and nothing is recorded', async (t) => {
	const { ui, workspace } = await start(t)
	const page = (await call(ui, '/settings/targets/shop-local', { headers: actorCookie })).body
	const before = read(workspace, (store) => operationLog(store, { limit: 1000 }).length)
	const reply = await call(ui, '/settings/targets/shop-local/instances', {
		form: {
			csrf: field(page, 'csrf'),
			instanceId: 'big',
			'entry.web': 'https://big.example',
			environment: 'x'.repeat(300 * 1024),
		},
		headers: actorCookie,
	})
	assert.equal(reply.status, 413)
	assert.match(reply.body, /Form too large/)
	assert.match(reply.body, /more than 256 KiB/)
	assert.equal(
		read(workspace, (store) => operationLog(store, { limit: 1000 }).length),
		before
	)
})
