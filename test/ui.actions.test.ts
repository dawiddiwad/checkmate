import type { TestContext } from 'node:test'
import test from 'node:test'
import assert from 'node:assert/strict'
import { realpathSync } from 'node:fs'
import { closeStore, openStore } from '../plugin/src/store.ts'
import { explorationEvents, openExploration } from '../plugin/src/explorations.ts'
import { explorationStatus, running } from '../plugin/src/explorers.ts'
import { startUi } from '../plugin/src/ui/server.ts'
import { requestModelText, testerModelText, workspaceHarness } from '../plugin/src/settings.ts'
import { piAuthenticationHint, authenticationHint } from '../plugin/src/sessions.ts'
import { failureOf, phaseOf, runsOf } from '../plugin/src/ui/activity.ts'
import { ago } from '../plugin/src/ui/html.ts'
import { actor, directory, plan, store, target } from './support.ts'
import { fakeClaude } from './claude.ts'
import { call, token, waitFor, workspaceWithFake } from './actions.ts'
import { done, ended, event, launch, launched, openTest } from './explorations.ts'

async function fixture(t: TestContext, replies: Parameters<typeof fakeClaude>[1]) {
	const base = workspaceWithFake(t, replies)
	const ui = await startUi({ workspace: base.workspace, env: base.env })
	t.after(() => ui.close())
	const csrf = async () => token((await call(ui, '/plans/checkout')).body)
	const as = { Cookie: `checkmate_actor=${actor}` }
	const post = async (path: string, form: Record<string, string> = {}, headers: Record<string, string> = as) =>
		call(ui, path, { csrf: await csrf(), ...form }, headers)
	return { ui, csrf, post, as, ...base }
}

const stacks = { kind: 'defect', title: 'Coupon stacks', severity: 'high', expected: '450', actual: '400' }

test('every action route refuses a foreign origin and a missing token, and records nothing', async (t) => {
	const { ui, read, workspace } = await fixture(t, {})
	const opened = openStore(workspace)
	openTest(opened, 'checkout', 'x-1', 'b1')
	launched(opened, 'x-1', 'a1')
	closeStore(opened)
	const form = {
		csrf: token((await call(ui, '/plans/checkout')).body),
		build: 'b2',
		level: 'smoke',
		rules: 'Read Bash',
	}
	const origin = `http://127.0.0.1:${new URL(ui.url).port}`
	for (const path of [
		'/plans/checkout/test',
		'/plans/checkout/follow',
		'/explorations/x-1/stop',
		'/explorations/x-1/explorers/a1/stop',
	]) {
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
		assert.deepEqual(
			explorationEvents(reading, 'x-1').map((item) => item.step),
			['start', 'supervisor', 'launch']
		)
		assert.equal(explorationStatus(reading, 'x-1').state, 'testing')
	})
})

test('a start runs the testers, a second start is refused, and a stop leaves no process alive', async (t) => {
	const { ui, post, pids, read, as } = await fixture(t, { explorer: '!sleep' })
	const started = await post('/plans/checkout/test', { build: 'b1', level: 'smoke', rules: 'Read Bash' })
	assert.equal(started.status, 303)
	assert.equal(started.headers.location, '/explorations/x-1')
	const { supervisor, children } = await waitFor('the tester sleeps', () => {
		const found = pids('x-1')
		return found.supervisor && found.children.length === 1 ? found : undefined
	})
	t.after(() => {
		for (const pid of [supervisor!, ...children]) if (running(pid)) process.kill(-pid, 'SIGKILL')
	})
	assert(running(supervisor) && children.every(running))
	read((reading) =>
		assert.equal(explorationEvents(reading, 'x-1').find((item) => item.step === 'start')!.detail.level, 'smoke')
	)

	const again = await post('/plans/checkout/test', { build: 'b2', level: 'smoke', rules: 'Read Bash' })
	assert.equal(again.status, 422)
	assert.match(again.body, /A test of checkout is in progress: x-1\./)
	assert.match(again.body, /href="\/explorations\/x-1"/)
	assert.equal(
		read((reading) => reading.db.prepare('SELECT COUNT(*) AS n FROM explorations').get()!.n),
		1
	)

	const live = (await call(ui, '/activity')).body
	assert.match(live, /Activity<span class="sb-long"> · 1 running<\/span>/)
	assert.match(live, /data-key="run:x-1"/)

	const stopped = await post('/explorations/x-1/stop', { reason: 'wrong build' })
	assert.equal(stopped.status, 303)
	assert.equal(stopped.headers.location, '/explorations/x-1')
	await waitFor('the processes end', () => !running(supervisor!) && children.every((pid) => !running(pid)))
	await waitFor('the end is recorded', () =>
		read((reading) => explorationEvents(reading, 'x-1').some((item) => item.step === 'stop-end'))
	)
	assert.equal(
		read((reading) => [explorationStatus(reading, 'x-1').state, explorationStatus(reading, 'x-1').reason]).join(
			'|'
		),
		`stopped|Stopped by ${actor}: wrong build`
	)
	const page = (await call(ui, '/explorations/x-1')).body
	assert.match(page, new RegExp(`<strong>Stopped by ${actor}</strong\\s*>: wrong build`))
	assert.match(page, /Test build… again/)
	assert.doesNotMatch((await call(ui, '/activity')).body, /1 running/)
	assert.match((await call(ui, '/')).body, /data-status="stopped"/)
	const refused = await post('/explorations/x-1/stop', {}, as)
	assert.equal(refused.status, 422)
	assert.match(refused.body, /Exploration x-1 is stopped\. Only a running exploration can stop\./)
})

