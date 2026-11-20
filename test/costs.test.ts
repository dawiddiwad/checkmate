import assert from 'node:assert/strict'
import test from 'node:test'
import { explorationCost } from '../plugin/src/costs.ts'
import { explorationEvents } from '../plugin/src/explorations.ts'
import { openPlan } from '../plugin/src/plans.ts'
import { completed, one, write } from '../plugin/src/store.ts'
import { explorationLive, planExplorations, planList } from '../plugin/src/views.ts'
import { done, event, openTest } from './explorations.ts'
import { actor, plan, planRequest, store, target } from './support.ts'

test('reported model costs roll up across exploration phases and plans', (t) => {
	const opened = store(t)
	target(opened)
	plan(opened)
	openPlan(opened, actor, { planId: 'other', target: 'checkout-local@1', request: planRequest() })
	openTest(opened, 'checkout', 'x-1', 'b1')
	for (const step of ['rules', 'end', 'record', 'merge', 'verify'])
		event(opened, 'x-1', { step, status: 'completed', detail: { costUsd: 0.125 } })
	event(opened, 'x-1', { step: 'verify', status: 'skipped' })
	done(opened, 'x-1', 'completed', { costUsd: 0.625 })
	event(opened, 'x-1', { step: 'follow', detail: { answers: [] } })
	event(opened, 'x-1', { step: 'follow-turn', status: 'completed', detail: { costUsd: 0.125 } })
	event(opened, 'x-1', { step: 'record', status: 'completed', detail: { costUsd: 0.125 } })
	event(opened, 'x-1', { step: 'followed', status: 'completed', detail: { costUsd: 0.25 } })
	openTest(opened, 'checkout', 'x-2', 'b2')
	event(opened, 'x-2', { step: 'end', status: 'completed' })
	done(opened, 'x-2')
	openTest(opened, 'other', 'x-3', 'b1')
	event(opened, 'x-3', { step: 'end', status: 'completed', detail: { costUsd: 0 } })
	done(opened, 'x-3')

	const cost = ({ costUsd, costPartial }: ReturnType<typeof explorationCost>) => [costUsd, costPartial]
	const events = explorationEvents(opened, 'x-1')
	const follow = events.findIndex((item) => item.step === 'follow')
	assert.deepEqual(cost(explorationCost(events.slice(0, follow))), [0.625, false])
	assert.deepEqual(cost(explorationCost(events.slice(follow))), [0.25, false])
	assert.deepEqual(cost(explorationLive(opened, 'x-1')), [0.875, false])
	assert.deepEqual(planExplorations(opened, 'checkout').map(cost), [
		[0.875, false],
		[null, false],
	])
	assert.deepEqual(
		planList(opened).map((row) => [row.planId, ...cost(row)]),
		[
			['checkout', 0.875, true],
			['other', 0, false],
		]
	)

	const source = one<{ operation_id: string }>(
		opened,
		"SELECT operation_id FROM exploration_events WHERE exploration_id = 'x-2' AND step = 'end'"
	)!
	write(opened, { actor, command: 'recover Pi costs', subject: 'x-2', input: null }, (operationId) => {
		opened.db
			.prepare(
				`INSERT INTO exploration_event_costs (source_operation_id, step, explorer, cost_usd, partial, operation_id)
				VALUES (?, 'end', '', 0.0625, 0, ?)`
			)
			.run(source.operation_id, operationId)
		return { reply: completed('x-2'), subjects: ['exploration:x-2'] }
	})
	assert.deepEqual(cost(explorationLive(opened, 'x-2')), [0.0625, false])
	assert.deepEqual(cost(planExplorations(opened, 'checkout')[1]), [0.0625, false])
	assert.deepEqual(cost(planList(opened).find((row) => row.planId === 'checkout')!), [0.9375, false])
})

test('partial stage costs preserve the numeric subtotal and a skipped call with a session is unknown', (t) => {
	const opened = store(t)
	target(opened)
	plan(opened)
	openTest(opened, 'checkout', 'x-1', 'b1')
	event(opened, 'x-1', { step: 'end', status: 'completed', detail: { costUsd: 0, costPartial: true } })
	const partial = explorationEvents(opened, 'x-1')
	assert.deepEqual(explorationCost(partial), { costUsd: 0, costPartial: true })
	event(opened, 'x-1', { step: 'record', status: 'completed', detail: { costUsd: 0.125 } })
	event(opened, 'x-1', { step: 'verify', status: 'skipped', detail: { session: 'verify-session' } })
	const attempted = explorationEvents(opened, 'x-1')
	assert.deepEqual(explorationCost(attempted.slice(partial.length)), { costUsd: 0.125, costPartial: true })
})
