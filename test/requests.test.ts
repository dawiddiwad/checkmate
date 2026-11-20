import test from 'node:test'
import assert from 'node:assert/strict'
import type { TestContext } from 'node:test'
import { mkdirSync } from 'node:fs'
import { join } from 'node:path'
import { readStreamLine } from '../plugin/src/ui/requester.ts'
import { startUi } from '../plugin/src/ui/server.ts'
import { checkmateScript, pluginRoot, requestSystemPrompt, uiFilePath } from '../plugin/src/sessions.ts'
import { allRequests, currentConversation, requestOf } from '../plugin/src/requests.ts'
import { explorationPermissions, openPermissions } from '../plugin/src/permissions.ts'
import { closeStore, openStore } from '../plugin/src/store.ts'
import { saveRequestModel } from '../plugin/src/settings.ts'
import { readFileSync } from 'node:fs'
import { call, endProcessesIn, token, waitFor, workspaceWithFake } from './actions.ts'
import { directory } from './support.ts'
import type { FakeReplies } from './claude.ts'

const stops = { terminate: 150, kill: 150 }

async function serverOf(t: TestContext, replies: FakeReplies = {}, env: Record<string, string | undefined> = {}) {
	const w = workspaceWithFake(t, replies)
	const logs: string[] = []
	const ui = await startUi({
		workspace: w.workspace,
		env: { ...w.env, ...env },
		defaultActor: 'qa-lead',
		stopDelays: stops,
		log: (line) => logs.push(line),
	})
	t.after(async () => {
		await ui.close()
		endProcessesIn(w.workspace)
	})
	const hook = JSON.parse(readFileSync(uiFilePath(w.workspace), 'utf8')) as { port: number; hookToken: string }
	const post = async (path: string, form: Record<string, string>, headers: Record<string, string> = {}) => {
		const csrf = token((await call(ui, '/activity')).body)
		return call(ui, path, { csrf, ...form }, headers)
	}
	const ask = async (text: string, screen = '') => {
		const sent = await post('/requests', { text, screen })
		assert.equal(sent.status, 303, sent.body)
		return String(sent.headers.location).replace('/requests/', '')
	}
	const request = (id: string) => w.read((reading) => requestOf(reading, id))
	const state = (id: string, wanted: string) =>
		waitFor(`${id} is ${wanted}`, () => request(id)?.state === wanted && request(id))
	return { ...w, ui, logs, hook, post, ask, request, state }
}

const sample = [
	{ type: 'system', subtype: 'init', session_id: 's-1', cwd: '/w', model: 'm', tools: ['Bash'] },
	{ type: 'assistant', message: { role: 'assistant', content: [{ type: 'text', text: 'Let me look.' }] } },
	{
		type: 'assistant',
		cwd: '/w',
		message: {
			role: 'assistant',
			content: [
				{
					type: 'tool_use',
					id: 't1',
					name: 'Bash',
					input: { command: 'curl -H "Authorization: Bearer abc" x' },
				},
			],
		},
	},
	{ type: 'user', message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: 't1', content: 'ok' }] } },
	{
		type: 'result',
		subtype: 'success',
		is_error: false,
		result: 'D3 fails.',
		total_cost_usd: 0.06,
		permission_denials: [],
	},
].map((line) => JSON.stringify(line))

test('the stream reader finds the session, the tool calls, and the result, and flags broken lines', () => {
	assert.deepEqual(readStreamLine(sample[0]), [{ kind: 'session', sessionId: 's-1' }])
	assert.deepEqual(readStreamLine(sample[1]), [{ kind: 'other' }])
	assert.deepEqual(readStreamLine(sample[2]), [
		{ kind: 'tool', name: 'Bash', input: { command: 'curl -H "Authorization: Bearer abc" x' }, cwd: '/w' },
	])
	assert.deepEqual(readStreamLine(sample[3]), [{ kind: 'other' }])
	const [result] = readStreamLine(sample[4])
	assert.equal(result.kind === 'result' && result.value.result, 'D3 fails.')
	for (const broken of ['not json', '[1]', '"text"', '{"type":', ''])
		assert.deepEqual(readStreamLine(broken), [{ kind: 'broken' }], broken)
})

