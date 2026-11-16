import test from 'node:test'
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { existsSync, mkdirSync, readFileSync, realpathSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { run } from '../plugin/src/cli.ts'
import { closeStore } from '../plugin/src/store.ts'
import { openPlan } from '../plugin/src/plans.ts'
import { actor, directory, planRequest, store, target } from './support.ts'
import { fakeClaude } from './claude.ts'

const first = '11111111-1111-4111-8111-111111111111'
const second = '22222222-2222-4222-8222-222222222222'
const allow = ['--allow', 'Read']

test('a later exploration gets one plain file with the results of earlier builds, and its verdicts are saved', (t) => {
	const workspace = realpathSync(directory(t))
	const opened = store(t, workspace)
	target(opened)
	openPlan(opened, actor, { planId: 'checkout', target: 'checkout-local@1', request: planRequest() })
	closeStore(opened)
	const fake = fakeClaude(t, {
		explorer: 'Tested.',
		recorder: {
			[first]: [
				{ kind: 'criterion', id: 'C1', text: 'Two coupons do not stack.' },
				{ kind: 'criterion', id: 'C2', text: 'A gift card pays the rest.' },
				{ kind: 'note', id: 'N1', text: 'Tested the coupon form.', area: 'coupon form' },
				{ kind: 'observation', id: 'O1', about: 'C1', saw: 'Two coupons applied.' },
				{
					kind: 'defect',
					id: 'D1',
					title: 'Coupons stack',
					severity: 'high',
					expected: 'The total is 450.',
					actual: 'The total is 400.',
					steps: 'Apply two coupons.',
				},
				{ kind: 'question', id: 'Q1', question: 'Can a coupon apply to a sale item?' },
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
			'*': [{ kind: 'verdict', defect: 'a2/D1', result: 'not_fixed', saw: 'Tax again.' }],
		},
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
	assert.equal(existsSync(join(workspace, 'qa-evidence', 'x-1', 'known-state.md')), false)
	const charter = (id: string) =>
		JSON.parse(
			command(['query', `SELECT charter FROM explorations WHERE exploration_id = '${id}'`]).body.rows[0].charter
		)
	assert.equal(charter('x-1').knownState, null)
	command(['record', 'x-1', '--explorer', 'a1', '--session', first])
	command(['record', 'x-1', '--explorer', 'a2', '--session', second])
	command(['gap', 'answer', 'checkout', 'a1/Q1', '--kind', 'defer', '--value', 'No, never.', '--rationale', 'Rule.'])
	command(['claim', 'reject', 'checkout', 'a1/D1', '--rationale', 'Stacking is intended.'])
	const started = command(['explore', 'start', 'checkout', '--build', 'b2', '--level', 'smoke', ...allow])
	assert.equal(started.code, 0, started.output)
	assert.equal(charter('x-2').knownState, 'qa-evidence/x-2/known-state.md')
	const text = readFileSync(join(workspace, 'qa-evidence', 'x-2', 'known-state.md'), 'utf8')
	assert.equal(
		text,
		[
			'# Results of earlier builds',
			'',
			'## Open problems',
			'',
			'Retest each one. Say for each one if it is still there or fixed, with its ID.',
			'',
			'### a2/D1: Wrong tax (low)',
			'- Last seen on build: b1',
			'- Steps: Ship.',
			'- Expected: No tax',
			'- Actual: Tax',
			'',
			'## Decisions of the product owner',
			'',
			'- Can a coupon apply to a sale item? Answer: No, never.',
			'- Not a defect: Coupons stack. Stacking is intended.',
			'',
			'## Problems fixed on an earlier build',
			'',
			'None.',
			'',
			'## Areas tested before',
			'',
			'- coupon form',
			'',
			'## Rules not tested yet',
			'',
			'- A gift card pays the rest.',
			'',
		].join('\n')
	)
	assert.doesNotMatch(text, /checkmate|claim|explor/i)
	assert.equal(command(['explore', 'wait', 'x-2', '--timeout', '60']).code, 0)
	const calls = fake.called()
	const explorer = calls.find((call) => call.role === 'explorer')
	assert.match(
		explorer.prompt,
		/\nRead qa-evidence\/x-2\/known-state\.md\. It has the results of earlier builds\. Retest each open problem/
	)
	assert.match(
		explorer.prompt,
		/\nFolders in the workspace whose names start with a dot belong to tools, not to the product under test\.\n/
	)
	const recorder = calls.filter((call) => call.role === 'recorder').at(-1)
	assert.match(recorder.prompt, /open defect a2\/D1 \(b1, low\): Wrong tax/)
	assert.match(recorder.prompt, /log a verdict with the ID of that defect: fixed or not_fixed/)
	const claims = command(['explore', 'show', 'x-1']).body.claims
	const tax = claims.find((claim: { id: string }) => claim.id === 'a2/D1')
	assert.deepEqual(tax.statuses.b2, { status: 'not_fixed', basis: 'single' })
})

test('--since reads the changes of a repository in a subfolder with --repo', (t) => {
	const workspace = realpathSync(directory(t))
	const opened = store(t, workspace)
	target(opened)
	openPlan(opened, actor, { planId: 'checkout', target: 'checkout-local@1', request: planRequest() })
	closeStore(opened)
	const fake = fakeClaude(t, { explorer: 'Tested.', recorder: [{ kind: 'note', text: 'Done.' }] })
	const code = join(workspace, 'app')
	mkdirSync(code)
	execFileSync('git', ['init', '-q'], { cwd: code })
	writeFileSync(join(code, 'cart.js'), 'one\n')
	execFileSync('git', ['add', 'cart.js'], { cwd: code })
	execFileSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@t', 'commit', '-qm', 'base'], { cwd: code })
	writeFileSync(join(code, 'cart.js'), 'two\n')
	const command = (args: string[]) =>
		run([...args, '--workspace', workspace, '--json'], {
			cwd: workspace,
			env: { ...process.env, CHECKMATE_ACTOR: actor, ...fake.env },
			stdin: () => '',
		})
	const reply = JSON.parse(
		command(['test', 'checkout', '--build', 'b1', '--since', 'HEAD', '--repo', 'app', '--level', 'smoke', ...allow])
			.output
	)
	assert.deepEqual(reply.scope, ['cart.js'])
	assert.equal(command(['explore', 'wait', 'x-1', '--timeout', '60']).code, 0)
	const failed = JSON.parse(command(['test', 'checkout', '--build', 'b2', '--since', 'HEAD', ...allow]).output)
	assert.match(failed.hint, /Give --repo <dir> when the code is in a subfolder/)
})
