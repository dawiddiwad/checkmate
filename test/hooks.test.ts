import test from 'node:test'
import assert from 'node:assert/strict'
import type { TestContext } from 'node:test'
import { spawn } from 'node:child_process'
import { request } from 'node:http'
import { existsSync, readFileSync, realpathSync, statSync, writeFileSync } from 'node:fs'
import { setTimeout as pause } from 'node:timers/promises'
import { run } from '../plugin/src/cli.ts'
import { closeStore, openStore } from '../plugin/src/store.ts'
import { explorationEvents, openExploration } from '../plugin/src/explorations.ts'
import { recordStop } from '../plugin/src/explorers.ts'
import { explorationLive } from '../plugin/src/views.ts'
import {
	explorationPermissions,
	openPermissions,
	permissionRules,
	requestPermission,
} from '../plugin/src/permissions.ts'
import { childArgs, childEnv, liveUi, uiFilePath, writeUiFile } from '../plugin/src/sessions.ts'
import { startUi } from '../plugin/src/ui/server.ts'
import { activityLine } from '../plugin/src/ui/hooks.ts'
import { actor, directory, plan, root, store, target } from './support.ts'
import { event, launched } from './explorations.ts'
import { call, endProcessesIn, token, waitFor, workspaceWithFake } from './actions.ts'

const suggestion = {
	type: 'addRules',
	rules: [{ toolName: 'Bash', ruleContent: 'npm view *' }],
	behavior: 'allow',
	destination: 'localSettings',
}
const ask = { hook_event_name: 'PermissionRequest', tool_name: 'Bash', tool_input: { command: 'npm view left-pad' } }
const asking = { ...ask, permission_suggestions: [suggestion] }
const wrap = (decision: string) => `{"hookSpecificOutput":{"hookEventName":"PermissionRequest","decision":${decision}}}`
const rule = (destination: string) =>
	`{"type":"addRules","rules":[{"toolName":"Bash","ruleContent":"npm view *"}],"behavior":"allow","destination":"${destination}"}`
const as = { Cookie: `checkmate_actor=${actor}` }

type Options = Parameters<typeof startUi>[0]

function dummyProcess(t: TestContext) {
	const child = spawn(process.execPath, ['-e', 'setTimeout(() => {}, 120000)'], { detached: true, stdio: 'ignore' })
	t.after(() => {
		try {
			process.kill(-child.pid!, 'SIGKILL')
		} catch {}
	})
	return child.pid!
}

function workspaceOf(t: TestContext) {
	const workspace = realpathSync(directory(t))
	const opened = store(t, workspace)
	target(opened)
	plan(opened)
	openExploration(opened, 'checkmate', { planId: 'checkout', build: 'b1', explorationId: 'x-1' })
	const events = [
		{ step: 'start', detail: { level: 'smoke', explorers: 2, model: 'm', modelFrom: 'host', verifier: false } },
		{ step: 'supervisor', detail: { pid: dummyProcess(t) } },
	]
	for (const item of events) event(opened, 'x-1', item)
	launched(opened, 'x-1', 'a1')
	launched(opened, 'x-1', 'a2')
	closeStore(opened)
	return workspace
}

async function serverOf(t: TestContext, workspace: string, options: Partial<Options> = {}) {
	const logs: string[] = []
	const ui = await startUi({ workspace, defaultActor: '', log: (line) => logs.push(line), ...options })
	t.after(() => ui.close())
	const hookToken = (JSON.parse(readFileSync(uiFilePath(workspace), 'utf8')) as { hookToken: string }).hookToken
	const read = <T>(view: (reading: ReturnType<typeof openStore>) => T) => {
		const reading = openStore(workspace)
		try {
			return view(reading)
		} finally {
			closeStore(reading)
		}
	}
	return { ui, logs, hookToken, read, workspace }
}

async function fixture(t: TestContext, options: Partial<Options> = {}) {
	return serverOf(t, workspaceOf(t), options)
}

type Fixture = Awaited<ReturnType<typeof fixture>>
type Reply = { status: number; body: string; headers: Record<string, unknown> }

function hookCall(
	{ ui, hookToken }: Pick<Fixture, 'ui' | 'hookToken'>,
	path: string,
	body: unknown,
	headers: Record<string, string> = { Authorization: `Bearer ${hookToken}` }
) {
	return new Promise<Reply>((resolve, reject) => {
		const req = request(
			new URL(path, ui.url),
			{ method: 'POST', headers: { 'Content-Type': 'application/json', ...headers } },
			(res) => {
				const chunks: Buffer[] = []
				res.on('data', (chunk) => chunks.push(chunk))
				res.on('end', () =>
					resolve({
						status: res.statusCode ?? 0,
						body: Buffer.concat(chunks).toString(),
						headers: res.headers,
					})
				)
			}
		)
		req.on('error', reject)
		req.end(typeof body === 'string' ? body : JSON.stringify(body))
	})
}

const permission = (f: Fixture, who: string, body: unknown = asking, exploration = 'x-1') =>
	hookCall(f, `/hooks/permission/${exploration}/${who}`, body)
const activity = (f: Fixture, who: string, body: unknown) => hookCall(f, `/hooks/activity/x-1/${who}`, body)
const open = (f: Fixture) => f.read((reading) => openPermissions(reading))
const waitOpen = (f: Fixture, count: number) =>
	waitFor(`${count} open requests`, () => open(f).length === count && open(f))
const requests = (f: Fixture) => f.read((reading) => explorationPermissions(reading, 'x-1'))

