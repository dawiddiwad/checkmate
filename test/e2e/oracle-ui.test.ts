import test from 'node:test'
import type { TestContext } from 'node:test'
import assert from 'node:assert/strict'
import { execFileSync, spawn, spawnSync } from 'node:child_process'
import { chmodSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { createServer } from 'node:http'
import { once } from 'node:events'
import { join } from 'node:path'
import { chromium, type Browser, type BrowserContext } from 'playwright-core'
import { closeStore, openStore } from '../../plugin/src/store.ts'
import { seedDemo } from '../../scripts/ui-demo.ts'
import { directory, root, store, target, plan, evidenceFile } from '../support.ts'
import { openTest, launched, entries, done, ended, stacks } from '../explorations.ts'
import { asking, bash, allOf, openOf, plainBody, waitOpen } from '../permissions.ts'
import { planDetail } from '../../plugin/src/index.ts'
import { answerGap } from '../../plugin/src/plans.ts'
import { mergedClaims } from '../../plugin/src/views.ts'
import { endProcessesIn } from '../actions.ts'

const executable = process.env.CHECKMATE_BROWSER_EXECUTABLE
const browserSkip = executable ? false : 'Set CHECKMATE_BROWSER_EXECUTABLE to a Chromium binary'
let project: string
let cli: string
let browser: Browser | undefined

test.before(async () => {
	const packs = directory()
	project = directory()
	try {
		const packed = execFileSync('npm', ['pack', '--ignore-scripts', '--json', '--pack-destination', packs], {
			cwd: join(root, 'cli'),
			encoding: 'utf8',
		})
		const tarball = join(packs, JSON.parse(packed)[0].filename)
		writeFileSync(join(project, 'package.json'), '{ "private": true }\n')
		execFileSync('npm', ['install', '--no-audit', '--no-fund', tarball], { cwd: project, stdio: 'ignore' })
		cli = join(project, 'node_modules/.bin/checkmate')
		if (executable) browser = await chromium.launch({ executablePath: executable })
	} catch (error) {
		rmSync(project, { recursive: true, force: true })
		rmSync(packs, { recursive: true, force: true })
		throw error
	}
	// The test context is unavailable in before(), so keep the two temp dirs for after().
	;(globalThis as Record<string, unknown>).__checkmateE2eDirs = [packs, project]
})

test.after(async () => {
	await browser?.close()
	const dirs = (globalThis as Record<string, unknown>).__checkmateE2eDirs as string[] | undefined
	for (const path of dirs ?? []) rmSync(path, { recursive: true, force: true })
})

function command(workspace: string, args: string[], env: Record<string, string | undefined> = {}, input?: string) {
	const result = spawnSync(process.execPath, [cli, ...args, '--workspace', workspace, '--json'], {
		cwd: workspace,
		env: { ...process.env, CHECKMATE_ACTOR: 'oracle', ...env },
		input,
		encoding: 'utf8',
		timeout: 60_000,
	})
	return {
		code: result.status,
		out: result.stdout,
		err: result.stderr,
		body: result.stdout ? JSON.parse(result.stdout) : null,
	}
}

function must(workspace: string, args: string[], env: Record<string, string | undefined> = {}, input?: string) {
	const result = command(workspace, args, env, input)
	assert.equal(result.code, 0, result.err + result.out)
	return result.body
}

function read<T>(workspace: string, view: (opened: ReturnType<typeof openStore>) => T) {
	const opened = openStore(workspace)
	try {
		return view(opened)
	} finally {
		closeStore(opened)
	}
}

async function startUi(t: TestContext, workspace: string) {
	const server = spawn(cli, ['ui', '--port', '0', '--json', '--workspace', workspace], {
		cwd: workspace,
		stdio: ['ignore', 'pipe', 'pipe'],
	})
	t.after(async () => {
		if (server.exitCode === null) server.kill('SIGTERM')
		await Promise.race([once(server, 'exit'), new Promise((resolve) => setTimeout(resolve, 5000))])
	})
	let output = ''
	const url = await new Promise<string>((resolve, reject) => {
		const timer = setTimeout(() => reject(new Error(`UI did not start: ${output}`)), 10_000)
		server.stdout.on('data', (chunk: Buffer) => {
			output += chunk.toString()
			const line = output.split('\n')[0]
			try {
				const result = JSON.parse(line)
				if (result.url) {
					clearTimeout(timer)
					resolve(result.url)
				}
			} catch {}
		})
		server.stderr.on('data', (chunk: Buffer) => (output += chunk.toString()))
		server.once('error', reject)
		server.once('exit', (code) => reject(new Error(`UI exited ${code}: ${output}`)))
	})
	return { server, url }
}

async function pageFor(t: TestContext, url: string, options: Parameters<Browser['newContext']>[0] = {}) {
	assert(browser)
	const context: BrowserContext = await browser.newContext({ viewport: { width: 1280, height: 900 }, ...options })
	t.after(() => context.close())
	context.setDefaultTimeout(5000)
	await context.addCookies([{ name: 'checkmate_actor', value: 'oracle', url }])
	const page = await context.newPage()
	const errors: string[] = []
	page.on('pageerror', (error) => errors.push(error.message))
	t.after(() => assert.deepEqual(errors, [], 'packaged UI page errors'))
	return { context, page }
}

async function prepared(t: TestContext, seeded: 'plan' | 'demo' = 'plan') {
	const workspace = directory(t)
	t.after(() => endProcessesIn(workspace))
	if (seeded === 'demo') seedDemo(workspace)
	else {
		const opened = store(t, workspace)
		target(opened)
		plan(opened)
		closeStore(opened)
	}
	const ui = await startUi(t, workspace)
	return { workspace, ...ui }
}

test('13–16 packaged oracle answers update the handoff, and the UI reflects the same record', async (t) => {
	const workspace = directory(t)
	t.after(() => endProcessesIn(workspace))
	const server = createServer((_request, response) => response.end('ready'))
	await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
	t.after(() => server.close())
	const url = `http://127.0.0.1:${(server.address() as { port: number }).port}`
	writeFileSync(join(workspace, 'ticket.md'), 'The quote is 240. Decide whether promotion replaces loyalty.\n')
	const bin = join(workspace, 'bin')
	mkdirSync(bin)
	const host = join(bin, 'pi')
	writeFileSync(
		host,
		`#!/usr/bin/env node
const fs = require('node:fs')
if (!process.argv.includes('--no-tools') || !process.argv.includes('--no-mcp')) throw Error('reviewer has tools')
const input = fs.readFileSync(0, 'utf8')
const answered = input.includes('The promotion replaces loyalty.')
fs.appendFileSync('reviewer.log', answered ? 'answered\\n' : 'open\\n')
const entries = [{kind:'review',source:'ticket.md',evidence:'The quote is 240.',rationale:answered?'Reviewed the owner answer.':'Reviewed the open question.'}]
if (!answered) entries.push({kind:'question',source:'ticket.md',evidence:'The quote is 240. Decide whether promotion replaces loyalty.',question:'Does promotion replace loyalty?',consequence:'Expected total is unclear.',testIds:['T1'],requirementIds:[]})
console.log(JSON.stringify({type:'agent_end',messages:[{role:'assistant',stopReason:'stop',content:[{type:'text',text:JSON.stringify(entries)}]}],willRetry:false}))
console.log(JSON.stringify({type:'agent_settled',aborted:false}))
`
	)
	chmodSync(host, 0o755)
	const env = { PATH: `${bin}:${process.env.PATH}`, CHECKMATE_HARNESS: 'pi' }
	must(workspace, ['setup', '--url', url, '--target', 'ticket', '--operations', 'read_catalog'], env)
	must(
		workspace,
		['plan', 'open', 'ticket', '--target', 'ticket@1', '--objective', 'Verify promotion.', '--source', 'ticket.md'],
		env
	)
	const candidate = {
		requirements: [{ id: 'R1', text: 'The quote is 240.', source: 'ticket.md' }],
		tests: [
			{
				id: 'T1',
				title: 'Promotion quote',
				requirementIds: ['R1'],
				capability: 'http',
				operations: ['read_catalog'],
				dependsOn: [],
				preconditions: [],
				action: 'Read the quote.',
				assertions: [{ id: 'A1', check: 'Quote is 240.', checkKind: 'deterministic' }],
			},
		],
		gaps: [
			{
				id: 'G1',
				severity: 'blocking',
				status: 'open',
				requirementIds: ['R1'],
				testIds: ['T1'],
				question: 'Does promotion replace loyalty?',
				consequence: 'Expected total is unclear.',
				decisionId: null,
			},
		],
	}
	must(workspace, ['plan', 'save', 'ticket'], env, JSON.stringify(candidate))
	const first = must(workspace, ['delegate', 'spec', 'ticket@1'], env)
	assert.equal(first.status, 'needs_decision')
	const pending = must(workspace, ['spec', 'status', 'ticket@1'], env)
	assert.equal(pending.ready, false)
	assert.equal(pending.findings[0].evidence, 'The quote is 240. Decide whether promotion replaces loyalty.')
	const ui = await startUi(t, workspace)
	const page = await fetch(new URL('/plans/ticket@1', ui.url))
	assert.equal(page.status, 200)
	assert.match(await page.text(), /Does promotion replace loyalty\?/)
	must(
		workspace,
		[
			'gap',
			'answer',
			'ticket',
			'G1',
			'--kind',
			'clarify',
			'--value',
			'The promotion replaces loyalty.',
			'--source',
			'oracle',
			'--rationale',
			'Product decision.',
		],
		env
	)
	const answered = must(workspace, ['spec', 'status', 'ticket@1'], env)
	assert.equal(answered.ready, false, 'the pinned revision still needs an updated review')
	const nextActor = must(workspace, ['status', 'ticket'], env)
	assert.deepEqual([nextActor.state, nextActor.waitsOn], ['needs_revision', 'planner'])
	assert.match(nextActor.next.join(' '), /delegate revise ticket/)
	const stale = command(workspace, ['delegate', 'spec', 'ticket@1'], env)
	assert.equal(stale.code, 1)
	assert.match(stale.out + stale.err, /pending oracle answer|stale/i)
	must(workspace, ['plan', 'revise', 'ticket'], env, JSON.stringify({ tests: {} }))
	const current = must(workspace, ['delegate', 'spec', 'ticket@2'], env)
	assert.equal(current.status, 'completed')
	assert.equal(readFileSync(join(workspace, 'reviewer.log'), 'utf8'), 'open\nanswered\n')
	const status = must(workspace, ['spec', 'status', 'ticket@2'], env)
	assert.equal(status.findings.length, 1)
	assert.match(status.review.rationale, /owner answer/i)
	must(workspace, ['plan', 'approve', 'ticket@2', '--rationale', 'Oracle accepts the review.'], env)
	const handoff = must(
		workspace,
		['spec', 'handoff', 'ticket@2', '--expect-sha', status.sha256, '--rationale', 'Ready for the factory.'],
		env
	)
	assert.equal(handoff.status, 'completed')
	assert.equal(
		read(workspace, (db) => db.db.prepare('SELECT count(*) AS n FROM approvals').get()!.n),
		1
	)
})

test('14 CLI and UI expose the same eligible follow-up and omit a consumed answer', async (t) => {
	const workspace = directory(t)
	t.after(() => endProcessesIn(workspace))
	const opened = store(t, workspace)
	target(opened)
	plan(opened)
	openTest(opened, 'checkout', 'older', 'b1')
	entries(opened, 'older', 'a1', [{ kind: 'question', id: 'Q1', question: 'What is the refund window?' }])
	done(opened, 'older')
	openTest(opened, 'checkout', 'consumed', 'b1')
	answerGap(opened, 'oracle', {
		planId: 'checkout',
		gapId: 'a1/Q1',
		kind: 'clarify',
		value: 'Refunds are available for 14 days.',
		source: 'oracle',
		rationale: 'Product decision.',
	})
	done(opened, 'consumed')
	closeStore(opened)
	const { url } = await startUi(t, workspace)
	const cliStatus = must(workspace, ['status', 'checkout'])
	const page = await fetch(new URL('/plans/checkout', url))
	assert.equal(page.status, 200)
	const html = await page.text()
	const encoded = /data-qa-status="([^"]+)"/.exec(html)?.[1]
	assert(encoded)
	const uiStatus = JSON.parse(
		encoded
			.replaceAll('&quot;', '"')
			.replaceAll('&#39;', "'")
			.replaceAll('&lt;', '<')
			.replaceAll('&gt;', '>')
			.replaceAll('&amp;', '&')
	)
	assert.deepEqual(uiStatus, cliStatus.qa)
	assert.deepEqual(
		uiStatus.follow.map((item: { explorationId: string; available: boolean }) => [
			item.explorationId,
			item.available,
		]),
		[
			['older', true],
			['consumed', false],
		]
	)
	assert.match(html, /Test the answers \(1\)/)
})

