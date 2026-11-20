import test from 'node:test'
import assert from 'node:assert/strict'
import type { TestContext } from 'node:test'
import { spawnSync } from 'node:child_process'
import { existsSync, mkdirSync, realpathSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { run } from '../plugin/src/cli.ts'
import { closeStore, openStore } from '../plugin/src/store.ts'
import { explorationEvents, openExploration } from '../plugin/src/explorations.ts'
import {
	driveExploration,
	explorationState,
	explorationStatus,
	running,
	stopExploration,
} from '../plugin/src/explorers.ts'
import { lastEntry } from '../plugin/src/recorder.ts'
import { actor, cli, directory, plan, root, store, target } from './support.ts'
import { fakeClaude } from './claude.ts'
import { coupon, done, ended, entries, event, launch, launched, openTest } from './explorations.ts'

const allow = ['--allow', 'Read', '--allow', 'Bash']

const alive = running

function waitFor<T>(what: string, look: () => T | undefined | false) {
	const until = Date.now() + 30000
	for (;;) {
		const found = look()
		if (found) return found
		if (Date.now() > until) assert.fail(`Timed out: ${what}`)
		Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 20)
	}
}

function seeded(t: TestContext) {
	const opened = store(t)
	target(opened)
	plan(opened)
	return opened
}

function stopOf(opened: ReturnType<typeof seeded>, explorationId = 'x-1', input: { explorer?: string } = {}) {
	return () => stopExploration(opened, actor, { explorationId, reason: 'wrong build', ...input })
}

test('a stop refuses an unknown exploration, one that is open, and one that ended', (t) => {
	const opened = seeded(t)
	assert.throws(stopOf(opened, 'x-9'), /Unknown exploration: x-9/)
	openExploration(opened, actor, { planId: 'checkout', build: 'b1', explorationId: 'x-1' })
	assert.throws(stopOf(opened), /Exploration x-1 is open\. Only a running exploration can stop\./)
	openTest(opened, 'checkout', 'x-2', 'b1')
	done(opened, 'x-2')
	assert.throws(stopOf(opened, 'x-2'), /Exploration x-2 is completed\./)
	openTest(opened, 'checkout', 'x-3', 'b1')
	done(opened, 'x-3', 'failed', { reason: 'The merger stopped.' })
	assert.throws(stopOf(opened, 'x-3'), /Exploration x-3 is failed\./)
})

test('a stop of a stopped exploration is a refusal, and the record does not change', (t) => {
	const opened = seeded(t)
	openTest(opened, 'checkout', 'x-1', 'b1')
	event(opened, 'x-1', { step: 'stop', detail: { actor, reason: '', was: 'testing' } })
	const before = explorationEvents(opened, 'x-1').length
	assert.throws(stopOf(opened), /Exploration x-1 is stopped\./)
	assert.equal(explorationEvents(opened, 'x-1').length, before)
})

test('a stop refuses an exploration of the session path and says to stop it in the session', (t) => {
	const opened = seeded(t)
	openExploration(opened, actor, { planId: 'checkout', build: 'b1', explorationId: 'x-1' })
	event(opened, 'x-1', { step: 'start', detail: { ...launch, path: 'session' } })
	assert.throws(stopOf(opened), (error: Error & { hint?: string }) => {
		assert.match(error.message, /runs in a session\. The operator session owns its testers\./)
		assert.equal(error.hint, 'Stop the testers in the session.')
		return true
	})
})

test('a stop of one tester refuses an unknown tester, one that ended, and one that stopped already', (t) => {
	const opened = seeded(t)
	openTest(opened, 'checkout', 'x-1', 'b1')
	launched(opened, 'x-1', 'a1')
	launched(opened, 'x-1', 'a2')
	ended(opened, 'x-1', 'a2', [])
	assert.throws(stopOf(opened, 'x-1', { explorer: 'a9' }), /has no running tester named a9\./)
	assert.throws(stopOf(opened, 'x-1', { explorer: 'a2' }), /Tester a2 of exploration x-1 has ended\./)
	event(opened, 'x-1', { step: 'stop', explorer: 'a1', detail: { actor, reason: '', was: 'testing' } })
	assert.throws(stopOf(opened, 'x-1', { explorer: 'a1' }), /Tester a1 of exploration x-1 has ended\./)
	assert.equal(explorationState(explorationEvents(opened, 'x-1')), 'recording')
})

