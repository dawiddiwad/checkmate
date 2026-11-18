import type { TestContext } from 'node:test'
import test from 'node:test'
import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, realpathSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { closeStore, openStore } from '../plugin/src/store.ts'
import { explorationEvents } from '../plugin/src/explorations.ts'
import { planRequest } from '../plugin/src/plans.ts'
import { targetList, targetRevision } from '../plugin/src/targets.ts'
import { startUi } from '../plugin/src/ui/server.ts'
import { actor, directory, plan, store, target } from './support.ts'
import { fakeClaude } from './claude.ts'
import { call, endProcessesIn, token, waitFor } from './actions.ts'

async function application(t: TestContext) {
	const server = createServer((_, res) => res.end('ok'))
	await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
	t.after(() => server.close())
	return `http://127.0.0.1:${(server.address() as { port: number }).port}`
}

async function fixture(t: TestContext, seed: 'nothing' | 'target' | 'plan') {
	const workspace = realpathSync(directory(t))
	t.after(() => endProcessesIn(workspace))
	const opened = store(t, workspace)
	if (seed !== 'nothing') target(opened)
	if (seed === 'plan') plan(opened)
	closeStore(opened)
	const fake = fakeClaude(t, { rules: '!sleep', explorer: '!sleep' })
	const env = { ...process.env, ...fake.env, CHECKMATE_ACTOR: undefined }
	const ui = await startUi({ workspace, env })
	t.after(() => ui.close())
	const as = { Cookie: `checkmate_actor=${actor}` }
	const read = <T>(view: (reading: ReturnType<typeof openStore>) => T) => {
		const reading = openStore(workspace)
		try {
			return view(reading)
		} finally {
			closeStore(reading)
		}
	}
	const post = async (path: string, form: Record<string, string> = {}, headers: Record<string, string> = as) =>
		call(ui, path, { csrf: token((await call(ui, '/setup')).body), ...form }, headers)
	return { ui, workspace, as, read, post, fake }
}

const refusal = (reply: { status: number; body: string }, field: string, text: RegExp) => {
	assert.equal(reply.status, 422)
	assert.match(reply.body, new RegExp(`role="alert" data-field="${field}"`))
	assert.match(reply.body, text)
}

test('the routes of the first run and of the new change refuse a foreign origin and a missing token, and record nothing', async (t) => {
	const { ui, read } = await fixture(t, 'target')
	const form = { csrf: token((await call(ui, '/setup')).body), url: 'http://127.0.0.1:1', file: 'x.md', plan: 'p' }
	const origin = `http://127.0.0.1:${new URL(ui.url).port}`
	for (const path of ['/setup', '/setup/assumed', '/new']) {
		const foreign = await call(ui, path, form, { Cookie: `checkmate_actor=${actor}`, Origin: 'http://evil.test' })
		assert.equal(foreign.status, 403, path)
		const missing = await call(
			ui,
			path,
			{ ...form, csrf: '' },
			{ Cookie: `checkmate_actor=${actor}`, Origin: origin }
		)
		assert.equal(missing.status, 403, path)
		assert.match(missing.body, /Load the page again/)
	}
	read((reading) => {
		assert.equal(targetList(reading).length, 1)
		assert.equal(reading.db.prepare('SELECT count(*) AS n FROM plan_requests').get()!.n, 0)
		assert.equal(reading.db.prepare('SELECT count(*) AS n FROM explorations').get()!.n, 0)
	})
})

