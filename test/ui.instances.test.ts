import type { TestContext } from 'node:test'
import test from 'node:test'
import assert from 'node:assert/strict'
import { closeStore, openStore } from '../plugin/src/store.ts'
import { explorationStatus } from '../plugin/src/explorers.ts'
import { addInstance, retireInstance } from '../plugin/src/targets.ts'
import { startUi } from '../plugin/src/ui/server.ts'
import { actor } from './support.ts'
import { call, token, waitFor, workspaceWithFake } from './actions.ts'
import { done, openTest } from './explorations.ts'

const stacks = { kind: 'defect', title: 'Coupon stacks', severity: 'high', expected: '450', actual: '400' }

async function fixture(t: TestContext, instances: string[]) {
	const base = workspaceWithFake(t, { explorer: 'Tested.', recorder: [stacks], merger: [] })
	const opened = openStore(base.workspace)
	for (const instanceId of instances)
		addInstance(opened, actor, {
			targetId: 'checkout-local',
			instanceId,
			instance: { entries: { web: `http://127.0.0.1:4173/${instanceId}` }, environment: instanceId },
		})
	closeStore(opened)
	const ui = await startUi({ workspace: base.workspace, env: base.env })
	t.after(() => ui.close())
	const as = { Cookie: `checkmate_actor=${actor}` }
	const post = async (path: string, form: Record<string, string> = {}) =>
		call(ui, path, { csrf: token((await call(ui, '/plans/checkout')).body), ...form }, as)
	return { ui, post, ...base }
}

const start = { build: 'b1', level: 'smoke', rules: 'Read Bash' }
const radios = (body: string) => [...body.matchAll(/<input[^>]*name="instance"[^>]*>/g)].map((match) => match[0])

test('a target with one active instance shows no instance choice and starts as before', async (t) => {
	const { ui, post, read } = await fixture(t, [])
	assert.deepEqual(radios((await call(ui, '/plans/checkout')).body), [])
	assert.equal((await post('/plans/checkout/test', start)).status, 303)
	await waitFor('the run ends', () => read((reading) => explorationStatus(reading, 'x-1').state === 'completed'))
	assert.equal(
		read((reading) => explorationStatus(reading, 'x-1').instanceId),
		'local'
	)
})

test('a target with two active instances asks for one, in the dialog and at the field', async (t) => {
	const { ui, post, read } = await fixture(t, ['staging'])
	const page = (await call(ui, '/plans/checkout')).body
	assert.equal(radios(page).length, 2)
	assert.doesNotMatch(radios(page).join(''), /checked/)
	assert.match(page, /<kbd>1<\/kbd><span>local<\/span>/)
	assert.match(page, /<kbd>2<\/kbd><span>staging<\/span>/)
	const none = await post('/plans/checkout/test', start)
	assert.equal(none.status, 422)
	assert.match(none.body, /role="alert" data-field="instance"/)
	assert.match(none.body, /Choose the instance: local or staging\./)
	assert.doesNotMatch(none.body, /Name one with --instance/)
	const unknown = await post('/plans/checkout/test', { ...start, instance: 'prod' })
	assert.equal(unknown.status, 422)
	assert.match(unknown.body, /data-field="instance"/)
	assert.equal(
		read((reading) => reading.db.prepare('SELECT COUNT(*) AS n FROM explorations').get()!.n),
		0
	)
	assert.equal((await post('/plans/checkout/test', { ...start, instance: 'staging' })).status, 303)
	await waitFor('the run ends', () => read((reading) => explorationStatus(reading, 'x-1').state === 'completed'))
	assert.equal(
		read((reading) => explorationStatus(reading, 'x-1').instanceId),
		'staging'
	)
})

test('the instance of the last run is the default while it is active, and a retired instance leaves none', async (t) => {
	const { ui, workspace } = await fixture(t, ['staging'])
	const opened = openStore(workspace)
	openTest(opened, 'checkout', 'x-1', 'b1', 'staging')
	done(opened, 'x-1', 'failed')
	closeStore(opened)
	const page = (await call(ui, '/plans/checkout')).body
	assert.deepEqual(
		radios(page).map((input) => /value="(\w+)"/.exec(input)![1] + (/checked/.test(input) ? ':checked' : '')),
		['local', 'staging:checked']
	)
	assert.match((await call(ui, '/explorations/x-1')).body, /name="instance"/)
	assert.match((await call(ui, '/activity')).body, /data-instances="checkout"/)
	const retiring = openStore(workspace)
	retireInstance(retiring, actor, { targetId: 'checkout-local', instanceId: 'staging' })
	closeStore(retiring)
	assert.deepEqual(radios((await call(ui, '/plans/checkout')).body), [])
})

test('the new change form asks for the instance and keeps the instance of its target', async (t) => {
	const { ui, post } = await fixture(t, ['staging'])
	const form = (await call(ui, '/new?target=checkout-local')).body
	assert.equal(radios(form).length, 2)
	const refused = await post('/new', {
		file: '',
		text: 'A ticket.',
		plan: 'fresh',
		target: 'checkout-local',
		build: 'b1',
		level: 'smoke',
		rules: 'Read Bash',
	})
	assert.equal(refused.status, 422)
	assert.match(refused.body, /data-field="instance"/)
	assert.match(refused.body, /Choose the instance: local or staging\./)
})
