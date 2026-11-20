import test from 'node:test'
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { existsSync, mkdirSync, readFileSync, realpathSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { run } from '../plugin/src/cli.ts'
import { closeStore } from '../plugin/src/store.ts'
import type { TestContext } from 'node:test'
import { openPlan } from '../plugin/src/plans.ts'
import { knownStateText, openExploration } from '../plugin/src/explorations.ts'
import { logEntries } from '../plugin/src/journal.ts'
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
	assert.equal(existsSync(join(workspace, '.checkmate', 'work', 'x-1', 'known-state.md')), false)
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
	assert.equal(charter('x-2').knownState, '.checkmate/work/x-2/known-state.md')
	const text = readFileSync(join(workspace, '.checkmate', 'work', 'x-2', 'known-state.md'), 'utf8')
	assert.equal(
		text,
		[
			'# Results of earlier builds',
			'',
			'Retest every problem below, open and fixed. In your report, give one line for each problem, with its ID: still present, fixed, or not retested and the reason.',
			'',
			'## Open problems',
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
			'## Problems reported as fixed',
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
		/\nRead \.checkmate\/work\/x-2\/known-state\.md\. It has the results of earlier builds\. Retest each open problem/
	)
	assert.match(
		explorer.prompt,
		/\nApart from your work folder, the folders in the workspace whose names start with a dot belong to tools, not to the product under test\.\n/
	)
	const recorder = calls.filter((call) => call.role === 'recorder').at(-1)
	assert.match(recorder.prompt, /open defect a2\/D1 \(b1, low\): Wrong tax/)
	assert.match(recorder.prompt, /Use fixed or not_fixed only when the session ran the retest and observed/)
	assert.match(recorder.prompt, /use not_retested\. Put the reason in "saw"/)
	const claims = command(['explore', 'show', 'x-1']).body.claims
	const tax = claims.find((claim: { id: string }) => claim.id === 'a2/D1')
	assert.deepEqual(tax.statuses.b2, { status: 'not_fixed', basis: 'single' })
})