test(
	'16 review requires a rejection reason, accepts another finding, and hands it off',
	{ skip: browserSkip, timeout: 60_000 },
	async (t) => {
		const workspace = directory(t)
		t.after(() => endProcessesIn(workspace))
		const opened = store(t, workspace)
		target(opened)
		plan(opened)
		openTest(opened, 'checkout', 'review', 'b1')
		launched(opened, 'review', 'tester')
		ended(opened, 'review', 'tester', [
			{ ...stacks, evidence: [evidenceFile(opened, 'review', 'quote.txt', 'HTTP 200: 220 PLN')] },
		])
		done(opened, 'review')
		openTest(opened, 'checkout', 'review-2', 'b1')
		launched(opened, 'review-2', 'tester2')
		ended(opened, 'review-2', 'tester2', [
			{
				...stacks,
				id: 'D2',
				title: 'Confirmation is missing',
				evidence: [evidenceFile(opened, 'review-2', 'confirmation.txt', 'Order not confirmed')],
			},
		])
		done(opened, 'review-2')
		const claimIds = mergedClaims(opened, 'checkout').map((item) => item.id)
		closeStore(opened)
		const { url } = await startUi(t, workspace)
		const { page } = await pageFor(t, url)
		await page.goto(new URL('/plans/checkout?view=all', url).href)
		const claim = page.locator('[data-panel="all"] [data-row][data-key^="c:"][data-needs]').first()
		await claim.waitFor()
		await claim.click()
		await page.waitForURL((address) => address.searchParams.has('item'))
		const key = new URL(page.url()).searchParams.get('item')!
		await page.locator('[data-drawer] .sp-dhead [data-option]', { hasText: 'No' }).click()
		const reason = page.locator('[data-drawer] #reject-text')
		await reason.waitFor()
		await page.locator('[data-drawer]').getByRole('button', { name: 'Reject' }).click()
		await page.getByText('Write a short reason for the reject.').waitFor()
		assert.equal(await reason.inputValue(), '')
		await reason.fill('The defect does not reproduce on the pinned build.')
		await page.locator('[data-drawer]').getByRole('button', { name: 'Reject' }).click()
		await page
			.getByRole('status')
			.filter({ hasText: `Rejected checkout · ${key.slice(2)}` })
			.waitFor()
		const rejected = read(workspace, (reading) =>
			mergedClaims(reading, 'checkout').find((item) => `c:${item.id}` === key)!
		)
		assert.equal(rejected.state, 'rejected')
		assert.equal(rejected.decision?.actor, 'oracle')
		assert.match(rejected.decision?.rationale ?? '', /pinned build/)
		const secondClaim = claimIds.find((id) => id !== key.slice(2))!
		must(workspace, [
			'claim',
			'accept',
			'checkout',
			secondClaim,
			'--rationale',
			'The confirmation is a known defect.',
		])
		must(workspace, ['claim', 'handoff', 'checkout', secondClaim, '--to', 'payments team'])
		const accepted = read(workspace, (reading) =>
			mergedClaims(reading, 'checkout').find((item) => item.id === secondClaim)!
		)
		assert.equal(accepted.state, 'accepted')
		assert.equal(accepted.decision?.actor, 'oracle')
		assert.equal(accepted.handoff?.to, 'payments team')
	}
)