test('home is the first-run form without a target, the new change without a plan, and the plans with a row for a new change', async (t) => {
	const first = await fixture(t, 'nothing')
	const home = (await call(first.ui, '/')).body
	assert.match(home, /Set up the application/)
	assert.match(home, /name="url"/)
	assert.match(home, /name="operations"/)
	assert.doesNotMatch(home, /name="file"/)
	const second = await fixture(t, 'target')
	const change = (await call(second.ui, '/')).body
	assert.match(change, /<h1>New change<\/h1>/)
	assert.match(change, /name="file"/)
	assert.match(change, /name="text"/)
	assert.match(change, /name="rules"[^>]*value="Read Bash"/)
	assert.match(change, /<input\s+type="hidden"\s+name="target"\s+value="checkout-local"/)
	assert.match(change, /href="\/setup"/)
	const third = await fixture(t, 'plan')
	const plans = (await call(third.ui, '/')).body
	assert.match(plans, /data-key="plan:checkout"/)
	assert.match(plans, /data-key="new:change"[^>]*data-href="\/new"/)
	assert(plans.indexOf('data-key="plan:checkout"') < plans.indexOf('data-key="new:change"'))
	const found = JSON.parse((await call(third.ui, '/find?q=new')).body).results.map(
		(item: { id: string; href: string }) => [item.id, item.href]
	)
	assert.deepEqual(found, [
		['New change', '/new'],
		['New target', '/setup'],
	])
	assert.equal((await call(third.ui, '/setup')).status, 200)
	assert.equal((await call(third.ui, '/new?target=checkout-local')).status, 200)
})

test('the assumptions come from the engine, and the address decides what is local', async (t) => {
	const { post } = await fixture(t, 'nothing')
	const local = JSON.parse((await post('/setup/assumed', { url: 'http://localhost:3000' })).body)
	assert.equal(local.local, true)
	assert.equal(local.address, 'localhost:3000')
	assert.equal(local.targetId, 'localhost-3000')
	assert.deepEqual(
		local.assumed.map(([label]: string[]) => label),
		['Instance', 'Entry point', 'Capabilities', 'Operations', 'Reset', 'Authentication']
	)
	const named = JSON.parse(
		(await post('/setup/assumed', { url: 'http://shop.example.com', target: 'mine', operations: 'no' })).body
	)
	assert.equal(named.local, false)
	assert.equal(named.targetId, 'mine')
	assert(
		named.assumed.every(([label, value]: string[]) => label !== 'Operations' || !/^any_test_operation/.test(value))
	)
	assert.match(JSON.parse((await post('/setup/assumed', { url: 'localhost' })).body).error, /Give a full address/)
})

test('a first run sets the target up and goes on to the new change', async (t) => {
	const app = await application(t)
	const { post, read, as } = await fixture(t, 'nothing')
	const done = await post('/setup', { url: app, target: 'shop', environment: 'staging' })
	assert.equal(done.status, 303)
	assert.equal(done.headers.location, '/new?target=shop')
	read((reading) => {
		assert.deepEqual(
			targetList(reading).map((item) => item.targetId),
			['shop']
		)
		const profile = targetRevision(reading, 'shop').profile
		assert.deepEqual(profile.allowedOperations, ['any_test_operation'])
		assert.equal(profile.readyForLiveExecution, true)
		const instance = reading.db.prepare('SELECT body FROM instances').get()!
		assert.deepEqual(JSON.parse(String(instance.body)), {
			entries: { web: app },
			environment: 'staging',
			references: [],
		})
	})
	const again = await post('/setup', { url: app, target: 'shop' }, as)
	assert.equal(again.status, 422)
	assert.match(again.body, /role="alert"/)
})

test('a first run on a local address can limit the testers to reading', async (t) => {
	const app = await application(t)
	const { post, read } = await fixture(t, 'nothing')
	assert.equal((await post('/setup', { url: app, operations: 'no', target: 'shop' })).status, 303)
	read((reading) => assert.deepEqual(targetRevision(reading, 'shop').profile.allowedOperations, ['read_only']))
})

