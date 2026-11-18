import test from 'node:test'
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { run } from '../plugin/src/cli.ts'
import { explorationEvents } from '../plugin/src/explorations.ts'
import { explorationStatus } from '../plugin/src/explorers.ts'
import { startUi } from '../plugin/src/ui/server.ts'
import { actor } from './support.ts'
import { call, endProcessesIn, waitFor, workspaceWithFake } from './actions.ts'

const defect = { kind: 'defect', title: 'Coupon stacks', severity: 'high', expected: '450', actual: '400' }
const question = { kind: 'question', id: 'Q1', question: 'Can a coupon apply to a sale item?' }
const rules = (args: string[]) => args.filter((arg, index) => args[index - 1] === '--allowedTools')
const own = (explorer: string) => `Edit(/.checkmate/work/x-1/${explorer}/**)`

function setup(t: Parameters<typeof workspaceWithFake>[0], replies: Parameters<typeof workspaceWithFake>[1]) {
	const ws = workspaceWithFake(t, replies)
	t.after(() => endProcessesIn(ws.workspace))
	const command = (args: string[]) =>
		run([...args, '--workspace', ws.workspace, '--json'], {
			cwd: ws.workspace,
			env: { ...ws.env, CHECKMATE_ACTOR: actor },
			stdin: () => '',
		})
	const ended = (step: string) =>
		waitFor(`the ${step} of x-1`, () =>
			ws.read((reading) => explorationEvents(reading, 'x-1').some((item) => item.step === step))
		)
	return { ...ws, command, ended }
}

test('a tester always may write in its own work folder, and no other child gets that rule', async (t) => {
	const ws = setup(t, { explorer: 'Tested.', recorder: [defect, question] })
	const started = ws.command([
		'explore',
		'start',
		'checkout',
		'--build',
		'b1',
		'--level',
		'normal',
		'--allow',
		'Read',
		'--allow',
		'Bash',
	])
	assert.equal(started.code, 0, started.output)
	await ws.ended('done')
	assert.equal(
		ws.command(['gap', 'answer', 'checkout', 'a1/Q1', '--kind', 'defer', '--value', 'No.', '--rationale', 'Rule.'])
			.code,
		0
	)
	assert.equal(ws.command(['explore', 'follow', 'x-1', '--allow', 'Read', '--allow', 'Bash']).code, 0)
	await ws.ended('followed')
	const calls = ws.called()
	const bySteps = (role: string) => calls.filter((item) => item.role === role)
	const names = (role: string) =>
		bySteps(role).map((item) => /\.checkmate\/work\/x-1\/(a\d)\//.exec(item.prompt)?.[1])
	for (const role of ['explorer', 'tester', 'follower']) {
		assert(bySteps(role).length >= 2, role)
		for (const [index, item] of bySteps(role).entries()) {
			const explorer = names(role)[index]!
			assert.deepEqual(rules(item.args), ['Read', 'Bash', own(explorer)], role)
			const settings = JSON.parse(item.args[item.args.indexOf('--settings') + 1])
			assert(settings.permissions.deny.includes('Edit(./.checkmate/checkmate.db*)'))
			assert(settings.permissions.deny.includes('Read(./.checkmate/checkmate.db*)'))
			assert.equal(rules(item.args).includes('Edit(/.checkmate/**)'), false)
		}
	}
	for (const role of ['recorder', 'merger', 'verifier', 'rules']) {
		for (const item of bySteps(role)) assert(!rules(item.args).some((rule) => rule.startsWith('Edit(')), role)
	}
	const launches = ws.read((reading) => explorationEvents(reading, 'x-1').filter((item) => item.step === 'launch'))
	assert.deepEqual(
		launches.map((item) => [item.explorer, item.detail.engineRules]),
		[
			['a1', [own('a1')]],
			['a2', [own('a2')]],
		]
	)
	assert.equal(ws.command(['explore', 'status', 'x-1']).code, 0)
})

for (const git of [false, true]) {
	test(`a file that a tester leaves in the project root is recorded and not touched${git ? ' (git workspace)' : ''}`, async (t) => {
		const ws = setup(t, { explorer: '!stray', recorder: [defect] })
		if (git) execFileSync('git', ['init', '-q'], { cwd: ws.workspace })
		const started = ws.command([
			'explore',
			'start',
			'checkout',
			'--build',
			'b1',
			'--level',
			'smoke',
			'--allow',
			'Read',
			'--allow',
			'Bash',
		])
		assert.equal(started.code, 0, started.output)
		await ws.ended('done')
		const strays = ws.read((reading) => explorationEvents(reading, 'x-1').filter((item) => item.step === 'stray'))
		assert.deepEqual(
			strays.map((item) => [item.explorer, item.status, item.detail.turn, item.detail.names]),
			[['a1', 'completed', 'study', [git ? 'qa-scratch/' : 'qa-scratch']]]
		)
		assert.equal(
			ws.read((reading) => explorationStatus(reading, 'x-1').explorers[0].stray.length),
			1
		)
		const ui = await startUi({ workspace: ws.workspace, defaultActor: '' })
		t.after(() => ui.close())
		const page = (await call(ui, '/explorations/x-1')).body
		assert.match(
			page,
			/Tester a1 left files outside its work folder: <code>qa-scratch\/?<\/code>\.\s+Checkmate did not touch them\./
		)
	})
}