test(
	'17 an answered claim makes an open browser draft stale without losing its text',
	{ skip: browserSkip, timeout: 60_000 },
	async (t) => {
		const workspace = directory(t)
		t.after(() => endProcessesIn(workspace))
		const opened = store(t, workspace)
		target(opened)
		plan(opened)
		closeStore(opened)
		const ui = await startUi(t, workspace)
		assert(browser)
		const firstContext = await browser.newContext()
		const secondContext = await browser.newContext()
		firstContext.setDefaultTimeout(5000)
		secondContext.setDefaultTimeout(5000)
		await firstContext.addCookies([{ name: 'checkmate_actor', value: 'first-oracle', url: ui.url }])
		await secondContext.addCookies([{ name: 'checkmate_actor', value: 'second-oracle', url: ui.url }])
		const first = await firstContext.newPage()
		const second = await secondContext.newPage()
		t.after(async () => {
			await firstContext.close()
			await secondContext.close()
		})
		await Promise.all([
			first.goto(new URL('/plans/checkout@1/gaps/G2', ui.url).href),
			second.goto(new URL('/plans/checkout@1/gaps/G2', ui.url).href),
		])
		const draft = first.locator('#value')
		await draft.fill('Keep this answer after another oracle acts.')
		await first.locator('#source').fill('first oracle')
		await first.locator('#rationale').fill('first draft')
		await second.locator('#value').fill('Refund eligible for 14 days.')
		await second.locator('input[name="source"]').fill('second oracle')
		await second.locator('#rationale').fill('product decision')
		const answerPost = second.waitForResponse(
			(response) => response.request().method() === 'POST' && response.url().includes('/gaps/G2')
		)
		await second.getByRole('button', { name: /Record answer/ }).click()
		const answerResult = await answerPost
		assert.equal(answerResult.status(), 303)
		await first.getByRole('button', { name: /Record answer/ }).click()
		await first.getByRole('alert').waitFor()
		assert.equal(await draft.inputValue(), 'Keep this answer after another oracle acts.')
		assert.equal(
			read(workspace, (db) => planDetail(db, 'checkout').pendingDecisions.length),
			1
		)
	}
)