async function decide(f: Fixture, id: string, form: Record<string, string>, headers = as) {
	const csrf = token((await call(f.ui, '/activity', undefined, headers)).body)
	return call(f.ui, `/permissions/x-1/${id}`, { csrf, ...form }, headers)
}

test('the UI server writes ui.json with mode 0600, replaces a stale file, and removes its own file', async (t) => {
	const workspace = workspaceOf(t)
	writeFileSync(uiFilePath(workspace), JSON.stringify({ port: 1, pid: 2 ** 22 + 5, hookToken: 'old' }))
	assert.equal(liveUi(workspace), null)
	const f = await serverOf(t, workspace)
	const file = JSON.parse(readFileSync(uiFilePath(workspace), 'utf8'))
	assert.deepEqual(Object.keys(file).sort(), ['hookToken', 'pid', 'port'])
	assert.equal(file.pid, process.pid)
	assert.equal(file.port, Number(new URL(f.ui.url).port))
	assert.match(file.hookToken, /^[0-9a-f]{64}$/)
	assert.equal(statSync(uiFilePath(workspace)).mode & 0o777, 0o600)
	assert.deepEqual(liveUi(workspace), file)
	await f.ui.close()
	assert.equal(existsSync(uiFilePath(workspace)), false)
})

test('a server that closes does not remove the file of a newer server', async (t) => {
	const workspace = workspaceOf(t)
	const first = await serverOf(t, workspace)
	const second = await serverOf(t, workspace)
	await first.ui.close()
	assert.equal(JSON.parse(readFileSync(uiFilePath(workspace), 'utf8')).hookToken, second.hookToken)
})

test('both hook routes refuse an Origin header and a missing or wrong token, and record nothing', async (t) => {
	const f = await fixture(t)
	const good = { Authorization: `Bearer ${f.hookToken}` }
	const bad: Array<Record<string, string>> = [
		{ ...good, Origin: 'http://evil.test' },
		{ ...good, Origin: f.ui.url.slice(0, -1) },
		{},
		{ Authorization: 'Bearer wrong' },
		{ Authorization: f.hookToken },
		{ Authorization: `Bearer ${f.hookToken}x` },
	]
	for (const headers of bad) {
		for (const path of ['/hooks/permission/x-1/a1', '/hooks/activity/x-1/a1']) {
			const reply = await hookCall(f, path, asking, headers)
			assert.equal(reply.status, 403, `${path} ${JSON.stringify(headers)}`)
			assert.equal(reply.headers['set-cookie'], undefined)
		}
	}
	assert.equal(open(f).length, 0)
	assert.equal(
		f.read((reading) => explorationEvents(reading, 'x-1').filter((item) => item.step === 'activity')).length,
		0
	)
})

test('the hook routes take no form token, and the browser route for answers needs one', async (t) => {
	const f = await fixture(t)
	const asked = permission(f, 'a1')
	await waitOpen(f, 1)
	const missing = await call(f.ui, '/permissions/x-1/P1', { decision: 'allow' }, as)
	assert.equal(missing.status, 403)
	const foreign = await call(
		f.ui,
		'/permissions/x-1/P1',
		{ csrf: 'x', decision: 'allow' },
		{ ...as, Origin: 'http://evil.test' }
	)
	assert.equal(foreign.status, 403)
	assert.equal(open(f).length, 1)
	assert.equal((await decide(f, 'P1', { decision: 'allow' })).status, 303)
	await asked
})

test('an unknown exploration and a body that is not the event get an empty 200 and a log line', async (t) => {
	const f = await fixture(t)
	const cases: Array<[string, string, unknown]> = [
		['permission', 'x-9', asking],
		['activity', 'x-9', { hook_event_name: 'PreToolUse', tool_name: 'Bash', tool_input: {} }],
		['permission', 'x-1', { ...asking, hook_event_name: 'PreToolUse' }],
		['permission', 'x-1', { hook_event_name: 'PermissionRequest', tool_input: {} }],
		['permission', 'x-1', 'not json'],
		['activity', 'x-1', { hook_event_name: 'PermissionRequest', tool_name: 'Bash' }],
		['activity', 'x-1', []],
	]
	for (const [kind, exploration, body] of cases) {
		const reply = await hookCall(f, `/hooks/${kind}/${exploration}/a1`, body)
		assert.deepEqual([reply.status, reply.body], [200, ''], JSON.stringify(body))
	}
	assert.equal(f.logs.length, cases.length)
	assert.equal(open(f).length, 0)
})