test('a stop of one tester ends only its process, and the run goes on', async (t) => {
	const { post, pids, read } = await fixture(t, { explorer: '!sleep' })
	assert.equal((await post('/plans/checkout/test', { build: 'b1', level: 'normal', rules: 'Read Bash' })).status, 303)
	const { supervisor, children } = await waitFor('two testers sleep', () => {
		const found = pids('x-1')
		return found.supervisor && found.children.length === 2 ? found : undefined
	})
	t.after(() => {
		for (const pid of [supervisor!, ...children]) if (running(pid)) process.kill(-pid, 'SIGKILL')
	})
	const first = read((reading) => explorationEvents(reading, 'x-1').find((item) => item.step === 'child')!.explorer!)
	const stopped = await post(`/explorations/x-1/explorers/${first}/stop`, { reason: 'stuck' })
	assert.equal(stopped.status, 303)
	await waitFor('the tester ends', () => !running(children[0]))
	assert(!running(children[0]) && running(children[1]) && running(supervisor))
	assert.equal(
		read((reading) => explorationStatus(reading, 'x-1').state),
		'testing'
	)
	const missing = await post('/explorations/x-1/explorers/a9/stop')
	assert.equal(missing.status, 422)
	assert.match(missing.body, /has no running tester named a9\./)
	assert.equal((await post('/explorations/x-1/stop')).status, 303)
	await waitFor('the processes end', () => !running(supervisor!) && children.every((pid) => !running(pid)))
})

test('the refusals of the engine come back as plain sentences', async (t) => {
	const { ui, post, workspace } = await fixture(t, {})
	const opened = openStore(workspace)
	openTest(opened, 'checkout', 'x-1', 'b1')
	done(opened, 'x-1')
	closeStore(opened)
	const stop = await post('/explorations/x-1/stop')
	assert.equal(stop.status, 422)
	assert.match(stop.body, /Exploration x-1 is completed\. Only a running exploration can stop\./)
	const follow = await post('/plans/checkout/follow', { exploration: 'x-1' })
	assert.equal(follow.status, 422)
	assert.match(follow.body, /Exploration x-1 has no answer that a follow-up has not used\./)
	assert.match(
		(await post('/plans/checkout/test', { build: '', level: 'smoke', rules: 'Read Bash' })).body,
		/Write the build name\./
	)
	assert.match(
		(await post('/plans/checkout/test', { build: 'b', level: 'huge', rules: 'Read Bash' })).body,
		/Choose the level smoke, normal, or deep\./
	)
	assert.match(
		(await post('/plans/checkout/test', { build: 'b', level: 'smoke', rules: 'Read Bash', until: 'HEAD' })).body,
		/Until needs Since\./
	)
	assert.equal((await call(ui, '/plans/nothing', undefined)).status, 404)
	assert.equal((await post('/plans/nothing/test', { build: 'b', level: 'smoke', rules: 'Read Bash' })).status, 404)
})

