import test from 'node:test'
import assert from 'node:assert/strict'
import { openTarget, showTargetRequest, saveTarget } from '../plugin/src/targets.ts'
import { openPlan, showPlanRequest } from '../plugin/src/plans.ts'
import { actor, cli, json, planRequest, profile, ready, store } from './support.ts'

test('setup context is recorded and plan context can override it without dropping setup tool restrictions', (t) => {
	const opened = store(t)
	const contextInstructions = 'Read the acceptance criteria in the tracker.'
	const toolInstructions = 'Use the caller tracker connector. Do not use shell HTTP.'
	const configured = profile({
		contextInstructions,
		toolInstructions,
		tooling: [
			{ capability: 'browser', executable: 'mcp__browser', version: 'host-managed' },
			{ capability: 'http', executable: 'caller-fetch', version: '1.0' },
		],
	})
	const args = [
		'target',
		'open',
		configured.targetId,
		'--base-url',
		configured.baseUrl,
		'--capabilities',
		configured.capabilities.join(','),
		'--operations',
		configured.allowedOperations.join(','),
		'--context-instructions',
		contextInstructions,
		'--tool-instructions',
		toolInstructions,
	]
	assert.equal(cli(opened.workspace, args).code, 0)
	assert.deepEqual(showTargetRequest(opened, configured.targetId).data.request, {
		targetId: configured.targetId,
		baseUrl: configured.baseUrl,
		capabilities: configured.capabilities,
		allowedOperations: configured.allowedOperations,
		contextInstructions,
		toolInstructions,
	})
	saveTarget(opened, actor, {
		targetId: configured.targetId,
		profile: { ...configured, contextInstructions: undefined, toolInstructions: 'Ignore setup restrictions.' },
	})
	openPlan(opened, actor, { planId: 'defaults', target: 'checkout-local@1', request: planRequest() })
	assert.equal(showPlanRequest(opened, 'defaults').data.contextInstructions, contextInstructions)
	assert.equal(showPlanRequest(opened, 'defaults').data.toolInstructions, toolInstructions)
	openPlan(opened, actor, {
		planId: 'override',
		target: 'checkout-local@1',
		request: {
			...planRequest(),
			contextInstructions: 'Read ticket QA-123 and its linked design.',
			toolInstructions: 'Read only QA-123.',
		},
	})
	const shown = showPlanRequest(opened, 'override').data
	assert.equal(shown.contextInstructions, 'Read ticket QA-123 and its linked design.')
	assert.equal(shown.toolInstructions, toolInstructions + '\nRead only QA-123.')
	assert.match(cli(opened.workspace, ['plan', 'request', 'override']).output, /Read only QA-123/)
	assert.throws(
		() =>
			openTarget(opened, actor, {
				targetId: 'invalid',
				baseUrl: configured.baseUrl,
				capabilities: configured.capabilities,
				allowedOperations: configured.allowedOperations,
				contextInstructions: '',
			}),
		/Invalid contextInstructions/
	)
})

test('CLI plan edits save a revision and reject a stale digest', (t) => {
	const opened = store(t)
	ready(opened)
	const detail = json(opened.workspace, ['plan', 'show', 'checkout']).body
	const payload = {
		objective: 'Review the updated checkout scope.',
		requirements: detail.plan.requirements,
		tests: detail.plan.tests,
	}
	const edit = json(opened.workspace, ['plan', 'edit', 'checkout', '--expect-sha', detail.sha256], payload)
	assert.equal(edit.code, 0, JSON.stringify(edit.body))
	assert.equal(edit.body.subject, `checkout@${detail.revision + 1}`)
	const saved = json(opened.workspace, ['plan', 'show', 'checkout']).body
	assert.equal(saved.plan.objective, payload.objective)
	assert.equal(saved.approval.state, 'pending')
	const stale = json(opened.workspace, ['plan', 'edit', 'checkout', '--expect-sha', detail.sha256], payload)
	assert.equal(stale.code, 1)
	assert.match(stale.body.reasons.join(' '), /changed|digest|Stale/i)
})
