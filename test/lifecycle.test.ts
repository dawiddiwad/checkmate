import test from 'node:test'
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { existsSync, realpathSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { closeStore } from '../plugin/src/store.ts'
import { running } from '../plugin/src/sessions.ts'
import { actor, directory, plan, root, store, target } from './support.ts'
import { fakeClaude } from './claude.ts'

const question = { kind: 'question', id: 'Q1', question: 'Can the coupon stack?', blocking: true }
const secondQuestion = { kind: 'question', id: 'Q2', question: 'Does loyalty apply?', blocking: true }

test('public exploration and follow-up keep partial Pi usage, cancel safely, and retry', (t) => {
	const workspace = realpathSync(directory(t))
	const opened = store(t, workspace)
	target(opened)
	plan(opened)
	closeStore(opened)
	const host = fakeClaude(t, { explorer: 'Studied.', tester: '!partial-sleep', recorder: [question] }, 'pi')
	const clock = join(workspace, 'clock.cjs')
	writeFileSync(
		clock,
		`if (process.argv.includes('drive')) {
 const schedule = global.setTimeout
 global.setTimeout = (fn, delay, ...args) => schedule(fn, delay === 60000 ? 4000 : delay, ...args)
}`
	)
	const env = {
		...process.env,
		...host.env,
		CHECKMATE_ACTOR: actor,
		CHECKMATE_HARNESS: 'pi',
		FAKE_FOLLOW_STRAY: '1',
		NODE_OPTIONS: `--require=${clock}`,
	}
	const command = (args: string[]) => {
		const child = spawnSync(
			process.execPath,
			[join(root, 'plugin/dist/checkmate.js'), ...args, '--workspace', workspace, '--json'],
			{ cwd: workspace, env, encoding: 'utf8', timeout: 70000 }
		)
		assert.ok(child.stdout, child.stderr)
		return { code: child.status, body: JSON.parse(child.stdout), output: child.stdout + child.stderr }
	}
	const ok = (args: string[]) => {
		const result = command(args)
		assert.equal(result.code, 0, result.output)
		return result.body
	}
	const started = ok([
		'explore',
		'start',
		'checkout',
		'--build',
		'b1',
		'--level',
		'smoke',
		'--timeout',
		'60',
		'--allow',
		'Read',
		'--allow',
		'Bash',
	])
	assert.equal(started.explorationId, 'x-1')
	const first = ok(['explore', 'wait', 'x-1', '--timeout', '60'])
	assert.deepEqual(
		[first.state, first.explorers[0].ended, first.explorers[0].recorded],
		['completed', 'interrupted', 'completed']
	)
	assert.equal(existsSync(join(workspace, '.checkmate/work/x-1')), false)
	const events = (step: string) =>
		ok(['query', `SELECT status, detail FROM exploration_events WHERE step = '${step}' ORDER BY rowid`]).rows.map(
			(row: { status: string; detail: string }) => ({ status: row.status, ...JSON.parse(row.detail) })
		)
	const ended = events('end')[0]
	assert.equal(ended.costPartial, true)
	assert.equal(ended.costUsd, 0.125)
	assert.ok(ended.observedModels.includes('fixture/partial'))
	assert.match(ended.reason, /did not end in 60 seconds/)
	const firstCalls = host.called()
	assert.deepEqual(
		firstCalls.map((call) => call.role),
		['explorer', 'tester', 'recorder']
	)
	assert(firstCalls.every((call) => !running(call.pid)))
	assert.equal(
		ok([
			'gap',
			'answer',
			'checkout',
			'a1/Q1',
			'--kind',
			'clarify',
			'--value',
			'No.',
			'--source',
			'owner',
			'--rationale',
			'Owner answer.',
		]).status,
		'completed'
	)
	host.reply({
		follower: '!partial-sleep',
		recorder: [question, secondQuestion, { kind: 'note', text: 'Follow-up evidence.' }],
	})
	ok(['explore', 'follow', 'x-1', '--timeout', '60'])
	const followed = ok(['explore', 'wait', 'x-1', '--timeout', '60'])
	assert.equal(followed.follow, 'completed')
	assert.equal(existsSync(join(workspace, '.checkmate/work/x-1')), false)
	const follow = events('follow-turn')[0]
	assert.deepEqual([follow.status, follow.costUsd, follow.costPartial], ['interrupted', 0.125, true])
	assert.ok(follow.observedModels.includes('fixture/partial'))
	const activities = events('activity')
	assert.ok(
		activities.some(
			(item: { turn: string; activity: string }) => item.turn === 'test' && item.activity.includes('report.md')
		)
	)
	assert.ok(
		activities.some(
			(item: { turn: string; activity: string }) =>
				item.turn === 'follow-up' && item.activity.includes('follow-up-report.md')
		)
	)
	const stray = events('stray')
	assert.ok(
		stray.some(
			(item: { turn: string; names: string[] }) =>
				item.turn === 'follow-up' && item.names.includes('follow-stray.txt')
		)
	)
	const calls = host.called()
	assert.deepEqual(
		calls.map((call) => call.role),
		['follower', 'recorder']
	)
	assert(calls.every((call) => !running(call.pid)))
	assert(calls[0].prompt.includes('Answer: No.'))
	assert.equal(calls[0].args[calls[0].args.indexOf('--session') + 1], firstCalls[1].session)
	assert.equal(calls[1].args[calls[1].args.indexOf('--fork') + 1], firstCalls[1].session)
	const files = ok(['explore', 'show', 'x-1']).files
	assert(files.some((file: { phase: string; name: string }) => file.phase === 'test' && file.name === 'report.md'))
	assert(
		files.some(
			(file: { phase: string; name: string }) => file.phase === 'follow-1' && file.name === 'follow-up-report.md'
		)
	)
	ok([
		'gap',
		'answer',
		'checkout',
		'a1/Q2',
		'--kind',
		'clarify',
		'--value',
		'Yes.',
		'--source',
		'owner',
		'--rationale',
		'Owner answer.',
	])
	host.reply({ follower: '!partial-sleep', recorder: [question, secondQuestion] })
	ok(['explore', 'follow', 'x-1', '--timeout', '60'])
	const until = Date.now() + 10000
	let active: ReturnType<typeof host.called>[number] | undefined
	while (!active && Date.now() < until) {
		active = host.called().find((call) => call.role === 'follower')
		if (!active) Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 20)
	}
	assert.ok(active, 'The follow-up host did not start.')
	const stopped = ok(['explore', 'stop', 'x-1', '--reason', 'Stop the follow-up.'])
	assert.match(stopped.next[0], /explore start checkout --build b1/)
	const stoppedState = ok(['explore', 'wait', 'x-1', '--timeout', '60'])
	assert.equal(stoppedState.follow, 'stopped')
	assert.equal(events('stop').at(-1).actor, actor)
	assert.equal(
		ok(['query', "SELECT count(*) AS n FROM operations WHERE command = 'explore stop' AND status = 'completed'"])
			.rows[0].n,
		1
	)
	assert.equal(stoppedState.workFolder, '.checkmate/work/x-1')
	assert.equal(running(active.pid), false)
	assert.match(ok(['status', 'checkout']).next.join(' '), /explore follow x-1/)
	host.reply({
		follower: 'Retested the answer.',
		recorder: [question, secondQuestion, { kind: 'note', text: 'Retry evidence.' }],
	})
	ok(['explore', 'follow', 'x-1', '--timeout', '60'])
	assert.equal(ok(['explore', 'wait', 'x-1', '--timeout', '60']).follow, 'completed')
	assert.equal(existsSync(join(workspace, '.checkmate/work/x-1')), false)
	const retry = host.called()
	assert(retry.every((call) => !running(call.pid)))
	assert.equal(
		ok(['query', "SELECT count(*) AS n FROM operations WHERE command = 'explore follow' AND status = 'completed'"])
			.rows[0].n,
		3
	)
})