test('allow once, deny, and stop answer with the bodies of the design', async (t) => {
	const f = await fixture(t)
	const first = permission(f, 'a1', ask)
	await waitOpen(f, 1)
	assert.equal(open(f)[0].tool, 'Bash')
	assert.equal((await decide(f, 'P1', { decision: 'allow' })).status, 303)
	assert.equal((await first).body, wrap('{"behavior":"allow"}'))
	const second = permission(f, 'a1', ask)
	await waitOpen(f, 1)
	const noReason = await decide(f, 'P2', { decision: 'deny', reason: '  ' })
	assert.equal(noReason.status, 422)
	assert.match(noReason.body, /A denial needs a reason/)
	assert.equal(open(f).length, 1)
	await decide(f, 'P2', { decision: 'deny', reason: 'Not on this site.' })
	assert.equal((await second).body, wrap('{"behavior":"deny","message":"Not on this site."}'))
	const third = permission(f, 'a2', ask)
	await waitOpen(f, 1)
	await decide(f, 'P3', { decision: 'stop' })
	assert.equal((await third).body, wrap(`{"behavior":"deny","message":"Stopped by ${actor}.","interrupt":true}`))
	await waitFor('the stop of a2', () =>
		f.read((reading) =>
			explorationEvents(reading, 'x-1').some((item) => item.step === 'stop-end' && item.explorer === 'a2')
		)
	)
	const events = f.read((reading) => explorationEvents(reading, 'x-1'))
	assert.equal(
		events.some((item) => item.step === 'stop' && item.explorer === 'a2'),
		true
	)
	assert.equal(
		events.some((item) => item.step === 'stop' && item.explorer === 'a1'),
		false
	)
	const all = await requests(f)
	assert.deepEqual(
		all.map((item) => [item.id, item.who, item.decision?.kind, item.decision?.by]),
		[
			['P1', 'a1', 'allow', actor],
			['P2', 'a1', 'deny', actor],
			['P3', 'a2', 'stop', actor],
		]
	)
	assert.equal(all[1].decision?.reason, 'Not on this site.')
})

test('allow for this test answers with the rule at destination session, and the same request of another tester is answered at once', async (t) => {
	const f = await fixture(t)
	const first = permission(f, 'a1')
	await waitOpen(f, 1)
	assert.equal(open(f)[0].rule, 'Bash(npm view *)')
	await decide(f, 'P1', { decision: 'allow-kind' })
	assert.equal((await first).body, wrap(`{"behavior":"allow","updatedPermissions":[${rule('session')}]}`))
	const rules = f.read((reading) => permissionRules(reading, 'x-1'))
	assert.deepEqual(
		rules.map((item) => [item.rule, item.setBy, item.requestId]),
		[['Bash(npm view *)', actor, 'P1']]
	)
	const second = await permission(f, 'a2', {
		...asking,
		permission_suggestions: [{ ...suggestion, destination: 'userSettings' }],
	})
	assert.equal(second.body, wrap(`{"behavior":"allow","updatedPermissions":[${rule('session')}]}`))
	assert.equal(open(f).length, 0)
	const other = await permission(f, 'merge')
	assert.equal(other.body, second.body)
	const [, again] = await requests(f)
	assert.equal(again.decision?.kind, 'rule')
	assert.equal(again.decision?.text, `allowed by rule Bash(npm view *), set by ${actor}`)
	const different = permission(f, 'a2', {
		...ask,
		tool_input: { command: 'npm publish' },
		permission_suggestions: [{ ...suggestion, rules: [{ toolName: 'Bash', ruleContent: 'npm publish *' }] }],
	})
	await waitOpen(f, 1)
	await decide(f, 'P4', { decision: 'allow' })
	await different
})

test('allow every call of a tool answers with the tool rule, and a later request for the tool of any tester is answered at once', async (t) => {
	const f = await fixture(t)
	const first = permission(f, 'a1', ask)
	await waitOpen(f, 1)
	assert.equal((await decide(f, 'P1', { decision: 'allow-tool' })).status, 303)
	const toolRule = '{"type":"addRules","rules":[{"toolName":"Bash"}],"behavior":"allow","destination":"session"}'
	assert.equal((await first).body, wrap(`{"behavior":"allow","updatedPermissions":[${toolRule}]}`))
	const rules = f.read((reading) => permissionRules(reading, 'x-1'))
	assert.deepEqual(
		rules.map((item) => [item.rule, item.kind, item.setBy, item.requestId]),
		[['Bash', 'allow-tool', actor, 'P1']]
	)
	const second = await permission(f, 'a2', { ...ask, tool_input: { command: 'rm -rf build' } })
	assert.equal(second.body, wrap(`{"behavior":"allow","updatedPermissions":[${toolRule}]}`))
	const withSuggestion = await permission(f, 'merge', asking)
	assert.equal(withSuggestion.body, second.body)
	assert.equal(open(f).length, 0)
	const [, again, last] = await requests(f)
	assert.deepEqual(
		[again.decision?.kind, again.decision?.rule, again.decision?.text],
		['rule', 'Bash', `allowed by rule every Bash call, set by ${actor}`]
	)
	assert.equal(last.decision?.kind, 'rule')
	const other = permission(f, 'a2', { ...ask, tool_name: 'Write', tool_input: { file_path: '/tmp/x', content: 'y' } })
	await waitOpen(f, 1)
	assert.equal(open(f)[0].tool, 'Write')
	await decide(f, 'P4', { decision: 'allow' })
	await other
	assert.equal(f.read((reading) => permissionRules(reading, 'x-1')).length, 1)
})

test('a tool rule of one exploration does not answer a request of another exploration', async (t) => {
	const f = await fixture(t)
	const reading = openStore(f.workspace)
	openExploration(reading, 'checkmate', { planId: 'checkout', build: 'b2', explorationId: 'x-2' })
	launched(reading, 'x-2', 'a1')
	closeStore(reading)
	const first = permission(f, 'a1', ask)
	await waitOpen(f, 1)
	await decide(f, 'P1', { decision: 'allow-tool' })
	await first
	const elsewhere = permission(f, 'a1', ask, 'x-2')
	await waitFor('the request of x-2', () => open(f).length === 1)
	assert.equal(open(f)[0].explorationId, 'x-2')
	await call(
		f.ui,
		'/permissions/x-2/P1',
		{ csrf: token((await call(f.ui, '/activity', undefined, as)).body), decision: 'allow' },
		as
	)
	await elsewhere
})

