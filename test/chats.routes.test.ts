import assert from 'node:assert/strict'
import { test } from 'node:test'
import { askRequest, chatOf, requestOf, setRequestState } from '../plugin/src/requests.ts'
import { decidePermission, permissionRules, requestPermission } from '../plugin/src/permissions.ts'
import { startUi } from '../plugin/src/ui/server.ts'
import { call, token, waitFor } from './actions.ts'
import { fakeClaude } from './claude.ts'
import { begin, ready, store } from './support.ts'

test('Find starts chats with a real screen origin and follow-ups keep the original context', async (t) => {
	const opened = store(t)
	ready(opened)
	begin(opened)
	const legacy = askRequest(opened, 'qa', { text: 'Existing request', context: { planId: null, record: null } })
	setRequestState(opened, legacy, 'answered', { reply: 'Existing reply' })
	const fake = fakeClaude(t, { request: 'Fixture reply.' })
	const ui = await startUi({ workspace: opened.workspace, env: fake.env, defaultActor: 'qa' })
	t.after(() => ui.close())
	const csrf = token((await call(ui, '/chats')).body)
	const ask = (path: string, fields: Record<string, string>) => call(ui, path, { csrf, ...fields })
	const list = await call(ui, '/chats')
	assert.match(list.body, /Existing request/)
	const launched = await ask('/requests', { chat: '1', text: 'Explain this run', screen: '/runs/run-1' })
	assert.equal(launched.status, 303)
	const address = String(launched.headers.location)
	assert.match(address, /^\/chats\/[0-9a-f-]+$/)
	const id = address.split('/').at(-1)!
	const turn = chatOf(opened, id)!.turns[0]
	assert.deepEqual(turn.context, {
		planId: 'checkout',
		planRevision: 2,
		record: { kind: 'run', id: 'run-1' },
	})
	await waitFor('the first reply', () => chatOf(opened, id)?.turns[0].state === 'answered')
	const reply = await ask(`${address}/turns`, { text: 'What next?', screen: '/plans' })
	assert.equal(reply.status, 303)
	assert.equal(reply.headers.location, address)
	assert.deepEqual(
		chatOf(opened, id)?.turns.map((item) => item.context),
		[turn.context, turn.context]
	)
	const separate = await ask('/chats', { text: 'Summarize plans', screen: '/' })
	assert.equal(separate.status, 303)
	assert.notEqual(separate.headers.location, address)
	const planList = chatOf(opened, String(separate.headers.location).split('/').at(-1)!)
	assert.deepEqual(planList?.context, { planId: null, record: null, page: 'plans' })
	const refused = await ask(`${address}/turns`, { text: 'Invalid harness', harness: 'unknown' })
	assert.equal(refused.status, 422)
	assert.equal(chatOf(opened, id)?.turns.length, 2)
})

test('chat tool grants stay within the harness where the oracle approved them', (t) => {
	const opened = store(t)
	const context = { planId: null, record: null }
	const first = askRequest(opened, 'qa', { text: 'First', context, harness: 'claude', chatId: null })
	const chatId = requestOf(opened, first)!.conversation
	const asked = requestPermission(opened, { askerId: first, who: first, tool: 'Bash', input: {}, suggestions: [] })
	decidePermission(opened, 'qa', { askerId: first, requestId: asked.id, decision: 'allow-tool' }, () => {})
	const pi = askRequest(opened, 'qa', { text: 'Switch to Pi', context, harness: 'pi', chatId })
	const again = askRequest(opened, 'qa', { text: 'Back to Claude Code', context, harness: 'claude', chatId })
	assert.deepEqual(permissionRules(opened, pi), [])
	assert.equal(permissionRules(opened, again)[0]?.rule, 'Bash')
})
