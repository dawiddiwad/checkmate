import test from 'node:test'
import assert from 'node:assert/strict'
import type { TestContext } from 'node:test'
import { request } from 'node:http'
import { realpathSync } from 'node:fs'
import { run } from '../plugin/src/cli.ts'
import { closeStore } from '../plugin/src/store.ts'
import { openPlan } from '../plugin/src/plans.ts'
import { startUi } from '../plugin/src/ui/server.ts'
import { testLevels } from '../plugin/src/levels.ts'
import { actor, directory, planRequest, store, target } from './support.ts'
import { fakeClaude } from './claude.ts'

const first = '11111111-1111-4111-8111-111111111111'
const second = '22222222-2222-4222-8222-222222222222'
const stacks = {
	kind: 'defect',
	title: 'Coupon stacks',
	severity: 'high',
	expected: '450',
	actual: '400',
	steps: 'Apply two coupons.',
}
const tax = {
	kind: 'defect',
	title: 'Wrong tax on shipping',
	severity: 'medium',
	expected: 'No tax',
	actual: 'Tax 23%',
	steps: 'Ship to PL.',
}
const question = { kind: 'question', id: 'Q1', question: 'Can a coupon apply to a sale item?' }
const allow = ['--allow', 'Read', '--allow', 'Bash']

function setup(t: TestContext) {
	const workspace = realpathSync(directory(t))
	const opened = store(t, workspace)
	target(opened)
	openPlan(opened, actor, { planId: 'checkout', target: 'checkout-local@1', request: planRequest() })
	closeStore(opened)
	const fake = fakeClaude(t, {
		recorder: { [first]: [stacks, question], [second]: [tax] },
		merger: [],
		verifier: [
			{ id: 'a1/D1', seen: true, saw: 'The total is 400 again.' },
			{ id: 'a2/D1', seen: false, saw: 'Shipping has no tax.' },
		],
	})
	const command = (args: string[]) => {
		const outcome = run([...args, '--workspace', workspace, '--json'], {
			cwd: workspace,
			env: { ...process.env, CHECKMATE_ACTOR: actor, ...fake.env },
			stdin: () => '',
		})
		return { code: outcome.code, body: JSON.parse(outcome.output), output: outcome.output }
	}
	return { workspace, command, ...fake }
}

function recorded(t: TestContext) {
	const context = setup(t)
	const { command } = context
	assert.equal(command(['explore', 'open', 'checkout', '--build', 'b1']).code, 0)
	assert.equal(command(['record', 'x-1', '--explorer', 'a1', '--session', first]).code, 0)
	assert.equal(command(['record', 'x-1', '--explorer', 'a2', '--session', second]).code, 0)
	const finished = command(['explore', 'finish', 'x-1', ...allow])
	assert.equal(finished.code, 0, finished.output)
	const done = command(['explore', 'wait', 'x-1', '--timeout', '60'])
	assert.equal(done.code, 0, done.output)
	return { ...context, done }
}

test('explore finish merges the reports, verifies single reports, and keeps a refuted claim as unresolved', (t) => {
	const { command, called, done } = recorded(t)
	assert.deepEqual(
		done.body.phases.map((item: { step: string; status: string }) => [item.step, item.status]),
		[
			['merge', 'completed'],
			['verify', 'completed'],
		]
	)
	const calls = called()
	const merger = calls.find((call) => call.role === 'merger')
	const verifier = calls.find((call) => call.role === 'verifier')
	assert.match(merger.prompt, /^Merge the reports of independent testers of build b1\./)
	assert.match(merger.prompt, /a1\/D1 \(high\): Coupon stacks/)
	assert(!merger.args.includes('--allowedTools'), 'the merger has no tool rules')
	assert.equal(merger.args[merger.args.indexOf('--model') + 1], testLevels.standard.model)
	assert.match(verifier.prompt, /^Reproduce each problem below on the application\./)
	assert.match(verifier.prompt, /- a2\/D1: Wrong tax on shipping Steps: Ship to PL\./)
	assert.doesNotMatch(verifier.prompt, /checkmate/i)
	assert.match(
		verifier.prompt,
		/\nUse the existing records of the application, and make new records when a case needs them\. Start each name or value that you make with qa-x-1-verify-\.\n/
	)
	assert(verifier.args.includes('--allowedTools'))
	assert.deepEqual(verifier.env, [])
	const shown = command(['explore', 'show', 'x-1']).body
	const claims = Object.fromEntries(
		shown.claims.map((claim: { id: string; state: string; reason: string | null }) => [
			claim.id,
			[claim.state, claim.reason],
		])
	)
	assert.deepEqual(claims, {
		'a1/D1': ['confirmed', null],
		'a2/D1': ['unresolved', 'The verifier did not see it: Shipping has no tax.'],
	})
})

