import test from 'node:test'
import assert from 'node:assert/strict'
import type { TestContext } from 'node:test'
import {
	chmodSync,
	existsSync,
	mkdirSync,
	rmSync,
	readFileSync,
	realpathSync,
	utimesSync,
	writeFileSync,
} from 'node:fs'
import { spawn, spawnSync } from 'node:child_process'
import { delimiter, join } from 'node:path'
import { cli, directory, json, root } from './support.ts'
import { run } from '../plugin/src/cli.ts'
import { recorderPrompt } from '../plugin/src/guide.ts'

const script = join(root, 'plugin/bin/checkmate.ts')
const older = '11111111-1111-4111-8111-111111111111'
const tester = '22222222-2222-4222-8222-222222222222'
const caller = '33333333-3333-4333-8333-333333333333'

const fakeClaude = `#!/usr/bin/env node
const { spawnSync } = require('node:child_process')
const { appendFileSync, mkdirSync, readFileSync, writeFileSync } = require('node:fs')
const { join } = require('node:path')
const args = process.argv.slice(2)
const prompt = readFileSync(0, 'utf8')
const repair = !args.includes('--fork-session')
const recorder = repair ? args[args.indexOf('--resume') + 1] : args[args.indexOf('--session-id') + 1]
const folder = join(process.env.CLAUDE_CONFIG_DIR, 'projects', process.cwd().replace(/[^a-zA-Z0-9]/g, '-'))
mkdirSync(folder, { recursive: true })
writeFileSync(join(folder, recorder + '.jsonl'), '{}\\n')
const nested = spawnSync(process.execPath, [process.env.FAKE_CHECKMATE, 'record', 'cart'], { encoding: 'utf8' }).stdout
const env = ['CHECKMATE_WORKSPACE', 'CHECKMATE_ACTOR', 'CHECKMATE_RECORDER'].map((name) => process.env[name])
appendFileSync(process.env.FAKE_CLAUDE_CALL, JSON.stringify({ args, prompt, cwd: process.cwd(), env, nested, start: Date.now() }) + '\\n')
const observation = { kind: 'observation', about: 'coupon', saw: 'The total is 450.00.' }
const defect = { kind: 'defect', title: 'Coupon stacks', severity: 'high', expected: '450.00', actual: '400.00', evidence: ['evidence/total.txt'] }
const json = (entries) => JSON.stringify(entries)
const replies = {
	reply: json([observation, defect]),
	slow: json([observation]),
	fenced: 'Here are the entries:\\n\\u0060\\u0060\\u0060json\\n' + json([observation, defect]) + '\\n\\u0060\\u0060\\u0060\\nI used [no tool].',
	nothing: 'I have nothing to add [yet].',
	fix: repair ? json([defect]) : json([observation, { ...defect, severity: undefined }]),
	collide: json([
		{ kind: 'note', id: 'N1', text: 'Explored the coupon form.' },
		{ kind: 'observation', id: 'O1', about: 'N1 and C1', saw: 'The total is 450.00.' },
		{ ...defect, id: 'D1', links: ['O1', 'C1'] },
	]),
	missing: json([{ ...defect, evidence: ['evidence/gone.png', 'evidence/total.txt'] }]),
	dangling: repair
		? json([{ kind: 'verdict', defect: 'D11', result: 'fixed' }])
		: json([
				{ kind: 'observation', id: 'O1', about: 'coupon', saw: 'The total is 450.00.' },
				{ ...defect, id: 'D1', links: ['O1', 'Q9'] },
				{ kind: 'observation', id: 'O2', saw: 'Again 450.00.', repeats: 'O7' },
				{ kind: 'verdict', defect: 'D11', result: 'fixed' },
			]),
	asked: json([
		{ kind: 'question', id: 'Q1', question: 'Does a coupon stack?' },
		{ ...defect, links: ['Q1'], evidence: ['total.txt', 'gone.png'] },
		{ kind: 'note', text: 'Saved the total.', evidence: 'total.txt' },
	]),
}
const mode = process.env.FAKE_CLAUDE
if (mode === 'fail') {
	process.stderr.write('API error: overloaded\\n')
	process.exit(2)
}
if (mode === 'sleep') setTimeout(() => {}, 60000)
else
	setTimeout(() => {
		if (mode === 'slow') appendFileSync(process.env.FAKE_CLAUDE_CALL, JSON.stringify({ end: Date.now() }) + '\\n')
		process.stdout.write(
			JSON.stringify({ type: 'result', subtype: 'success', is_error: false, result: replies[mode], session_id: recorder, total_cost_usd: 0.25, duration_ms: 1000 })
		)
	}, mode === 'slow' ? 600 : 0)
`