test('the first request starts claude with a fixed argument list, and a later one resumes the conversation', async (t) => {
	const f = await serverOf(t, { request: 'First reply.' })
	const first = await f.ask('why does D3 fail?', '/plans/checkout')
	await f.state(first, 'answered')
	const conversation = f.read((reading) => currentConversation(reading))!.sessionId
	assert.match(conversation, /^[0-9a-f-]{36}$/)
	const settings = JSON.stringify({
		hooks: {
			PermissionRequest: [
				{
					hooks: [
						{
							type: 'http',
							url: `http://127.0.0.1:${f.hook.port}/hooks/permission/request/R1`,
							timeout: 600,
							headers: { Authorization: 'Bearer $CHECKMATE_HOOK_TOKEN' },
							allowedEnvVars: ['CHECKMATE_HOOK_TOKEN'],
						},
					],
				},
			],
			PreToolUse: [
				{
					hooks: [
						{
							type: 'http',
							url: `http://127.0.0.1:${f.hook.port}/hooks/activity/request/R1`,
							timeout: 5,
							headers: { Authorization: 'Bearer $CHECKMATE_HOOK_TOKEN' },
							allowedEnvVars: ['CHECKMATE_HOOK_TOKEN'],
						},
					],
				},
			],
		},
	})
	const common = (id: string, resume: boolean) => [
		'-p',
		'--output-format',
		'stream-json',
		'--verbose',
		resume ? '--resume' : '--session-id',
		conversation,
		'--plugin-dir',
		pluginRoot,
		'--settings',
		settings.replaceAll('/request/R1', `/request/${id}`),
		'--append-system-prompt',
		requestSystemPrompt(checkmateScript()),
	]
	const [one] = f.called()
	assert.deepEqual(one.args, common('R1', false))
	assert.equal(one.cwd, f.workspace)
	assert.equal(
		one.prompt,
		'why does D3 fail?\n\nFor context only: the person had plan checkout on screen. Use this only when the request refers to it.'
	)
	assert.equal(one.actor, 'qa-lead via request R1')
	assert(['CHECKMATE_ACTOR', 'CHECKMATE_HOOK_TOKEN', 'CHECKMATE_REQUEST'].every((name) => one.env.includes(name)))
	const second = await f.ask('and D4?')
	await f.state(second, 'answered')
	const [two] = f.called()
	assert.deepEqual(two.args, common('R2', true))
	assert.equal(two.prompt, 'and D4?')
	assert.equal(two.actor, 'qa-lead via request R2')
	const names = [...one.args, ...two.args]
	for (const flag of ['--tools', '--allowedTools', '--allowed-tools', '--disallowedTools', '--model', '--bare'])
		assert(!names.includes(flag), flag)
})

test('a conversation that never started its session is started again, and a new conversation has a new ID', async (t) => {
	const f = await serverOf(t, { request: '!auth' })
	const first = await f.ask('hello')
	await f.state(first, 'failed')
	f.reply({ request: 'Fine.' })
	const second = await f.ask('hello again')
	await f.state(second, 'answered')
	const [, again] = f.called()
	assert(again.args.includes('--session-id') && !again.args.includes('--resume'))
	const before = f.read((reading) => currentConversation(reading))!.sessionId
	assert.equal((await f.post('/requests/conversation', { return: '/requests' })).status, 303)
	const third = await f.ask('new start')
	await f.state(third, 'answered')
	const [last] = f.called()
	assert.notEqual(f.read((reading) => currentConversation(reading))!.sessionId, before)
	assert(last.args.includes('--session-id') && !last.args.includes(before))
})

test('the model setting adds --model and an empty setting removes it', async (t) => {
	const f = await serverOf(t, { request: 'Done.' })
	f.read((reading) => saveRequestModel(reading, 'qa-lead', 'sonnet'))
	await f.state(await f.ask('one'), 'answered')
	const [withModel] = f.called()
	assert.deepEqual(withModel.args.slice(-2), ['--model', 'sonnet'])
	const refused = await f.post('/settings/claude/model', { model: 'bad model; rm -rf' })
	assert.equal(refused.status, 422)
	assert.match(refused.body, /is not a model alias or ID/)
	assert.equal((await f.post('/settings/claude/model', { model: '' })).status, 303)
	await f.state(await f.ask('two'), 'answered')
	assert(!f.called()[0].args.includes('--model'))
})