test('a start without claude on PATH says so and gives the next step', async (t) => {
	const workspace = realpathSync(directory(t))
	const opened = store(t, workspace)
	target(opened)
	plan(opened)
	closeStore(opened)
	const ui = await startUi({ workspace, env: { PATH: '' } })
	t.after(() => ui.close())
	const form = {
		csrf: token((await call(ui, '/plans/checkout')).body),
		build: 'b1',
		level: 'smoke',
		rules: 'Read Bash',
	}
	const refused = await call(ui, '/plans/checkout/test', form, { Cookie: `checkmate_actor=${actor}` })
	assert.equal(refused.status, 422)
	assert.match(refused.body, /Claude Code was not found: no claude program is on PATH\. Install Claude Code/)
	const settings = (await call(ui, '/settings/harness')).body
	assert.match(settings, /No claude executable on PATH/)
	assert.doesNotMatch(settings, /<code>\//)
})

test('Test the answers starts the follow-up, and the answers count once', async (t) => {
	const { ui, post, read, called, reply } = await fixture(t, {
		explorer: 'Tested.',
		recorder: [stacks, { kind: 'question', id: 'Q1', question: 'Can a coupon apply to a sale item?' }],
		merger: [],
	})
	assert.equal((await post('/plans/checkout/test', { build: 'b1', level: 'smoke', rules: 'Read Bash' })).status, 303)
	await waitFor('the run completes', () => read((reading) => explorationStatus(reading, 'x-1').state === 'completed'))
	assert.doesNotMatch((await call(ui, '/plans/checkout')).body, /Test the answers/)
	const asked = read((reading) => reading.db.prepare('SELECT 1').get())
	assert(asked)
	const question = (await call(ui, '/plans/checkout?view=all')).body.match(/data-key="q:([^"]+)"/)![1]
	const answered = await post(`/explorations/x-1/questions/${question}`, {
		kind: 'defer',
		value: 'No.',
		rationale: 'Rule.',
		return: '/',
		item: `q:${question}`,
	})
	assert.equal(answered.status, 303)
	assert.match((await call(ui, '/plans/checkout')).body, /Test the answers \(1\)…/)
	called()
	reply({ follower: 'Tested the answers.', recorder: [stacks], merger: [] })
	const follow = await post('/plans/checkout/follow', { exploration: 'x-1' })
	assert.equal(follow.status, 303)
	assert.equal(follow.headers.location, '/explorations/x-1')
	await waitFor('the follow-up ends', () =>
		read((reading) => explorationStatus(reading, 'x-1').follow === 'completed')
	)
	assert.doesNotMatch((await call(ui, '/plans/checkout')).body, /Test the answers/)
	const rows = (await call(ui, '/activity')).body
	assert.match(rows, /data-key="follow:x-1:1"/)
})