function setup(t: TestContext) {
	const workspace = realpathSync(directory(t))
	for (const args of [
		[
			'target',
			'open',
			'shop',
			'--entry-point',
			'web:url:The shop.',
			'--capabilities',
			'http',
			'--operations',
			'read',
		],
		['open', 'cart', '--target', 'shop'],
	])
		assert.equal(cli(workspace, args).code, 0, args.join(' '))
	mkdirSync(join(workspace, 'evidence'))
	writeFileSync(join(workspace, 'evidence', 'total.txt'), 'Total: 400.00')
	const bin = directory(t)
	writeFileSync(join(bin, 'claude'), fakeClaude)
	chmodSync(join(bin, 'claude'), 0o755)
	const config = directory(t)
	const folder = join(config, 'projects', workspace.replace(/[^a-zA-Z0-9]/g, '-'))
	mkdirSync(folder, { recursive: true })
	;[older, tester, caller].forEach((id, age) => {
		writeFileSync(join(folder, `${id}.jsonl`), '{}\n')
		utimesSync(join(folder, `${id}.jsonl`), 1000 + age, 1000 + age)
	})
	const call = join(directory(t), 'call.json')
	const env: Record<string, string | undefined> = {
		...process.env,
		PATH: `${bin}${delimiter}${process.env.PATH}`,
		CLAUDE_CONFIG_DIR: config,
		CLAUDE_CODE_SESSION_ID: caller,
		CHECKMATE_ACTOR: 'qa:a1',
		CHECKMATE_RECORDER: undefined,
		CHECKMATE_WORKSPACE: undefined,
		FAKE_CLAUDE_CALL: call,
		FAKE_CHECKMATE: script,
		FAKE_CLAUDE: 'reply',
	}
	const sessions = (directory: string) => {
		const folder = join(config, 'projects', realpathSync(directory).replace(/[^a-zA-Z0-9]/g, '-'))
		mkdirSync(folder, { recursive: true })
		writeFileSync(join(folder, `${older}.jsonl`), '{}\n')
		utimesSync(join(folder, `${older}.jsonl`), 500, 500)
		writeFileSync(join(folder, `${tester}.jsonl`), '{}\n')
		utimesSync(join(folder, `${tester}.jsonl`), 900, 900)
	}
	const recordFrom = (cwd: string, args: string[] = []) => {
		const outcome = run(['record', 'cart', ...args, '--json'], { cwd, env, stdin: () => '' })
		return { code: outcome.code, output: outcome.output, body: JSON.parse(outcome.output) }
	}
	const record = (args: string[] = [], change: Record<string, string | undefined> = {}, json = true) => {
		const outcome = run(['record', 'cart', ...args, '--workspace', workspace, ...(json ? ['--json'] : [])], {
			cwd: workspace,
			env: { ...env, ...change },
			stdin: () => '',
		})
		return { code: outcome.code, output: outcome.output, body: json ? JSON.parse(outcome.output) : undefined }
	}
	const called = () => {
		const lines = existsSync(call) ? readFileSync(call, 'utf8').trim().split('\n') : []
		rmSync(call, { force: true })
		return lines.map((line) => JSON.parse(line))
	}
	return { workspace, env, record, recordFrom, sessions, called }
}

const noTools = ['--output-format', 'json', '--permission-prompts', 'none']