test('a watcher error releases the supervisor after recording the failed exploration', (t) => {
	const workspace = realpathSync(directory(t))
	const opened = store(t, workspace)
	target(opened)
	plan(opened)
	closeStore(opened)
	const host = fakeClaude(t, { explorer: 'Studied.' }, 'pi')
	const fault = join(workspace, 'listing-fault.cjs')
	writeFileSync(
		fault,
		`if (process.argv.includes('drive')) {
 const fs = require('node:fs')
 const original = fs.readdirSync
 let reads = 0
 fs.readdirSync = (path, ...args) => {
  if (String(path) === process.cwd() && ++reads === 2) throw Error('Controlled workspace listing failure')
  return original(path, ...args)
 }
 require('node:module').syncBuiltinESMExports()
}`
	)
	const env = {
		...process.env,
		...host.env,
		CHECKMATE_ACTOR: actor,
		CHECKMATE_HARNESS: 'pi',
		NODE_OPTIONS: `--require=${fault}`,
	}
	const command = (args: string[]) => {
		const child = spawnSync(
			process.execPath,
			[join(root, 'plugin/dist/checkmate.js'), ...args, '--workspace', workspace, '--json'],
			{ cwd: workspace, env, encoding: 'utf8', timeout: 70000 }
		)
		assert.ok(child.stdout, child.stderr)
		return { code: child.status, body: JSON.parse(child.stdout), output: child.stdout + child.stderr }
	}
	assert.equal(
		command([
			'explore',
			'start',
			'checkout',
			'--build',
			'b1',
			'--level',
			'smoke',
			'--allow',
			'Read',
			'--allow',
			'Bash',
		]).code,
		0
	)
	const failed = command(['explore', 'wait', 'x-1', '--timeout', '60'])
	assert.equal(failed.code, 1, failed.output)
	assert.equal(failed.body.state, 'failed')
	assert.match(failed.body.reason, /Controlled workspace listing failure/)
	const query = command(['query', "SELECT detail FROM exploration_events WHERE step = 'supervisor'"])
	assert.equal(query.code, 0, query.output)
	const pid = JSON.parse(query.body.rows[0].detail).pid as number
	const until = Date.now() + 3000
	while (running(pid) && Date.now() < until) Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 20)
	assert.equal(running(pid), false, 'The watcher kept the supervisor alive after failure.')
	assert.ok(existsSync(join(workspace, '.checkmate/work/x-1')))
})