test('activity lines, the reply, the cost, and the denials are recorded from the stream', async (t) => {
	const f = await serverOf(t, {
		request: {
			result: 'D3 fails because of the fee.',
			cost: 0.12,
			tools: [
				{ name: 'Bash', input: { command: 'curl -H "Authorization: Bearer abc123" http://x' } },
				{ name: 'Read', input: { file_path: join(process.cwd(), 'a.txt') } },
			],
			ask: [{ name: 'Write', input: { file_path: '/tmp/x.txt', content: 'x' }, rule: '' }],
		},
	})
	const id = await f.ask('why does D3 fail?')
	const open = await waitFor('the permission request of R1', () =>
		f.read((reading) => openPermissions(reading)).find((item) => item.askerId === id)
	)
	assert.equal(open.fromRequest, true)
	assert.equal((await f.post(`/permissions/${id}/P1`, { decision: 'deny', reason: 'No writes.' })).status, 303)
	const done = await f.state(id, 'answered')
	assert.deepEqual(
		done.activity.map((entry) => entry.line),
		['Bash: curl -H "Authorization: Bearer …" http://x', `Read: ${join(process.cwd(), 'a.txt')}`]
	)
	assert.equal(done.reply, 'D3 fails because of the fee.')
	assert.equal(done.costUsd, 0.12)
	assert.deepEqual(done.denials, ['Write: /tmp/x.txt'])
	assert.equal(done.sessionId, f.read((reading) => currentConversation(reading))!.sessionId)
})

test('a second request waits and starts when the first ends', async (t) => {
	const f = await serverOf(t, { request: '!hang' })
	const first = await f.ask('first')
	await waitFor('the first runs', () => f.answers().includes('hanging'))
	const second = await f.ask('second')
	assert.equal(f.request(second)?.state, 'waiting')
	f.reply({ request: 'Second reply.' })
	assert.equal((await f.post(`/requests/${first}/stop`, {})).status, 303)
	await f.state(first, 'stopped')
	const done = await f.state(second, 'answered')
	assert.equal(done.reply, 'Second reply.')
	assert.equal(f.called().length, 2)
})

for (const [reply, how] of [
	['!hang', 'SIGINT'],
	['!ignore-interrupt', 'SIGTERM'],
	['!stubborn', 'SIGKILL'],
] as const)
	test(`stop ends a request that ignores signals in steps: ${how}`, async (t) => {
		const f = await serverOf(t, { request: reply })
		const id = await f.ask('slow')
		await waitFor('the child hangs', () => f.answers().includes('hanging'))
		const waiting = await f.ask('later')
		assert.equal((await f.post(`/requests/${id}/stop`, { reason: 'Too slow.' })).status, 303)
		const stopped = await f.state(id, 'stopped')
		assert.equal(stopped.reason, 'Too slow.')
		f.reply({ request: 'Back.' })
		assert.equal((await f.state(waiting, 'answered')).reply, 'Back.')
		const again = await f.ask('go on')
		assert.equal((await f.state(again, 'answered')).reply, 'Back.')
		const calls = f.called()
		assert.equal(calls.length, 3)
		assert(calls[1].args.includes('--resume') && calls[2].args.includes('--resume'))
		assert.equal(calls[1].session, calls[0].session)
	})

test('stopping a waiting request keeps it from starting', async (t) => {
	const f = await serverOf(t, { request: '!hang' })
	const first = await f.ask('first')
	await waitFor('the first runs', () => f.answers().includes('hanging'))
	const second = await f.ask('second')
	await f.post(`/requests/${second}/stop`, {})
	assert.equal(f.request(second)?.state, 'stopped')
	await f.post(`/requests/${first}/stop`, {})
	await f.state(first, 'stopped')
	assert.equal(f.called().length, 1)
})

test('a server that stops ends the running request as interrupted, and a restart interrupts a stale one', async (t) => {
	const f = await serverOf(t, { request: '!hang' })
	const first = await f.ask('first')
	await waitFor('the first runs', () => f.answers().includes('hanging'))
	const second = await f.ask('second')
	await f.ui.close()
	assert.equal(f.request(first)?.state, 'interrupted')
	assert.equal(f.request(first)?.reason, 'The UI stopped before the request ended.')
	assert.equal(f.request(second)?.state, 'interrupted')
	const again = await startUi({ workspace: f.workspace, env: f.env, defaultActor: 'qa-lead', stopDelays: stops })
	t.after(() => again.close())
	assert.equal(f.request(first)?.state, 'interrupted')
	assert.equal(f.request(second)?.state, 'interrupted')
	assert.equal(f.called().length, 1)
})