test('the oracle sees one list of gaps and questions, answers a question as a gap, and decides a claim', (t) => {
	const { command, workspace } = recorded(t)
	const inbox = command(['inbox']).body
	assert.deepEqual(
		inbox.gaps.map((gap: { gapId: string; explorationId: string }) => [gap.gapId, gap.explorationId]),
		[['a1/Q1', 'x-1']]
	)
	assert.deepEqual(
		inbox.claims.map((claim: { claimId: string; state: string }) => [claim.claimId, claim.state]),
		[['a2/D1', 'unresolved']]
	)
	const text = run(['inbox', '--workspace', workspace], { cwd: workspace, env: {}, stdin: () => '' }).output
	assert.match(text, /\ncheckout\/a1\/Q1\tquestion\tnon_blocking\tx-1\tCan a coupon apply to a sale item\?/)
	assert.match(text, /\ncheckout\/a2\/D1\tclaim\tunresolved\tmedium\tWrong tax on shipping/)
	const status = command(['status', 'checkout']).body
	assert.deepEqual([status.state, status.waitsOn], ['needs_triage', 'oracle'])
	const answered = command([
		'gap',
		'answer',
		'checkout',
		'a1/Q1',
		'--kind',
		'clarify',
		'--value',
		'No. A coupon never applies to a sale item.',
		'--source',
		'po',
		'--rationale',
		'Pricing rule.',
	])
	assert.equal(answered.code, 0, answered.output)
	assert.equal(
		command(['gap', 'answer', 'checkout', 'a1/Q9', '--kind', 'defer', '--value', 'x', '--rationale', 'y']).code,
		1
	)
	assert.equal(command(['claim', 'reject', 'checkout', 'a2/D1', '--rationale', 'Shipping is tax free.']).code, 0)
	const after = command(['inbox']).body
	assert.deepEqual([after.gaps.length, after.claims.length], [0, 0])
	const fix = command(['status', 'checkout']).body
	assert.deepEqual([fix.state, fix.waitsOn], ['defects_open', 'factory'])
	assert.deepEqual(
		fix.claims.map((claim: { claimId: string; state: string }) => [claim.claimId, claim.state]),
		[['a1/D1', 'confirmed']]
	)
	assert.equal(command(['claim', 'accept', 'checkout', 'a1/D1', '--rationale', 'Real defect.']).body.claimId, 'a1/D1')
	assert.match(
		command(['claim', 'accept', 'checkout', 'a9/D1', '--rationale', 'x']).body.reasons[1],
		/Unknown claim a9\/D1/
	)
	const shown = command(['explore', 'show', 'x-1']).body
	assert.deepEqual(
		shown.claims.map((claim: { id: string; state: string }) => [claim.id, claim.state]),
		[
			['a1/D1', 'accepted'],
			['a2/D1', 'rejected'],
		]
	)
	assert.equal(shown.questions[0].answer, 'No. A coupon never applies to a sale item.')
	const report = command(['export', 'exploration', 'x-1', '--format', 'md']).body.content
	assert.match(report, /^# Exploration x-1\n/)
	assert.match(report, /\| a2\/D1 \| rejected \| medium \| a2 \| Wrong tax on shipping \| Shipping is tax free\. \|/)
})

function get(
	url: string,
	path: string,
	form?: Record<string, string>
): Promise<{ status: number; body: string; location?: string }> {
	const body = form ? new URLSearchParams(form).toString() : undefined
	return new Promise((resolve, reject) => {
		const req = request(
			new URL(path, url),
			{
				method: body ? 'POST' : 'GET',
				headers: body
					? { 'Content-Type': 'application/x-www-form-urlencoded', Cookie: 'checkmate_actor=po' }
					: {},
			},
			(res) => {
				const chunks: Buffer[] = []
				res.on('data', (chunk) => chunks.push(chunk))
				res.on('end', () =>
					resolve({
						status: res.statusCode ?? 0,
						body: Buffer.concat(chunks).toString(),
						location: res.headers.location,
					})
				)
			}
		)
		req.on('error', reject)
		req.end(body)
	})
}

test('the review UI shows the exploration, answers a question, and decides a claim', async (t) => {
	const { workspace, command } = recorded(t)
	const ui = await startUi({ workspace, defaultActor: '' })
	t.after(() => ui.close())
	const inbox = await get(ui.url, '/')
	assert.match(inbox.body, /href="\/explorations\/x-1\/questions\/a1\/Q1#answer"/)
	assert.match(inbox.body, /Claims to decide · 1/)
	const page = await get(ui.url, '/explorations/x-1')
	assert.equal(page.status, 200)
	assert.match(page.body, /Exploration x-1/)
	assert.match(page.body, /The verifier did not see it: Shipping has no tax\./)
	const form = await get(ui.url, '/explorations/x-1/questions/a1/Q1')
	const csrf = /name="csrf" value="([^"]+)"/.exec(form.body)![1]
	const answered = await get(ui.url, '/explorations/x-1/questions/a1/Q1', {
		csrf,
		kind: 'defer',
		value: 'Not in this scope.',
		rationale: 'Later.',
	})
	assert.equal(answered.status, 303)
	const decided = await get(ui.url, '/explorations/x-1/claims/a2/D1', {
		csrf,
		verdict: 'approved',
		rationale: 'Seen by the PM.',
	})
	assert.equal(decided.status, 303)
	const claims = command(['explore', 'show', 'x-1']).body.claims
	assert.equal(claims.find((claim: { id: string }) => claim.id === 'a2/D1').state, 'accepted')
	assert.equal(command(['inbox']).body.gaps.length, 0)
	const report = await get(ui.url, '/explorations/x-1/export.json')
	assert.equal(JSON.parse(report.body).explorationId, 'x-1')
})

