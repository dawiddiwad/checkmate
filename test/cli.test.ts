import test from 'node:test'
import assert from 'node:assert/strict'
import { existsSync, readFileSync } from 'node:fs'
import { execFileSync } from 'node:child_process'
import { userInfo } from 'node:os'
import { join } from 'node:path'
import type { TestContext } from 'node:test'
import { cli, directory, json, profile, root } from './support.ts'

function setup(t: TestContext) {
	const workspace = directory(t)
	const value = profile()
	const steps: Array<[string[], unknown?]> = [
		[
			[
				'target',
				'open',
				'checkout-local',
				'--entry-point',
				'web:url:Checkout web application and HTTP API.',
				'--capabilities',
				value.capabilities.join(','),
				'--operations',
				value.allowedOperations.join(','),
			],
		],
		[['target', 'save', 'checkout-local'], value],
		[['target', 'instance', 'add', 'checkout-local', 'local', '--entry', 'web=http://127.0.0.1:4173']],
		[['open', 'cart', '--target', 'checkout-local', '--instance', 'local']],
		[['log', 'cart', '--build', 'b1'], { kind: 'note', text: 'The cart page loads.' }],
	]
	for (const [args, stdin] of steps) assert.equal(cli(workspace, args, stdin).code, 0, args.join(' '))
	return workspace
}

const question = { kind: 'question', question: 'Does the promotion stack with loyalty?' }

test('compact output starts with the status and subject; --json prints the same data', (t) => {
	const workspace = setup(t)
	const shown = cli(workspace, ['show', 'cart'])
	assert.equal(shown.code, 0)
	assert.equal(shown.lines[0], 'completed cart target=checkout-local instance=local builds=b1')
	const { code, body } = json(workspace, ['show', 'cart'])
	assert.equal(code, 0)
	assert.deepEqual([body.status, body.subject, body.reasons, body.builds], ['completed', 'cart', [], ['b1']])
	const again = cli(workspace, ['open', 'cart', '--target', 'checkout-local'])
	assert.equal(again.code, 1)
	assert.deepEqual(again.lines, [
		'rejected cart refusal=prohibited',
		'reason: Refused: prohibited in the current state.',
		'reason: Change cart is open.',
		'hint: Run checkmate show cart to read it. Use a new change ID for another change.',
	])
})

test('query is read-only and prints TSV with a header or JSON rows', (t) => {
	const workspace = setup(t)
	const rows = cli(workspace, ['query', 'SELECT change_id, target_id FROM changes'])
	assert.deepEqual(rows.lines, ['completed query rows=1', 'change_id\ttarget_id', 'cart\tcheckout-local'])
	assert.deepEqual(json(workspace, ['query', 'SELECT change_id FROM changes WHERE 0']).body.columns, ['change_id'])
	for (const sql of [
		'DELETE FROM operations',
		"INSERT INTO meta VALUES ('a', 'b')",
		'DROP TABLE meta',
		'PRAGMA user_version = 5',
		'pragma main.journal_mode=delete',
		'PRAGMA journal_mode(DELETE)',
		'/* note */ PRAGMA user_version = 1',
		' -- note\nPRAGMA locking_mode = exclusive',
		"VACUUM INTO '/tmp/checkmate-vacuum.db'",
		'BEGIN',
		'VACUUM',
	]) {
		const refused = cli(workspace, ['query', sql])
		assert.equal(refused.code, 1, sql)
		assert.deepEqual(refused.lines, [
			'rejected query refusal=prohibited',
			'reason: Refused: prohibited in the current state.',
			'reason: query is read-only. Use the Checkmate commands to change the record.',
		])
	}
	assert.deepEqual(cli(workspace, ['query', 'SELECT 1; DELETE FROM operations']).lines, [
		'rejected query refusal=malformed',
		'reason: Refused: malformed request.',
		'reason: query runs one SQL statement. Send each statement in its own query.',
	])
	assert.deepEqual(cli(workspace, ['query', 'SELEC 1']).lines, [
		'rejected query refusal=malformed',
		'reason: Refused: malformed request.',
		'reason: SQL error: near "SELEC": syntax error',
		'hint: Send one valid SQLite SELECT statement.',
	])
	assert.equal(cli(workspace, ['query', "SELECT ';' AS x; -- end"]).lines[2], ';')
	assert.equal(cli(workspace, ['query', 'PRAGMA table_info(meta)']).code, 0)
	assert.equal(cli(workspace, ['query', 'PRAGMA journal_mode']).lines[2], 'wal')
	assert.equal(json(workspace, ['query', 'SELECT count(*) AS n FROM operations']).body.rows[0].n, 5)
	const fresh = directory(t)
	assert.equal(cli(fresh, ['query', 'SELECT count(*) AS n FROM changes']).code, 1)
	assert(!existsSync(join(fresh, '.checkmate')))
})

