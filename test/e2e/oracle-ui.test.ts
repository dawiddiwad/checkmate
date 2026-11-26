import test from 'node:test'
import type { TestContext } from 'node:test'
import assert from 'node:assert/strict'
import { execFileSync, spawn, spawnSync } from 'node:child_process'
import {
	chmodSync,
	existsSync,
	mkdirSync,
	readdirSync,
	readFileSync,
	realpathSync,
	rmSync,
	writeFileSync,
} from 'node:fs'
import { createServer } from 'node:http'
import { once } from 'node:events'
import { dirname, join } from 'node:path'
import { tmpdir } from 'node:os'
import { pathToFileURL } from 'node:url'
import { chromium, type Browser, type BrowserContext } from 'playwright-core'
import { closeStore, openStore } from '../../plugin/src/store.ts'
import { startUi as startSourceUi } from '../../plugin/src/ui/server.ts'
import { seedDemo } from '../../scripts/ui-demo.ts'
import {
	actor,
	directory,
	pathWithoutRecipeTools,
	root,
	store,
	target,
	plan,
	evidenceFile,
	ready,
	endProcessesIn,
} from '../support.ts'
import { openTest, launched, entries, done, ended, stacks } from '../explorations.ts'
import { asking, bash, allOf, openOf, plainBody, waitOpen } from '../permissions.ts'
import { planDetail } from '../../plugin/src/index.ts'
import { answerGap } from '../../plugin/src/plans.ts'
import { mergedClaims } from '../../plugin/src/views.ts'
import { fakeClaude } from '../claude.ts'
import { beginRun, checkAssertion, closeTest, finishRun } from '../../plugin/src/runs.ts'

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