test('the phase comes from the events, and the failure sentences name the next step', () => {
	const step = (name: string, explorer: string | null = null, status = 'started', detail = {}) => ({
		at: '2026-01-01T00:00:00.000Z',
		step: name,
		explorer,
		status,
		detail,
	})
	const events = [step('start', null, 'started', launch), step('supervisor')]
	assert.equal(phaseOf(events, 'testing'), 'study')
	events.push(step('launch', 'a1'), step('launch', 'a2'))
	assert.equal(phaseOf(events, 'testing'), 'study')
	events.push(step('turn', 'a1', 'started', { turn: 'test' }))
	assert.equal(phaseOf(events, 'testing'), 'test')
	events.push(step('end', 'a1', 'completed'), step('end', 'a2', 'completed'))
	assert.equal(phaseOf(events, 'testing'), 'record')
	events.push(step('record', 'a1', 'completed'))
	assert.equal(phaseOf(events, 'recording'), 'record')
	events.push(step('record', 'a2', 'completed'))
	assert.equal(phaseOf(events, 'recording'), 'merge')
	events.push(step('merge', null, 'completed'))
	assert.equal(phaseOf(events, 'verifying'), 'check')
	assert.equal(phaseOf(events, 'completed'), null)
	assert.equal(phaseOf(events, 'stopped'), null)

	assert.match(
		failureOf('No claude executable on PATH. Nothing changed.', null, []).cause,
		/^Claude Code was not found/
	)
	assert.match(failureOf('No pi executable on PATH.', null, []).cause, /^Pi was not found/)
	assert.match(failureOf('Host authentication', piAuthenticationHint, []).cause, /^Pi could not sign in/)
	const signedOut = failureOf('Host authentication: no session could log in.', authenticationHint, [])
	assert.equal(signedOut.cause, 'Claude Code is not signed in on this computer.')
	assert.equal(signedOut.detail, authenticationHint)
	const slow = failureOf('No explorer session was recorded.', null, [
		step('end', 'a1', 'interrupted', { reason: 'claude did not end in 600 seconds. Checkmate stopped it.' }),
	])
	assert.equal(slow.cause, 'A tester did not end in 600 seconds. Checkmate stopped it.')
	const other = failureOf('The instance did not answer.', null, [])
	assert.deepEqual(
		[other.cause, other.next],
		['The test failed: The instance did not answer.', 'Read the log of the run. Then test again.']
	)
	assert(!/\[object|Error:/.test(JSON.stringify([slow, other, signedOut])))
})

test('a tester that ended with no record and a run that failed show as failed, not running', async (t) => {
	const { ui, workspace } = await fixture(t, {})
	const opened = openStore(workspace)
	openTest(opened, 'checkout', 'x-1', 'b1')
	launched(opened, 'x-1', 'a1')
	ended(opened, 'x-1', 'a1', [])
	event(opened, 'x-1', { step: 'stop', detail: { actor: 'ana', reason: '', was: 'testing' } })
	closeStore(opened)
	const page = (await call(ui, '/explorations/x-1')).body
	assert.match(page, /<strong>Stopped by ana<\/strong\s*>\./)
	assert.doesNotMatch(page, /is running/)
	const home = (await call(ui, '/')).body
	assert.match(home, /data-status="stopped"/)
	assert.doesNotMatch(home, /Testing<\/span>/)
})

test('the tester rules of a start come from the form, and an empty field shows the refusal of the engine', async (t) => {
	const { post, read, called, reply, ui } = await fixture(t, {
		explorer: 'Studied.',
		tester: 'Tested.',
		recorder: [{ kind: 'question', id: 'Q1', question: 'Can a coupon apply to a sale item?' }],
		merger: [],
	})
	const empty = await post('/plans/checkout/test', { build: 'b1', level: 'smoke', rules: '  ' })
	assert.equal(empty.status, 422)
	assert.match(empty.body, /data-field="rules"/)
	assert.match(empty.body, /Give the tool rules of the explorers and the verifier with --allow/)
	assert.doesNotMatch(empty.body, /A tester cannot answer a permission prompt/)
	assert.match(empty.body, /Without the review UI, an explorer cannot answer a permission prompt\./)
	const missing = await post('/plans/checkout/test', { build: 'b1', level: 'smoke' })
	assert.equal(missing.status, 422)
	assert.match(missing.body, /data-field="rules"/)
	assert.equal(
		read((reading) => reading.db.prepare('SELECT COUNT(*) AS n FROM explorations').get()!.n),
		0
	)
	const started = await post('/plans/checkout/test', {
		build: 'b1',
		level: 'smoke',
		rules: 'Read  Bash(git log:*) Grep',
	})
	assert.equal(started.status, 303)
	await waitFor('the run ends', () => read((reading) => explorationStatus(reading, 'x-1').state === 'completed'))
	read((reading) =>
		assert.deepEqual(explorationEvents(reading, 'x-1').find((item) => item.step === 'start')!.detail.allow, [
			'Read',
			'Bash(git log:*)',
			'Grep',
		])
	)
	const rulesOf = (role: string) =>
		called()
			.filter((item) => item.role === role)
			.map((item) => item.args.filter((arg: string, at: number) => item.args[at - 1] === '--allowedTools'))
	assert.deepEqual(rulesOf('explorer')[0], ['Read', 'Bash(git log:*)', 'Grep', 'Edit(/.checkmate/work/x-1/a1/**)'])
	const question = (await call(ui, '/plans/checkout?view=all')).body.match(/data-key="q:([^"]+)"/)![1]
	assert.equal(
		(
			await post(`/explorations/x-1/questions/${question}`, {
				kind: 'defer',
				value: 'No.',
				rationale: 'Rule.',
				return: '/',
				item: `q:${question}`,
			})
		).status,
		303
	)
	reply({ follower: 'Tested the answers.', recorder: [stacks], merger: [] })
	assert.equal((await post('/plans/checkout/follow', { exploration: 'x-1' })).status, 303)
	await waitFor('the follow-up ends', () =>
		read((reading) => explorationStatus(reading, 'x-1').follow === 'completed')
	)
	assert.deepEqual(rulesOf('follower')[0], ['Read', 'Bash(git log:*)', 'Grep', 'Edit(/.checkmate/work/x-1/a1/**)'])
})

