import assert from 'node:assert/strict'
import test from 'node:test'
import { explorationCost, planCost } from '../plugin/src/costs.ts'
import { explorationEvents } from '../plugin/src/explorations.ts'
import { askRequest, listedChats, recordRequestEvent, requestOf, setRequestState } from '../plugin/src/requests.ts'
import { openPlan } from '../plugin/src/plans.ts'
import { completed, one, write } from '../plugin/src/store.ts'
import { explorationLive, planExplorations, planList, runDetail, runList } from '../plugin/src/views.ts'
import { done, event, openTest } from './explorations.ts'
import { actor, begin, delegateUsageReceipt, plan, planRequest, ready, store, target } from './support.ts'

test('structured run receipts count once alongside exploration and chat usage', (t) => {
	const opened = store(t)
	ready(opened)
	begin(opened, 'run-1', ['T1'], 'b1')
	begin(opened, 'run-2', ['T1', 'T2'], 'b2')
	openTest(opened, 'checkout', 'x-1', 'b1')
	event(opened, 'x-1', { step: 'end', status: 'completed', detail: { costUsd: 0.5 } })
	done(opened, 'x-1')
	const chat = askRequest(opened, actor, {
		text: 'What passed?',
		chatId: null,
		context: { planId: 'checkout', record: null },
	})
	setRequestState(opened, chat, 'running')
	recordRequestEvent(
		opened,
		chat,
		{ step: 'session', status: 'started', detail: { sessionId: 'chat' } },
		{ subjects: [] }
	)
	setRequestState(opened, chat, 'answered', { costUsd: 0.125, costScope: 'turn' })
	delegateUsageReceipt(opened, 'run-1', { observedModels: ['fixture/qa-local'], costUsd: 0.125 }, 'interrupted')
	delegateUsageReceipt(opened, 'run-1', { observedModels: ['fixture/qa-local', 'fixture/second'], costUsd: 0.25 })
	assert.deepEqual(planCost(opened, 'checkout'), { costUsd: 1, costPartial: false })
	delegateUsageReceipt(opened, 'run-1', { observedModels: ['fixture/third'] }, 'operational_error')
	delegateUsageReceipt(opened, 'run-2', { observedModels: ['fixture/qa-local'] })
	const run = runDetail(opened, 'run-1')
	assert.deepEqual(
		[run.observedModels, run.costUsd, run.costPartial],
		[['fixture/qa-local', 'fixture/second', 'fixture/third'], 0.375, true]
	)
	const [other] = runList(opened, { planId: 'checkout', build: 'b2' })
	assert.deepEqual(
		[other.runId, other.observedModels, other.costUsd, other.costPartial],
		['run-2', ['fixture/qa-local'], null, false]
	)
	assert.deepEqual(planCost(opened, 'checkout'), { costUsd: 1, costPartial: true })
	const [plan] = planList(opened)
	assert.deepEqual([plan.costUsd, plan.costPartial], [1, true])
})

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

test('plan costs include validated chat starts and exclude ambiguous historical session totals', (t) => {
	const opened = store(t)
	target(opened)
	plan(opened)
	openPlan(opened, actor, { planId: 'other', target: 'checkout-local@1', request: planRequest() })
	openTest(opened, 'checkout', 'x-1', 'b1')
	event(opened, 'x-1', { step: 'end', status: 'completed', detail: { costUsd: 0.5 } })
	done(opened, 'x-1')

	function finish(id: string, sessionId: string, costUsd: number, current = false) {
		setRequestState(opened, id, 'running')
		recordRequestEvent(opened, id, { step: 'session', status: 'started', detail: { sessionId } }, { subjects: [] })
		setRequestState(opened, id, 'answered', { costUsd, ...(current ? { costScope: 'turn' } : {}) })
	}

	const context = { planId: 'checkout', record: null }
	const first = askRequest(opened, actor, { text: 'First.', chatId: null, context })
	const chatId = requestOf(opened, first)!.conversation
	assert.equal(listedChats(opened, 'checkout')[0].costUsd, null)
	finish(first, 'first', 0.125)
	finish(askRequest(opened, actor, { text: 'Legacy resume.', chatId, context }), 'first', 0.25)
	finish(askRequest(opened, actor, { text: 'Current resume.', chatId, context }), 'first', 0.25, true)
	finish(askRequest(opened, actor, { text: 'New selection.', chatId, context }), 'second', 0.125)
	finish(askRequest(opened, actor, { text: 'Legacy contextual ask.', context }), 'generic', 100)
	const generic = askRequest(opened, actor, {
		text: 'Global.',
		chatId: null,
		context: { planId: null, record: null },
	})
	const genericChat = requestOf(opened, generic)!.conversation
	finish(askRequest(opened, actor, { text: 'Global follow.', chatId: genericChat, context }), 'global', 100, true)
	const otherContext = { planId: 'other', record: null, planChat: true } as const
	const other = askRequest(opened, actor, { text: 'Other.', chatId: null, context: otherContext })
	finish(other, 'other', 0, true)
	const otherChat = requestOf(opened, other)!.conversation
	assert.throws(
		() =>
			askRequest(opened, actor, {
				text: 'Wrong plan.',
				chatId: otherChat,
				context: { ...context, planChat: true },
			}),
		/different context/
	)
	assert.throws(
		() => askRequest(opened, actor, { text: 'Wrong scope.', chatId: otherChat, context }),
		/different context/
	)

	const [chat] = listedChats(opened, 'checkout')
	assert.equal(chat.id, chatId)
	assert.equal(chat.costUsd, 0.5)
	assert.equal(chat.costPartial, true)
	assert.equal(listedChats(opened, 'checkout').length, 1)
	assert.deepEqual(
		planList(opened).map(({ planId, costUsd, costPartial }) => [planId, costUsd, costPartial]),
		[
			['checkout', 1, true],
			['other', 0, false],
		]
	)
})
