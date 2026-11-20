import test from 'node:test'
import assert from 'node:assert/strict'
import type { TestContext } from 'node:test'
import { existsSync, realpathSync } from 'node:fs'
import { join } from 'node:path'
import { run } from '../plugin/src/cli.ts'
import { startExploration } from '../plugin/src/explorers.ts'
import { closeStore, openStore } from '../plugin/src/store.ts'
import { workDenyRules } from '../plugin/src/sessions.ts'
import { saveModels, saveWorkspaceHarness } from '../plugin/src/settings.ts'
import { actor, directory, plan, store, target } from './support.ts'
import { fakeClaude } from './claude.ts'

const stacks = { kind: 'defect', title: 'Coupon stacks', severity: 'high', expected: '450', actual: '400' }
const sale = {
	kind: 'defect',
	title: 'Coupon applies to a sale item',
	severity: 'medium',
	expected: '90',
	actual: '80',
}
const question = { kind: 'question', id: 'Q1', question: 'Can a coupon apply to a sale item?' }
const allow = ['--allow', 'Read', '--allow', 'Bash']
const after = (args: string[], flag: string) => args[args.indexOf(flag) + 1]

function setup(t: TestContext, harness?: 'pi') {
	const workspace = realpathSync(directory(t))
	const opened = store(t, workspace)
	target(opened)
	plan(opened)
	closeStore(opened)
	const fake = fakeClaude(t, { explorer: 'Tested.', recorder: [stacks, question], merger: [] }, harness)
	const command = (args: string[], selected: 'pi' | 'claude' | undefined = harness) => {
		const outcome = run([...args, '--workspace', workspace, '--json'], {
			cwd: workspace,
			env: { ...process.env, CHECKMATE_ACTOR: actor, CHECKMATE_HARNESS: selected, ...fake.env },
			stdin: () => '',
		})
		return { code: outcome.code, body: JSON.parse(outcome.output), output: outcome.output }
	}
	const text = (args: string[]) =>
		run([...args, '--workspace', workspace], { cwd: workspace, env: {}, stdin: () => '' }).output
	const wait = (id: string) => command(['explore', 'wait', id, '--timeout', '60'])
	return { workspace, command, text, wait, ...fake }
}

const answer = ['gap', 'answer', 'checkout', 'a1/Q1', '--kind', 'defer', '--value', 'No.', '--rationale', 'Rule.']

test('Pi follow-up reopens the test session and records the new entries', (t) => {
	const { command, wait, reply, called, workspace, env } = setup(t, 'pi')
	const model = 'openrouter/z-ai/glm-5.3-flash'
	const models = [
		{ provider: 'provider', id: 'run-default', reasoning: true },
		{ provider: 'openrouter', id: 'z-ai/glm-5.3-flash', reasoning: true },
	]
	reply({ recorder: [stacks, question], models })
	const configured = openStore(workspace)
	saveModels(configured, actor, 'pi', '', 'provider/run-default', undefined, 'low')
	startExploration(
		configured,
		actor,
		{
			planId: 'checkout',
			build: 'b1',
			level: 'smoke',
			allow: ['Read', 'Bash'],
			claudeArgs: [],
			testerModels: { a1: model },
			testerEfforts: { a1: 'high' },
		},
		{ ...env, CHECKMATE_HARNESS: 'pi' }
	)
	closeStore(configured)
	assert.equal(wait('x-1').body.state, 'completed')
	const tester = called().find((call) => call.role === 'tester')
	assert.equal(command(answer).code, 0)
	const opened = openStore(workspace)
	saveWorkspaceHarness(opened, actor, 'claude')
	saveModels(opened, actor, 'pi', '', 'another-model')
	closeStore(opened)
	reply({ recorder: [stacks, question, sale], models })
	assert.equal(command(['explore', 'follow', 'x-1'], 'claude').code, 0)
	const done = wait('x-1')
	assert.equal(done.body.follow, 'completed')
	const calls = called()
	assert.equal(after(tester.args, '--model'), model)
	assert.equal(after(tester.args, '--thinking'), 'high')
	for (const role of ['follower', 'recorder', 'merger']) {
		const call = calls.find((item) => item.role === role)
		assert.ok(call)
		assert.equal(after(call.args, '--model'), role === 'merger' ? 'provider/run-default' : model)
		assert.equal(after(call.args, '--thinking'), role === 'merger' ? 'low' : 'high')
	}
	assert.equal(after(calls.find((call) => call.role === 'follower').args, '--session'), tester.session)
	assert.equal(after(calls.find((call) => call.role === 'recorder').args, '--fork'), tester.session)
	const record = command(['query', "SELECT detail FROM exploration_events WHERE step = 'record'"]).body.rows
	assert.equal(JSON.parse(record.at(-1).detail).saved, 1)
})