test('record forks the latest test session, and Checkmate logs the reply of the recorder as the actor of the caller', (t) => {
	const { workspace, record, called } = setup(t)
	const reply = record(['--build', 'b1'])
	assert.equal(reply.code, 0, reply.output)
	const recorder = reply.body.recorder
	assert.deepEqual(reply.body, {
		status: 'completed',
		subject: 'cart',
		reasons: [],
		changeId: 'cart',
		build: 'b1',
		session: tester,
		recorder,
		calls: 1,
		saved: 2,
		refused: 0,
		added: { observation: 1, defect: 1 },
		evidenceMissing: 0,
		referencesDropped: 0,
		costUsd: 0.25,
		durationMs: 1000,
	})
	const [call] = called()
	assert.deepEqual(call.args, ['-p', '--resume', tester, '--fork-session', '--session-id', recorder, ...noTools])
	assert(!call.args.some((arg: string) => /allowedTools|Bash|Edit|Write|add-dir/.test(arg)), 'no tool grant')
	assert.equal(call.prompt, recorderPrompt('cart', 'b1', 'No criterion, defect, or question yet.'))
	assert.match(call.prompt, /Reply with only one JSON array of the new entries, and nothing else\. Use no tool\./)
	assert.doesNotMatch(call.prompt, /checkmate (log|guide|show)|<<'EOF'|Write tool/)
	assert.equal(existsSync(join(workspace, '.checkmate', 'tmp', 'record-cart.lock')), false)
	assert.equal(call.cwd, workspace)
	assert.deepEqual(call.env, [workspace, 'qa:a1', '1'])
	assert.match(call.nested, /^rejected cart refusal=prohibited\n.*\nreason: A recorder cannot start another recorder/)
	const exported = JSON.parse(cli(workspace, ['export', 'cart']).output)
	const defect = exported.entries.find((entry: { kind: string }) => entry.kind === 'defect')
	assert.deepEqual([defect.build, defect.evidence[0].path], ['b1', 'evidence/total.txt'])
	const actors = cli(workspace, ['query', "SELECT DISTINCT actor FROM journal_entries WHERE change_id = 'cart'"])
	assert.deepEqual(actors.lines.slice(1), ['actor', 'qa:a1'])
	const operations = json(workspace, ['operations', '--subject', 'change:cart', '--limit', '2']).body.operations
	assert.deepEqual(
		operations.map((operation: { actor: string; command: string; status: string }) => [
			operation.actor,
			operation.command,
			operation.status,
		]),
		[
			['qa:a1', 'record', 'completed'],
			['qa:a1', 'log', 'completed'],
		]
	)

	const fenced = record(['--build', 'b2'], { FAKE_CLAUDE: 'fenced' })
	assert.equal(fenced.code, 0, fenced.output)
	assert.equal(fenced.body.saved, 2)
	const [next] = called()
	assert.equal(next.args[2], tester)
	assert.match(next.prompt, /defect D1 \(b1, high\): Coupon stacks/)

	const again = record(['--build', 'b2'], { FAKE_CLAUDE: 'nothing' }, false)
	assert.equal(again.code, 1)
	assert.match(
		again.output,
		new RegExp(`^operational_error cart session=${tester} recorder=\\S+ saved=0 refused=0 costUsd=0.25`)
	)
	assert.match(
		again.output,
		/\nreason: The reply of the recorder has no JSON array of entries\.\nhint: The entries that Checkmate logged stay/
	)
})

test('record gives new IDs to reply entries whose IDs the record has, and keeps the references inside the reply', (t) => {
	const { workspace, record } = setup(t)
	const seeded = [
		{ kind: 'criterion', id: 'C1', text: 'A coupon does not stack.' },
		{ kind: 'note', id: 'N1', text: 'Read the ticket.' },
		{ kind: 'observation', id: 'O1', about: 'C1', saw: 'The form opens.' },
	]
	assert.equal(cli(workspace, ['log', 'cart', '--build', 'b1', '--actor', 'qa:a1'], seeded).code, 0)
	const reply = record(['--build', 'b1'], { FAKE_CLAUDE: 'collide' })
	assert.equal(reply.code, 0, reply.output)
	assert.deepEqual([reply.body.saved, reply.body.refused, reply.body.calls], [3, 0, 1])
	const entries = JSON.parse(cli(workspace, ['export', 'cart']).output).entries
	const byId = (id: string) => entries.find((entry: { id: string }) => entry.id === id)
	assert.equal(byId('N2').text, 'Explored the coupon form.')
	assert.equal(byId('O2').about, 'N2 and C1')
	assert.deepEqual(byId('D1').links, ['O2', 'C1'])
	assert.equal(byId('N1').text, 'Read the ticket.')
})