test(
	'18 keyboard review opens persisted finding evidence and returns to the claim',
	{ skip: browserSkip, timeout: 60_000 },
	async (t) => {
		const workspace = directory(t)
		t.after(() => endProcessesIn(workspace))
		const opened = store(t, workspace)
		target(opened)
		plan(opened)
		const exp = 'evidence-1'
		openTest(opened, 'checkout', exp, 'broken-build')
		launched(opened, exp, 'tester')
		ended(opened, exp, 'tester', [
			{
				kind: 'defect',
				id: 'D1',
				title: 'Promotion quote is wrong',
				severity: 'high',
				expected: '240 PLN',
				actual: '220 PLN',
				evidence: [evidenceFile(opened, exp, 'quote.txt', 'HTTP 200: totalPLN=220')],
			},
		])
		done(opened, exp)
		const key = `c:${mergedClaims(opened, 'checkout')[0].id}`
		closeStore(opened)
		const ui = await startUi(t, workspace)
		const { page } = await pageFor(t, ui.url)
		await page.goto(new URL(`/plans/checkout?view=all&at=${encodeURIComponent(key)}&focus=list`, ui.url).href)
		await page.waitForFunction((selected) => document.activeElement?.getAttribute('data-key') === selected, key)
		await page.keyboard.press('ArrowRight')
		await page.waitForURL((address) => address.searchParams.get('item') === key)
		await page.getByText('Promotion quote is wrong').first().waitFor()
		await page.locator('[data-drawer] [data-sub][data-label="quote.txt"]').click()
		await page.locator('.sp-viewer').waitFor()
		assert.match((await page.locator('.sp-viewer').textContent()) ?? '', /HTTP 200: totalPLN=220/)
		await page.keyboard.press('Escape')
		await page.locator('[data-drawer]').waitFor()
	}
)