test('always allow answers at destination localSettings and sets no rule on the exploration', async (t) => {
	const f = await fixture(t)
	const first = permission(f, 'a1')
	await waitOpen(f, 1)
	await decide(f, 'P1', { decision: 'always' })
	assert.equal((await first).body, wrap(`{"behavior":"allow","updatedPermissions":[${rule('localSettings')}]}`))
	assert.deepEqual(
		f.read((reading) => permissionRules(reading, 'x-1')),
		[]
	)
	const second = permission(f, 'a2')
	await waitOpen(f, 1)
	await decide(f, 'P2', { decision: 'allow' })
	await second
})

test('a rule choice needs a suggestion of type addRules', async (t) => {
	const f = await fixture(t)
	const asked = permission(f, 'a1', {
		...ask,
		permission_suggestions: [{ type: 'addDirectories', directories: ['/tmp'], destination: 'session' }],
	})
	await waitOpen(f, 1)
	assert.equal(open(f)[0].rule, null)
	for (const decision of ['allow-kind', 'always']) {
		const refused = await decide(f, 'P1', { decision })
		assert.equal(refused.status, 422)
		assert.match(refused.body, /has no rule that Claude Code can remember/)
	}
	await decide(f, 'P1', { decision: 'allow' })
	await asked
})

test('a request that has an answer refuses a second one with a plain sentence', async (t) => {
	const f = await fixture(t)
	const asked = permission(f, 'a1')
	await waitOpen(f, 1)
	await decide(f, 'P1', { decision: 'allow' })
	await asked
	const again = await decide(f, 'P1', { decision: 'deny', reason: 'Too late.' })
	assert.equal(again.status, 303)
	assert.equal(again.headers.location, '/permissions/x-1/P1')
	const record = (await call(f.ui, '/permissions/x-1/P1?view=history', undefined, as)).body
	assert.match(record, /Answered[\s\S]*allowed once, by tester/)
	assert.doesNotMatch(record, /data-option/)
	assert.deepEqual(
		(await requests(f)).map((item) => item.decision?.kind),
		['allow']
	)
	const unknown = await decide(f, 'P7', { decision: 'allow' })
	assert.equal(unknown.status, 422)
	assert.match(unknown.body, /has no permission request P7/)
	const noName = await call(f.ui, '/permissions/x-1/P1', {
		csrf: token((await call(f.ui, '/activity')).body),
		decision: 'allow',
	})
	assert.equal(noName.status, 422)
	assert.match(noName.body, /Enter your name/)
})

test('without an answer in time the response is empty and the request is closed', async (t) => {
	const f = await fixture(t, { holdMilliseconds: 150 })
	const asked = await permission(f, 'a1')
	assert.deepEqual([asked.status, asked.body], [200, ''])
	const [request] = await requests(f)
	assert.equal(request.decision?.kind, 'closed')
	assert.equal(request.decision?.cause, 'timeout')
	assert.equal(request.decision?.text, 'no answer in 10 minutes')
	assert.equal(open(f).length, 0)
	const late = await decide(f, 'P1', { decision: 'allow' })
	assert.equal(late.status, 303)
	assert.match(
		(await call(f.ui, '/permissions/x-1/P1?view=history', undefined, as)).body,
		/Closed[\s\S]*no answer in 10 minutes[\s\S]*Claude Code denied the call/
	)
	assert.deepEqual(
		(await requests(f)).map((item) => item.decision?.kind),
		['closed']
	)
})

test('closing the server answers each held response with an empty body and records the close', async (t) => {
	const f = await fixture(t)
	const asked = [permission(f, 'a1'), permission(f, 'a2')]
	await waitOpen(f, 2)
	await f.ui.close()
	for (const reply of await Promise.all(asked)) assert.deepEqual([reply.status, reply.body], [200, ''])
	const reading = openStore(f.workspace)
	t.after(() => closeStore(reading))
	assert.deepEqual(
		explorationPermissions(reading, 'x-1').map((item) => [item.decision?.cause, item.decision?.text]),
		[
			['ui-stopped', 'closed, the UI stopped'],
			['ui-stopped', 'closed, the UI stopped'],
		]
	)
})

test('requests that were open when an earlier server ended show as closed after a restart', async (t) => {
	const workspace = workspaceOf(t)
	const opened = openStore(workspace)
	requestPermission(opened, {
		explorationId: 'x-1',
		who: 'a1',
		tool: 'Bash',
		input: { command: 'ls' },
		suggestions: [],
	})
	closeStore(opened)
	const f = await serverOf(t, workspace)
	assert.equal(open(f).length, 0)
	const [request] = await requests(f)
	assert.equal(request.decision?.text, 'closed, the UI stopped')
})

test('a run that is stopped closes its open requests; a stopped tester closes only its own', async (t) => {
	const f = await fixture(t)
	const first = permission(f, 'a1')
	const second = permission(f, 'a2')
	await waitOpen(f, 2)
	const opened = openStore(f.workspace)
	t.after(() => closeStore(opened))
	recordStop(opened, actor, { explorationId: 'x-1', explorer: 'a1', reason: 'enough' })
	assert.deepEqual([(await first).status, (await first).body], [200, ''])
	assert.equal(open(f).length, 1)
	assert.equal(open(f)[0].who, 'a2')
	recordStop(opened, actor, { explorationId: 'x-1', reason: 'enough' })
	assert.deepEqual([(await second).status, (await second).body], [200, ''])
	assert.deepEqual(
		(await requests(f)).map((item) => [item.who, item.decision?.cause]),
		[
			['a1', 'stopped'],
			['a2', 'stopped'],
		]
	)
})

