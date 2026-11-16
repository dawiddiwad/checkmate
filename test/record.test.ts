import test from 'node:test'
import assert from 'node:assert/strict'
import type { TestContext } from 'node:test'
import { chmodSync, existsSync, mkdirSync, readFileSync, realpathSync, utimesSync, writeFileSync } from 'node:fs'
import { delimiter, join } from 'node:path'
import { cli, directory, root } from './support.ts'
import { run } from '../plugin/src/cli.ts'
import { recorderPrompt } from '../plugin/src/guide.ts'

const script = join(root, 'plugin/bin/checkmate.ts')
const older = '11111111-1111-4111-8111-111111111111'
const tester = '22222222-2222-4222-8222-222222222222'
const caller = '33333333-3333-4333-8333-333333333333'

const fakeClaude = `#!/usr/bin/env node
const { execFileSync, spawnSync } = require('node:child_process')
const { mkdirSync, readFileSync, writeFileSync } = require('node:fs')
const { join } = require('node:path')
const args = process.argv.slice(2)
const prompt = readFileSync(0, 'utf8')
const recorder = args[args.indexOf('--session-id') + 1]
const checkmate = /Run \`node (\\S+) guide cart\`/.exec(prompt)[1]
const files = /to a file in (\\S+) with the Write tool/.exec(prompt)[1]
const guide = execFileSync(process.execPath, [checkmate, 'guide', 'cart'], { encoding: 'utf8' })
const folder = join(process.env.CLAUDE_CONFIG_DIR, 'projects', process.cwd().replace(/[^a-zA-Z0-9]/g, '-'))
mkdirSync(folder, { recursive: true })
writeFileSync(join(folder, recorder + '.jsonl'), '{}\\n')
const nested = spawnSync(process.execPath, [checkmate, 'record', 'cart'], { encoding: 'utf8' }).stdout
const env = ['CHECKMATE_WORKSPACE', 'CHECKMATE_ACTOR', 'CHECKMATE_RECORDER'].map((name) => process.env[name])
writeFileSync(process.env.FAKE_CLAUDE_CALL, JSON.stringify({ args, prompt, cwd: process.cwd(), env, nested, guide, files }))
const mode = process.env.FAKE_CLAUDE
if (mode === 'sleep') setTimeout(() => {}, 60000)
else if (mode === 'fail') {
	process.stderr.write('API error: overloaded\\n')
	process.exit(2)
} else {
	if (mode === 'log') {
		writeFileSync(
			join(files, 'entries.json'),
			JSON.stringify([
				{ kind: 'observation', about: 'coupon', saw: 'The total is 450.00.' },
				{ kind: 'defect', title: 'Coupon stacks', severity: 'high', expected: '450.00', actual: '400.00', evidence: ['evidence/total.txt'] },
			])
		)
		execFileSync(process.execPath, [checkmate, 'log', 'cart', '--build', 'b1', '--from', join(files, 'entries.json')])
	}
	process.stdout.write(
		JSON.stringify({ type: 'result', subtype: 'success', is_error: false, session_id: recorder, total_cost_usd: 0.25, duration_ms: 1234 })
	)
}
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
		FAKE_CLAUDE: 'log',
	}
	const record = (args: string[] = [], change: Record<string, string | undefined> = {}, json = true) => {
		const outcome = run(['record', 'cart', ...args, '--workspace', workspace, ...(json ? ['--json'] : [])], {
			cwd: workspace,
			env: { ...env, ...change },
			stdin: () => '',
			script,
		})
		return { code: outcome.code, output: outcome.output, body: json ? JSON.parse(outcome.output) : undefined }
	}
	const called = () => JSON.parse(readFileSync(call, 'utf8'))
	return { workspace, record, called }
}

test('record forks the latest test session, and the recorder logs as the actor of the caller', (t) => {
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
		added: { observation: 1, defect: 1 },
		entries: 2,
		costUsd: 0.25,
		durationMs: 1234,
	})
	const call = called()
	assert.deepEqual(call.args, [
		'-p',
		'--resume',
		tester,
		'--fork-session',
		'--session-id',
		recorder,
		'--output-format',
		'json',
		'--permission-prompts',
		'none',
		'--allowedTools',
		`Bash(node ${script} *)`,
		'Read',
		`Write(/${call.files}/**)`,
	])
	assert.equal(call.files, join(workspace, '.checkmate', 'tmp', `record-${recorder}`))
	assert.equal(call.prompt, recorderPrompt('cart', 'b1', { command: `node ${script}`, files: call.files }))
	assert(call.guide.includes(`node ${script} log cart --build <build> --from ${call.files}/<file>.json`), call.guide)
	assert(call.guide.includes(`Write to ${call.files}/entries.json:`), call.guide)
	assert.doesNotMatch(call.guide, /<<'EOF'|heredoc:|checkmate log/)
	assert.equal(existsSync(call.files), false)
	const evidence = JSON.parse(cli(workspace, ['export', 'cart']).output).entries.find(
		(entry: { kind: string }) => entry.kind === 'defect'
	).evidence
	assert.equal(evidence[0].path, 'evidence/total.txt')
	assert.equal(call.cwd, workspace)
	assert.deepEqual(call.env, [workspace, 'qa:a1', '1'])
	assert.match(call.nested, /^rejected cart refusal=prohibited\n.*\nreason: A recorder cannot start another recorder/)
	const actors = cli(workspace, ['query', "SELECT DISTINCT actor FROM journal_entries WHERE change_id = 'cart'"])
	assert.deepEqual(actors.lines.slice(1), ['actor', 'qa:a1'])
	const operation = cli(workspace, ['operations', '--subject', 'change:cart', '--limit', '1']).lines[1].split('\t')
	assert.deepEqual([operation[2], operation[3], operation[4]], ['qa:a1', 'record', 'completed'])

	const again = record([], { FAKE_CLAUDE: 'nothing' }, false)
	assert.equal(again.code, 1)
	assert.match(
		again.output,
		new RegExp(`^operational_error cart session=${tester} recorder=\\S+ entries=0 costUsd=0.25`)
	)
	assert.match(
		again.output,
		/\nreason: The recorder added no entry to cart\.\nhint: The entries that the recorder added stay/
	)
})

test('record reports a recorder that exits with an error or does not end in time', (t) => {
	const { record } = setup(t)
	const failed = record([], { FAKE_CLAUDE: 'fail' })
	assert.equal(failed.code, 1)
	assert.equal(failed.body.status, 'operational_error')
	assert.deepEqual(failed.body.reasons, ['The recorder exited with code 2: API error: overloaded'])
	const slow = record(['--timeout', '1'], { FAKE_CLAUDE: 'sleep' })
	assert.equal(slow.code, 1)
	assert.equal(slow.body.status, 'interrupted')
	assert.deepEqual(slow.body.reasons, ['The recorder did not end in 1 seconds. Checkmate stopped it.'])
	assert.equal(slow.body.entries, 0)
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

test('guide --role recorder prints the recorder prompt', (t) => {
	const { workspace } = setup(t)
	const prompt = cli(workspace, ['guide', 'cart', '--role', 'recorder', '--build', 'b2']).output
	assert.equal(prompt, recorderPrompt('cart', 'b2'))
	assert.match(
		prompt,
		/^Now record this session in Checkmate.*\(change cart, build b2\)\. Run `checkmate guide cart` first\./
	)
	assert.match(prompt, /Do not test again for the record/)
	assert.doesNotMatch(cli(workspace, ['guide', 'cart', '--role', 'recorder']).output, /build/)
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