test('a request recorded as running with no process is interrupted when the UI starts', async (t) => {
	const w = workspaceWithFake(t, {})
	const writer = openStore(w.workspace)
	const { askRequest, setRequestState } = await import('../plugin/src/requests.ts')
	const id = askRequest(writer, 'qa-lead', { text: 'stale', context: { planId: null, record: null } })
	setRequestState(writer, id, 'running')
	closeStore(writer)
	const ui = await startUi({ workspace: w.workspace, env: w.env, defaultActor: 'qa-lead' })
	t.after(() => ui.close())
	const reading = openStore(w.workspace)
	t.after(() => closeStore(reading))
	assert.equal(requestOf(reading, id)?.state, 'interrupted')
})

test('the store changes of a request are listed with the request, attributed by its actor', async (t) => {
	const f = await serverOf(t, {
		request: {
			result: 'Answered G1 and deferred G2.',
			run: [
				[
					'gap',
					'answer',
					'checkout',
					'G1',
					'--kind',
					'clarify',
					'--value',
					'Promotion replaces loyalty.',
					'--source',
					'decisions#promotion',
					'--rationale',
					'Asked in the UI.',
				],
				[
					'gap',
					'answer',
					'checkout',
					'G2',
					'--kind',
					'defer',
					'--value',
					'Out of scope.',
					'--rationale',
					'Asked in the UI.',
				],
			],
		},
	})
	const id = await f.ask('answer G1 and defer G2')
	const done = await f.state(id, 'answered')
	assert.deepEqual(
		done.changes.map((change) => [change.text, change.href]),
		[
			['answered checkout/G1', '/plans/checkout'],
			['answered checkout/G2', '/plans/checkout'],
		]
	)
	assert.deepEqual(
		f
			.answers()
			.filter((line) => line.startsWith('ran'))
			.map((line) => line.slice(-1)),
		['0', '0']
	)
	const operations = f.read((reading) =>
		reading.db.prepare("SELECT DISTINCT actor, via FROM operations WHERE command = 'gap answer'").all()
	)
	assert.deepEqual(
		operations.map((row) => ({ ...row })),
		[{ actor: 'qa-lead via request R1', via: 'R1' }]
	)
})

test('a change made with another --actor is still a change of the request', async (t) => {
	const f = await serverOf(t, {
		request: {
			result: 'Answered G1.',
			run: [
				[
					'gap',
					'answer',
					'checkout',
					'G1',
					'--kind',
					'defer',
					'--value',
					'Out of scope.',
					'--rationale',
					'Asked in the UI.',
					'--actor',
					'other',
				],
			],
		},
	})
	const id = await f.ask('answer G1')
	const done = await f.state(id, 'answered')
	assert.deepEqual(
		done.changes.map((change) => change.text),
		['answered checkout/G1']
	)
	const stored = f.read((reading) =>
		reading.db.prepare("SELECT actor, via FROM operations WHERE command = 'gap answer'").all()
	)
	assert.deepEqual(
		stored.map((row) => ({ ...row })),
		[{ actor: 'other', via: id }]
	)
	const page = await call(f.ui, `/requests/${id}`)
	assert(page.body.includes('answered checkout/G1'))
	assert(!page.body.includes('changed no record'))
	const log = await call(f.ui, '/log')
	assert(log.body.includes(`href="/requests/${id}">via request ${id}`))
})

test('a request without a write says that it changed no record', async (t) => {
	const f = await serverOf(t, { request: { result: 'Nothing to do.' } })
	const id = await f.ask('look')
	await f.state(id, 'answered')
	const page = await call(f.ui, `/requests/${id}`)
	assert(page.body.includes('The request changed no record.'))
})

test('a stopped request shows its activity and the changes that it made, and a running one says when changes show', async (t) => {
	const f = await serverOf(t, {
		request: {
			tools: [{ name: 'Bash', input: { command: 'checkmate gap answer checkout G1' } }],
			run: [['gap', 'answer', 'checkout', 'G1', '--kind', 'defer', '--value', 'Out.', '--rationale', 'UI.']],
			hang: true,
		},
	})
	const id = await f.ask('answer G1')
	await waitFor('the child hangs', () => f.answers().includes('hanging'))
	await waitFor('the activity shows', () => f.request(id)?.activity.length === 1)
	const running = await call(f.ui, `/requests/${id}`)
	assert(running.body.includes('Changes show when the request ends.'))
	assert(!running.body.includes('changed no record'))
	await f.post(`/requests/${id}/stop`, {})
	await f.state(id, 'stopped')
	const page = await call(f.ui, `/requests/${id}`)
	assert(page.body.includes('Stopped by you.'))
	assert(page.body.includes('Bash: checkmate gap answer checkout G1'))
	assert(page.body.includes('answered checkout/G1'))
	assert(!page.body.includes('changed no record'))
})