test('the state is stopped after a stop, interrupted when the supervisor died, and the reason says which', (t) => {
	const opened = seeded(t)
	const gone = spawnSync(process.execPath, ['-e', '']).pid!
	openTest(opened, 'checkout', 'x-1', 'b1')
	assert.equal(explorationState(explorationEvents(opened, 'x-1')), 'testing')
	openExploration(opened, actor, { planId: 'checkout', build: 'b1', explorationId: 'x-2' })
	event(opened, 'x-2', { step: 'start', detail: launch })
	event(opened, 'x-2', { step: 'supervisor', detail: { pid: gone } })
	assert.equal(explorationState(explorationEvents(opened, 'x-2')), 'interrupted')
	assert.equal(explorationStatus(opened, 'x-2').reason, 'The supervisor stopped before the end.')
	event(opened, 'x-2', { step: 'stop', detail: { actor: 'ana', reason: 'wrong build', was: 'interrupted' } })
	assert.equal(explorationState(explorationEvents(opened, 'x-2')), 'stopped')
	assert.equal(explorationStatus(opened, 'x-2').reason, 'Stopped by ana: wrong build')
	event(opened, 'x-1', { step: 'stop', detail: { actor: 'ana', reason: '', was: 'testing' } })
	assert.equal(explorationStatus(opened, 'x-1').reason, 'Stopped by ana.')
})

test('explore status prints ended=stopped and the reason for a tester that a person stopped', (t) => {
	const opened = seeded(t)
	openTest(opened, 'checkout', 'x-1', 'b1')
	launched(opened, 'x-1', 'a1')
	launched(opened, 'x-1', 'a2')
	event(opened, 'x-1', { step: 'stop', explorer: 'a1', detail: { actor: 'ana', reason: 'stuck', was: 'testing' } })
	event(opened, 'x-1', { step: 'end', explorer: 'a1', status: 'operational_error', detail: {} })
	const lines = cli(opened.workspace, ['explore', 'status', 'x-1']).lines
	assert.match(
		lines.find((line) => line.startsWith('a1\t'))!,
		/\tended=stopped\t.*\treason=Stopped by ana: stuck$/
	)
	assert.match(
		lines.find((line) => line.startsWith('a2\t'))!,
		/\tended=-\t/
	)
})

test('a stop of a follow-up leaves the exploration completed and the follow-up stopped', (t) => {
	const opened = seeded(t)
	openTest(opened, 'checkout', 'x-1', 'b1')
	done(opened, 'x-1')
	event(opened, 'x-1', { step: 'follow', detail: { answers: [] } })
	event(opened, 'x-1', { step: 'supervisor', detail: { pid: process.pid } })
	assert.equal(explorationState(explorationEvents(opened, 'x-1')), 'following')
	event(opened, 'x-1', { step: 'stop', detail: { actor: 'ana', reason: 'late', was: 'following' } })
	const status = explorationStatus(opened, 'x-1')
	assert.deepEqual(
		[status.state, status.follow, status.followReason],
		['completed', 'stopped', 'Stopped by ana: late']
	)
})

test('when the done event is first, the stop is refused; when the stop is first, the driver writes no done event', async (t) => {
	const opened = seeded(t)
	openExploration(opened, actor, { planId: 'checkout', build: 'b1', explorationId: 'x-1' })
	event(opened, 'x-1', { step: 'start', detail: launch })
	event(opened, 'x-1', { step: 'stop', detail: { actor, reason: 'first', was: 'starting' } })
	closeStore(opened)
	await driveExploration(opened.workspace, 'x-1', { CHECKMATE_ACTOR: actor })
	const again = openStore(opened.workspace)
	t.after(() => closeStore(again))
	assert.deepEqual(
		explorationEvents(again, 'x-1').map((item) => item.step),
		['start', 'stop', 'supervisor']
	)
	assert.equal(explorationState(explorationEvents(again, 'x-1')), 'stopped')
})

