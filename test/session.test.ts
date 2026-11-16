import test from 'node:test'
import assert from 'node:assert/strict'
import type { TestContext } from 'node:test'
import { existsSync, mkdirSync, readFileSync, realpathSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { run } from '../plugin/src/cli.ts'
import { closeStore, openStore } from '../plugin/src/store.ts'
import { exploration } from '../plugin/src/explorations.ts'
import { entryValues } from '../plugin/src/explorers.ts'
import { explorerBrief, followBrief } from '../plugin/src/briefs.ts'
import { explorationLive } from '../plugin/src/views.ts'
import { testLevels } from '../plugin/src/levels.ts'
import { actor, directory, plan, root, store, target } from './support.ts'

const stacks = { kind: 'defect', title: 'Coupon stacks', severity: 'high', expected: '450', actual: '400' }
const sale = { kind: 'defect', title: 'Sale price shows twice', severity: 'low', expected: 'Once', actual: 'Twice' }
const question = { kind: 'question', id: 'Q1', question: 'Can a coupon apply to a sale item?' }
const work = (explorer = '') => `.checkmate/work/x-1${explorer ? `/${explorer}` : ''}`
const tester = (name: string, step: string) =>
	`message ${name} ${step} agent=agent-${name} prompt="Read ${work(name)}/task-${step}.md and do what it says."`

function setup(t: TestContext) {
	const workspace = realpathSync(directory(t))
	const opened = store(t, workspace)
	target(opened)
	plan(opened)
	closeStore(opened)
	const command = (args: string[]) => {
		const outcome = run([...args, '--workspace', workspace, '--json'], {
			cwd: workspace,
			env: { CHECKMATE_ACTOR: actor, PATH: '' },
			stdin: () => '',
		})
		return { code: outcome.code, body: JSON.parse(outcome.output), output: outcome.output }
	}
	const text = (args: string[]) =>
		run([...args, '--workspace', workspace], { cwd: workspace, env: { PATH: '' }, stdin: () => '' }).output
	const start = (extra: string[] = []) =>
		command(['test', 'checkout', '--build', 'b1', '--mode', 'exploratory', '--session', ...extra])
	const next = () => command(['explore', 'next', 'x-1'])
	const lines = () => (next().body.actions as Array<{ line: string }>).map((item) => item.line)
	const done = (name: string, step: string, extra: string[] = []) => {
		const reply = command(['explore', 'done', 'x-1', name, step, ...extra])
		assert.equal(reply.code, 0, reply.output)
		return reply.body
	}
	const file = (path: string) => readFileSync(join(workspace, path), 'utf8')
	const put = (path: string, value: unknown) => {
		mkdirSync(join(workspace, path, '..'), { recursive: true })
		writeFileSync(join(workspace, path), typeof value === 'string' ? value : JSON.stringify(value))
	}
	return { workspace, command, text, start, next, lines, done, file, put }
}

function expectedBrief(workspace: string, explorer: string) {
	const opened = openStore(workspace)
	try {
		return explorerBrief(
			exploration(opened, 'x-1').charter,
			entryValues(opened, 'x-1'),
			`qa-x-1-${explorer}-`,
			work(explorer),
			{ study: 600, test: 900 }
		)
	} finally {
		closeStore(opened)
	}
}

const clean = (text: string) => text.replaceAll('.checkmate/work/', '')

test('a session run gives the actions of each step until it is finished, and the operator never writes a brief', (t) => {
	const { workspace, command, text, start, lines, done, file, put } = setup(t)
	const started = start()
	assert.equal(started.code, 0, started.output)
	assert.deepEqual(
		[started.body.path, started.body.level, started.body.explorers, started.body.model, started.body.next],
		['session', 'standard', 3, null, ['checkmate explore next x-1']]
	)
	assert.match(text(['explore', 'status', 'x-1']), /^completed x-1 state=testing .* path=session/)

	assert.deepEqual(
		lines(),
		['a1', 'a2', 'a3'].map(
			(name) =>
				`start ${name} study agent=checkmate:tester description="x-1 ${name} study" prompt="Read ${work(name)}/task-study.md and do what it says."`
		)
	)
	assert.deepEqual(lines(), ['wait'])
	for (const name of ['a1', 'a2', 'a3']) {
		const brief = expectedBrief(workspace, name)
		const study = file(`${work(name)}/task-study.md`)
		assert(study.startsWith(`${brief.study}\n\n`), study)
		assert.match(study, new RegExp(`export PLAYWRIGHT_CLI_SESSION=qa-x-1-${name};`))
		assert.doesNotMatch(clean(study), /checkmate|journal|recorder|\brecord\b/i)
		put(`${work(name)}/plan.md`, `plan of ${name}\n`)
		done(name, 'study', ['--agent', `agent-${name}`, '--activity', `Read the cart of ${name}.`])
	}
	const opened = openStore(workspace)
	assert.equal(explorationLive(opened, 'x-1').explorers[0].activity, 'Read the cart of a1.')
	closeStore(opened)

	assert.deepEqual(lines(), [tester('a1', 'test'), tester('a2', 'test'), tester('a3', 'test')])
	for (const name of ['a1', 'a2', 'a3']) {
		assert.equal(
			file(`${work(name)}/task-test.md`),
			`${expectedBrief(workspace, name).test}\n\nEnd your reply with this line: tester ${name} test done\n`
		)
		put(`${work(name)}/report.md`, `report of ${name}\n`)
		done(name, 'test')
	}

	assert.deepEqual(lines(), [tester('a1', 'record'), tester('a2', 'record'), tester('a3', 'record')])
	const record = file(`${work('a1')}/task-record.md`)
	assert.match(
		record,
		/\nWrite only one JSON array of the new entries to \.checkmate\/work\/x-1\/a1\/entries\.json, and nothing else\. Then reply in short\.\n/
	)
	assert.doesNotMatch(record, /Use no tool/)
	assert.doesNotMatch(clean(record), /checkmate/i)
	put(`${work('a1')}/entries.json`, [stacks, question])
	put(`${work('a2')}/entries.json`, [stacks])
	put(`${work('a3')}/entries.json`, [sale])
	for (const name of ['a1', 'a2', 'a3']) assert.equal(done(name, 'record').state, 'completed')

	assert.deepEqual(lines(), [
		'start merge merge agent=checkmate:clerk description="x-1 merge merge" prompt="Read .checkmate/work/x-1/merge/task.md and write your answer to .checkmate/work/x-1/merge/answer.json."',
	])
	const merge = file(`${work()}/merge/task.md`)
	assert.match(merge, /^Merge the reports of independent testers of build b1\. Do not test\.\n/)
	assert.match(merge, /\na1\/D1 \(high\): Coupon stacks/)
	assert.doesNotMatch(clean(merge), /Use no tool|checkmate/i)
	put(`${work()}/merge/answer.json`, [
		{ kind: 'issue', title: 'Coupons stack', severity: 'high', reports: ['a1/D1', 'a2/D1'] },
	])
	assert.equal(done('merge', 'merge', ['--agent', 'clerk-1']).event, 'merge')

	assert.deepEqual(lines(), [
		'start verify verify agent=checkmate:tester description="x-1 verify verify" prompt="Read .checkmate/work/x-1/verify/task.md and do what it says."',
	])
	for (const [path, line] of [
		[`${work('a1')}/task-study.md`, 'tester a1 study done'],
		[`${work('a2')}/task-test.md`, 'tester a2 test done'],
		[`${work('a3')}/task-record.md`, 'tester a3 record done'],
		[`${work()}/merge/task.md`, 'merge done'],
		[`${work()}/verify/task.md`, 'verify done'],
	])
		assert(file(path).endsWith(`\n\nEnd your reply with this line: ${line}\n`), path)
	const verify = file(`${work()}/verify/task.md`)
	assert.match(verify, /^Reproduce each problem below on the application\./)
	assert.match(verify, /\n- a3\/D1: Sale price shows twice /)
	assert.match(verify, /At the end, write only one JSON array to \.checkmate\/work\/x-1\/verify\/answer\.json, /)
	assert.doesNotMatch(clean(verify), /checkmate/i)
	put(`${work()}/verify/answer.json`, [{ id: 'a3/D1', seen: true, saw: 'Twice.' }])
	assert.equal(done('verify', 'verify', ['--agent', 'verifier-1']).state, 'completed')

	assert.deepEqual(lines(), ['finished'])
	assert.deepEqual(lines(), ['finished'])
	assert(!existsSync(join(workspace, work())), 'work folder removed')
	assert(!existsSync(join(workspace, '.checkmate', 'work')), 'empty work folder removed')
	assert(!existsSync(join(workspace, '.checkmate', 'tmp')), 'empty tmp folder removed')
	assert.match(text(['explore', 'status', 'x-1']), /\na1\tagent=agent-a1\tended=completed/)
	const shown = command(['explore', 'show', 'x-1']).body
	assert.equal(shown.state, 'completed')
	assert.deepEqual(
		shown.explorers.map((item: { explorer: string; session: string; ended: string; recorded: string }) => [
			item.explorer,
			item.session,
			item.ended,
			item.recorded,
		]),
		['a1', 'a2', 'a3'].map((name) => [name, `agent-${name}`, 'completed', 'completed'])
	)
	assert.deepEqual(
		shown.claims.map((claim: { id: string; state: string }) => [claim.id, claim.state]),
		[
			['merge/I1', 'confirmed'],
			['a3/D1', 'confirmed'],
		]
	)
	assert.deepEqual(
		shown.files.map((item: { explorer: string; name: string }) => [item.explorer, item.name]),
		['a1', 'a2', 'a3'].flatMap((name) => [
			[name, 'plan.md'],
			[name, 'report.md'],
		])
	)
	assert.equal(command(['explore', 'wait', 'x-1', '--timeout', '1']).body.outcome, 'done')
	const activities = command(['query', "SELECT detail FROM exploration_events WHERE explorer = 'a2'"])
		.body.rows.map((row: { detail: string }) => JSON.parse(row.detail).activity)
		.filter(Boolean)
	assert.deepEqual(activities, ['Read the cart of a2.', 'test ended', 'record ended'])
})

test('a refused entry gets one repair round, and the entries keep their evidence and new IDs', (t) => {
	const { workspace, start, next, lines, done, file, put, command } = setup(t)
	start(['--level', 'smoke'])
	next()
	done('a1', 'study', ['--agent', 'agent-a1'])
	next()
	put(`${work('a1')}/report.md`, 'report\n')
	done('a1', 'test')
	next()
	put(
		`${work('a1')}/entries.json`,
		`Here it is: ${JSON.stringify([
			{ ...stacks, id: 'D4', evidence: 'report.md' },
			{ kind: 'defect', title: 'No severity' },
		])}`
	)
	assert.equal(done('a1', 'record').event, 'repair')
	assert.deepEqual(lines(), [tester('a1', 'repair').replace(' repair ', ' record ')])
	const repair = file(`${work('a1')}/task-repair.md`)
	assert.match(repair, /^These entries of your file were refused:\n- /)
	assert.match(repair, /\n\nEnd your reply with this line: tester a1 record done\n$/)
	assert.match(
		repair,
		/\nWrite only one JSON array of the corrected entries to \.checkmate\/work\/x-1\/a1\/entries\.json, and nothing else\./
	)
	assert.doesNotMatch(clean(repair), /checkmate/i)
	assert(!existsSync(join(workspace, work('a1'), 'entries.json')), 'the old answer file goes')
	put(`${work('a1')}/entries.json`, [
		{ kind: 'defect', title: 'No severity', severity: 'low', expected: 'a', actual: 'b' },
	])
	const recorded = done('a1', 'record')
	assert.deepEqual(
		[recorded.event, recorded.state, recorded.saved, recorded.refused, recorded.calls],
		['record', 'completed', 2, 0, 2]
	)
	const rows = command(['query', "SELECT entry_id, body FROM journal_entries WHERE kind = 'defect' ORDER BY rowid"])
		.body.rows
	assert.deepEqual(
		rows.map((row: { entry_id: string }) => row.entry_id),
		['D4', 'D1']
	)
	assert.equal(JSON.parse(rows[0].body).evidence[0].path, `${work('a1')}/report.md`)
	assert.deepEqual(lines(), ['finished'])
	assert(!existsSync(join(workspace, work())))
})

test('a failed step ends its tester, and with no record the exploration fails and keeps its work folder', (t) => {
	const { workspace, start, next, command, done } = setup(t)
	start(['--level', 'smoke'])
	assert.equal(command(['explore', 'done', 'x-1', 'a1', 'test', '--agent', 'agent-a1']).code, 1)
	next()
	const bare = command(['explore', 'done', 'x-1', 'a1', 'study'])
	assert.match(bare.body.reasons[1], /^Give --agent with the agent ID that the Agent tool returned\.$/)
	done('a1', 'study', ['--failed', 'The agent stopped.'])
	const finished = next()
	assert.equal(finished.code, 1)
	assert.deepEqual(finished.body.reasons, ['No explorer session was recorded.'])
	assert.deepEqual(finished.body.actions, [{ action: 'finished', line: 'finished' }])
	const status = command(['explore', 'status', 'x-1']).body
	assert.deepEqual(
		[status.state, status.explorers[0].ended, status.explorers[0].reason, status.workFolder],
		['failed', 'operational_error', 'The agent stopped.', work()]
	)
	assert(existsSync(join(workspace, work('a1'), 'task-study.md')))
})

test('the process path refuses the session commands, and --session refuses host arguments', (t) => {
	const { command, start } = setup(t)
	const refused = start(['--claude-arg', '--model'])
	assert.match(refused.body.reasons[1], /^--claude-arg and --timeout are for testers in new processes\./)
	const opened = command(['explore', 'open', 'checkout', '--build', 'b1'])
	assert.equal(opened.code, 0)
	const next = command(['explore', 'next', 'x-1'])
	assert.match(next.body.reasons[1], /^Exploration x-1 does not run in a session\./)
	assert.equal(command(['explore', 'done', 'x-1', 'a1', 'flight']).code, 1)
})

test('a refused merge answer gets one repair round from the same clerk', (t) => {
	const { start, next, lines, done, put, file, command } = setup(t)
	start(['--level', 'smoke', '--explorers', '2'])
	next()
	for (const name of ['a1', 'a2']) done(name, 'study', ['--agent', `agent-${name}`])
	next()
	for (const name of ['a1', 'a2']) done(name, 'test')
	next()
	for (const name of ['a1', 'a2']) {
		put(`${work(name)}/entries.json`, [stacks])
		done(name, 'record')
	}
	next()
	put(`${work()}/merge/answer.json`, [
		{ kind: 'issue', title: 'Coupons stack', severity: 'high', reports: ['a9/D1'] },
	])
	assert.equal(done('merge', 'merge', ['--agent', 'clerk-1']).event, 'merge-round')
	assert.deepEqual(lines(), [
		'message merge merge agent=clerk-1 prompt="Read .checkmate/work/x-1/merge/task-repair.md and write your answer to .checkmate/work/x-1/merge/answer.json."',
	])
	assert.match(file(`${work()}/merge/task-repair.md`), /^These entries of your file were refused:\n- /)
	put(`${work()}/merge/answer.json`, [
		{ kind: 'issue', title: 'Coupons stack', severity: 'high', reports: ['a1/D1', 'a2/D1'] },
	])
	const merged = done('merge', 'merge')
	assert.deepEqual([merged.event, merged.state, merged.agent], ['merge', 'completed', 'clerk-1'])
	assert.deepEqual(lines(), ['finished'])
	assert.deepEqual(
		command(['claim', 'list', 'checkout']).body.claims.map((claim: { id: string }) => claim.id),
		['merge/I1']
	)
})

test('done refuses an agent ID of another tester, a rebind corrects it, and the reply line is checked', (t) => {
	const { start, lines, done, command } = setup(t)
	start()
	lines()
	done('a1', 'study', ['--agent', 'agent-a1'])
	done('a2', 'study', ['--agent', 'agent-a3'])
	const twice = command(['explore', 'done', 'x-1', 'a3', 'study', '--agent', 'agent-a3'])
	assert.equal(twice.code, 1)
	assert.equal(twice.body.reasons[1], 'Agent agent-a3 is bound to a2 in exploration x-1, not to a3.')
	assert.match(
		twice.body.hint,
		/correct it first: checkmate explore done x-1 a2 study --agent <the agent ID of a2>\.$/
	)
	assert.equal(done('a2', 'study', ['--agent', 'agent-a2']).event, 'bind')
	done('a3', 'study', ['--agent', 'agent-a3'])
	assert.deepEqual(lines(), [tester('a1', 'test'), tester('a2', 'test'), tester('a3', 'test')])
	const late = command(['explore', 'done', 'x-1', 'a2', 'study', '--agent', 'agent-a2b'])
	assert.equal(late.body.reasons[1], 'No study step of a2 runs in exploration x-1.')
	assert.match(late.body.hint, /^The steps that run: a1 test, a2 test, a3 test\./)
	const other = command(['explore', 'done', 'x-1', 'a1', 'test', '--reply-line', 'tester a2 test done'])
	assert.equal(other.code, 1)
	assert.equal(other.body.reasons[1], 'The reply line "tester a2 test done" names a2 test, not a1 test.')
	assert.match(other.body.hint, /^Record this reply for a2: checkmate explore done x-1 a2 test --agent /)
	assert.equal(done('a1', 'test', ['--reply-line', 'tester a1 test done']).state, 'completed')
	const status = command(['explore', 'status', 'x-1']).body
	assert.deepEqual(
		status.explorers.map((item: { session: string }) => item.session),
		['agent-a1', 'agent-a2', 'agent-a3']
	)
})

test('--instructions of a new plan reach the study task, for example the way to sign in', (t) => {
	const { command, file } = setup(t)
	const started = command([
		'test',
		'login',
		'--source',
		'ticket.md',
		'--build',
		'b1',
		'--instructions',
		'Sign in with the user in SHOP_USER and the password in SHOP_PASSWORD.',
		'--session',
	])
	assert.equal(started.code, 0, started.output)
	command(['explore', 'next', 'x-1'])
	assert.deepEqual(command(['status', 'login']).body.next, ['checkmate explore next x-1'])
	assert.match(
		file(`${work('a1')}/task-study.md`),
		/\nSign in with the user in SHOP_USER and the password in SHOP_PASSWORD\.\n/
	)
})

function finishedWithQuestion(context: ReturnType<typeof setup>, explorers: string[]) {
	const { start, next, done, put } = context
	start(['--level', 'smoke', '--explorers', String(explorers.length)])
	next()
	for (const name of explorers) done(name, 'study', ['--agent', `agent-${name}`])
	next()
	for (const name of explorers) done(name, 'test')
	next()
	for (const name of explorers) {
		put(`${work(name)}/entries.json`, [name === 'a1' ? question : { kind: 'note', text: `Explored ${name}.` }])
		done(name, 'record')
	}
	assert.deepEqual(context.lines(), ['finished'])
}

const answer = ['gap', 'answer', 'checkout', 'a1/Q1', '--kind', 'defer', '--value', 'No.', '--rationale', 'Rule.']

test('a follow-up messages each tester that can be reached, and skips the one that cannot', (t) => {
	const context = setup(t)
	const { command, lines, done, put, file, workspace } = context
	finishedWithQuestion(context, ['a1', 'a2'])
	assert.equal(command(answer).code, 0)
	const follow = command(['explore', 'follow', 'x-1'])
	assert.equal(follow.code, 0, follow.output)
	assert.deepEqual(follow.body.next, ['checkmate explore next x-1'])
	assert.deepEqual(lines(), [tester('a1', 'follow'), tester('a2', 'follow')])
	assert.equal(
		file(`${work('a1')}/task-follow.md`),
		`${followBrief([{ question: question.question, answer: 'No.' }], work('a1'), 300)}\n\nEnd your reply with this line: tester a1 follow done\n`
	)
	assert.equal(command(['explore', 'status', 'x-1']).body.state, 'following')
	put(`${work('a1')}/follow-up-report.md`, 'more\n')
	done('a1', 'follow', ['--activity', 'Tested a sale item.'])
	done('a2', 'follow', ['--failed', 'No agent with this ID.'])
	assert.deepEqual(lines(), [tester('a1', 'record')])
	put(`${work('a1')}/entries.json`, [question, sale])
	assert.equal(done('a1', 'record').saved, 1)
	assert.deepEqual(lines(), ['finished'])
	const status = command(['explore', 'status', 'x-1']).body
	assert.deepEqual([status.state, status.follow], ['completed', 'completed'])
	const followed = status.phases.findLast((item: { step: string }) => item.step === 'followed')
	assert.deepEqual(followed.detail.skipped, ['The agent of a2 could not be reached: No agent with this ID.'])
	assert(!existsSync(join(workspace, work())))
	const files = command(['explore', 'show', 'x-1']).body.files
	assert.deepEqual(files.at(-1), { ...files.at(-1), explorer: 'a1', phase: 'follow-1', name: 'follow-up-report.md' })
})

test('a follow-up with no tester to reach fails and tells the operator to test again', (t) => {
	const context = setup(t)
	const { command, lines, done } = context
	finishedWithQuestion(context, ['a1', 'a2'])
	command(answer)
	command(['explore', 'follow', 'x-1'])
	lines()
	done('a1', 'follow', ['--failed', 'The session ended.'])
	done('a2', 'follow', ['--failed', 'The session ended.'])
	const finished = command(['explore', 'next', 'x-1'])
	assert.equal(finished.code, 1)
	assert.deepEqual(finished.body.reasons, ['No tester of the follow-up could be reached.'])
	assert.equal(
		finished.body.hint,
		'The testers ran in a session that ended. Run checkmate test checkout --build b1 --session again. The answers reach the new testers through the known-state file.'
	)
	const status = command(['explore', 'status', 'x-1']).body
	assert.deepEqual([status.state, status.follow], ['completed', 'failed'])
	assert.equal(command(['status', 'checkout']).body.next[0], '1 unused answer of x-1: checkmate explore follow x-1')
})

test('the agent files name a plain tester and a clerk, without the Skill or Agent tool or Checkmate words', () => {
	const agents = { tester: 'Read, Write, Edit, Bash, Glob, Grep', clerk: 'Read, Write' }
	for (const [name, tools] of Object.entries(agents)) {
		const [, front, body] = readFileSync(join(root, 'plugin/agents', `${name}.md`), 'utf8').split('---\n')
		const fields = Object.fromEntries(
			front
				.trim()
				.split('\n')
				.map((line) => [line.slice(0, line.indexOf(':')), line.slice(line.indexOf(':') + 1).trim()])
		)
		assert.equal(fields.name, name)
		assert.equal(fields.tools, tools)
		assert.equal(fields.model, testLevels.standard.model)
		assert.doesNotMatch(fields.tools, /Skill|Agent|Task/)
		assert.doesNotMatch(body, /checkmate|journal|record/i)
		assert(body.trim().split(/(?<=\.)\s+/).length <= 3, body)
	}
})