test('the recorder saves incomplete retests without casting a claim vote', (t) => {
	const workspace = realpathSync(directory(t))
	const opened = store(t, workspace)
	target(opened)
	openPlan(opened, actor, { planId: 'checkout', target: 'checkout-local@1', request: planRequest() })
	for (const build of ['b1', 'b2']) openExploration(opened, actor, { planId: 'checkout', build })
	const ids = ['D1', 'D2', 'D3']
	const defectId = (id: string) => `a1/${id}`
	logEntries(opened, 'qa:a1', {
		explorationId: 'x-1',
		entries: ids.map((id) => ({
			kind: 'defect',
			id,
			title: `Problem ${id}`,
			severity: 'medium',
			expected: `Right ${id}`,
			actual: `Wrong ${id}`,
			steps: `Do ${id}.`,
		})),
	})
	closeStore(opened)
	const reason = 'The required run was unavailable.'
	const fake = fakeClaude(t, {
		recorder: {
			[first]: [
				{ kind: 'verdict', defect: defectId('D1'), result: 'fixed', saw: 'The total is correct.' },
				{ kind: 'verdict', defect: defectId('D2'), result: 'not_fixed', saw: 'The total is still wrong.' },
			],
			[second]: ids.map((id) => ({ kind: 'verdict', defect: defectId(id), result: 'not_retested', saw: reason })),
		},
	})
	const command = (args: string[], json = true) =>
		run([...args, '--workspace', workspace, ...(json ? ['--json'] : [])], {
			cwd: workspace,
			env: { ...process.env, CHECKMATE_ACTOR: actor, ...fake.env },
			stdin: () => '',
		})
	for (const [name, session, saved] of [
		['a1', first, 2],
		['a2', second, 3],
	] as const) {
		const reply = command(['record', 'x-2', '--explorer', name, '--session', session])
		assert.equal(reply.code, 0, reply.output)
		assert.deepEqual(JSON.parse(reply.output).added, { verdict: saved })
	}
	const report = JSON.parse(command(['explore', 'show', 'x-2']).output)
	assert.deepEqual(
		report.retests.filter((entry: { actor: string }) => entry.actor === 'qa:a2'),
		ids.map((id, index) => ({
			id: `a2/V${index + 1}`,
			actor: 'qa:a2',
			defect: defectId(id),
			result: 'not_retested',
			saw: reason,
			evidence: [],
		}))
	)
	assert.match(
		command(['explore', 'show', 'x-2'], false).output,
		/a2\/V1\tverdict\ta1\/D1\tnot_retested\tThe required run was unavailable\./
	)
	const { claims } = JSON.parse(command(['claim', 'list', 'checkout', '--all']).output)
	assert.deepEqual(
		claims.map((claim: { id: string; statuses: { b2: unknown }; open: boolean }) => [
			claim.id,
			claim.statuses.b2,
			claim.open,
		]),
		[
			['a1/D1', { status: 'fixed', basis: 'single' }, false],
			['a1/D2', { status: 'not_fixed', basis: 'single' }, true],
			['a1/D3', { status: 'no verdict', basis: 'none' }, true],
		]
	)
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

function seeded(t: TestContext, count: number) {
	const opened = store(t)
	target(opened)
	openPlan(opened, actor, { planId: 'checkout', target: 'checkout-local@1', request: planRequest() })
	const log = (explorationId: string, entries: unknown[]) => logEntries(opened, 'qa:a1', { explorationId, entries })
	for (const build of ['b1', 'b2', 'b3']) openExploration(opened, actor, { planId: 'checkout', build })
	const ids = Array.from({ length: count }, (_, index) => `D${index + 1}`)
	log(
		'x-1',
		ids.map((id) => ({
			kind: 'defect',
			id,
			title: `Problem ${id}`,
			severity: 'medium',
			expected: `Right ${id}`,
			actual: `Wrong ${id}`,
			steps: `Do ${id}.`,
		}))
	)
	const half = Math.ceil(count / 2)
	log(
		'x-2',
		ids.slice(0, half).map((id) => ({ kind: 'verdict', defect: id, result: 'fixed' }))
	)
	log(
		'x-3',
		ids.slice(half).map((id) => ({ kind: 'verdict', defect: id, result: 'fixed' }))
	)
	return opened
}

test('a fixed defect keeps its steps and its expected result, and the newest fix comes first', (t) => {
	const text = knownStateText(seeded(t, 2), 'checkout', 'b4')
	const fixed = text.slice(text.indexOf('## Problems reported as fixed'), text.indexOf('## Areas tested before'))
	assert.equal(
		fixed,
		[
			'## Problems reported as fixed',
			'',
			'Check that each one does not come back. The newest fix is first.',
			'',
			'### a1/D2: Problem D2 (medium)',
			'- Reported fixed on build: b3',
			'- Steps: Do D2.',
			'- Expected: Right D2',
			'- Actual: Wrong D2',
			'',
			'### a1/D1: Problem D1 (medium)',
			'- Reported fixed on build: b2',
			'- Steps: Do D1.',
			'- Expected: Right D1',
			'- Actual: Wrong D1',
			'',
			'',
		].join('\n')
	)
	assert.match(text, /\n## Open problems\n\nNone\.\n/)
})

test('a long file shortens the oldest fixed defects to a title line, and says how many', (t) => {
	const text = knownStateText(seeded(t, 30), 'checkout', 'b4')
	const lines = text.trimEnd().split('\n')
	assert(lines.length <= 150, String(lines.length))
	assert.match(text, /### a1\/D16: Problem D16 \(medium\)\n- Reported fixed on build: b3\n- Steps: Do D16\./)
	assert.match(text, /\n- a1\/D15: Problem D15 \(reported fixed on build b2\)\n/)
	const shortened = Number(/\n([0-9]+) older fixed problems are shortened to their title\.\n/.exec(text)![1])
	assert.equal(lines.filter((line) => /^- a1\/D[0-9]+: /.test(line)).length, shortened)
	assert.equal(lines.filter((line) => /^### a1\/D[0-9]+: /.test(line)).length, 30 - shortened)
	assert(text.indexOf('a1/D30') < text.indexOf('a1/D1:'), 'the newest fix comes first')
})