test('a client that goes away before the answer closes its request', async (t) => {
	const f = await fixture(t)
	const req = request(
		new URL('/hooks/permission/x-1/a1', f.ui.url),
		{ method: 'POST', headers: { Authorization: `Bearer ${f.hookToken}`, 'Content-Type': 'application/json' } },
		() => {}
	)
	req.on('error', () => {})
	req.end(JSON.stringify(asking))
	await waitOpen(f, 1)
	req.destroy()
	await waitFor('the close of P1', () => open(f).length === 0)
	const [request1] = await requests(f)
	assert.equal(request1.decision?.cause, 'disconnected')
})

test('the CLI answers a request like the browser does, and it needs a live UI', async (t) => {
	const f = await fixture(t)
	const permit = (...args: string[]) =>
		run(['explore', 'permit', 'x-1', ...args, '--workspace', f.workspace, '--json'], {
			cwd: f.workspace,
			env: { CHECKMATE_ACTOR: 'factory' },
			stdin: () => '',
		})
	const asked = permission(f, 'a1')
	await waitOpen(f, 1)
	assert.match(permit('P1').output, /Give one of --allow, --allow-kind, --allow-tool, --always, --deny, --stop/)
	assert.match(permit('P1', '--allow', '--deny').output, /Give one of/)
	const noReason = permit('P1', '--deny')
	assert.equal(noReason.code, 1)
	assert.match(noReason.output, /A denial needs a reason/)
	const done = permit('P1', '--allow-kind')
	assert.equal(done.code, 0, done.output)
	assert.equal(JSON.parse(done.output).decision, 'allow-kind')
	assert.equal((await asked).body, wrap(`{"behavior":"allow","updatedPermissions":[${rule('session')}]}`))
	assert.deepEqual(
		f.read((reading) => permissionRules(reading, 'x-1')).map((item) => item.setBy),
		['factory']
	)
	const listed = run(['explore', 'permissions', 'x-1', '--workspace', f.workspace], {
		cwd: f.workspace,
		env: {},
		stdin: () => '',
	})
	assert.match(listed.output, /P1\tallowed for this test: Bash\(npm view \*\), by factory/)
	const again = permit('P1', '--allow')
	assert.equal(again.code, 1)
	assert.match(again.output, /has an answer already/)
	const stopped = permission(f, 'a2', ask)
	await waitOpen(f, 1)
	const stop = permit('P2', '--stop', '--reason', 'Wrong site.')
	assert.equal(stop.code, 0, stop.output)
	assert.equal((await stopped).body, wrap('{"behavior":"deny","message":"Wrong site.","interrupt":true}'))
	const events = f.read((reading) => explorationEvents(reading, 'x-1'))
	assert.equal(events.find((item) => item.step === 'stop')?.explorer, 'a2')
	const tooled = permission(f, 'a1', { ...ask, tool_name: 'Read', tool_input: { file_path: '/tmp/a' } })
	await waitOpen(f, 1)
	const tool = permit('P3', '--allow-tool')
	assert.equal(tool.code, 0, tool.output)
	assert.equal(JSON.parse(tool.output).decision, 'allow-tool')
	assert.match((await tooled).body, /"rules":\[\{"toolName":"Read"\}\]/)
	assert.match(
		run(['explore', 'permissions', 'x-1', '--workspace', f.workspace], {
			cwd: f.workspace,
			env: {},
			stdin: () => '',
		}).output,
		/P3\tallowed for this test: every Read call, by factory/
	)
	await f.ui.close()
	const without = permit('P4', '--allow')
	assert.equal(without.code, 1)
	assert.match(without.output, /No UI server runs for this folder/)
})

test('the line of an activity call is one short line without secrets', () => {
	const cwd = '/work/app'
	const cases: Array<[string, unknown, string]> = [
		[
			'Bash',
			{ command: 'curl -s -X POST http://127.0.0.1:4173/api/notes' },
			'Bash: curl -s -X POST http://127.0.0.1:4173/api/notes',
		],
		['Read', { file_path: '/work/app/src/app.js' }, 'Read: src/app.js'],
		['Write', { file_path: '/other/report.md', content: 'x' }, 'Write: /other/report.md'],
		['Bash', { command: 'first\nsecond' }, 'Bash: first'],
		['Grep', { pattern: 'total' }, 'Grep: total'],
		['TodoWrite', { todos: [] }, 'TodoWrite'],
		['Bash', 'text', 'Bash'],
		[
			'Bash',
			{ command: 'curl -H "Authorization: Bearer abc123" http://x' },
			'Bash: curl -H "Authorization: Bearer …" http://x',
		],
		['Bash', { command: 'tool --password hunter2 --name a' }, 'Bash: tool --password … --name a'],
		['Bash', { command: 'tool --api-key=abc --name a' }, 'Bash: tool --api-key=… --name a'],
		['Bash', { command: 'API_TOKEN=abc node run.js' }, 'Bash: API_TOKEN=… node run.js'],
		['Bash', { command: 'curl http://user:secret@host/x' }, 'Bash: curl http://…@host/x'],
	]
	for (const [tool, input, line] of cases) assert.equal(activityLine(tool, input, cwd), line)
	const long = activityLine('Bash', { command: 'a'.repeat(300) })
	assert.equal(long.length, 120)
	assert.equal(long.endsWith('…'), true)
})