test('--actor names the writer; parse errors are invalid requests', (t) => {
	const workspace = setup(t)
	assert.equal(cli(workspace, ['log', 'cart', '--build', 'b1', '--actor', 'reviewer'], question).code, 0)
	const actors = json(workspace, ['export', 'cart']).body
	assert.equal(typeof actors.content, 'string')
	const history = JSON.parse(actors.content).history as Array<{ kind: string; actor: string }>
	assert.deepEqual(
		history.map((row) => [row.kind, row.actor]),
		[
			['note', 'tester'],
			['question', 'reviewer'],
		]
	)
	const gapsUsage = 'Usage: checkmate gaps <changeId> [--build <value>] [--all]'
	const cases: Array<[string[], string, RegExp]> = [
		[
			['deploy'],
			'Unknown command: deploy',
			/^Use one of: init, target, open, log, gaps, guide, record, show, answer,/,
		],
		[['journal', 'log', 'cart'], 'Unknown command: journal log cart', /^Use one of: init, target, open, log,/],
		[
			['target', 'instance', 'drop', 'x', 'y'],
			'Unknown command: target instance drop',
			/^Use one of: target instance add, target instance retire, target instance list\. Run checkmate --help/,
		],
		[['target', 'instance', '--json'], 'Unknown command: target instance', /^Use one of: target instance add,/],
		[['gaps', 'cart', '--verbose'], 'Unknown option --verbose for gaps', /^Usage: checkmate gaps/],
		[['gaps', 'cart', '--actor', 'x'], 'Unknown option --actor for gaps', /^Usage: checkmate gaps/],
		[['gaps'], 'gaps needs 1 argument(s), not 0: <changeId>', /^Usage: checkmate gaps/],
		[['gaps', 'cart', '--build'], 'Missing value for --build', /^Usage: checkmate gaps/],
		[
			['merge', 'cart', '--build', 'a', '--build', 'b'],
			'Option --build is given twice',
			/^Usage: checkmate merge <changeId>/,
		],
		[['merge', 'cart'], 'Missing --build', /--build <value>/],
	]
	for (const [args, reason, hint] of cases) {
		const outcome = json(workspace, args)
		assert.equal(outcome.code, 1, args.join(' '))
		assert.deepEqual(outcome.body.reasons, ['Refused: malformed request.', reason], args.join(' '))
		assert.equal(outcome.body.status, 'invalid_request')
		assert.equal(outcome.body.refusal, 'malformed')
		assert.match(outcome.body.hint, hint, args.join(' '))
	}
	assert.equal(json(workspace, ['gaps', 'cart', '--verbose']).body.hint, gapsUsage)
	const badJson = cli(workspace, ['target', 'save', 'checkout-local'], '{not json')
	assert.equal(badJson.lines[0], 'rejected checkout-local refusal=malformed')
	assert.match(badJson.lines[2], /^reason: Standard input is not valid JSON/)
	assert.match(badJson.lines[3], /^hint: Send one JSON object on standard input/)
})

