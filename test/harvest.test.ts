import test from 'node:test'
import assert from 'node:assert/strict'
import { realpathSync } from 'node:fs'
import { run } from '../plugin/src/cli.ts'
import { closeStore, openStore } from '../plugin/src/store.ts'
import { openPlan, planRevision } from '../plugin/src/plans.ts'
import { actor, directory, planRequest, store, target } from './support.ts'
import { fakeClaude } from './claude.ts'

const first = '11111111-1111-4111-8111-111111111111'
const second = '22222222-2222-4222-8222-222222222222'

test('harvest turns the kept claims of an exploration into stored tests, once, and observations on request', (t) => {
	const workspace = realpathSync(directory(t))
	const opened = store(t, workspace)
	target(opened)
	openPlan(opened, actor, { planId: 'checkout', target: 'checkout-local@1', request: planRequest() })
	closeStore(opened)
	const fake = fakeClaude(t, {
		recorder: {
			[first]: [
				{ kind: 'criterion', id: 'C1', text: 'Two coupons do not stack.', source: 'brief#coupons' },
				{
					kind: 'defect',
					id: 'D1',
					title: 'Coupons stack',
					severity: 'high',
					expected: 'The total is 450.',
					actual: 'The total is 400.',
					steps: ['Add a 500 item.', 'Apply two coupons.'],
					via: 'api',
					links: ['C1'],
				},
				{
					kind: 'observation',
					id: 'O1',
					about: 'C1',
					steps: 'Apply one coupon.',
					saw: 'Total 450.',
					value: '450',
					verdict: 'ok',
				},
			],
			[second]: [
				{
					kind: 'defect',
					title: 'Wrong tax',
					severity: 'low',
					expected: 'No tax',
					actual: 'Tax',
					steps: 'Ship.',
				},
			],
		},
		verifier: [{ id: 'a2/D1', seen: false, saw: 'No tax.' }],
	})
	const command = (args: string[]) => {
		const outcome = run([...args, '--workspace', workspace, '--json'], {
			cwd: workspace,
			env: { ...process.env, CHECKMATE_ACTOR: actor, ...fake.env },
			stdin: () => '',
		})
		return { code: outcome.code, body: JSON.parse(outcome.output), output: outcome.output }
	}
	command(['explore', 'open', 'checkout', '--build', 'b1'])
	command(['record', 'x-1', '--explorer', 'a1', '--session', first])
	command(['record', 'x-1', '--explorer', 'a2', '--session', second])
	command(['explore', 'finish', 'x-1', '--allow', 'Read'])
	assert.equal(command(['explore', 'wait', 'x-1', '--timeout', '60']).code, 0)
	const harvested = command(['harvest', 'x-1'])
	assert.equal(harvested.code, 0, harvested.output)
	assert.deepEqual([harvested.body.subject, harvested.body.tests], ['checkout@1', ['H1']])
	const again = command(['harvest', 'x-1'])
	assert.equal(again.code, 1)
	assert.match(again.body.reasons[1], /Each item of x-1 is harvested already into checkout/)
	const more = command(['harvest', 'x-1', '--observations'])
	assert.deepEqual([more.body.tests, more.body.skipped], [['H2'], 1])
	const reader = openStore(workspace)
	t.after(() => closeStore(reader))
	const { plan } = planRevision(reader, 'checkout')
	const [claim, observed] = plan.tests
	assert.deepEqual(
		[claim.capability, claim.action, claim.assertions[0], claim.metadata],
		[
			'http',
			'Add a 500 item. Apply two coupons.',
			{ id: 'A1', check: 'The total is 450.', checkKind: 'agent_observation' },
			{ type: 'regression', origin: 'harvest', basis: 'claim', harvestedFrom: 'x-1/a1/D1', build: 'b1' },
		]
	)
	assert.deepEqual(observed.assertions[0], { id: 'A1', check: 'The result is 450.', checkKind: 'deterministic' })
	assert.equal(observed.metadata?.basis, 'observed')
	const requirement = plan.requirements.find((item) => item.id === claim.requirementIds[0])
	assert.deepEqual(requirement, { id: 'HR1', text: 'Two coupons do not stack.', source: 'brief#coupons' })
	assert.deepEqual(observed.requirementIds, ['HR1'])
	assert(
		!plan.tests.some((item) => item.metadata?.harvestedFrom === 'x-1/a2/D1'),
		'an unresolved claim is not harvested'
	)
	assert.equal(command(['harvest', 'x-9']).code, 1)
})
