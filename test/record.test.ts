import test from 'node:test'
import assert from 'node:assert/strict'
import type { TestContext } from 'node:test'
import { mkdirSync, realpathSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { run } from '../plugin/src/cli.ts'
import { recorderPrompt } from '../plugin/src/briefs.ts'
import { ruleMap } from '../plugin/src/rulemap.ts'
import { actor, directory, plan, store, target } from './support.ts'
import { fakeClaude } from './claude.ts'
import { closeStore } from '../plugin/src/store.ts'
import { done } from './explorations.ts'

const session = '22222222-2222-4222-8222-222222222222'
const observation = { kind: 'observation', about: 'coupon', saw: 'The total is 450.00.' }
const defect = {
	kind: 'defect',
	title: 'Coupon stacks',
	severity: 'high',
	expected: '450.00',
	actual: '400.00',
	evidence: ['evidence/total.txt'],
}
const noPrompts = ['--output-format', 'json', '--permission-prompts', 'none']

function setup(t: TestContext) {
	const workspace = realpathSync(directory(t))
	const opened = store(t, workspace)
	target(opened)
	plan(opened)
	closeStore(opened)
	mkdirSync(join(workspace, 'evidence'))
	writeFileSync(join(workspace, 'evidence', 'total.txt'), 'Total: 400.00')
	const fake = fakeClaude(t, { recorder: [observation, defect] })
	const command = (args: string[], stdin = '', change: Record<string, string> = {}) => {
		const outcome = run([...args, '--workspace', workspace, '--json'], {
			cwd: workspace,
			env: { CHECKMATE_ACTOR: actor, ...fake.env, ...change },
			stdin: () => stdin,
		})
		return { code: outcome.code, body: JSON.parse(outcome.output) }
	}
	assert.equal(command(['explore', 'open', 'checkout', '--build', 'b1']).code, 0)
	const record = (explorer = 'a1', change: Record<string, string> = {}, extra: string[] = []) =>
		command(['record', 'x-1', '--explorer', explorer, '--session', session, ...extra], '', change)
	const entries = () =>
		command(['query', 'SELECT entry_id, kind, actor, body FROM journal_entries ORDER BY rowid']).body
			.rows as Array<{
			entry_id: string
			kind: string
			actor: string
			body: string
		}>
	return { workspace, command, record, entries, ...fake }
}

test('explore open records an exploration with its charter and the plan request', (t) => {
	const { command } = setup(t)
	const shown = command([
		'query',
		'SELECT exploration_id, plan_id, build, mode, instance_id, charter FROM explorations',
	])
	const [row] = shown.body.rows
	assert.deepEqual(
		[row.exploration_id, row.plan_id, row.build, row.mode, row.instance_id],
		['x-1', 'checkout', 'b1', 'exploratory', 'local']
	)
	const charter = JSON.parse(row.charter)
	assert.equal(charter.goal, 'Verify checkout and identify missing acceptance decisions.')
	assert.deepEqual(charter.operations, ['read_catalog', 'create_fixture_order', 'apply_fixture_discount'])
	assert.equal(charter.requirements.length, 3)
	assert.equal(command(['explore', 'open', 'checkout', '--build', 'b2']).body.explorationId, 'x-2')
	const unknown = command(['explore', 'open', 'nothing', '--build', 'b1'])
	assert.equal(unknown.code, 1)
	assert.match(unknown.body.reasons[1], /Unknown plan: nothing/)
})

test('record forks the test session, and Checkmate logs the reply as the explorer', (t) => {
	const { record, entries, called } = setup(t)
	const reply = record()
	assert.equal(reply.code, 0, JSON.stringify(reply.body))
	assert.deepEqual(
		[reply.body.saved, reply.body.refused, reply.body.calls, reply.body.added],
		[2, 0, 1, { observation: 1, defect: 1 }]
	)
	assert.deepEqual([reply.body.costUsd, reply.body.durationMs], [0.25, 1000])
	const [call] = called()
	assert.deepEqual(call.args, [
		'-p',
		'--resume',
		session,
		'--fork-session',
		'--session-id',
		reply.body.recorder,
		...noPrompts,
	])
	assert(!call.args.some((arg: string) => /allowedTools|disallowedTools|--tools|Bash|Edit/.test(arg)), 'no tool list')
	assert.equal(
		call.prompt,
		recorderPrompt('b1', 'No criterion, defect, or question yet.', [], undefined, [
			{ id: 'R1', text: 'A standard order for a 400 PLN item has a total of 400 PLN.' },
			{ id: 'R2', text: 'A 40 percent promotion applies; stacking is unspecified.' },
			{ id: 'R3', text: 'Refund eligibility is unspecified.' },
		])
	)
	assert.match(
		call.prompt,
		/Use "wrong" only when the session observed product behaviour that contradicts the rule\..*\n.*Omit "verdict" for an unverified rule/
	)
	assert.match(
		call.prompt,
		/\nThe rules of the plan:\nR1: A standard order for a 400 PLN item has a total of 400 PLN\.\nR2: /
	)
	assert.deepEqual(call.env, ['CHECKMATE_RECORDER'])
	const saved = entries()
	assert.deepEqual(
		saved.map((row) => [row.entry_id, row.kind, row.actor]),
		[
			['O1', 'observation', 'qa:a1'],
			['D1', 'defect', 'qa:a1'],
		]
	)
	const body = JSON.parse(saved[1].body)
	assert.deepEqual([body.build, body.evidence[0].path], ['b1', 'evidence/total.txt'])
})

test('the recorder ties criteria, defects, and questions to a plan rule, and an unknown rule ID becomes outside', (t) => {
	const { record, reply, entries } = setup(t)
	reply({
		recorder: [
			{
				kind: 'criterion',
				rule: 'R1',
				text: 'A 400 PLN order totals 400 PLN.',
				verdict: 'ok',
				saw: 'The order summary showed a total of 400 PLN.',
			},
			{ ...defect, rule: 'R9' },
			{ kind: 'question', rule: 'outside', question: 'Is a gift card a payment?' },
			{ kind: 'question', question: 'Does the promotion stack?' },
		],
	})
	const recorded = record()
	assert.equal(recorded.code, 0, JSON.stringify(recorded.body))
	assert.deepEqual([recorded.body.saved, recorded.body.refused, recorded.body.unknownRules], [4, 0, ['R9']])
	assert.deepEqual(
		entries().map((row) => [JSON.parse(row.body).rule, JSON.parse(row.body).verdict]),
		[
			['R1', 'ok'],
			['outside', undefined],
			['outside', undefined],
			[undefined, undefined],
		]
	)
})

test('the recorder requires an observation for criterion verdicts and keeps incomplete checks unverified', (t) => {
	const { workspace, record, reply, called, entries } = setup(t)
	const skipped = { kind: 'criterion', rule: 'R3', text: 'Refund eligibility is unspecified.' }
	const partial = { kind: 'criterion', rule: 'R2', text: 'A 40 percent promotion applies.' }
	const observed = {
		kind: 'criterion',
		rule: 'R1',
		text: 'A 400 PLN order totals 400 PLN.',
		verdict: 'wrong',
		saw: 'The order summary showed a total of 450 PLN.',
	}
	reply({
		recorder: [{ ...skipped, verdict: 'wrong' }, { ...partial, verdict: 'ok', saw: ' ' }, observed],
		repair: [skipped, partial, { kind: 'note', text: 'The test session did not exercise a refund.' }],
	})
	const result = record()
	assert.equal(result.code, 0, JSON.stringify(result.body))
	assert.deepEqual([result.body.calls, result.body.saved, result.body.refused], [2, 4, 0])
	const [, repair] = called()
	assert.match(repair.prompt, /\[0\] \[0\]\.saw is required/)
	assert.match(repair.prompt, /\[1\] \[1\]\.saw is required/)
	assert.deepEqual(
		entries().map((row) => JSON.parse(row.body).verdict),
		['wrong', undefined, undefined, undefined]
	)
	const opened = store(t, workspace)
	done(opened, 'x-1')
	const map = ruleMap(opened, 'checkout')
	assert.deepEqual(
		map.rows.slice(0, 3).map((row) => [row.rule.id, row.cells[0]?.status]),
		[
			['R1', 'failed'],
			['R2', 'not_checked'],
			['R3', 'not_checked'],
		]
	)
})

test('record repairs refused entries once, and the next record does not repeat what the record holds', (t) => {
	const { record, reply, called } = setup(t)
	reply({ recorder: [observation, { ...defect, severity: 'huge' }], repair: [defect] })
	const fixed = record()
	assert.equal(fixed.code, 0, JSON.stringify(fixed.body))
	assert.deepEqual([fixed.body.calls, fixed.body.saved, fixed.body.refused], [2, 2, 0])
	const [, repair] = called()
	assert.deepEqual(repair.args, ['-p', '--resume', fixed.body.recorder, ...noPrompts])
	assert.match(repair.prompt, /^Checkmate refused these entries of your reply:\n- \[1\] .*severity/)
	reply({ recorder: [{ ...defect, id: 'D1', title: 'Coupon stacks again' }] })
	const again = record()
	assert.equal(again.code, 0)
	const [next] = called()
	assert.match(next.prompt, /defect D1 \(b1, high\): Coupon stacks/)
	assert.equal(again.body.added.defect, 1)
})

test('record keeps a missing evidence path as text, and reports a reply without entries or a failed recorder', (t) => {
	const { record, reply, entries } = setup(t)
	reply({ recorder: [{ ...defect, evidence: ['evidence/gone.png', 'evidence/total.txt'] }] })
	const missing = record()
	assert.deepEqual([missing.body.saved, missing.body.missingEvidence], [1, ['evidence/gone.png']])
	assert.deepEqual(JSON.parse(entries()[0].body).evidence[0], { text: 'evidence/gone.png' })
	reply({ recorder: 'I have nothing to add.' })
	const nothing = record()
	assert.equal(nothing.body.status, 'operational_error')
	assert.match(nothing.body.reasons.join(' '), /no JSON array of entries/)
	assert.match(nothing.body.hint, /The entries that Checkmate logged stay/)
	reply({ recorder: '!fail' })
	const failed = record()
	assert.equal(failed.body.status, 'operational_error')
	assert.match(failed.body.reasons[0], /claude exited with code 2: API error: overloaded/)
	reply({ recorder: '!sleep' })
	const slow = record('a1', {}, ['--timeout', '1'])
	assert.equal(slow.body.status, 'interrupted')
})

test('record refuses a reserved explorer, a bad session, a missing claude, or a nested recorder', (t) => {
	const { record, command } = setup(t)
	const empty = directory(t)
	for (const [explorer, change, reason] of [
		['merge', {}, /^Explorer name merge is reserved/],
		['a1', { PATH: empty }, /^No claude executable on PATH/],
		['a1', { CHECKMATE_RECORDER: '1' }, /^A recorder cannot start another recorder/],
	] as const) {
		const reply = record(explorer, change)
		assert.equal(reply.code, 1)
		assert.match(reply.body.reasons[1], reason)
	}
	const bad = command(['record', 'x-1', '--explorer', 'a1', '--session', 'latest'])
	assert.match(bad.body.reasons[1], /Invalid session ID: latest/)
	const unknown = command(['record', 'x-9', '--explorer', 'a1', '--session', session])
	assert.match(unknown.body.reasons[1], /^Unknown exploration: x-9/)
	const reserved = command(['record', 'x-1', '--explorer', 'a1', '--session', session, '--claude-arg', '--tools'])
	assert.match(reserved.body.reasons[1], /--claude-arg --tools is not permitted/)
})

test('explore log saves each valid entry for the actor and refuses each invalid entry alone', (t) => {
	const { command, entries } = setup(t)
	const text = '```json\n[{"kind": "note", "text": "Read the ticket.",}, {"kind": "defect", "title": "x"}]\n```'
	const logged = command(['explore', 'log', 'x-1', '--actor', 'qa:a2'], text)
	assert.equal(logged.code, 0, JSON.stringify(logged.body))
	assert.deepEqual(
		logged.body.saved.map((item: { id: string }) => item.id),
		['N1']
	)
	assert.match(logged.body.refused[0].reason, /needs field/)
	assert.deepEqual(
		entries().map((row) => [row.entry_id, row.actor]),
		[['N1', 'qa:a2']]
	)
})