test('record keeps a missing evidence path as text and counts it, and log stays strict', (t) => {
	const { workspace, record } = setup(t)
	const reply = record(['--build', 'b1'], { FAKE_CLAUDE: 'missing' })
	assert.equal(reply.code, 0, reply.output)
	assert.deepEqual(
		[reply.body.saved, reply.body.evidenceMissing, reply.body.missingEvidence],
		[1, 1, ['evidence/gone.png']]
	)
	const defect = JSON.parse(cli(workspace, ['export', 'cart']).output).entries.find(
		(entry: { kind: string }) => entry.kind === 'defect'
	)
	assert.deepEqual(defect.evidence[0], { text: 'evidence/gone.png' })
	assert.equal(defect.evidence[1].path, 'evidence/total.txt')
	const strict = cli(
		workspace,
		['log', 'cart', '--build', 'b1', '--json'],
		[{ kind: 'observation', saw: 'x', evidence: 'evidence/gone.png' }]
	)
	assert.match(JSON.parse(strict.output).reasons[1], /Evidence file not found: evidence\/gone\.png/)
})

test('record resumes the recorder once to fix the refused entries', (t) => {
	const { record, called } = setup(t)
	const reply = record(['--build', 'b1'], { FAKE_CLAUDE: 'fix' })
	assert.equal(reply.code, 0, reply.output)
	assert.deepEqual([reply.body.calls, reply.body.saved, reply.body.refused], [2, 2, 0])
	assert.deepEqual([reply.body.costUsd, reply.body.durationMs], [0.5, 2000])
	const [, repair] = called()
	assert.deepEqual(repair.args, ['-p', '--resume', reply.body.recorder, ...noTools])
	assert.match(repair.prompt, /^Checkmate refused these entries of your reply:\n- \[1\] .*severity/)
	assert.match(repair.prompt, /Reply with only one JSON array of the corrected entries/)
})

test('record reports a recorder that exits with an error or does not end in time', (t) => {
	const { record } = setup(t)
	const failed = record([], { FAKE_CLAUDE: 'fail' })
	assert.equal(failed.code, 1)
	assert.equal(failed.body.status, 'operational_error')
	assert.deepEqual(failed.body.reasons, ['The recorder exited with code 2: API error: overloaded'])
	const slow = record(['--timeout', '1', '--build', 'b1'], { FAKE_CLAUDE: 'sleep' })
	assert.equal(slow.code, 1)
	assert.equal(slow.body.status, 'interrupted')
	assert.deepEqual(slow.body.reasons, ['The recorder did not end in 1 seconds. Checkmate stopped it.'])
	assert.deepEqual(slow.body.added, {})
})

test('record refuses without a change, claude, a session, or inside a recorder', (t) => {
	const { record, workspace } = setup(t)
	const empty = directory(t)
	for (const [args, change, reason] of [
		[[], { CHECKMATE_RECORDER: '1' }, /^A recorder cannot start another recorder/],
		[[], { PATH: empty }, /^No claude executable on PATH/],
		[[], { CLAUDE_CONFIG_DIR: empty }, /^No Claude Code session of /],
	] as const) {
		const reply = record([...args], change)
		assert.equal(reply.code, 1)
		assert.equal(reply.body.refusal, 'prohibited')
		assert.match(reply.body.reasons[1], reason)
	}
	const unknown = run(['record', 'kart', '--workspace', workspace, '--json'], {
		cwd: workspace,
		env: {},
		stdin: () => '',
	})
	assert.match(JSON.parse(unknown.output).reasons[1], /^Unknown change: kart/)
	assert.match(record([], { CLAUDE_CONFIG_DIR: empty }).body.hint, /--session <sessionId>/)
})