test(
	'25 one browser answer resolves a real host permission request',
	{ skip: browserSkip, timeout: 60_000 },
	async (t) => {
		const { workspace, url } = await prepared(t)
		const child = spawn(process.execPath, ['-e', 'setTimeout(() => {}, 120000)'], {
			detached: true,
			stdio: 'ignore',
		})
		t.after(() => {
			try {
				process.kill(-child.pid!, 'SIGKILL')
			} catch {}
		})
		const opened = openStore(workspace)
		openTest(opened, 'checkout', 'perm-e2e', 'b1')
		launched(opened, 'perm-e2e', 'a1')
		launched(opened, 'perm-e2e', 'a2')
		closeStore(opened)
		const answer = asking({ url }, workspace, 'perm-e2e', 'a1', bash('curl http://127.0.0.1/'))
		await waitOpen(workspace, 1)
		const { page } = await pageFor(t, url)
		await page.goto(new URL('/plans/checkout?view=needs&focus=list', url).href)
		await page.waitForFunction(() => document.activeElement?.matches('[data-row]'))
		await page.keyboard.press('1')
		assert.deepEqual(await answer, { status: 200, body: plainBody('{"behavior":"allow"}') })
		assert.equal(openOf(workspace).length, 0)
		const denial = asking({ url }, workspace, 'perm-e2e', 'a2', bash('curl http://127.0.0.1/private'))
		await waitOpen(workspace, 1)
		const { page: denialPage } = await pageFor(t, url)
		await denialPage.goto(new URL('/permissions/perm-e2e/P2', url).href)
		await denialPage.waitForFunction(() => document.activeElement?.matches('[data-sub]'))
		await denialPage.keyboard.press('3')
		await denialPage.locator('#deny-text').fill('The private path is outside this test.')
		await denialPage.getByRole('button', { name: 'Deny', exact: true }).click()
		assert.deepEqual(await denial, {
			status: 200,
			body: plainBody('{"behavior":"deny","message":"The private path is outside this test."}'),
		})
		assert.equal(openOf(workspace).length, 0)
		assert.deepEqual(
			allOf(workspace, 'perm-e2e').map((item) => item.decision?.kind),
			['allow', 'deny']
		)
	}
)