test('each failure gives its sentence', async (t) => {
	const f = await serverOf(t, { request: '!crash' })
	const crashed = await f.state(await f.ask('crash'), 'failed')
	const lines = crashed.reason!.split('\n')
	assert.equal(lines[0], 'claude ended without a reply.')
	assert.equal(lines.length, 21)
	assert.equal(lines.at(-1), 'stack line 30')
	f.reply({ request: '!garbage' })
	const garbage = await f.state(await f.ask('garbage'), 'failed')
	assert.match(garbage.reason!, /^claude printed a line that is not JSON\./)
	f.reply({ request: '!auth' })
	const auth = await f.state(await f.ask('auth'), 'failed')
	assert.match(auth.reason!, /^claude ended without a reply\.\nInvalid API key/)
	f.reply({ request: { isError: true, result: 'Authentication error: log in.' } })
	const error = await f.state(await f.ask('error'), 'failed')
	assert.match(error.reason!, /^claude ended with an error: Authentication error: log in\./)
	assert.match(error.hint!, /does not pass its login token/)
	f.reply({ request: { noResult: true } })
	const none = await f.state(await f.ask('none'), 'failed')
	assert.match(none.reason!, /^claude ended without a reply\./)
})

test('a missing claude program fails the request with the engine sentence', async (t) => {
	const empty = directory(t)
	mkdirSync(join(empty, 'bin'))
	const f = await serverOf(t, {}, { PATH: join(empty, 'bin') })
	const failed = await f.state(await f.ask('anybody there?'), 'failed')
	assert.match(failed.reason!, /^No claude executable on PATH\. Nothing changed\./)
	const page = (await call(f.ui, `/requests/${failed.id}`)).body
	assert.match(page, /Claude Code was not found: no claude program is on PATH\./)
})