test('a first run refuses what the engine refuses, at the field', async (t) => {
	const app = await application(t)
	const { post, read } = await fixture(t, 'nothing')
	refusal(await post('/setup', { url: '' }), 'url', /Give the address of the application/)
	refusal(await post('/setup', { url: 'ftp://x' }), 'url', /Give the address of the application/)
	refusal(await post('/setup', { url: app, target: 'no good!' }), 'target', /Invalid target name/)
	refusal(
		await post('/setup', { url: 'http://127.0.0.1:1' }),
		'url',
		/The application did not answer at http:\/\/127\.0\.0\.1:1\.[\s\S]*Start the application/
	)
	refusal(await post('/setup', { url: app, environment: 'production' }), 'environment', /production instance/)
	refusal(
		await post('/setup', { url: 'http://shop.example.invalid', operations: '' }),
		'operations',
		/shop\.example\.invalid is not a local address\. Choose whether testers may change data there\./
	)
	refusal(
		await post('/setup', { url: 'http://shop.example.invalid', operations: 'yes' }),
		'url',
		/Confirm that Checkmate may test shop\.example\.invalid, an address that is not local\./
	)
	refusal(
		await post('/setup', { url: 'http://shop.example.invalid', operations: 'yes', confirmed: '1' }),
		'url',
		/did not answer at http:\/\/shop\.example\.invalid\./
	)
	read((reading) => assert.equal(targetList(reading).length, 0))
})

test('a production environment may be tested only with an explicit limit to reading', async (t) => {
	const app = await application(t)
	const { post, read } = await fixture(t, 'nothing')
	assert.equal(
		(await post('/setup', { url: app, environment: 'production', operations: 'no', target: 'shop' })).status,
		303
	)
	read((reading) => assert.deepEqual(targetRevision(reading, 'shop').profile.allowedOperations, ['read_only']))
})

const ticket = (workspace: string, name = 'docs/ticket.md', text = '# Checkout\nAC1 A coupon gives 10 percent.\n') => {
	mkdirSync(join(workspace, 'docs'), { recursive: true })
	writeFileSync(join(workspace, name), text)
}

test('a new change from a ticket file makes the plan like checkmate test and starts the test', async (t) => {
	const { post, read, workspace } = await fixture(t, 'target')
	ticket(workspace)
	const started = await post('/new', {
		file: 'docs/ticket.md',
		plan: 'coupons',
		target: 'checkout-local',
		build: 'b7',
		level: 'smoke',
		rules: 'Read Grep',
	})
	assert.equal(started.status, 303)
	assert.equal(started.headers.location, '/explorations/x-1')
	read((reading) => {
		const request = planRequest(reading, 'coupons').request
		assert.deepEqual(request.context?.sources, ['docs/ticket.md'])
		assert.equal(request.objective, 'Test the change that docs/ticket.md describes.')
		const start = explorationEvents(reading, 'x-1').find((item) => item.step === 'start')!
		assert.deepEqual([start.detail.level, start.detail.allow], ['smoke', ['Read', 'Grep']])
		assert.equal(reading.db.prepare('SELECT build FROM explorations').get()!.build, 'b7')
	})
	assert(!existsSync(join(workspace, '.checkmate', 'sources')))
})

test('a pasted ticket is kept as a file in .checkmate/sources and read like any source', async (t) => {
	const { post, read, workspace, fake } = await fixture(t, 'target')
	const before = readdirSync(workspace)
	const started = await post('/new', {
		text: 'Fix the cart total\nAC1 Totals include shipping.',
		plan: 'cart-total',
		target: 'checkout-local',
		build: 'b1',
		level: 'smoke',
		rules: 'Read',
	})
	assert.equal(started.status, 303)
	assert.equal(
		readFileSync(join(workspace, '.checkmate', 'sources', 'cart-total.md'), 'utf8'),
		'Fix the cart total\nAC1 Totals include shipping.\n'
	)
	read((reading) =>
		assert.deepEqual(planRequest(reading, 'cart-total').request.context?.sources, [
			'.checkmate/sources/cart-total.md',
		])
	)
	assert.deepEqual(readdirSync(workspace), before)
	const seen: Array<{ role: string; prompt: string }> = []
	const clerk = await waitFor('the clerk reads the pasted ticket', () => {
		seen.push(...fake.called())
		return seen.find((item) => item.role === 'rules')
	})
	assert.match(clerk.prompt, /AC1 Totals include shipping\./)
})