test('an activity call becomes the live line of the tester, at most once in the interval', async (t) => {
	const f = await fixture(t, { activityMilliseconds: 300 })
	const send = (command: string, who = 'a1') =>
		activity(f, who, { hook_event_name: 'PreToolUse', tool_name: 'Bash', tool_input: { command } })
	const lines = () =>
		f.read((reading) =>
			explorationEvents(reading, 'x-1')
				.filter((item) => item.step === 'activity')
				.map((item) => [item.explorer, item.detail.activity])
		)
	for (const command of ['one', 'two', 'three']) {
		const reply = await send(command)
		assert.deepEqual([reply.status, reply.body], [200, ''])
	}
	assert.deepEqual(lines(), [['a1', 'Bash: one']])
	assert.deepEqual([(await send('other', 'a2')).body], [''])
	assert.deepEqual(lines(), [
		['a1', 'Bash: one'],
		['a2', 'Bash: other'],
	])
	await waitFor('the last line', () => lines().length === 3)
	assert.deepEqual(lines()[2], ['a1', 'Bash: three'])
	await pause(400)
	assert.equal(lines().length, 3)
	const row = f.read((reading) => explorationLive(reading, 'x-1').explorers.find((item) => item.explorer === 'a1'))
	assert.equal(row?.activity, 'Bash: three')
	assert.notEqual(row?.activityAt, null)
	await send('not a tester', 'merge')
	assert.equal(lines().length, 3)
})

test('the status bar counts open requests, /permissions opens the first one, and the record lists the options', async (t) => {
	const f = await fixture(t)
	const empty = await call(f.ui, '/permissions')
	assert.equal(empty.status, 303)
	assert.equal(empty.headers.location, '/activity')
	assert.match((await call(f.ui, '/')).body, /data-region="permissions-link"\s+hidden/)
	const asked = permission(f, 'a1', { ...asking, cwd: '/work/app' })
	await waitOpen(f, 1)
	const page = (await call(f.ui, '/activity', undefined, as)).body
	assert.match(page, /data-region="permissions-link"\s*>1 permission</)
	const first = await call(f.ui, '/permissions', undefined, { ...as, Referer: new URL('/log?q=x', f.ui.url).href })
	assert.equal(first.status, 303)
	assert.equal(first.headers.location, '/permissions/x-1/P1?from=%2Flog%3Fq%3Dx')
	const record = (await call(f.ui, '/permissions/x-1/P1', undefined, as)).body
	assert.match(record, /<h1[^>]*>Tester a1 asks to run a command<\/h1>/)
	assert.match(record, /<pre class="sp-code" tabindex="0">npm view left-pad<\/pre>/)
	assert.match(record, /<code>\/<wbr \/>work\/<wbr \/>app<\/code>/)
	const order = [
		'value="allow"',
		'value="allow-kind"',
		'value="allow-tool"',
		'value="always"',
		'data-reveal="deny"',
		'value="stop"',
	].map((name) => record.indexOf(name, record.indexOf('class="sp-optlist asks"')))
	assert(
		order.every((position) => position > 0),
		JSON.stringify(order)
	)
	assert.deepEqual(
		order,
		[...order].sort((a, b) => a - b)
	)
	assert.match(record, /<code>Bash\(npm view \*\)<\/code>[\s\S]*\.claude\/settings\.local\.json/)
	assert.match(record, /Allow every Bash call for this test/)
	assert.match(record, /Stop tester a1…/)
	const settings = (await call(f.ui, '/settings/claude')).body
	assert.match(settings, /Testers that start now can ask you in this UI/)
	assert.match(
		settings,
		/With the rule <code>Bash<\/code>, testers run commands without asking\. Without it, each command asks you\s+here, and a tester waits up to 10 minutes for the answer\./
	)
	await decide(f, 'P1', { decision: 'allow' })
	await asked
})

test('after an answer the next open request opens, and the last answer returns to where the person came from', async (t) => {
	const f = await fixture(t)
	const first = permission(f, 'a1', ask)
	const second = permission(f, 'a2', ask)
	await waitOpen(f, 2)
	const csrf = token((await call(f.ui, '/activity', undefined, as)).body)
	const one = await call(f.ui, '/permissions/x-1/P1', { csrf, decision: 'allow', from: '/log' }, as)
	assert.equal(one.headers.location, '/permissions/x-1/P2?from=%2Flog')
	assert.match(String(one.headers['set-cookie']), /Answered%20x-1%2FP1%3A%20allowed%20once%2C%20by%20tester/)
	const two = await call(f.ui, '/permissions/x-1/P2', { csrf, decision: 'allow', from: '/log' }, as)
	assert.equal(two.headers.location, '/log')
	await first
	await second
	const outside = await call(f.ui, '/permissions/x-1/P2', { csrf, decision: 'allow', from: 'http://evil.test/' }, as)
	assert.equal(outside.headers.location, '/permissions/x-1/P2')
	const away = await call(f.ui, '/permissions/x-1/P2?from=%2F%2Fevil.test', undefined, as)
	assert.match(away.body, /data-moves-on data-next="\/activity"/)
	assert.match(away.body, /data-back="\/activity"/)
})