test('the merge joins questions that ask the same thing, one answer answers each, and status does not wait on a non-blocking question', (t) => {
	const context = setup(t)
	context.reply({
		recorder: {
			[first]: [stacks, { kind: 'question', id: 'Q1', question: 'How is the discount rounded?' }],
			[second]: [
				{ ...stacks, title: 'Two coupons stack' },
				{ kind: 'question', id: 'Q1', question: 'Which step rounds the discount?' },
				{ kind: 'question', id: 'Q2', question: 'Can a zero coupon apply?' },
			],
		},
		merger: [
			{ kind: 'issue', title: 'Coupons stack', severity: 'high', reports: ['a1/D1', 'a2/D1'] },
			{ kind: 'topic', question: 'Which step rounds the discount, and how?', members: ['a1/Q1', 'a2/Q1'] },
		],
	})
	const { command } = context
	command(['explore', 'open', 'checkout', '--build', 'b1'])
	command(['record', 'x-1', '--explorer', 'a1', '--session', first])
	command(['record', 'x-1', '--explorer', 'a2', '--session', second])
	command(['explore', 'finish', 'x-1', '--level', 'smoke'])
	assert.equal(command(['explore', 'wait', 'x-1', '--timeout', '60']).code, 0)
	const questions = command(['explore', 'show', 'x-1']).body.questions
	assert.deepEqual(
		questions.map((item: { id: string; members: string[] }) => [item.id, item.members]),
		[
			['merge/T1', ['a1/Q1', 'a2/Q1']],
			['a2/Q2', ['a2/Q2']],
		]
	)
	assert.deepEqual(
		command(['inbox']).body.gaps.map((gap: { gapId: string }) => gap.gapId),
		['a2/Q2', 'merge/T1']
	)
	const status = command(['status', 'checkout']).body
	assert.deepEqual([status.state, status.waitsOn], ['defects_open', 'factory'])
	assert.deepEqual(status.next, [
		'1 confirmed or observed claim ready for the factory: checkmate claim list checkout',
		'2 open questions can be answered at any time and do not block: checkmate gap answer checkout <questionId> --kind <kind> --value "<answer>" --source "<source>" --rationale "<why>"',
		'Store the claims as tests: checkmate harvest x-1',
		'Retest on the next build: checkmate test checkout --build <new build> --allow Read --allow Bash',
	])
	assert.equal(command(['claim', 'list', 'checkout']).body.claims[0].id, 'merge/I1')
	const answered = command([
		'gap',
		'answer',
		'checkout',
		'merge/T1',
		'--kind',
		'defer',
		'--value',
		'Round the total once.',
		'--rationale',
		'Rule.',
	])
	assert.equal(answered.code, 0, answered.output)
	assert.deepEqual(
		command(['inbox']).body.gaps.map((gap: { gapId: string }) => gap.gapId),
		['a2/Q2']
	)
})