test('every refusal of the new change shows at its field and creates nothing', async (t) => {
	const { post, read, workspace, as } = await fixture(t, 'plan')
	ticket(workspace)
	const outside = mkdtempSync(join(tmpdir(), 'checkmate-outside-'))
	writeFileSync(join(outside, 'ticket.md'), 'x')
	const good = {
		file: 'docs/ticket.md',
		plan: 'new-plan',
		target: 'checkout-local',
		build: 'b1',
		level: 'smoke',
		rules: 'Read',
	}
	const bad = (change: Record<string, string>) => post('/new', { ...good, ...change }, as)
	refusal(
		await bad({ file: '', text: '' }),
		'file',
		/Give the ticket: the path of a file in the workspace, or the pasted text\./
	)
	refusal(await bad({ text: 'both' }), 'text', /Give the file or the pasted text, not both\./)
	refusal(await bad({ file: '../ticket.md' }), 'file', /The ticket \.\.\/ticket\.md is outside the workspace\./)
	refusal(await bad({ file: join(outside, 'ticket.md') }), 'file', /is outside the workspace\./)
	refusal(await bad({ file: 'docs/missing.md' }), 'file', /The ticket file docs\/missing\.md does not exist\./)
	refusal(await bad({ plan: '' }), 'plan', /Write the name of the plan\./)
	refusal(await bad({ plan: 'bad name' }), 'plan', /Invalid plan ID/)
	refusal(await bad({ plan: 'checkout' }), 'plan', /A plan checkout exists already\./)
	refusal(await bad({ target: 'nothing' }), 'target', /Choose a target, or set one up\./)
	refusal(await bad({ build: '' }), 'build', /Write the build name\./)
	refusal(await bad({ until: 'HEAD', since: '' }), 'until', /Until needs Since\./)
	refusal(await bad({ rules: ' ' }), 'rules', /Give the tool rules of the explorers and the verifier/)
	refusal(await bad({ text: 'paste', file: '', plan: 'new-plan', rules: '' }), 'rules', /tool rules/)
	assert.equal((await bad({ level: 'huge' })).status, 422)
	read((reading) => {
		assert.equal(reading.db.prepare('SELECT count(*) AS n FROM plan_requests').get()!.n, 1)
		assert.equal(reading.db.prepare('SELECT count(*) AS n FROM explorations').get()!.n, 0)
	})
	assert(!existsSync(join(workspace, '.checkmate', 'sources', 'new-plan.md')))
})

test('a new change without claude on PATH says so and creates no plan and no file', async (t) => {
	const workspace = realpathSync(directory(t))
	const opened = store(t, workspace)
	target(opened)
	closeStore(opened)
	const ui = await startUi({ workspace, env: { PATH: '' } })
	t.after(() => ui.close())
	const page = await call(ui, '/new')
	const reply = await call(
		ui,
		'/new',
		{
			csrf: token(page.body),
			text: 'Ticket',
			plan: 'p',
			target: 'checkout-local',
			build: 'b',
			level: 'smoke',
			rules: 'Read',
		},
		{ Cookie: `checkmate_actor=${actor}` }
	)
	assert.equal(reply.status, 422)
	assert.match(reply.body, /Claude Code was not found: no claude program is on PATH\./)
	assert(!existsSync(join(workspace, '.checkmate', 'sources')))
})

test('a new change on an address that is not local asks to confirm', async (t) => {
	const workspace = realpathSync(directory(t))
	const opened = store(t, workspace)
	target(opened, {}, 'http://shop.example.com')
	closeStore(opened)
	const fake = fakeClaude(t, { rules: '!sleep', explorer: '!sleep' })
	const ui = await startUi({ workspace, env: { ...process.env, ...fake.env } })
	t.after(() => ui.close())
	const page = (await call(ui, '/new')).body
	assert.match(page, /data-nonlocal\s+data-address="shop\.example\.com"/)
	const form = {
		csrf: token(page),
		text: 'Ticket',
		plan: 'p',
		target: 'checkout-local',
		build: 'b',
		level: 'smoke',
		rules: 'Read',
	}
	refusal(
		await call(ui, '/new', form, { Cookie: `checkmate_actor=${actor}` }),
		'target',
		/Confirm that Checkmate may test shop\.example\.com, an address that is not local\./
	)
	assert(!existsSync(join(workspace, '.checkmate', 'sources')))
})