test('the operation log has one row per write, records refusals, and lists subjects', (t) => {
	const workspace = setup(t)
	cli(workspace, ['show', 'cart'])
	cli(workspace, ['accept', 'cart', '--build', 'b1', '--rationale', ''])
	cli(workspace, ['accept', 'cart', '--build', 'b1', '--rationale', 'Ok.'])
	const log = json(workspace, ['operations']).body.operations as Array<{
		rowid: number
		command: string
		status: string
		subjects: string[]
		actor: string
		arguments: Record<string, unknown>
		response: { reasons: string[] }
	}>
	assert.deepEqual(
		log.map((row) => [row.command, row.status, row.subjects]),
		[
			['accept', 'completed', ['change:cart']],
			['accept', 'rejected', []],
			['log', 'completed', ['change:cart']],
			['open', 'completed', ['change:cart']],
			['target instance add', 'completed', ['target:checkout-local']],
			['target save', 'completed', ['target:checkout-local']],
			['target open', 'completed', ['target:checkout-local']],
		]
	)
	assert.deepEqual(log[1].response.reasons, ['Missing rationale (--rationale)'])
	assert.equal(log[1].actor, 'tester')
	assert.equal(log[2].arguments.build, 'b1')
	const compact = cli(workspace, ['operations', '--subject', 'target:checkout-local', '--limit', '1'])
	assert.equal(compact.lines.length, 2)
	assert.match(
		compact.lines[1],
		/^[0-9A-Z]{26}\t\S+\ttester\ttarget instance add\tcompleted\ttarget:checkout-local\t3$/
	)
	assert.match(cli(workspace, ['operations', '--limit', '1']).lines[1], /\taccept\tcompleted\tchange:cart\tOk\.\t7$/)
	const after = json(workspace, ['operations', '--after', '3', '--limit', '2']).body.operations as typeof log
	assert.deepEqual(
		after.map((row) => [row.rowid, row.command]),
		[
			[4, 'open'],
			[5, 'log'],
		]
	)
	assert.deepEqual(json(workspace, ['operations', '--after', '7']).body.operations, [])
	assert.deepEqual(cli(workspace, ['operations', '--subject', 'checkout-local']).lines, [
		'invalid_request operations refusal=malformed',
		'reason: Refused: malformed request.',
		'reason: Invalid --subject: checkout-local. Use target:<targetId> or change:<changeId>.',
	])
	for (const [flag, text, reason] of [
		['--after', 'x', 'Invalid --after: x. Use a whole number from 0'],
		['--limit', 'ten', 'Invalid --limit: ten. Use a whole number from 1 to 1000.'],
		['--limit', '0', 'Invalid --limit: 0. Use a whole number from 1 to 1000.'],
		['--limit', '1001', 'Invalid --limit: 1001. Use a whole number from 1 to 1000.'],
	]) {
		const refused = cli(workspace, ['operations', flag, text])
		assert.equal(refused.lines[0], 'invalid_request operations refusal=malformed')
		assert(refused.lines[2].startsWith(`reason: ${reason}`), refused.output)
	}
	const before = json(workspace, ['operations']).body.operations.length
	assert.deepEqual(cli(workspace, ['guide', 'cart', '--role', 'boss']).lines, [
		'invalid_request guide refusal=malformed',
		'reason: Refused: malformed request.',
		'reason: Invalid --role: boss. Use one of: tester, recorder, merger, verifier.',
	])
	assert.equal(json(workspace, ['operations']).body.operations.length, before)
})