test('guide --role recorder prints the recorder prompt with a placeholder for the record', (t) => {
	const { workspace } = setup(t)
	const prompt = cli(workspace, ['guide', 'cart', '--role', 'recorder', '--build', 'b2']).output
	assert.equal(prompt, recorderPrompt('cart', 'b2'))
	assert.match(prompt, /^Now record this session in Checkmate.*\(change cart, build b2\)\./)
	assert.match(
		prompt,
		/Reply with only one JSON array of the new entries, and nothing else\. Use no tool\. Checkmate logs your reply with build b2\./
	)
	assert.match(prompt, /Number the new entries freely/)
	assert.match(prompt, /\nKind defect: /)
	assert.match(
		prompt,
		/The record already holds:\n<the criteria, defects with verdicts, and questions with answers of this change>$/
	)
	assert.doesNotMatch(cli(workspace, ['guide', 'cart', '--role', 'recorder']).output, /build b/)
	assert.match(cli(workspace, ['guide', 'cart', '--build', 'b2']).output, /--build is only for --role recorder/)
})

test('log --from reads the entries from a file in the workspace, with the evidence paths of standard input', (t) => {
	const { workspace } = setup(t)
	const entries = [
		{
			kind: 'defect',
			title: 'Wrong total',
			severity: 'high',
			expected: '450',
			actual: '400',
			evidence: ['evidence/total.txt'],
		},
	]
	writeFileSync(join(workspace, 'entries.json'), JSON.stringify(entries))
	const from = cli(workspace, ['log', 'cart', '--build', 'b1', '--from', 'entries.json', '--json'])
	const piped = cli(workspace, ['log', 'cart', '--build', 'b1', '--json'], entries)
	assert.equal(from.code, 0, from.output)
	assert.equal(piped.code, 0, piped.output)
	const defects = JSON.parse(cli(workspace, ['export', 'cart']).output).entries.filter(
		(entry: { kind: string }) => entry.kind === 'defect'
	)
	assert.deepEqual(defects[0].evidence, defects[1].evidence)
	const outside = join(directory(t), 'entries.json')
	writeFileSync(outside, JSON.stringify(entries))
	for (const [file, reason] of [
		[outside, /^Entries file must be inside the workspace/],
		['missing.json', /^No entries file: missing\.json/],
	] as const) {
		const refused = JSON.parse(cli(workspace, ['log', 'cart', '--from', file, '--json']).output)
		assert.equal(refused.refusal, 'malformed')
		assert.match(refused.reasons[1], reason)
	}
})

test('record runs in the directory of the caller, and finds its session and its evidence there', (t) => {
	const { workspace, recordFrom, sessions, called } = setup(t)
	const subdirectory = join(workspace, 'qa')
	mkdirSync(join(subdirectory, 'evidence'), { recursive: true })
	writeFileSync(join(subdirectory, 'evidence', 'total.txt'), 'Total: 401.00')
	const missing = recordFrom(subdirectory)
	assert.equal(missing.code, 1)
	assert.match(missing.body.reasons[1], new RegExp(`^No Claude Code session of ${realpathSync(subdirectory)} in`))
	sessions(subdirectory)
	const reply = recordFrom(subdirectory, ['--build', 'b1'])
	assert.equal(reply.code, 0, reply.output)
	assert.equal(reply.body.session, tester)
	const [call] = called()
	assert.equal(call.cwd, realpathSync(subdirectory))
	assert.deepEqual(call.args.slice(0, 6), [
		'-p',
		'--resume',
		tester,
		'--fork-session',
		'--session-id',
		reply.body.recorder,
	])
	assert.deepEqual(call.args.slice(6), noTools)
	assert.equal(call.env[0], workspace)
	const defect = JSON.parse(cli(workspace, ['export', 'cart']).output).entries.find(
		(entry: { kind: string }) => entry.kind === 'defect'
	)
	assert.equal(defect.evidence[0].path, 'qa/evidence/total.txt')
})