test('a denial without a reason shows the record again with the refusal at the field, and a bulk answer skips answered requests', async (t) => {
	const f = await fixture(t)
	const first = permission(f, 'a1', ask)
	const second = permission(f, 'a2', ask)
	const third = permission(f, 'a1', ask)
	await waitOpen(f, 3)
	const csrf = token((await call(f.ui, '/activity', undefined, as)).body)
	const empty = await call(f.ui, '/permissions/x-1/P1', { csrf, decision: 'deny', reason: '  ', from: '/log' }, as)
	assert.equal(empty.status, 422)
	assert.match(empty.body, /<p class="form-error" role="alert" data-field="reason">A denial needs a reason\./)
	assert.equal(open(f).length, 3)
	const plain = (name: string) => `permission:checkout:x-1/${name}`
	const none = await call(f.ui, '/permissions/bulk', { csrf, decision: 'allow', return: '/log' }, as)
	assert.equal(none.status, 422)
	assert.match(none.body, /Select at least one request/)
	const noReason = await call(
		f.ui,
		'/permissions/bulk',
		[
			['csrf', csrf],
			['decision', 'deny'],
			['return', '/log'],
			['pick', plain('P1')],
		],
		as
	)
	assert.match(noReason.body, /A denial needs a reason/)
	assert.equal(open(f).length, 3)
	await decide(f, 'P3', { decision: 'allow' })
	await third
	const bulk = await call(
		f.ui,
		'/permissions/bulk',
		[
			['csrf', csrf],
			['decision', 'deny'],
			['reason', 'Not now.'],
			['return', '/plans/checkout'],
			['pick', plain('P1')],
			['pick', plain('P2')],
			['pick', plain('P3')],
		],
		as
	)
	assert.equal(bulk.status, 303)
	assert.equal(bulk.headers.location, '/plans/checkout')
	assert.match(
		String(bulk.headers['set-cookie']),
		/Denied%3A%202%20requests\.%201%20request%20had%20an%20answer%20already/
	)
	assert.equal((await first).body, wrap('{"behavior":"deny","message":"Not now."}'))
	assert.equal((await second).body, wrap('{"behavior":"deny","message":"Not now."}'))
	assert.deepEqual(
		(await requests(f)).map((item) => item.decision?.kind),
		['deny', 'deny', 'allow']
	)
	assert.equal(open(f).length, 0)
})

test('Settings says when testers started now cannot ask', async (t) => {
	const f = await fixture(t)
	writeFileSync(uiFilePath(f.workspace), JSON.stringify({ port: 1, pid: 2 ** 22 + 5, hookToken: 'old' }))
	assert.match((await call(f.ui, '/settings/claude')).body, /Testers that start now cannot ask you/)
})

test('a child gets the hooks and the token only when ui.json names a live server', () => {
	const context = { hiddenPlugin: 'checkmate@checkmate', claudeArgs: ['--model', 'haiku'], deny: ['Read(./x)'] }
	const without = childArgs(context, ['--session-id', 's1'])
	assert.deepEqual(without, [
		'-p',
		'--model',
		'haiku',
		'--settings',
		JSON.stringify({ enabledPlugins: { 'checkmate@checkmate': false }, permissions: { deny: ['Read(./x)'] } }),
		'--session-id',
		's1',
		'--output-format',
		'json',
		'--permission-prompts',
		'none',
	])
	assert.deepEqual(childArgs({ ...context, hook: undefined }, ['--session-id', 's1']), without)
	const env = { PATH: '/bin', CHECKMATE_HOOK_TOKEN: 'inherited', CHECKMATE_ACTOR: 'x' }
	assert.deepEqual(childEnv(env, { A: '1' }), { PATH: '/bin', A: '1' })
	const hook = { port: 4321, token: 'abc', explorationId: 'x-1', who: 'a1' }
	const settings = JSON.parse(childArgs({ ...context, hook }, ['--session-id', 's1'])[4])
	const entry = (path: string, timeout: number) => [
		{
			hooks: [
				{
					type: 'http',
					url: `http://127.0.0.1:4321/hooks/${path}/x-1/a1`,
					timeout,
					headers: { Authorization: 'Bearer $CHECKMATE_HOOK_TOKEN' },
					allowedEnvVars: ['CHECKMATE_HOOK_TOKEN'],
				},
			],
		},
	]
	assert.deepEqual(settings, {
		enabledPlugins: { 'checkmate@checkmate': false },
		permissions: { deny: ['Read(./x)'] },
		hooks: { PermissionRequest: entry('permission', 600), PreToolUse: entry('activity', 5) },
	})
	const others = childArgs({ ...context, hook }, ['--session-id', 's1'])
	assert.deepEqual([...others.slice(0, 4), ...others.slice(5)], [...without.slice(0, 4), ...without.slice(5)])
	assert.deepEqual(childEnv(env, { A: '1' }, hook), { PATH: '/bin', A: '1', CHECKMATE_HOOK_TOKEN: 'abc' })
})