async function startUi(t: TestContext, workspace: string, env: NodeJS.ProcessEnv = {}) {
	const server = spawn(cli, ['ui', '--port', '0', '--json', '--workspace', workspace], {
		cwd: workspace,
		env: { ...process.env, ...env },
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

async function prepared(t: TestContext, seeded: 'plan' | 'demo' = 'plan', env: NodeJS.ProcessEnv = {}) {
	const workspace = directory(t)
	t.after(() => endProcessesIn(workspace))
	if (seeded === 'demo') seedDemo(workspace)
	else {
		const opened = store(t, workspace)
		target(opened)
		plan(opened)
		closeStore(opened)
	}
	const ui = await startUi(t, workspace, env)
	return { workspace, ...ui }
}

test('13–16 packaged oracle answers update the handoff, and the UI reflects the same record', async (t) => {
	const workspace = directory(t)
	t.after(() => endProcessesIn(workspace))
	let probes = 0
	const server = createServer((request, response) => {
		if (request.url === '/setup-probe') probes++
		response.end('ready')
	})
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
	const env = { PATH: `${bin}:${pathWithoutRecipeTools()}`, CHECKMATE_HARNESS: 'pi' }
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
				assertions: [
					{
						id: 'A1',
						check: 'Quote is 240.',
						checkKind: 'deterministic',
						observe: 'the value stated by the check',
						expected: '240',
					},
				],
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
	const setup = await (await fetch(new URL('/setup', ui.url))).text()
	const csrf = /name="csrf" value="([^"]+)"/.exec(setup)?.[1]
	assert(csrf)
	const submit = (target: string) =>
		fetch(new URL('/setup', ui.url), {
			method: 'POST',
			body: new URLSearchParams({ csrf, actor: 'oracle', url: `${url}/setup-probe`, target, operations: 'no' }),
			redirect: 'manual',
		})
	assert.equal((await submit('bad target')).status, 422)
	assert.equal(probes, 0)
	assert.equal((await submit('ui-added')).status, 303)
	assert.equal(probes, 1)
	assert.equal(must(workspace, ['target', 'show', 'ui-added'], env).targetId, 'ui-added')
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
	'15 the UI follow-up consumes the oracle answer and records a durable completion',
	{ skip: browserSkip, timeout: 60_000 },
	async (t) => {
		const fake = fakeClaude(t, { explorer: 'The build was inspected.', recorder: [] })
		const { workspace, url } = await prepared(t, 'plan', { ...fake.env, CHECKMATE_HARNESS: 'claude' })
		fake.reply({
			explorer: 'The build was inspected.',
			recorder: [{ kind: 'question', id: 'Q1', question: 'Does the promotion replace loyalty?' }],
		})
		const env = { ...fake.env, CHECKMATE_HARNESS: 'claude' }
		const started = must(
			workspace,
			[
				'explore',
				'start',
				'checkout',
				'--build',
				'build-follow',
				'--level',
				'smoke',
				'--explorers',
				'1',
				'--allow',
				'Read',
				'--allow',
				'Bash',
			],
			env
		)
		const explorationId = started.explorationId as string
		assert.equal(must(workspace, ['explore', 'wait', explorationId, '--timeout', '60'], env).state, 'completed')
		must(
			workspace,
			[
				'gap',
				'answer',
				'checkout',
				'a1/Q1',
				'--kind',
				'clarify',
				'--value',
				'The promotion replaces loyalty.',
				'--source',
				'Product owner',
				'--rationale',
				'The product owner decided the stacking rule.',
			],
			env
		)
		fake.reply({
			explorer: 'The build was inspected.',
			recorder: [{ kind: 'note', text: 'Retested: the promotion replaces loyalty, as the owner decided.' }],
			follower: 'I tested the owner answer on build-follow and recorded what it settles.',
			merger: [],
		})
		const { page } = await pageFor(t, url)
		await page.goto(new URL('/plans/checkout', url).href)
		await page.getByRole('button', { name: /Test the answers \(1\)/ }).click()
		await page.getByRole('button', { name: /Test the 1 answer/ }).click()
		await page.waitForURL(new RegExp(`/explorations/${explorationId}$`))
		const finished = must(workspace, ['explore', 'wait', explorationId, '--timeout', '60'], env)
		assert.equal(finished.follow, 'completed')
		const calls = fake.called()
		const follower = calls.find((call) => call.role === 'follower')
		assert(follower, 'the follow-up host ran')
		assert.match(follower.toolSession, /^qa-[a-z0-9]{6}-x-\d+-a1$/)
		assert.equal(follower.toolSession, calls.find((call) => call.role === 'tester')?.toolSession)
		assert.match(follower.prompt, /The promotion replaces loyalty\./)
		assert.match(follower.prompt, /Does the promotion replace loyalty\?/)
		const show = must(workspace, ['explore', 'show', explorationId], env)
		const phases = show.phases as Array<{ step: string; status: string; detail: Record<string, unknown> }>
		const acknowledgment = phases.find((item) => item.step === 'followed')
		assert.equal(acknowledgment?.status, 'completed')
		assert.equal((acknowledgment?.detail as { answers?: number[] }).answers?.length, 1)
		assert.match(JSON.stringify(show), /Retested: the promotion replaces loyalty/)
		const status = must(workspace, ['status', 'checkout'], env)
		assert.equal(
			status.qa.follow.find((item: { explorationId: string }) => item.explorationId === explorationId)?.available,
			false
		)
		await page.goto(new URL('/plans/checkout', url).href)
		assert.doesNotMatch(await page.locator('body').innerText(), /Test the answers \(1\)/)
	}
)

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
		openTest(opened, 'checkout', 'no-tester-yet', 'broken-build')
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
		// A running test with no tester shows its empty state as one line across the list.
		await page.goto(new URL('/explorations/no-tester-yet', ui.url).href)
		const empty = page.locator('.sp-list > .sp-empty')
		await empty.waitFor()
		const list = await page.locator('.sp-list').first().boundingBox()
		const line = await empty.boundingBox()
		assert(list && line)
		assert(line.width > list.width - 4, `The empty state is ${line.width}px wide in a list ${list.width}px wide.`)
		assert(line.height < 80, `The empty state is ${line.height}px tall.`)
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

test(
	'40 select the current build and download its evidence-backed report for offline review',
	{ skip: browserSkip, timeout: 60_000 },
	async (t) => {
		const workspace = directory(t)
		t.after(() => endProcessesIn(workspace))
		const opened = store(t, workspace)
		ready(opened)
		const record = (runId: string, build: string, marker: string) => {
			beginRun(opened, actor, { runId, reference: 'checkout@2', tests: ['T1'], build, instance: 'local' })
			const evidence = checkAssertion(opened, actor, {
				runId,
				testId: 'T1',
				assertionId: 'A1',
				result: 'passed',
				observed: `${marker} The confirmation shows 400 PLN.`,
				evidence: [{ text: marker }],
			})
			checkAssertion(opened, actor, {
				runId,
				testId: 'T1',
				assertionId: 'A2',
				observed: '1',
				evidence: [{ text: `${build} order record is correct` }],
			})
			closeTest(opened, actor, { runId, testId: 'T1' })
			finishRun(opened, actor, {
				runId,
				completion: 'completed',
				cleanup: 'completed',
				cleanupReason: 'No browser or test data was left open.',
			})
			return (evidence.data.evidenceIds as string[])[0]
		}
		record('old-run', 'build-old', 'OLD_BUILD_EVIDENCE totalPLN=240 must not appear in the selected report.')
		const evidenceId = record('current-run', 'build-current', 'CURRENT_BUILD_EVIDENCE: HTTP 200, totalPLN=240.')
		closeStore(opened)
		const { url, server } = await startUi(t, workspace)
		const { page } = await pageFor(t, url)
		await page.goto(new URL('/runs?build=build-current', url).href)
		const rows = page.locator('[data-row][data-href^="/runs/"]')
		assert.equal(await rows.count(), 1)
		assert.equal(await rows.getAttribute('data-href'), '/runs/current-run')
		await rows.click()
		await page.waitForURL(/\/runs\/current-run$/)
		await page.locator('details[data-menu] summary').filter({ hasText: 'Download report' }).click()
		const [download] = await Promise.all([
			page.waitForEvent('download'),
			page.locator('a[data-download="html"]').click(),
		])
		const reportPath = join(workspace, 'current-run-report.html')
		await download.saveAs(reportPath)
		const response = await fetch(new URL(`/evidence/${evidenceId}`, url))
		assert.equal(response.status, 200)
		const evidencePath = join(workspace, 'current-run-evidence.txt')
		writeFileSync(evidencePath, Buffer.from(await response.arrayBuffer()))
		const stop = once(server, 'exit')
		server.kill('SIGTERM')
		await stop
		const html = readFileSync(reportPath, 'utf8')
		assert.match(html, /Test report: current-run/)
		assert.match(html, /build-current/)
		assert.match(html, /CURRENT_BUILD_EVIDENCE: HTTP 200, totalPLN=240/)
		assert.doesNotMatch(html, /OLD_BUILD_EVIDENCE/)
		assert.match(html, /Content-Security-Policy" content="default-src 'none'/)
		assert.doesNotMatch(html, /<(?:script|link|img)[^>]+(?:src|href)="https?:\/\//i)
		assert.equal(readFileSync(evidencePath, 'utf8'), 'CURRENT_BUILD_EVIDENCE: HTTP 200, totalPLN=240.')
		await assert.rejects(fetch(url), /fetch failed|ECONNREFUSED/)
		const external: string[] = []
		page.on('request', (request) => {
			if (/^https?:/.test(request.url())) external.push(request.url())
		})
		await page.goto(pathToFileURL(reportPath).href)
		assert.equal(await page.getByRole('heading', { name: 'Test report: current-run' }).count(), 1)
		assert.ok((await page.getByText('CURRENT_BUILD_EVIDENCE: HTTP 200, totalPLN=240.').count()) > 0)
		assert.deepEqual(external, [])
	}
)

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

test('Filter the review list by a build whose name has spaces — the row lists its builds as JSON, and the page script reads them as JSON.', async (t) => {
	const workspace = directory(t)
	t.after(() => endProcessesIn(workspace))
	const opened = store(t, workspace)
	target(opened)
	plan(opened)
	openTest(opened, 'checkout', 'spaced', 'Release 2.1 (beta; $(x))')
	entries(opened, 'spaced', 'a1', [{ kind: 'question', id: 'Q1', question: 'What is the refund window?' }])
	done(opened, 'spaced')
	closeStore(opened)
	const { url } = await startUi(t, workspace)
	const page = await (await fetch(new URL('/plans/checkout?view=needs', url))).text()
	assert.match(page, /data-builds="\[&quot;Release 2\.1 \(beta; \$\(x\)\)&quot;\]"/)
	const script = await (await fetch(new URL('/assets/client.js', url))).text()
	assert.match(script, /JSON\.parse\(row\.dataset\.builds/)
})

test(
	'Show built-in and custom tool recipes read-only in the review UI — a custom recipe is missing, unmarked, or its text runs as HTML.',
	{ skip: browserSkip, timeout: 60_000 },
	async (t) => {
		const workspace = realpathSync(directory(t))
		t.after(() => endProcessesIn(workspace))
		must(workspace, ['init'])
		const { url } = await startUi(t, workspace)
		const { page } = await pageFor(t, url)
		await page.goto(new URL('/settings/recipes', url).href)
		await page.locator('[data-live]:not(.down):not([hidden])').waitFor()
		const builtIn = ['maestro-mcp', 'maestro', 'node', 'playwright-cli']
		const sources = () =>
			page
				.locator('[data-region="recipes"] [data-row]')
				.evaluateAll((rows) =>
					rows.map((row) => [
						row.getAttribute('data-label'),
						row.querySelector('[data-source]')?.getAttribute('data-source'),
					])
				)
		assert.deepEqual(
			await sources(),
			builtIn.map((name) => [name, 'built-in'])
		)
		const empty = page.locator('[data-region="recipes"] .sp-empty')
		assert.match((await empty.textContent()) ?? '', /No custom recipe yet\.[\s\S]*Drop a recipe JSON file in/)
		assert.equal(await page.locator('main form, main button').count(), 0)

		const injected = `<img src=x onerror="document.body.dataset.injected='yes'">`
		const usage = `# Acme\n\nRun acme stock --store <store>.\n\n<script>document.body.dataset.injected = 'script'</script>\n${injected}\n`
		const recipe = {
			name: 'acme',
			capability: 'inventory',
			kind: 'cli',
			purpose: `Read stock levels ${injected}`,
			detect: 'path',
			entryPoints: [{ name: 'store', kind: 'value', purpose: 'The store code.', pattern: '^[A-Z]{3}$' }],
			reachable: [{ check: 'command', run: ['acme', 'ping', '{store}'], contains: ['pong'] }],
			environment: {},
			workspaceFolders: [],
			observeFrom: { stock: 'state' },
			evidence: ['stock_report'],
			usage: usage.split('\n'),
		}
		const json = JSON.stringify(recipe, null, 2) + '\n'
		const folder = join(workspace, '.checkmate', 'recipes')
		const path = join(folder, 'acme.json')
		mkdirSync(folder, { recursive: true })
		writeFileSync(path, json)
		await page.locator('[data-region="recipes"] [data-label="acme"]').waitFor()
		assert.deepEqual(await sources(), [...builtIn.map((name) => [name, 'built-in']), ['acme', 'custom']])
		assert.equal(await empty.count(), 0)
		assert.match(
			(await page.locator('[data-label="acme"]').textContent()) ?? '',
			/Read stock levels <img src=x onerror=/
		)

		await page.locator('[data-label="acme"]').click()
		await page.waitForURL(/\/settings\/recipes\/acme$/)
		const facts = await page.locator('#recipe + .facts').innerText()
		assert.equal(await page.locator('#recipe + .facts [data-source]').getAttribute('data-source'), 'custom')
		assert.ok(facts.includes(path), facts)
		assert.match(facts, /inventory · command-line tool/)
		assert.match(facts, /acme on PATH/)
		const requires = await page.locator('section[aria-labelledby="requires"]').innerText()
		assert.match(requires, /store · value · format \^\[A-Z\]\{3\}\$/)
		assert.match(requires, /Command acme ping \{store\} exits with code 0, and its output contains pong\./)
		assert.equal(await page.locator('[data-usage]').textContent(), usage)
		assert.equal(await page.locator('[data-json]').isVisible(), false)
		assert.equal(await page.locator('[data-json]').textContent(), json)
		assert.equal(await page.locator('main img, main script').count(), 0)
		assert.equal(await page.locator('main form, main button').count(), 0)
		assert.equal(await page.evaluate(() => document.body.dataset.injected ?? null), null)

		const { usage: _usage, ...withoutUsage } = recipe
		writeFileSync(path, JSON.stringify(withoutUsage))
		await page.reload()
		assert.equal(await page.locator('[data-usage], a[href="#usage"]').count(), 0)
		assert.equal(await page.locator('[data-json]').textContent(), JSON.stringify(withoutUsage))

		await page.goto(new URL('/settings/recipes/node', url).href)
		const nodeFacts = await page.locator('#recipe + .facts').innerText()
		assert.equal(await page.locator('#recipe + .facts [data-source]').getAttribute('data-source'), 'built-in')
		assert.match(nodeFacts, /The Node\.js that runs Checkmate/)
		assert.doesNotMatch(nodeFacts, /FILE/)
		const nodeUsage = (await page.locator('[data-usage]').textContent()) ?? ''
		assert.match(nodeUsage, /^# HTTP recipe\n\n\S/)
		assert.doesNotMatch(nodeUsage, /Agent only/)
		assert.equal((await fetch(new URL('/settings/recipes/missing', url))).status, 404)

		await page.goto(new URL('/settings/recipes', url).href)
		await page.locator('[data-live]:not(.down):not([hidden])').waitFor()
		writeFileSync(join(workspace, '.checkmate', 'recipes', 'bad.json'), injected)
		const bad = page.locator('[data-region="recipes"] [data-label="bad.json"]')
		await bad.waitFor()
		assert.deepEqual(await sources(), [
			...builtIn.map((name) => [name, 'built-in']),
			['acme', 'custom'],
			['bad.json', 'invalid'],
		])
		assert.equal(await page.locator('.banner').count(), 0)
		assert.match((await bad.textContent()) ?? '', /bad\.json is not valid: Cannot read JSON: .*<img src=x/)
		await bad.click()
		await page.waitForURL(/\/settings\/invalid-recipes\?file=bad\.json$/)
		const error = (await page.locator('[data-error]').textContent()) ?? ''
		assert.ok(
			error.startsWith(
				`Tool recipe ${join(workspace, '.checkmate', 'recipes', 'bad.json')} is not valid: Cannot read JSON: `
			),
			error
		)
		assert.match(error, /<img src=x/)
		assert.ok(
			(await page.locator('main .facts').innerText()).includes(
				join(workspace, '.checkmate', 'recipes', 'bad.json')
			)
		)
		assert.equal(await page.locator('main img, main form, main button').count(), 0)
		assert.equal(await page.evaluate(() => document.body.dataset.injected ?? null), null)
		assert.equal((await fetch(new URL('/settings/invalid-recipes?file=acme.json', url))).status, 404)
		assert.match(await page.locator('main .facts').innerText(), /Edit this JSON file to fix the listed problems/)
		await page.goto(new URL('/settings/recipes', url).href)
		await page.locator('[data-live]:not(.down):not([hidden])').waitFor()
		writeFileSync(join(folder, 'bad.json'), JSON.stringify({ ...recipe, name: 'bad' }))
		await page.locator('[data-label="bad"] [data-source="custom"]').waitFor()
		rmSync(join(folder, 'bad.json'))
		rmSync(path)
		await page.locator('[data-region="recipes"] .sp-empty').waitFor()
	}
)

const screenshots = process.env.CHECKMATE_CATALOGUE_SCREENSHOTS
const baselines = join(root, 'test/e2e/catalogue')
const actuals = join(tmpdir(), 'checkmate-catalogue-actual')

function checkScreenshot(theme: string, name: string, actual: Buffer) {
	const expected = join(baselines, theme, `${name}.png`)
	if (screenshots === 'update') {
		mkdirSync(dirname(expected), { recursive: true })
		writeFileSync(expected, actual)
		return null
	}
	if (existsSync(expected) && readFileSync(expected).equals(actual)) return null
	mkdirSync(join(actuals, theme), { recursive: true })
	writeFileSync(join(actuals, theme, `${name}.png`), actual)
	return `${theme}/${name}`
}

test(
	'The dev-only component catalogue shows every component in light and dark without console errors, and checkmate ui does not serve it.',
	{ skip: browserSkip, timeout: 120_000 },
	async (t) => {
		const components = readdirSync(join(root, 'plugin/src/ui/components'))
			.filter((name) => name.endsWith('.ts') && !name.endsWith('.catalogue.ts'))
			.map((name) => name.slice(0, -'.ts'.length))
		assert.ok(components.length > 0)
		const plain = await startSourceUi({ workspace: directory(t) })
		t.after(() => plain.close())
		assert.equal((await fetch(new URL('/catalogue', plain.url))).status, 404)
		const ui = await startSourceUi({ workspace: directory(t), catalogue: true })
		t.after(() => ui.close())
		const pinned = screenshots ? await chromium.launch() : browser!
		if (screenshots) t.after(() => pinned.close())
		const changed: string[] = []
		for (const theme of ['light', 'dark']) {
			const context = await pinned.newContext({ viewport: { width: 1280, height: 900 }, reducedMotion: 'reduce' })
			t.after(() => context.close())
			await context.addCookies([{ name: 'checkmate_theme', value: theme, url: ui.url }])
			await context.route('**/settings/harness/models?*', (route) =>
				route.fulfill({ json: { models: [], primary: null, defaultModel: null } })
			)
			const page = await context.newPage()
			const errors: string[] = []
			page.on('console', (message) => {
				if (message.type() === 'error') errors.push(message.text())
			})
			page.on('pageerror', (error) => errors.push(String(error)))
			await page.goto(new URL('/catalogue', ui.url).href)
			await page.locator('[data-live]:not([hidden])').first().waitFor()
			assert.equal(await page.locator('html').getAttribute('data-theme'), theme)
			if (screenshots) {
				await page.evaluate(() => document.fonts.ready)
				const height = await page.evaluate(() => document.documentElement.scrollHeight)
				await page.setViewportSize({ width: 1280, height: height + 200 })
				await page.mouse.move(0, 0)
			}
			for (const name of components) {
				const entry = page.locator(`[data-catalogue-entry="${name}"]`)
				assert.equal(await entry.count(), 1, `${name} has no catalogue entry in ${theme}`)
				assert.ok(await entry.locator('[data-catalogue-example]').count(), `${name} has no example in ${theme}`)
				if (screenshots) {
					const actual = await entry.screenshot({ animations: 'disabled', caret: 'hide' })
					const difference = checkScreenshot(theme, name, actual)
					if (difference) changed.push(difference)
				}
			}
			assert.deepEqual(errors, [], `console errors in ${theme}`)
		}
		assert.deepEqual(
			changed,
			[],
			`Catalogue screenshots differ from test/e2e/catalogue/. The new ones are in ${actuals}.`
		)
	}
)