test('Pi follow-up keeps the effort of a session started with the Pi default', (t) => {
	const { command, wait, reply, called, workspace } = setup(t, 'pi')
	const configured = openStore(workspace)
	saveModels(configured, actor, 'pi', '', '', undefined, 'high')
	closeStore(configured)
	reply({
		models: [{ provider: 'host', id: 'original', reasoning: true }],
		recorder: [stacks, question],
	})
	assert.equal(command(['explore', 'start', 'checkout', '--build', 'b1', '--level', 'smoke', ...allow]).code, 0)
	assert.equal(wait('x-1').body.state, 'completed')
	const tester = called().find((call) => call.role === 'tester')
	assert.ok(tester)
	assert(!tester.args.includes('--model'))
	assert.equal(after(tester.args, '--thinking'), 'high')
	assert.equal(command(answer).code, 0)
	reply({
		models: [{ provider: 'host', id: 'new-default', reasoning: false }],
		recorder: [stacks, question, sale],
	})
	assert.equal(command(['explore', 'follow', 'x-1']).code, 0)
	assert.equal(wait('x-1').body.follow, 'completed')
	const calls = called()
	for (const role of ['follower', 'recorder']) {
		const call = calls.find((item) => item.role === role)
		assert.ok(call)
		assert(!call.args.includes('--model'))
		assert.equal(after(call.args, '--thinking'), 'high')
	}
})

test('an explicit Claude follow-up model also applies to the forked recorder', (t) => {
	const { command, wait, called, reply } = setup(t)
	assert.equal(command(['explore', 'start', 'checkout', '--build', 'b1', '--level', 'smoke', ...allow]).code, 0)
	assert.equal(wait('x-1').body.state, 'completed')
	called()
	assert.equal(command(answer).code, 0)
	reply({ recorder: [stacks, question, sale] })
	assert.equal(command(['explore', 'follow', 'x-1', '--claude-arg', '--model', '--claude-arg', 'sonnet']).code, 0)
	assert.equal(wait('x-1').body.follow, 'completed')
	const calls = called()
	for (const role of ['follower', 'recorder'])
		assert.equal(after(calls.find((call) => call.role === role).args, '--model'), 'sonnet')
})

test('explore follow refuses an exploration that is not completed or that has no new answer', (t) => {
	const { command, wait, reply } = setup(t)
	command(['explore', 'start', 'checkout', '--build', 'b1', '--level', 'smoke', ...allow])
	wait('x-1')
	const none = command(['explore', 'follow', 'x-1'])
	assert.equal(none.code, 1)
	assert.match(none.body.reasons[1], /^Exploration x-1 has no answer that a follow-up has not used\.$/)
	assert.match(none.body.hint, /^Answer a question of the exploration first: checkmate gap answer checkout/)
	reply({ explorer: '!crash' })
	command(['explore', 'start', 'checkout', '--build', 'b2', '--level', 'smoke', ...allow])
	wait('x-2')
	const failed = command(['explore', 'follow', 'x-2'])
	assert.match(failed.body.reasons[1], /^Exploration x-2 is failed\. A follow-up needs a completed exploration\.$/)
	assert.match(failed.body.hint, /^Start a new test: checkmate test checkout/)
	assert.equal(command(['explore', 'follow', 'x-9']).code, 1)
})