function setup(t: TestContext, replies: Parameters<typeof fakeClaude>[1], harness: 'claude' | 'pi' = 'claude') {
	const workspace = realpathSync(directory(t))
	const opened = store(t, workspace)
	target(opened)
	plan(opened)
	closeStore(opened)
	const fake = fakeClaude(t, replies, harness)
	mkdirSync(join(fake.config, 'plugins'), { recursive: true })
	writeFileSync(
		join(fake.config, 'plugins', 'installed_plugins.json'),
		JSON.stringify({ version: 2, plugins: { 'checkmate@checkmate': [{ installPath: join(root, 'plugin') }] } })
	)
	const command = (args: string[]) => {
		const outcome = run([...args, '--workspace', workspace, '--json'], {
			cwd: workspace,
			env: { ...process.env, CHECKMATE_ACTOR: actor, CHECKMATE_HARNESS: harness, ...fake.env },
			stdin: () => '',
		})
		return { code: outcome.code, body: JSON.parse(outcome.output) }
	}
	const events = (explorationId: string) => {
		const reading = openStore(workspace)
		try {
			return explorationEvents(reading, explorationId)
		} finally {
			closeStore(reading)
		}
	}
	const pids = (explorationId: string) => ({
		supervisor: events(explorationId).findLast((item) => item.step === 'supervisor')?.detail.pid as number,
		children: events(explorationId)
			.filter((item) => item.step === 'child')
			.map((item) => item.detail.pid as number),
	})
	const sleeping = (explorationId: string, count: number) =>
		waitFor('all testers sleep', () => {
			const found = pids(explorationId)
			return found.supervisor && found.children.length === count ? found : undefined
		})
	return { workspace, command, events, pids, sleeping, ...fake }
}

test('a stop ends the supervisor and the child processes, keeps the record, and a new test can start', (t) => {
	const { command, events, sleeping, reply, workspace } = setup(t, { explorer: '!sleep' })
	assert.equal(command(['explore', 'start', 'checkout', '--build', 'b1', '--level', 'smoke', ...allow]).code, 0)
	const { supervisor, children } = sleeping('x-1', 1)
	t.after(() => {
		for (const pid of [supervisor, ...children]) if (alive(pid)) process.kill(-pid, 'SIGKILL')
	})
	assert(alive(supervisor) && children.every(alive))
	const plan = join(workspace, '.checkmate', 'work', 'x-1', 'a1', 'plan.md')
	waitFor('the tester writes its plan', () => existsSync(plan))
	const recording = openStore(workspace)
	entries(recording, 'x-1', 'a1', [coupon])
	const recorded = lastEntry(recording)
	closeStore(recording)

	const stopped = command(['explore', 'stop', 'x-1', '--reason', 'wrong build'])
	assert.equal(stopped.code, 0, JSON.stringify(stopped.body))
	assert.deepEqual(
		[stopped.body.was, stopped.body.reason, stopped.body.left, stopped.body.workFolder],
		['testing', 'wrong build', [], '.checkmate/work/x-1']
	)
	assert(!alive(supervisor))
	assert(children.every((pid) => !alive(pid)))
	assert(existsSync(plan))

	const steps = events('x-1')
	assert.deepEqual(
		steps.filter((item) => item.step === 'stop').map((item) => item.detail),
		[{ actor, reason: 'wrong build', was: 'testing' }]
	)
	assert(steps.some((item) => item.step === 'launch'))
	assert(!steps.some((item) => item.step === 'done'))
	const reading = openStore(workspace)
	assert.equal(lastEntry(reading), recorded)
	closeStore(reading)
	const status = command(['explore', 'status', 'x-1']).body
	assert.deepEqual([status.state, status.reason], ['stopped', `Stopped by ${actor}: wrong build`])
	assert.deepEqual(
		status.explorers.map((item: { ended: string; reason: unknown }) => [item.ended, item.reason]),
		[['stopped', `Stopped by ${actor}: wrong build`]]
	)

	const again = command(['explore', 'stop', 'x-1'])
	assert.notEqual(again.code, 0)
	assert.match(JSON.stringify(again.body), /Exploration x-1 is stopped\./)

	reply({
		explorer: 'Tested the cart.',
		recorder: [{ kind: 'defect', title: 'Coupon stacks', severity: 'high', expected: '450', actual: '400' }],
	})
	assert.equal(command(['explore', 'start', 'checkout', '--build', 'b1', '--level', 'smoke', ...allow]).code, 0)
	assert.equal(command(['explore', 'wait', 'x-2', '--timeout', '60']).body.state, 'completed')
	assert.equal(command(['explore', 'status', 'x-1']).body.state, 'stopped')
})