test('39 the packaged activity stream replays only events after its cursor', async (t) => {
	const { workspace, url } = await prepared(t)
	const response = await fetch(new URL('/events?subjects=plan:checkout', url), {
		headers: { Accept: 'text/event-stream' },
	})
	assert.equal(response.status, 200)
	assert.match(response.headers.get('content-type') ?? '', /text\/event-stream/)
	const reader = response.body!.getReader()
	assert.match(new TextDecoder().decode((await reader.read()).value), /retry: 2000/)
	const next = reader.read()
	must(workspace, [
		'gap',
		'answer',
		'checkout',
		'G2',
		'--kind',
		'defer',
		'--value',
		'Out of scope.',
		'--rationale',
		'Fixture decision.',
	])
	const live = new TextDecoder().decode((await next).value)
	const id = /^id: (\d+)$/m.exec(live)?.[1]
	assert.equal(/^data: plan:checkout$/m.test(live), true)
	assert(id)
	must(workspace, [
		'gap',
		'answer',
		'checkout',
		'G1',
		'--kind',
		'clarify',
		'--value',
		'Promotion replaces loyalty.',
		'--source',
		'oracle',
		'--rationale',
		'Fixture decision.',
	])
	const replay = await fetch(new URL('/events?subjects=plan:checkout', url), {
		headers: { 'Last-Event-ID': id, Accept: 'text/event-stream' },
	})
	assert.equal(replay.status, 200)
	const replayReader = replay.body!.getReader()
	let replayed = ''
	for (let attempt = 0; attempt < 5 && !/data: plan:checkout/.test(replayed); attempt++)
		replayed += new TextDecoder().decode((await replayReader.read()).value)
	assert.match(replayed, /data: plan:checkout/)
	assert(Number(/^id: (\d+)$/m.exec(replayed)?.[1]) > Number(id))
	await replayReader.cancel()
	await reader.cancel()
})