test('the rules are a setting of the workspace: Settings keeps them, and the dialog starts from them', async (t) => {
	const { ui, post, read } = await fixture(t, {})
	const settings = (await call(ui, '/settings/harness')).body
	assert.match(settings, /Tool rules of testers/)
	assert.match(settings, /Enter tool rules separated by spaces/)
	assert.match(settings, /name="rules"[^>]*value="Read Bash"/)
	assert.match((await call(ui, '/plans/checkout')).body, /name="rules"[\s\S]*?value="Read Bash"/)
	assert.match((await call(ui, '/plans/checkout')).body, /Testers may use without asking/)
	const empty = await post('/settings/harness/rules', { harness: 'claude', rules: ' ' })
	assert.equal(empty.status, 422)
	assert.match(empty.body, /Give at least one tool rule/)
	assert.doesNotMatch(empty.body, /cannot answer a permission prompt/)
	assert.match(empty.body, /The engine needs at least one rule today/)
	const saved = await post('/settings/harness/rules', { harness: 'claude', rules: 'Read Bash Edit' })
	assert.equal(saved.status, 303)
	assert.match((await call(ui, '/plans/checkout')).body, /name="rules"[\s\S]*?value="Read Bash Edit"/)
	assert.match((await call(ui, '/settings/harness')).body, /value="Read Bash Edit"/)
	read((reading) =>
		assert.equal(
			reading.db
				.prepare("SELECT command FROM operations WHERE command = 'setting set' AND status = 'completed'")
				.all().length,
			1
		)
	)
	const foreign = await call(
		ui,
		'/settings/harness/rules',
		{ csrf: token((await call(ui, '/settings/harness')).body), rules: 'Bash' },
		{ Cookie: `checkmate_actor=${actor}`, Origin: 'http://evil.test' }
	)
	assert.equal(foreign.status, 403)
	const none = await call(
		ui,
		'/settings/harness/rules',
		{ csrf: '', rules: 'Bash' },
		{ Cookie: `checkmate_actor=${actor}` }
	)
	assert.equal(none.status, 403)
	assert.match((await call(ui, '/settings/harness')).body, /value="Read Bash Edit"/)
})

test('the phase of a run follows the turns of the testers in the strip, the banner, and the navigator', async (t) => {
	const { ui, workspace } = await fixture(t, {})
	const opened = openStore(workspace)
	openTest(opened, 'checkout', 'x-1', 'b1')
	launched(opened, 'x-1', 'a1')
	launched(opened, 'x-1', 'a2')
	closeStore(opened)
	const lit = (page: string) => /data-phase="([a-z]+)"[^>]*>|aria-current="step" data-phase="([a-z]+)"/.exec(page)
	const phase = (page: string) => /aria-current="step" data-phase="([a-z]+)"/.exec(page)![1]
	const study = (await call(ui, '/explorations/x-1')).body
	assert(lit(study))
	assert.equal(phase(study), 'study')
	assert.match(study, /Phase: study\./)
	assert.match(study, /Testers now · study/)
	const again = openStore(workspace)
	event(again, 'x-1', { step: 'turn', explorer: 'a1', detail: { session: 'session-a1', turn: 'test' } })
	closeStore(again)
	const test = (await call(ui, '/explorations/x-1')).body
	assert.equal(phase(test), 'test')
	assert.match(test, /Phase: test\./)
	assert.match(test, /Testers now · test/)
})