test('record saves a defect that links a question, and a note with evidence found by the end of its path', (t) => {
	const { workspace, record } = setup(t)
	const reply = record(['--build', 'b1'], { FAKE_CLAUDE: 'asked' })
	assert.equal(reply.code, 0, reply.output)
	assert.deepEqual([reply.body.saved, reply.body.refused, reply.body.calls], [3, 0, 1])
	assert.deepEqual([reply.body.evidenceMissing, reply.body.missingEvidence], [1, ['gone.png']])
	const entries = JSON.parse(cli(workspace, ['export', 'cart']).output).entries
	const kind = (name: string) => entries.find((entry: { kind: string }) => entry.kind === name)
	assert.deepEqual(kind('defect').links, ['Q1'])
	assert.equal(kind('defect').evidence[0].path, 'evidence/total.txt')
	assert.equal(kind('note').evidence[0].path, 'evidence/total.txt')
	assert.equal(cli(workspace, ['show', 'cart']).code, 0)
	assert.equal(cli(workspace, ['gaps', 'cart', '--build', 'b1']).code, 0)
})

test('record keeps evidence as text when the end of its path matches no file or two files', (t) => {
	const { workspace, record } = setup(t)
	mkdirSync(join(workspace, 'qa', 'evidence'), { recursive: true })
	mkdirSync(join(workspace, 'node_modules', 'pkg'), { recursive: true })
	writeFileSync(join(workspace, 'qa', 'evidence', 'total.txt'), 'Total: 401.00')
	writeFileSync(join(workspace, 'node_modules', 'pkg', 'gone.png'), 'png')
	const reply = record(['--build', 'b1'], { FAKE_CLAUDE: 'asked' })
	assert.equal(reply.code, 0, reply.output)
	assert.deepEqual(reply.body.missingEvidence, ['total.txt', 'gone.png', 'total.txt'])
})

test('record drops a link to an ID that is nowhere, and refuses a verdict for a defect that is nowhere', (t) => {
	const { workspace, record } = setup(t)
	const reply = record(['--build', 'b1'], { FAKE_CLAUDE: 'dangling' })
	assert.equal(reply.code, 0, reply.output)
	assert.deepEqual([reply.body.saved, reply.body.refused, reply.body.calls], [3, 1, 2])
	assert.deepEqual([reply.body.referencesDropped, reply.body.droppedReferences], [2, ['Q9', 'O7']])
	assert.match(reply.body.reasons.at(-1), /^Refused: \[0\]\.defect names no defect or issue: D11\./)
	const entries = JSON.parse(cli(workspace, ['export', 'cart']).output).entries
	const byId = (id: string) => entries.find((entry: { id: string }) => entry.id === id)
	assert.deepEqual([byId('D1').links, byId('O2').repeats], [['O1'], undefined])
	const strict = cli(
		workspace,
		['log', 'cart', '--build', 'b1', '--json'],
		[{ kind: 'defect', title: 't', severity: 'low', expected: 'e', actual: 'a', links: ['Q9'] }]
	)
	assert.match(JSON.parse(strict.output).reasons[1], /\.links names no observation or criterion or question: Q9/)
})

async function until<T>(check: () => T | undefined, seconds = 15) {
	const end = Date.now() + seconds * 1000
	for (;;) {
		const found = check()
		if (found !== undefined) return found
		assert(Date.now() < end, 'The condition did not hold in time')
		await new Promise((done) => setTimeout(done, 100))
	}
}

function hookProcess(input: string, env: Record<string, string | undefined>, cwd: string) {
	return spawnSync(process.execPath, [script, 'record-hook'], { input, env, cwd, encoding: 'utf8' })
}

test('the record hook is silent and does nothing without CHECKMATE_RECORD, inside a recorder, or with bad input', (t) => {
	const { workspace, env } = setup(t)
	const input = JSON.stringify({ session_id: tester, cwd: workspace, hook_event_name: 'SessionEnd' })
	for (const change of [{}, { CHECKMATE_RECORD: 'cart', CHECKMATE_RECORDER: '1' }]) {
		const hook = hookProcess(input, { ...env, ...change }, workspace)
		assert.deepEqual([hook.status, hook.stdout, hook.stderr], [0, '', ''])
	}
	assert.equal(existsSync(join(workspace, '.checkmate', 'tmp')), false)
	const bad = hookProcess('not json', { ...env, CHECKMATE_RECORD: 'cart' }, workspace)
	assert.deepEqual([bad.status, bad.stdout, bad.stderr], [0, '', ''])
	const log = readFileSync(join(workspace, '.checkmate', 'tmp', 'record-hook-unknown.log'), 'utf8')
	assert.match(log, /The hook input is not valid JSON\. No recorder started\.\n$/)
	const away = directory(t)
	const elsewhere = hookProcess(input.replace(workspace, away), { ...env, CHECKMATE_RECORD: 'cart' }, away)
	assert.deepEqual([elsewhere.status, elsewhere.stdout], [0, ''])
	assert.equal(existsSync(join(away, '.checkmate')), false)
})