test('a tool that needs approval asks through the record of the request, and a rule lasts for the conversation', async (t) => {
	const asking = { name: 'Bash', input: { command: 'npm view left-pad' }, rule: 'npm view *' }
	const f = await serverOf(t, { request: { ask: [asking] } })
	const first = await f.ask('check the package')
	const open = await waitFor('the first permission request', () =>
		f.read((reading) => openPermissions(reading)).find((item) => item.askerId === first)
	)
	assert.equal(open.id, 'P1')
	const record = (await call(f.ui, `/permissions/${first}/P1`)).body
	assert.match(record, /<h1[^>]*>Request R1 asks to run a command<\/h1>/)
	assert.match(record, /Allow this command for this conversation/)
	assert.match(record, /Allow every Bash call for this conversation/)
	assert.match(record, /Stop the request…/)
	assert.match((await call(f.ui, '/activity')).body, /data-region="permissions-link"\s*>1 permission</)
	assert.equal((await f.post(`/permissions/${first}/P1`, { decision: 'allow-kind' })).status, 303)
	await f.state(first, 'answered')
	assert.match(f.answers().join('\n'), /"updatedPermissions":\[\{"type":"addRules".*"destination":"session"/)
	const second = await f.ask('check it again')
	await f.state(second, 'answered')
	const seen = f.read((reading) => explorationPermissions(reading, second))
	assert.equal(seen[0].decision?.kind, 'rule')
	assert.match(seen[0].decision!.text, /npm view \*/)
	await f.post('/requests/conversation', { return: '/requests' })
	const third = await f.ask('and in a new conversation')
	await waitFor(
		'a new permission request',
		() => f.read((reading) => explorationPermissions(reading, third)).length === 1
	)
	assert.equal(f.read((reading) => explorationPermissions(reading, third))[0].decision, null)
	await f.post(`/permissions/${third}/P1`, { decision: 'stop' })
	await f.state(third, 'stopped')
})

test('each decision answers the hook of a request as it answers a tester', async (t) => {
	const asking = { name: 'Bash', input: { command: 'npm view left-pad' }, rule: 'npm view *' }
	const f = await serverOf(t, { request: { ask: [asking] } })
	const wanted = [
		['allow', '"decision":{"behavior":"allow"}'],
		['allow-tool', '"rules":[{"toolName":"Bash"}]'],
		['always', '"destination":"localSettings"'],
		['deny', '"behavior":"deny","message":"Not now."'],
	]
	for (const [decision, body] of wanted) {
		await f.post('/requests/conversation', { return: '/requests' })
		const id = await f.ask(`try ${decision}`)
		await waitFor(`${decision} asks`, () =>
			f.read((reading) => openPermissions(reading)).some((item) => item.askerId === id)
		)
		await f.post(`/permissions/${id}/P1`, { decision, reason: 'Not now.' })
		await f.state(id, 'answered')
		assert(f.answers().at(-1)!.includes(body), `${decision}: ${f.answers().at(-1)}`)
	}
})

for (const [path, form] of [
	['/requests', { text: 'hello' }],
	['/requests/R1/stop', {}],
	['/requests/conversation', {}],
	['/settings/claude/model', { model: 'sonnet' }],
] as const)
	test(`${path} refuses a foreign origin and a missing token`, async (t) => {
		const f = await serverOf(t, { request: 'Done.' })
		const csrf = token((await call(f.ui, '/activity')).body)
		const foreign = await call(f.ui, path, { csrf, ...form }, { Origin: 'http://evil.example' })
		assert.equal(foreign.status, 403)
		const missing = await call(f.ui, path, { ...form })
		assert.equal(missing.status, 403)
		assert.equal(f.read((reading) => allRequests(reading)).length, 0)
	})

test('the request page shows model text as text and the reply as plain paragraphs and lists', async (t) => {
	const f = await serverOf(t, {
		request: {
			result: '<script>alert(1)</script> found.\nSecond line.\n\n- one <b>bold</b>\n- two\n\n1. first\n2. second',
		},
	})
	const id = await f.ask('<img src=x onerror=alert(1)>')
	await f.state(id, 'answered')
	const page = (await call(f.ui, `/requests/${id}`)).body
	assert(!page.includes('<script>alert'))
	assert(!page.includes('<img src=x'))
	assert.match(page, /<p>&lt;script&gt;alert\(1\)&lt;\/script&gt; found\.<br \/>Second line\.<\/p>/)
	assert.match(page, /<ul>\s*<li>one &lt;b&gt;bold&lt;\/b&gt;<\/li>\s*<li>two<\/li>\s*<\/ul>/)
	assert.match(page, /<ol>\s*<li>first<\/li>\s*<li>second<\/li>\s*<\/ol>/)
	assert.match(page, /Cost \$0\.06\./)
})

test('opening a reply marks it read, and the status bar counts unread replies', async (t) => {
	const f = await serverOf(t, { request: 'Done.' })
	const one = await f.ask('one')
	await f.state(one, 'answered')
	const two = await f.ask('two')
	await f.state(two, 'answered')
	assert.match(
		(await call(f.ui, '/activity')).body,
		/data-region="replies-link"[^>]*><span>2<span class="sb-long"> replies<\/span><\/span>/
	)
	const list = (await call(f.ui, '/requests')).body
	assert.match(list, /Not read\s*<span>2<\/span>/)
	assert(list.indexOf('data-key="request:R2"') < list.indexOf('data-key="request:R1"'))
	await call(f.ui, '/requests/R2')
	const after = (await call(f.ui, '/activity')).body
	assert.match(
		after,
		/href="\/requests\/R1"[^>]*data-region="replies-link"[^>]*><span>1<span class="sb-long"> reply<\/span><\/span>/
	)
	assert.match((await call(f.ui, '/requests')).body, /Earlier\s*<span>1<\/span>/)
})

test('Activity lists requests next to runs with their state and cost', async (t) => {
	const f = await serverOf(t, { request: { result: 'Done.', cost: 0.31 } })
	const id = await f.ask('why does D3 fail?')
	await f.state(id, 'answered')
	const page = (await call(f.ui, '/activity')).body
	const row = /<div[^>]*data-key="request:R1"[\s\S]*?<\/div>\s*(?=<div|<\/div>)/.exec(page)?.[0] ?? ''
	assert.match(row, /data-href="\/requests\/R1"/)
	assert.match(row, /data-status="answered"/)
	assert.match(row, /Request · why does D3 fail\?/)
	assert.match(row, /\$0\.31/)
	assert.match(page, /Showing 1–1 of 1 entry/)
})

test('Pi request stream rejects incomplete and aborted replies', () => {
	const line = (value: unknown) => JSON.stringify(value)
	const [length] = readStreamLine(
		line({
			type: 'agent_end',
			messages: [{ role: 'assistant', stopReason: 'length', content: [{ type: 'text', text: 'partial' }] }],
		}),
		'pi'
	)
	assert.equal(length.kind === 'result' && length.value.is_error, true)
	const [aborted] = readStreamLine(line({ type: 'agent_settled', aborted: true }), 'pi')
	assert.equal(aborted.kind === 'result' && aborted.value.is_error, true)
})