test('after a stop of the whole run, a tester reads Stopped and keeps its last activity line', async (t) => {
	const { ui, workspace } = await fixture(t, {})
	const opened = openStore(workspace)
	openTest(opened, 'checkout', 'x-1', 'b1')
	launched(opened, 'x-1', 'a1')
	launched(opened, 'x-1', 'a2')
	event(opened, 'x-1', {
		step: 'activity',
		explorer: 'a1',
		detail: { turn: 'study', activity: 'study: wrote plan.md. 1 file in the work folder.' },
	})
	event(opened, 'x-1', {
		step: 'end',
		explorer: 'a1',
		status: 'operational_error',
		detail: { turn: 'study', reason: 'claude ended with signal SIGTERM.' },
	})
	ended(opened, 'x-1', 'a2', [])
	event(opened, 'x-1', { step: 'stop', detail: { actor: 'ana', reason: '', was: 'testing' } })
	closeStore(opened)
	const page = (await call(ui, '/explorations/x-1')).body
	const row = (name: string) => page.split(`data-key="explorer:${name}"`)[1].split('data-row')[0]
	assert.doesNotMatch(page, /operational_error/i)
	assert.match(row('a1'), /sp-pill amber"\s*>Stopped</)
	assert.match(row('a1'), /study: wrote plan\.md\. 1 file in the work folder\./)
	assert.doesNotMatch(row('a1'), /No activity line in the record/)
	assert.match(row('a2'), />Finished</)
})

test('the header says when a run started and, when it is over, when it ended and how long it took', async (t) => {
	const { ui, workspace } = await fixture(t, {})
	const opened = openStore(workspace)
	openTest(opened, 'checkout', 'x-1', 'b1')
	launched(opened, 'x-1', 'a1')
	closeStore(opened)
	const head = (page: string) => /<h1>([^<]*)<\/h1>\s*<p class="sp-sub">([\s\S]*?)<\/p>/.exec(page)!
	const running = head((await call(ui, '/explorations/x-1')).body)
	assert.equal(running[1], 'Testers now')
	assert.match(running[2], />just now<\/time>\./)
	assert.match(running[2], /started <time[^>]*>just now<\/time>/)
	assert.match(ago(new Date(Date.now() - 60_000).toISOString()).html, />1 min ago</)
	assert.match(ago(new Date(Date.now() - 3 * 3600_000).toISOString()).html, />3 h ago</)
	const again = openStore(workspace)
	ended(again, 'x-1', 'a1', [])
	done(again, 'x-1')
	closeStore(again)
	const over = head((await call(ui, '/explorations/x-1')).body)
	assert.equal(over[1], 'Testers')
	assert.match(over[2], /started <time[^>]*>just now<\/time>, ended <time[^>]*>just now<\/time>, took \d+ s\./)
})

test('a tester row says in plain words where the tester is, and gives the age of its last line', async (t) => {
	const { ui, workspace } = await fixture(t, {})
	const opened = openStore(workspace)
	openTest(opened, 'checkout', 'x-1', 'b1')
	launched(opened, 'x-1', 'a1')
	launched(opened, 'x-1', 'a2')
	closeStore(opened)
	const row = (page: string, name: string) => page.split(`data-key="explorer:${name}"`)[1].split('data-row')[0]
	const first = (await call(ui, '/explorations/x-1')).body
	assert.match(row(first, 'a1'), /In its study turn\. The first activity line comes when the turn ends\./)
	assert.doesNotMatch(first, /No activity yet/)
	const again = openStore(workspace)
	event(again, 'x-1', { step: 'turn', explorer: 'a1', detail: { turn: 'test' } })
	event(again, 'x-1', {
		step: 'activity',
		explorer: 'a2',
		detail: { turn: 'study', activity: 'study: wrote plan.md. 1 file in the work folder.' },
	})
	closeStore(again)
	const later = (await call(ui, '/explorations/x-1')).body
	assert.match(row(later, 'a1'), /In its test turn\. No activity line yet\./)
	assert.match(
		row(later, 'a2'),
		/study: wrote plan\.md\. 1 file in the work folder\. · <span class="age"><time[^>]*>just now</
	)
})

test('a stop of testers that ignore SIGTERM does not hold the server, and the view says Stopping until they end', async (t) => {
	const { ui, post, pids, read } = await fixture(t, { explorer: '!stubborn' })
	assert.equal((await post('/plans/checkout/test', { build: 'b1', level: 'normal', rules: 'Read' })).status, 303)
	const { supervisor, children } = await waitFor('two testers run', () => {
		const found = pids('x-1')
		return found.supervisor && found.children.length === 2 ? found : undefined
	})
	t.after(() => {
		for (const pid of [supervisor!, ...children]) if (running(pid)) process.kill(-pid, 'SIGKILL')
	})
	const began = Date.now()
	const stopped = await post('/explorations/x-1/stop', { reason: 'wrong build' })
	assert.equal(stopped.status, 303)
	assert(Date.now() - began < 500, 'the POST answers at once')
	const other = Date.now()
	const page = await call(ui, '/activity')
	assert.equal(page.status, 200)
	assert(Date.now() - other < 500, 'another page answers while the stop runs')
	assert(
		children.some((pid) => running(pid)),
		'the testers are still alive'
	)
	const view = (await call(ui, '/explorations/x-1')).body
	assert.match(view, /<strong>Stopping x-1…<\/strong>/)
	assert.match(view, /data-status="stopping"/)
	assert.doesNotMatch(view, /Test build… again/)
	const second = await post('/plans/checkout/test', { build: 'b2', level: 'normal', rules: 'Read' })
	assert.equal(second.status, 422)
	assert.match(second.body, /A stop of x-1 is in progress/)
	await waitFor('the end is recorded', () =>
		read((reading) => explorationEvents(reading, 'x-1').some((item) => item.step === 'stop-end'))
	)
	assert(!running(supervisor!) && children.every((pid) => !running(pid)))
	const ended = (await call(ui, '/explorations/x-1')).body
	assert.match(ended, new RegExp(`<strong>Stopped by ${actor}</strong\\s*>: wrong build`))
	assert.doesNotMatch(ended, /Stopping x-1/)
	assert.match(ended, /Test build… again/)
})

test('coding harness settings persist and reject forms from the previous harness', async (t) => {
	const { ui, post, read } = await fixture(t, {})
	const old = await call(ui, '/settings/claude')
	assert.equal(old.status, 303)
	assert.equal(old.headers.location, '/settings/harness')
	assert.match((await call(ui, '/settings/harness')).body, /Coding harness/)
	assert.equal((await post('/settings/harness/select', { harness: 'pi' })).status, 303)
	const page = (await call(ui, '/settings/harness')).body
	assert.equal((await call(ui, '/settings/harness/models?harness=claude')).status, 409)
	assert.match(page, /value="pi" selected/)
	assert.match(page, /name="harness" value="pi"/)
	assert.equal((await post('/settings/harness/rules', { harness: 'claude', rules: 'Edit' })).status, 422)
	assert.equal((await post('/settings/harness/model', { harness: 'claude', model: 'sonnet' })).status, 422)
	assert.equal(
		(await post('/settings/harness/models', { harness: 'claude', testerModel: 'sonnet', requestModel: '' })).status,
		422
	)
	assert.equal((await post('/settings/harness/rules', { harness: 'pi', rules: 'Read Bash' })).status, 303)
	assert.equal(
		(
			await post('/settings/harness/models', {
				harness: 'pi',
				testerModel: 'provider/tester',
				requestModel: 'provider/model',
			})
		).status,
		303
	)
	assert.equal(
		(
			await post('/settings/harness/models', {
				harness: 'pi',
				testerModel: 'new/model',
				requestModel: 'bad\nmodel',
			})
		).status,
		422
	)
	assert.equal((await post('/settings/harness/models', { harness: 'pi', requestModel: 'partial' })).status, 422)
	assert.equal((await post('/settings/harness/select', { harness: 'invalid' })).status, 422)
	read((store) => {
		assert.equal(workspaceHarness(store), 'pi')
		assert.equal(requestModelText(store, 'pi'), 'provider/model')
		assert.equal(testerModelText(store, 'pi'), 'provider/tester')
		assert.equal(testerModelText(store, 'claude'), '')
		assert.equal(requestModelText(store, 'claude'), '')
	})
})

test('a saved coding harness overrides the UI startup environment', async (t) => {
	const base = workspaceWithFake(t, {})
	const ui = await startUi({ workspace: base.workspace, env: { ...base.env, CHECKMATE_HARNESS: 'pi' } })
	t.after(() => ui.close())
	const initial = await call(ui, '/settings/harness')
	assert.match(initial.body, /value="pi" selected/)
	const saved = await call(
		ui,
		'/settings/harness/select',
		{ csrf: token(initial.body), harness: 'claude' },
		{ Cookie: `checkmate_actor=${actor}` }
	)
	assert.equal(saved.status, 303)
	const changed = await call(ui, '/settings/harness')
	assert.match(changed.body, /value="claude" selected/)
	assert.match(changed.body, /name="harness" value="claude"/)
})

test('test forms reject rules from a different coding harness', async (t) => {
	const { ui, post } = await fixture(t, {})
	assert.match((await call(ui, '/new')).body, /name="harness" value="claude"/)
	assert.match((await call(ui, '/plans/checkout')).body, /name="harness" value="claude"/)
	assert.equal((await post('/settings/harness/select', { harness: 'pi' })).status, 303)
	for (const path of ['/new', '/plans/checkout/test']) {
		const refused = await post(path, { harness: 'claude', rules: 'Bash(git log:*)', build: 'test' })
		assert.equal(refused.status, 422)
		assert.match(refused.body, /coding harness changed/i)
	}
	const page = (await call(ui, '/settings/harness')).body
	assert.match(page, /Without it, they cannot use Bash/)
	assert.doesNotMatch(page, /Without it, each command asks/)
})

test('tester count follows the selected level and rejects a stale harness', async (t) => {
	const { ui, post } = await fixture(t, {})
	const count = await call(ui, '/settings/harness/tester-count?harness=claude&plan=checkout&level=normal')
	assert.equal(count.status, 200)
	assert.equal(JSON.parse(count.body).count, 2)
	const smoke = await call(ui, '/settings/harness/tester-count?harness=claude&target=checkout-local&level=smoke')
	assert.equal(JSON.parse(smoke.body).count, 1)
	assert.equal((await post('/settings/harness/select', { harness: 'pi' })).status, 303)
	assert.equal(
		(await call(ui, '/settings/harness/tester-count?harness=claude&plan=checkout&level=normal')).status,
		409
	)
})

test('a legacy Pi 401 failure shows the safe reason on the run and tester', async (t) => {
	const { ui, workspace } = await fixture(t, {})
	const opened = openStore(workspace)
	openExploration(opened, actor, { planId: 'checkout', build: 'b1', explorationId: 'x-2' })
	event(opened, 'x-2', {
		step: 'start',
		detail: { ...launch, context: { harness: 'pi', claudeArgs: [], hiddenPlugin: null } },
	})
	launched(opened, 'x-2', 'a1')
	event(opened, 'x-2', {
		step: 'end',
		explorer: 'a1',
		status: 'operational_error',
		detail: {
			reason: 'pi ended with an error: 401: {"message":"API key expired","api_key":"secret-value"}',
			stderr: ['Authorization: Bearer secret-value'],
		},
	})
	done(opened, 'x-2', 'failed', { reason: 'No explorer session was recorded.' })
	closeStore(opened)
	const page = (await call(ui, '/explorations/x-2')).body
	assert.match(page, /HTTP 401/)
	assert.match(page, /API key expired/i)
	assert.doesNotMatch(page, /secret-value/)
	const detail = (await call(ui, '/explorations/x-2?item=explorer%3Aa1')).body
	assert.match(detail, /HTTP 401/)
	assert.match(detail, /API key expired/i)
	assert.doesNotMatch(detail, /secret-value/)
})

test('Pi tester diagnostics do not replace unrelated failures or mislabel billing as login', () => {
	const at = '2026-01-01T00:00:00Z'
	const events = [
		{
			at,
			step: 'start',
			explorer: null,
			status: 'started',
			detail: { ...launch, context: { harness: 'pi', claudeArgs: [], hiddenPlugin: null } },
		},
		{
			at,
			step: 'end',
			explorer: 'a1',
			status: 'operational_error',
			detail: { reason: 'pi ended with an error: 402: {"message":"Insufficient credits for this API key"}' },
		},
	]
	const billing = failureOf('No explorer session was recorded.', null, events)
	assert.match(billing.cause, /HTTP 402/i)
	assert.doesNotMatch(billing.next, /login|sign in/i)
	const unrelated = failureOf('The verifier could not finish.', null, events)
	assert.match(unrelated.cause, /verifier could not finish/i)
	assert.doesNotMatch(unrelated.cause, /402/)
})

test('a follow-up failure reports its own reason, not an earlier tester error', async (t) => {
	const { workspace } = await fixture(t, {})
	const store = openStore(workspace)
	openExploration(store, actor, { planId: 'checkout', build: 'b1', explorationId: 'x-2' })
	event(store, 'x-2', {
		step: 'start',
		detail: { ...launch, context: { harness: 'pi', claudeArgs: [], hiddenPlugin: null } },
	})
	launched(store, 'x-2', 'a1')
	event(store, 'x-2', {
		step: 'end',
		explorer: 'a1',
		status: 'operational_error',
		detail: { reason: 'pi ended with an error: 401: {"message":"API key expired"}' },
	})
	done(store, 'x-2', 'completed')
	event(store, 'x-2', { step: 'follow', detail: { answers: [] } })
	event(store, 'x-2', { step: 'followed', status: 'failed', detail: { reason: 'The follow-up could not continue.' } })
	const follow = runsOf(store, 'x-2', new Map()).find((item) => item.follow)
	assert.match(follow?.outcome ?? '', /follow-up could not continue/)
	assert.doesNotMatch(follow?.outcome ?? '', /401|API key expired/)
	closeStore(store)
})

test('a new Pi authentication failure shows the tester error in the run banner', async (t) => {
	const { ui, workspace } = await fixture(t, {})
	const store = openStore(workspace)
	openExploration(store, actor, { planId: 'checkout', build: 'b1', explorationId: 'x-3' })
	event(store, 'x-3', {
		step: 'start',
		detail: { ...launch, context: { harness: 'pi', claudeArgs: [], hiddenPlugin: null } },
	})
	launched(store, 'x-3', 'a1')
	event(store, 'x-3', {
		step: 'end',
		explorer: 'a1',
		status: 'operational_error',
		detail: { reason: 'pi ended with an error: HTTP 401: API key expired.' },
	})
	done(store, 'x-3', 'failed', { reason: 'Host authentication: no session could log in.' })
	closeStore(store)
	const page = (await call(ui, '/explorations/x-3')).body
	assert.match(page, /data-key="run-ended"[\s\S]*?HTTP 401[\s\S]*?API key expired/)
})