test('--version and --help need no workspace', () => {
	const manifest = JSON.parse(readFileSync(join(root, 'plugin/.claude-plugin/plugin.json'), 'utf8'))
	assert.equal(cli('/nonexistent', ['--version']).output, manifest.version)
	const help = cli('/nonexistent', ['--help']).output
	assert.match(help, /^checkmate init$/m)
	assert.match(
		help,
		/^checkmate log <changeId> \[--build <value>\] \[--from <value>\] \[--actor <name>\] <<'EOF' <json> EOF$/m
	)
	assert.doesNotMatch(help, /journal|plan|lite|run |delegate/)
	const group = cli('/nonexistent', ['target', '--help'])
	assert.equal(group.code, 0)
	assert.equal(group.lines[0], 'completed target')
	assert(
		group.lines.slice(1).every((line) => line.startsWith('checkmate target ')),
		group.output
	)
	assert.deepEqual(cli('/nonexistent', ['open', '--help']).lines, [
		'completed open',
		'checkmate open <changeId> --target <value> [--instance <value>] [--actor <name>]',
	])
	assert.deepEqual(json('/nonexistent', ['target', 'instance', 'retire', '--help']).body.usage, [
		'checkmate target instance retire <targetId> <instanceId> [--actor <name>]',
	])
	assert.deepEqual(cli('/nonexistent', ['ui', '--help']).lines, ['completed ui', 'checkmate ui [--port <value>]'])
	assert.equal(cli('/nonexistent', ['nope', '--help']).lines[0], 'invalid_request checkmate refusal=malformed')
})

test('without --actor and CHECKMATE_ACTOR, a write records the git user name, else the login name', (t) => {
	const workspace = setup(t)
	const env = {
		CHECKMATE_ACTOR: '',
		PATH: process.env.PATH!,
		GIT_CONFIG_GLOBAL: '/dev/null',
		GIT_CONFIG_NOSYSTEM: '1',
	}
	const ask = () => cli(workspace, ['log', 'cart', '--build', 'b1'], question, env)
	assert.equal(ask().code, 0)
	execFileSync('git', ['init', '-q'], { cwd: workspace, env })
	execFileSync('git', ['config', 'user.name', 'Repo User'], { cwd: workspace, env })
	assert.equal(ask().code, 0)
	const actors = json(workspace, ['query', "SELECT actor FROM journal_entries WHERE kind = 'question'"]).body.rows
	assert.deepEqual(
		actors.map((row: { actor: string }) => row.actor),
		[userInfo().username, 'Repo User']
	)
})

test('payload commands read a shell heredoc on standard input', (t) => {
	const workspace = directory(t)
	const value = profile()
	const checkmate = `node ${JSON.stringify(join(root, 'plugin/bin/checkmate.ts'))}`
	const script = [
		`${checkmate} target open checkout-local --entry-point "web:url:Checkout web application and HTTP API." --capabilities ${value.capabilities.join(',')} --operations ${value.allowedOperations.join(',')}`,
		`${checkmate} target save checkout-local <<'EOF'\n${JSON.stringify(value, null, 2)}\nEOF`,
		`${checkmate} open cart --target checkout-local`,
		`${checkmate} log cart --build b1 <<'EOF'\n${JSON.stringify(question, null, 2)}\nEOF`,
	].join('\n')
	const output = execFileSync('sh', ['-c', script], {
		cwd: workspace,
		env: { ...process.env, CHECKMATE_ACTOR: 'tester' },
		encoding: 'utf8',
	})
	assert.match(output, /^completed checkout-local@1 sha256=[a-f0-9]{8} recorded=true$/m)
	assert.match(output, /^completed cart saved=Q1$/m)
})

test('an old store is refused with its schema version', (t) => {
	const workspace = setup(t)
	execFileSync(process.execPath, [
		'-e',
		`const { DatabaseSync } = require('node:sqlite')
		const db = new DatabaseSync(${JSON.stringify(join(workspace, '.checkmate', 'checkmate.db'))})
		db.exec('DROP TRIGGER meta_update')
		db.exec("UPDATE meta SET value = '4' WHERE key = 'schemaVersion'")
		db.close()`,
	])
	const path = join(workspace, '.checkmate', 'checkmate.db')
	assert.deepEqual(cli(workspace, ['show', 'cart']).lines, [
		'rejected cart refusal=prohibited',
		'reason: Refused: prohibited in the current state.',
		`reason: Database ${path} has schema version 4. Expected 5.`,
	])
	assert(existsSync(path))
})