test('explore follow resumes each session with the answers, records only new entries, and joins claims', (t) => {
	const { command, text, wait, reply, called, workspace } = setup(t)
	command(['explore', 'start', 'checkout', '--build', 'b1', '--level', 'smoke', ...allow])
	wait('x-1')
	const [tester] = called().filter((call) => call.role === 'tester')
	assert.equal(command(answer).code, 0)
	assert.equal(command(['status', 'checkout']).body.next[0], '1 unused answer of x-1: checkmate explore follow x-1')

	reply({ follower: '!fail' })
	assert.equal(command(['explore', 'follow', 'x-1']).code, 0)
	const failed = wait('x-1')
	assert.deepEqual(
		[failed.body.outcome, failed.body.state, failed.body.follow, failed.body.followReason, failed.body.workFolder],
		['done', 'completed', 'failed', 'No explorer session of the follow-up was recorded.', '.checkmate/work/x-1']
	)
	assert.equal(command(['claim', 'list', 'checkout']).body.claims.length, 1)
	const lost = failed.body.phases.find((item: { step: string }) => item.step === 'followed')
	assert.match(lost.detail.skipped[0], /^The session of a1 could not resume: claude exited with code 2/)
	assert.deepEqual(
		called().map((call) => call.role),
		['follower']
	)
	assert.equal(command(['status', 'checkout']).body.next[0], '1 unused answer of x-1: checkmate explore follow x-1')

	reply({
		follower: 'Tested the answers.',
		recorder: [stacks, question, sale],
		merger: [{ kind: 'issue', title: 'Coupons apply too often', severity: 'high', reports: ['a1/D1', 'a1/D2'] }],
	})
	const started = command(['explore', 'follow', 'x-1'])
	assert.equal(started.code, 0, started.output)
	assert.deepEqual([started.body.answers, started.body.followSeconds], [1, 300])
	assert.equal(wait('x-1').body.outcome, 'done')
	const calls = called()
	assert.deepEqual(
		calls.map((call) => call.role),
		['follower', 'recorder', 'merger']
	)
	const [follower, recorder, merger] = calls
	assert.equal(
		follower.prompt,
		[
			'The owner of the product answered these questions:',
			'1. Can a coupon apply to a sale item? Answer: No.',
			'',
			'Test the points that these answers decide, on the same build.',
			'Your work folder is .checkmate/work/x-1/a1/ again, and it is empty. Put each file that you or your tools make in it.',
			'Write .checkmate/work/x-1/a1/follow-up-report.md with only what this turn adds: each new defect in the same form as in your report, and for each earlier unclear point that an answer settles, one line that says what is now known.',
			'You have 300 seconds for this turn.',
		].join('\n')
	)
	assert.equal(after(follower.args, '--resume'), after(tester.args, '--resume'))
	assert.equal(after(follower.args, '--model'), after(tester.args, '--model'))
	assert.equal(after(follower.args, '--settings'), JSON.stringify({ permissions: { deny: workDenyRules([]) } }))
	assert.deepEqual(follower.args, tester.args)
	assert.doesNotMatch(follower.prompt.replaceAll('.checkmate/work/', ''), /checkmate|journal|recorder|\brecord\b/i)
	assert.equal(after(recorder.args, '--resume'), after(tester.args, '--resume'))
	assert.match(
		recorder.prompt,
		/ Reply with only the entries that are not in this list:\nD1 defect: Coupon stacks\nQ1 question: Can a coupon apply to a sale item\?$/
	)
	assert.match(merger.prompt, /\na1\/D2 \(medium\): Coupon applies to a sale item/)
	assert.doesNotMatch(merger.prompt, /\na1\/D1 \(high\)/)
	assert.match(merger.prompt, /\nThe issues found before\.[^\n]*\na1\/D1: Coupon stacks/)

	const record = command(['query', "SELECT detail FROM exploration_events WHERE step = 'record'"]).body.rows
	assert.deepEqual([JSON.parse(record.at(-1).detail).saved, JSON.parse(record.at(-1).detail).repeated], [1, 2])
	const shown = command(['explore', 'show', 'x-1']).body
	assert.deepEqual(
		shown.claims.map((claim: { id: string; reports: string[] }) => [claim.id, claim.reports]),
		[['merge/I1', ['a1/D1', 'a1/D2']]]
	)
	assert.deepEqual(
		shown.phases.map((item: { step: string; status: string }) => [item.step, item.status]),
		[
			['follow', 'started'],
			['followed', 'failed'],
			['follow', 'started'],
			['merge', 'completed'],
			['followed', 'completed'],
		]
	)
	assert.match(text(['explore', 'status', 'x-1']), /\nfollow\tstarted\tanswers=1\n/)
	assert.match(text(['explore', 'show', 'x-1']), /\nfollowed\tcompleted\tanswers=1(\n|$)/)

	assert.deepEqual(
		shown.files.map((file: { phase: string; name: string }) => [file.phase, file.name]),
		[
			['test', 'plan.md'],
			['test', 'report.md'],
			['follow-1', 'follow-up-report.md'],
			['follow-2', 'follow-up-report.md'],
		]
	)
	assert(!existsSync(join(workspace, '.checkmate', 'work', 'x-1')), 'work folder removed after the follow-up')
	const used = command(['explore', 'follow', 'x-1'])
	assert.match(used.body.reasons[1], /has no answer that a follow-up has not used/)
	assert(!command(['status', 'checkout']).body.next.some((line: string) => /explore follow/.test(line)))
})

test('a follow-up defect joins the claim that another explorer reported first', (t) => {
	const { command, wait, reply, called } = setup(t)
	reply({
		explorer: 'Tested.',
		recorder: [stacks, question],
		merger: [{ kind: 'issue', title: 'Coupons stack', severity: 'high', reports: ['a1/D1', 'a2/D1'] }],
	})
	command(['explore', 'start', 'checkout', '--build', 'b1', '--level', 'smoke', '--explorers', '2', ...allow])
	assert.equal(wait('x-1').body.outcome, 'done')
	const sessions = Object.fromEntries(
		called()
			.filter((call) => call.role === 'explorer')
			.map((call) => [/\.checkmate\/work\/x-1\/(a\d)\//.exec(call.prompt)![1], after(call.args, '--session-id')])
	)
	assert.equal(command(answer).code, 0)
	const again = { ...stacks, title: 'Two coupons still stack on a sale item' }
	reply({
		follower: 'Tested the answers.',
		recorder: { [sessions.a1]: [stacks, question], [sessions.a2]: [stacks, question, again] },
		merger: [{ kind: 'issue', title: 'Coupons stack', severity: 'high', reports: ['a1/D1', 'a2/D2'] }],
	})
	command(['explore', 'follow', 'x-1'])
	assert.equal(wait('x-1').body.outcome, 'done')
	const merger = called().find((call) => call.role === 'merger')
	assert.match(merger.prompt, /\nmerge\/I1 \(reports a1\/D1, a2\/D1\): Coupons stack/)
	assert.deepEqual(
		command(['claim', 'list', 'checkout']).body.claims.map((claim: { id: string; reports: string[] }) => [
			claim.id,
			claim.reports,
		]),
		[['merge/I1', ['a1/D1', 'a2/D1', 'a2/D2']]]
	)
})