test('the record hook starts a detached recorder for the ended session, and the record gets its entries', async (t) => {
	const { workspace, env, called } = setup(t)
	const input = JSON.stringify({ session_id: tester, cwd: workspace, hook_event_name: 'SessionEnd', reason: 'other' })
	const hook = hookProcess(input, { ...env, CHECKMATE_RECORD: 'cart', CHECKMATE_BUILD: 'b1' }, workspace)
	assert.deepEqual([hook.status, hook.stdout, hook.stderr], [0, '', ''])
	const log = join(workspace, '.checkmate', 'tmp', `record-hook-${tester}.log`)
	const done = await until(() => {
		const text = existsSync(log) ? readFileSync(log, 'utf8') : ''
		return /^completed cart /m.test(text) ? text : undefined
	})
	assert.match(
		done,
		new RegExp(`^\\S+ checkmate record cart --session ${tester} --build b1\\ncompleted cart session=${tester} `)
	)
	const [call] = called()
	assert.deepEqual(call.args.slice(0, 4), ['-p', '--resume', tester, '--fork-session'])
	const operation = json(workspace, ['operations', '--subject', 'change:cart', '--limit', '1']).body.operations[0]
	assert.deepEqual([operation.command, operation.status], ['record', 'completed'])
})

test('two record calls for one change run one after the other, and a stale lock is taken over', async (t) => {
	const { workspace, env, record, called } = setup(t)
	const recordProcess = () =>
		new Promise<number | null>((done) => {
			const child = spawn(process.execPath, [script, 'record', 'cart', '--session', tester, '--build', 'b1'], {
				cwd: workspace,
				env: { ...env, FAKE_CLAUDE: 'slow' },
				stdio: 'ignore',
			})
			child.on('close', done)
		})
	assert.deepEqual(await Promise.all([recordProcess(), recordProcess()]), [0, 0])
	const events = called()
	const starts = events.filter((event) => event.start).map((event) => event.start)
	const ends = events.filter((event) => event.end).map((event) => event.end)
	assert.equal(starts.length, 2)
	assert(Math.max(...starts) >= Math.min(...ends), JSON.stringify(events.map((event) => event.start ?? event.end)))
	const lock = join(workspace, '.checkmate', 'tmp', 'record-cart.lock')
	assert.equal(existsSync(lock), false)
	const dead = spawnSync(process.execPath, ['-e', '']).pid
	writeFileSync(lock, String(dead))
	assert.equal(record(['--build', 'b1']).body.status, 'completed')
	assert.equal(existsSync(lock), false)
	writeFileSync(lock, String(process.pid))
	const waited = record(['--timeout', '1', '--build', 'b1'])
	assert.equal(waited.body.status, 'operational_error')
	assert.match(waited.body.reasons[0], /^Another recorder of cart runs\. Checkmate waited 1 seconds for it\./)
	const operation = json(workspace, ['operations', '--subject', 'change:cart', '--limit', '1']).body.operations[0]
	assert.deepEqual([operation.command, operation.status], ['record', 'operational_error'])
})

test('the plugin declares one SessionEnd hook that runs record-hook', () => {
	const hooks = JSON.parse(readFileSync(join(root, 'plugin/hooks/hooks.json'), 'utf8'))
	assert.deepEqual(Object.keys(hooks.hooks), ['SessionEnd'])
	assert.deepEqual(hooks.hooks.SessionEnd, [
		{ hooks: [{ type: 'command', command: 'node "${CLAUDE_PLUGIN_ROOT}/dist/checkmate.js" record-hook' }] },
	])
})
