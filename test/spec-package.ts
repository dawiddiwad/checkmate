import assert from 'node:assert/strict'
import type { TestContext } from 'node:test'
import { spawnSync } from 'node:child_process'
import { chmodSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { closeStore } from '../plugin/src/store.ts'
import { openTarget, saveTarget } from '../plugin/src/targets.ts'
import { openPlan, savePlan } from '../plugin/src/plans.ts'
import { actor, directory, profile, store } from './support.ts'

export function specPackage(t: TestContext, project: string) {
	const workspace = directory(t)
	writeFileSync(join(workspace, 'ticket.md'), 'The quote is 240. Does the promotion replace loyalty?\n')
	const opened = store(t, workspace)
	const target = profile({ capabilities: ['http'], tools: [] })
	openTarget(opened, actor, {
		targetId: target.targetId,
		entryPoints: target.entryPoints,
		capabilities: target.capabilities,
		allowedOperations: target.allowedOperations,
	})
	saveTarget(opened, actor, { targetId: target.targetId, profile: target })
	openPlan(opened, actor, {
		planId: 'ticket',
		target: 'checkout-local@1',
		request: { objective: 'Check the quote.', context: { sources: ['ticket.md'] } },
	})
	savePlan(opened, actor, {
		planId: 'ticket',
		candidate: {
			requirements: [{ id: 'R1', text: 'The quote is 240.', source: 'ticket.md' }],
			tests: [
				{
					id: 'T1',
					title: 'Quote',
					requirementIds: ['R1'],
					capability: 'http',
					operations: ['read_catalog'],
					dependsOn: [],
					preconditions: [],
					action: 'Read the quote.',
					assertions: [{ id: 'A1', check: 'The quote is 240.', checkKind: 'deterministic' }],
				},
			],
			gaps: [],
		},
	})
	closeStore(opened)
	const bin = join(workspace, 'bin')
	mkdirSync(bin)
	const host = join(bin, 'pi')
	writeFileSync(
		host,
		`#!/usr/bin/env node
const fs = require('node:fs')
const args = process.argv.slice(2)
if (!args.includes('--no-tools') || !args.includes('--no-mcp')) throw Error('Reviewer has tools')
if (Object.keys(process.env).some(name => name.startsWith('CHECKMATE_'))) throw Error('Reviewer inherited Checkmate authority')
const input = fs.readFileSync(0, 'utf8')
if (!input.includes('The quote is 240. Does the promotion replace loyalty?')) throw Error('Ticket missing')
const answered = input.includes('The promotion replaces loyalty.')
fs.appendFileSync('reviewer-calls', answered ? 'answered\\n' : 'initial\\n')
const entries = [{ kind: 'review', source: 'ticket.md', evidence: 'The quote is 240.', rationale: answered ? 'Reviewed the owner answer.' : 'Reviewed the open question.' }]
if (!answered) entries.push({ kind: 'question', source: 'ticket.md', evidence: 'Does the promotion replace loyalty?', question: 'Does the promotion replace loyalty?', consequence: 'The combined quote is unclear.', testIds: ['T1'], requirementIds: [] })
console.log(JSON.stringify({ type: 'agent_end', messages: [{ role: 'assistant', stopReason: 'stop', content: [{ type: 'text', text: JSON.stringify(entries) }] }], willRetry: false }))
console.log(JSON.stringify({ type: 'agent_settled', aborted: false }))
`
	)
	chmodSync(host, 0o755)
	const cli = join(project, 'node_modules/.bin/checkmate')
	const env = {
		...process.env,
		PATH: `${bin}:${process.env.PATH}`,
		CHECKMATE_ACTOR: 'oracle',
		CHECKMATE_HARNESS: 'pi',
	}
	const command = (args: string[], input = '') => {
		const result = spawnSync(process.execPath, [cli, ...args, '--json'], {
			cwd: workspace,
			env,
			input,
			encoding: 'utf8',
			timeout: 70000,
		})
		assert.ok(result.stdout, result.stderr)
		return { code: result.status, body: JSON.parse(result.stdout), output: result.stdout + result.stderr }
	}
	const ok = (args: string[], input = '') => {
		const result = command(args, input)
		assert.equal(result.code, 0, result.output)
		return result.body
	}
	const refuse = (args: string[], pattern: RegExp) => {
		const result = command(args)
		assert.equal(result.code, 1, result.output)
		assert.match(result.output, pattern)
	}
	const first = ok(['delegate', 'spec', 'ticket@1'])
	assert.equal(first.status, 'needs_decision')
	assert.match(first.reasons.join(' '), /G1: Does the promotion replace loyalty/)
	assert.ok(first.operation)
	assert.equal(
		ok([
			'query',
			"SELECT count(*) AS n FROM operations WHERE command = 'delegate spec' AND status = 'needs_decision'",
		]).rows[0].n,
		1
	)
	const status = ok(['spec', 'status', 'ticket@1'])
	assert.equal(status.ready, false)
	assert.equal(status.findings[0].evidence, 'Does the promotion replace loyalty?')
	const sha = status.sha256
	refuse(['spec', 'handoff', 'ticket@1', '--expect-sha', sha, '--rationale', 'Ready.'], /Gap G1 is open/)
	ok([
		'gap',
		'answer',
		'ticket',
		'G1',
		'--kind',
		'clarify',
		'--value',
		'The promotion replaces loyalty.',
		'--source',
		'oracle',
		'--rationale',
		'Owner decision.',
	])
	refuse(['delegate', 'spec', 'ticket@1'], /pending oracle answer/)
	assert.equal(readFileSync(join(workspace, 'reviewer-calls'), 'utf8'), 'initial\n')
	ok(['plan', 'revise', 'ticket'], JSON.stringify({ tests: {} }))
	refuse(['delegate', 'spec', 'ticket@1'], /stale/)
	const second = ok(['delegate', 'spec', 'ticket@2'])
	assert.equal(second.status, 'needs_decision')
	assert.match(second.reasons.join(' '), /needs oracle approval/)
	assert.equal(readFileSync(join(workspace, 'reviewer-calls'), 'utf8'), 'initial\nanswered\n')
	const status2 = ok(['spec', 'status', 'ticket@2'])
	assert.equal(status2.findings.length, 1)
	assert.equal(status2.review.rationale, 'Reviewed the owner answer.')
	for (const table of ['instances', 'runs', 'explorations', 'plan_builds', 'approvals'])
		assert.equal(ok(['query', `SELECT count(*) AS n FROM ${table}`]).rows[0].n, 0)
	assert.deepEqual(
		ok(['query', 'SELECT actor FROM decisions']).rows.map((row: { actor: string }) => row.actor),
		['oracle']
	)
	ok(['plan', 'approve', 'ticket@2', '--rationale', 'The owner approves.'])
	ok(['spec', 'handoff', 'ticket@2', '--expect-sha', status2.sha256, '--rationale', 'Ready to build.'])
}