test('every child of a run and of its follow-up gets the hooks of its own step, and no other argument changes', async (t) => {
	const defect = { kind: 'defect', title: 'Coupon stacks', severity: 'high', expected: '450', actual: '400' }
	const question = { kind: 'question', id: 'Q1', question: 'Can a coupon apply to a sale item?' }
	const ws = workspaceWithFake(t, { explorer: 'Tested.', recorder: [defect, question] })
	t.after(() => endProcessesIn(ws.workspace))
	const server = await serverOf(t, ws.workspace)
	const file = JSON.parse(readFileSync(uiFilePath(ws.workspace), 'utf8'))
	const command = (args: string[]) =>
		run([...args, '--workspace', ws.workspace, '--json'], {
			cwd: ws.workspace,
			env: { ...ws.env, CHECKMATE_ACTOR: actor },
			stdin: () => '',
		})
	const started = command(['explore', 'start', 'checkout', '--build', 'b1', '--allow', 'Read', '--level', 'normal'])
	assert.equal(started.code, 0, started.output)
	const ended = (step: string) =>
		waitFor(`the ${step} of x-1`, () =>
			server.read((reading) => explorationEvents(reading, 'x-1').some((item) => item.step === step))
		)
	await ended('done')
	const answer = ['gap', 'answer', 'checkout', 'a1/Q1', '--kind', 'defer', '--value', 'No.', '--rationale', 'Rule.']
	assert.equal(command(answer).code, 0)
	assert.equal(command(['explore', 'follow', 'x-1', '--allow', 'Read']).code, 0)
	await ended('followed')
	const calls = ws.called()
	const urls = (settings: string) => {
		const hooks = JSON.parse(settings).hooks
		return [hooks.PermissionRequest[0].hooks[0].url, hooks.PreToolUse[0].hooks[0].url]
	}
	const seen = new Map<string, string>()
	for (const item of calls) {
		const settings = item.args[item.args.indexOf('--settings') + 1]
		assert.deepEqual(item.env.includes('CHECKMATE_HOOK_TOKEN'), true, item.role)
		const [permissionUrl, activityUrl] = urls(settings)
		assert.equal(permissionUrl.startsWith(`http://127.0.0.1:${file.port}/hooks/permission/x-1/`), true)
		assert.equal(activityUrl, permissionUrl.replace('/permission/', '/activity/'))
		seen.set(item.role, permissionUrl.split('/').pop()!)
		assert(
			!item.args.some(
				(arg: string) => /^--(allowed-?[tT]ools|tools|disallowed)/.test(arg) && item.role === 'recorder'
			)
		)
	}
	assert.equal(seen.get('recorder')?.startsWith('record-a'), true)
	assert.equal(seen.get('merger'), 'merge')
	assert.equal(seen.get('verifier'), 'verify')
	assert.equal(/^a[12]$/.test(seen.get('explorer')!), true)
	assert.equal(/^a[12]$/.test(seen.get('tester')!), true)
	assert.equal(/^a[12]$/.test(seen.get('follower')!), true)
})

test('children of a run get the arguments of today when no UI runs', async (t) => {
	const ws = workspaceWithFake(t, { explorer: 'Tested.', recorder: [] })
	t.after(() => endProcessesIn(ws.workspace))
	const command = (args: string[]) =>
		run([...args, '--workspace', ws.workspace, '--json'], {
			cwd: ws.workspace,
			env: { ...ws.env, CHECKMATE_ACTOR: actor },
			stdin: () => '',
		})
	writeUiFile(ws.workspace, { port: 4321, pid: 2 ** 22 + 5, hookToken: 'stale' })
	const started = command(['explore', 'start', 'checkout', '--build', 'b1', '--allow', 'Read', '--level', 'smoke'])
	assert.equal(started.code, 0, started.output)
	await waitFor('the end of x-1', () =>
		ws.read((reading) => explorationEvents(reading, 'x-1').some((item) => item.step === 'done'))
	)
	for (const item of ws.called()) {
		assert.doesNotMatch(item.args.join(' '), /hooks|127\.0\.0\.1/, item.role)
		assert.deepEqual(
			item.env.filter((name: string) => name === 'CHECKMATE_HOOK_TOKEN'),
			[]
		)
	}
})

test('a tester asks through the hook of its own settings, a person answers in the UI, and the record has both events', async (t) => {
	const ws = workspaceWithFake(t, { explorer: '!ask', recorder: [] })
	t.after(() => endProcessesIn(ws.workspace))
	const f = await serverOf(t, ws.workspace)
	const started = run(
		[
			'explore',
			'start',
			'checkout',
			'--build',
			'b1',
			'--allow',
			'Read',
			'--level',
			'smoke',
			'--workspace',
			ws.workspace,
			'--json',
		],
		{ cwd: ws.workspace, env: { ...ws.env, CHECKMATE_ACTOR: actor }, stdin: () => '' }
	)
	assert.equal(started.code, 0, started.output)
	await waitOpen(f, 1)
	const [asked] = open(f)
	assert.deepEqual(
		[asked.id, asked.who, asked.tool, asked.input],
		['P1', 'a1', 'Bash', { command: 'npm view left-pad' }]
	)
	assert.deepEqual(ws.answers(), [])
	assert.equal((await decide(f, 'P1', { decision: 'allow-kind' })).status, 303)
	await waitFor('the answer of the fake', () => ws.answers().length === 1)
	assert.equal(ws.answers()[0], wrap(`{"behavior":"allow","updatedPermissions":[${rule('session')}]}`))
	await waitFor('the end of x-1', () =>
		f.read((reading) => explorationEvents(reading, 'x-1').some((item) => item.step === 'done'))
	)
	const events = f.read((reading) => explorationEvents(reading, 'x-1'))
	const steps = events
		.filter((item) => item.step.startsWith('permission'))
		.map((item) => [item.step, item.explorer, item.status])
	assert.deepEqual(steps, [
		['permission', 'a1', 'open'],
		['permission-decision', 'a1', 'allow-kind'],
	])
	assert.equal(
		events.some((item) => item.step === 'activity' && item.detail.activity === 'Bash: npm view left-pad'),
		true
	)
	assert.equal(existsSync(`${root}/plugin/src/ui/hooks.ts`), true)
})