test('a blocking question makes the plan wait on the oracle', (t) => {
	const context = setup(t)
	context.reply({ recorder: { [first]: [{ kind: 'question', question: 'Which tax rate?', blocking: true }] } })
	const { command } = context
	command(['explore', 'open', 'checkout', '--build', 'b1'])
	command(['record', 'x-1', '--explorer', 'a1', '--session', first])
	const status = command(['status', 'checkout']).body
	assert.deepEqual(
		[status.state, status.waitsOn, status.why],
		['needs_triage', 'oracle', ['a1/Q1 blocks testing: Which tax rate?']]
	)
	assert.equal(command(['inbox']).body.gaps[0].severity, 'blocking')
})

test('a report left out of the merge goes to one more round, and a defect of a later build joins its claim', (t) => {
	const context = setup(t)
	const third = '33333333-3333-4333-8333-333333333333'
	context.reply({
		recorder: {
			[first]: [stacks],
			[second]: [{ ...stacks, title: 'Coupon stacks again', steps: 'Apply two coupons together.' }],
			[third]: [{ ...stacks, title: 'Two coupons still stack', steps: 'Apply two coupons.' }],
		},
		merger: [],
		repair: [{ kind: 'issue', title: 'Coupons stack', severity: 'high', reports: ['a1/D1', 'a2/D1'] }],
	})
	const { command, called } = context
	command(['explore', 'open', 'checkout', '--build', 'b1'])
	command(['record', 'x-1', '--explorer', 'a1', '--session', first])
	command(['record', 'x-1', '--explorer', 'a2', '--session', second])
	command(['explore', 'finish', 'x-1', '--level', 'smoke'])
	assert.equal(command(['explore', 'wait', 'x-1', '--timeout', '60']).code, 0)
	const again = called().find((call) => call.role === 'repair')
	assert.match(
		again.prompt,
		/^These reports are in no issue, but they look like other reports or issues:\n- a1\/D1: Coupon stacks Looks like: a2\/D1 \(Coupon stacks again; some of the same words and steps\)/
	)
	assert.deepEqual(
		command(['claim', 'list', 'checkout']).body.claims.map((claim: { id: string }) => claim.id),
		['merge/I1']
	)
	context.reply({
		recorder: { [third]: [{ ...stacks, title: 'Two coupons still stack', steps: 'Apply two coupons.' }] },
		merger: [
			{
				kind: 'issue',
				supersedes: 'merge/I1',
				title: 'Coupons stack',
				severity: 'high',
				reports: ['a1/D1', 'a2/D1', 'a1/D2'],
			},
		],
	})
	command(['explore', 'open', 'checkout', '--build', 'b2'])
	command(['record', 'x-2', '--explorer', 'a1', '--session', third])
	command(['explore', 'finish', 'x-2', '--level', 'smoke'])
	assert.equal(command(['explore', 'wait', 'x-2', '--timeout', '60']).code, 0)
	const merger = called().find((call) => call.role === 'merger')
	assert.match(merger.prompt, /\nThe issues of earlier builds\. When a report of this build describes one of them/)
	assert.match(merger.prompt, /\nmerge\/I1: Coupons stack Expected: 450 Actual: 400/)
	const claims = command(['claim', 'list', 'checkout']).body.claims
	assert.deepEqual(
		claims.map((claim: { id: string; build: string; reports: string[] }) => [claim.id, claim.build, claim.reports]),
		[['merge/I1', 'b1', ['a1/D1', 'a2/D1', 'a1/D2']]]
	)
	assert.deepEqual(claims[0].statuses.b2, { status: 'not_fixed', basis: 'reported' })
})