test('a stop of one tester ends only its child process, and the run goes on', (t) => {
	const { command, events, sleeping } = setup(t, { explorer: '!sleep' })
	const started = command([
		'explore',
		'start',
		'checkout',
		'--build',
		'b1',
		'--level',
		'smoke',
		'--explorers',
		'2',
		...allow,
	])
	assert.equal(started.code, 0, JSON.stringify(started.body))
	const { supervisor, children } = sleeping('x-1', 2)
	t.after(() => {
		for (const pid of [supervisor, ...children]) if (alive(pid)) process.kill(-pid, 'SIGKILL')
	})
	const first = events('x-1').find((item) => item.step === 'child')!.explorer!
	const stopped = command(['explore', 'stop', 'x-1', '--explorer', first, '--reason', 'stuck'])
	assert.equal(stopped.code, 0, JSON.stringify(stopped.body))
	assert(!alive(children[0]))
	assert(alive(children[1]) && alive(supervisor))
	const middle = command(['explore', 'status', 'x-1']).body
	const second = events('x-1').filter((item) => item.step === 'child')[1].explorer!
	assert.equal(middle.state, 'testing')
	assert.deepEqual(
		middle.explorers.map((item: { explorer: string; ended: string | null }) => [item.explorer, item.ended]),
		[
			[first, 'stopped'],
			[second, null],
		]
	)
	assert.equal(command(['explore', 'stop', 'x-1', '--explorer', second, '--reason', 'wrong build']).code, 0)
	const ended = command(['explore', 'wait', 'x-1', '--timeout', '10']).body
	assert.deepEqual([ended.state, ended.reason], ['stopped', `Stopped by ${actor}: wrong build`])
	assert(children.every((pid) => !alive(pid)))
})

test('stopping the only tester stops the Pi exploration and keeps its work and the attributed reason', (t) => {
	const { command, sleeping, workspace } = setup(t, { explorer: '!sleep' }, 'pi')
	assert.equal(command(['explore', 'start', 'checkout', '--build', 'b1', '--level', 'smoke', ...allow]).code, 0)
	const { supervisor, children } = sleeping('x-1', 1)
	t.after(() => {
		for (const pid of [supervisor, ...children]) if (alive(pid)) process.kill(-pid, 'SIGKILL')
	})
	const plan = join(workspace, '.checkmate', 'work', 'x-1', 'a1', 'plan.md')
	waitFor('the tester writes its plan', () => existsSync(plan))
	const reason = 'QA requested a clean stop'
	const stop = command(['explore', 'stop', 'x-1', '--explorer', 'a1', '--reason', reason])
	assert.equal(stop.code, 0, JSON.stringify(stop.body))
	assert.match(stop.body.next[0], /explore start checkout --build b1/)
	const status = command(['explore', 'wait', 'x-1', '--timeout', '10']).body
	assert.deepEqual(
		[status.state, status.reason, status.workFolder],
		['stopped', `Stopped by ${actor}: ${reason}`, '.checkmate/work/x-1']
	)
	assert.deepEqual(
		status.explorers.map((item: { ended: string; reason: unknown }) => [item.ended, item.reason]),
		[['stopped', `Stopped by ${actor}: ${reason}`]]
	)
	assert(existsSync(plan))
	assert(children.every((pid) => !alive(pid)))
})

test('a SIGKILL of the supervisor leaves the exploration interrupted, and a stop then ends the children', (t) => {
	const { command, sleeping } = setup(t, { explorer: '!sleep' })
	assert.equal(command(['explore', 'start', 'checkout', '--build', 'b1', '--level', 'smoke', ...allow]).code, 0)
	const { supervisor, children } = sleeping('x-1', 1)
	t.after(() => {
		for (const pid of children) if (alive(pid)) process.kill(-pid, 'SIGKILL')
	})
	process.kill(supervisor, 'SIGKILL')
	waitFor('the supervisor is gone', () => !alive(supervisor))
	const status = command(['explore', 'status', 'x-1']).body
	assert.deepEqual([status.state, status.reason], ['interrupted', 'The supervisor stopped before the end.'])
	assert.equal(command(['explore', 'stop', 'x-1']).code, 0)
	assert(children.every((pid) => !alive(pid)))
	assert.equal(command(['explore', 'status', 'x-1']).body.state, 'stopped')
})