test('40 the finished report downloads over HTTP without a browser session', async (t) => {
	const { url } = await prepared(t, 'demo')
	const page = await fetch(new URL('/runs/run-7', url))
	assert.equal(page.status, 200)
	for (const extension of ['html', 'md', 'json', 'junit']) {
		const response = await fetch(new URL(`/runs/run-7/report.${extension}`, url))
		assert.equal(response.status, 200, extension)
		assert.match(response.headers.get('content-type') ?? '', /(?:html|markdown|json|xml)/i)
		const body = await response.text()
		assert.match(body, /promotion/i)
	}
	const unavailable = await fetch(new URL('/runs/run-8/report.html', url))
	assert.equal(unavailable.status, 409)
	assert.equal((await fetch(new URL('/runs/missing/report.json', url))).status, 404)
})

test(
	'41 no-JS refused decision keeps the entered text for correction',
	{ skip: browserSkip, timeout: 60_000 },
	async (t) => {
		const { workspace, url } = await prepared(t)
		const { page } = await pageFor(t, url, { javaScriptEnabled: false })
		await page.goto(new URL('/plans/checkout@1/gaps/G2', url).href)
		const answer = page.getByLabel('Answer', { exact: true })
		await answer.fill('Keep the answer while I correct its missing rationale.')
		await page.getByLabel(/Source/).fill('')
		await page.getByLabel('Rationale').fill('The owner has confirmed the refund window.')
		await page.getByRole('button', { name: /Record answer/ }).click()
		await page
			.getByRole('alert')
			.filter({ hasText: /source/i })
			.waitFor()
		assert.equal(await answer.inputValue(), 'Keep the answer while I correct its missing rationale.')
		await page.getByLabel(/Source/).fill('Product owner')
		await page.getByRole('button', { name: /Record answer/ }).click()
		await page.getByRole('status').filter({ hasText: 'Answered checkout' }).waitFor()
		assert.equal(
			read(workspace, (db) => planDetail(db, 'checkout').pendingDecisions[0].gapId),
			'G2'
		)
	}
)

test(
	'42 the packaged UI restarts and accepts a form using persisted record state',
	{ skip: browserSkip, timeout: 60_000 },
	async (t) => {
		const workspace = directory(t)
		t.after(() => endProcessesIn(workspace))
		seedDemo(workspace)
		const historyBefore = Number(
			read(workspace, (db) => db.db.prepare('SELECT count(*) AS n FROM operations').get()!.n)
		)
		assert(historyBefore > 0, 'the existing run has recorded operation history')
		const first = await startUi(t, workspace)
		const { page } = await pageFor(t, first.url)
		await page.goto(new URL('/plans/checkout?item=g%3AG2', first.url).href)
		const token = await page.locator('input[name="csrf"]').first().inputValue()
		first.server.kill('SIGTERM')
		await once(first.server, 'exit')
		const second = await startUi(t, workspace)
		await page.goto(new URL('/plans/checkout?item=g%3AG2', second.url).href)
		await page.locator('input[name="csrf"]').first().waitFor({ state: 'attached' })
		assert.notEqual(await page.locator('input[name="csrf"]').first().inputValue(), token)
		await page.locator('#answer-text').fill('Refunds are outside this test scope.')
		await page.getByRole('button', { name: /Send the answer/ }).click()
		await page
			.getByRole('status')
			.filter({ hasText: /Answered checkout/ })
			.waitFor()
		assert.equal(
			read(workspace, (db) => planDetail(db, 'checkout').pendingDecisions.length),
			1
		)
		assert.equal(
			Number(read(workspace, (db) => db.db.prepare('SELECT count(*) AS n FROM operations').get()!.n)),
			historyBefore + 1
		)
	}
)
