import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { execFileSync, spawn } from 'node:child_process'
import { userInfo } from 'node:os'
import { join } from 'node:path'
import { closeStore } from '../plugin/src/store.ts'
import { uiOptions } from '../plugin/src/cli.ts'
import { rejectPlan } from '../plugin/src/plans.ts'
import {
	begin,
	candidate,
	cli,
	directory,
	json,
	passRun,
	planRequest,
	profile,
	promotionDelta,
	ready,
	root,
	store,
} from './support.ts'
import type { TestContext } from 'node:test'

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
		[['plan', 'open', 'checkout', '--target', 'checkout-local@1'], planRequest()],
		[['plan', 'save', 'checkout'], candidate()],
	]
	for (const [args, stdin] of steps) assert.equal(cli(workspace, args, stdin).code, 0, args.join(' '))
	return workspace
}

function revise(workspace: string) {
	const answers = [
		['G1', 'clarify', 'Promotion replaces loyalty.', '--source', 'decisions#1'],
		['G2', 'defer', 'Later.'],
	]
	for (const [gap, kind, text, ...rest] of answers)
		assert.equal(
			cli(workspace, [
				'gap',
				'answer',
				'checkout',
				gap,
				'--kind',
				kind,
				'--value',
				text,
				'--rationale',
				'Product.',
				...rest,
			]).code,
			0
		)
	assert.equal(cli(workspace, ['plan', 'revise', 'checkout'], promotionDelta).code, 0)
}

test('compact output starts with the status and subject; --json prints the same data', (t) => {
	const workspace = setup(t)
	const shown = cli(workspace, ['plan', 'show', 'checkout'])
	assert.equal(shown.code, 0)
	assert.match(shown.lines[0], /^completed checkout@1 sha256=[a-f0-9]{8} approval=pending$/)
	assert(shown.lines.some((line) => line.startsWith('G1\tblocking\topen\t')))
	const { code, body } = json(workspace, ['plan', 'show', 'checkout@1'])
	assert.equal(code, 0)
	assert.deepEqual([body.status, body.subject, body.reasons, body.revision], ['completed', 'checkout@1', [], 1])
	assert.equal(body.plan.tests.length, 3)
})

test('--tests and --fields select what plan show prints', (t) => {
	const workspace = setup(t)
	revise(workspace)
	const shown = cli(workspace, ['plan', 'show', 'checkout@2', '--tests', 'T2', '--fields', 'readiness,assertions'])
	assert.equal(shown.code, 0)
	assert.match(shown.lines[0], /^completed checkout@2 sha256=[a-f0-9]{8}$/)
	assert.deepEqual(shown.lines.slice(1), [
		'T2\tready',
		'T2.A1\tdeterministic\tThe response status is HTTP 200.',
		'T2.A2\tdeterministic\ttotalPLN equals 240.',
	])
	const fields = json(workspace, ['plan', 'show', 'checkout@2', '--fields', 'title']).body
	assert.deepEqual(fields.tests, [
		{ id: 'T1', title: 'Standard order total' },
		{ id: 'T2', title: 'Promotion quote' },
		{ id: 'T3', title: 'Refund eligibility' },
	])
	const unknown = cli(workspace, ['plan', 'show', 'checkout@2', '--fields', 'expected'])
	assert.equal(unknown.code, 1)
	assert.equal(unknown.lines[0], 'rejected checkout@2 refusal=malformed')
	assert.match(unknown.lines[2], /^reason: Unknown field: expected\. Use: title, readiness/)
	assert.deepEqual(cli(workspace, ['plan', 'show', 'checkout@2', '--tests', 'T9']).lines.slice(2), [
		'reason: Unknown test in checkout@2: T9',
		'hint: Use one of: T1, T2, T3.',
	])
	const pending = cli(workspace, ['plan', 'pending', 'checkout'])
	assert.match(pending.lines[0], /^completed checkout@2 sha256=[a-f0-9]{8} decisions=0$/)
	const diff = cli(workspace, ['plan', 'diff', 'checkout', '1', '2'])
	assert(diff.lines.includes('change\tT2.A2 added: "totalPLN equals 240."'))
	assert(diff.lines.some((line) => line.startsWith('add\t/tests/1/assertions/1\t')))
})

test('--expect-sha stops a decision on a changed snapshot', (t) => {
	const workspace = setup(t)
	revise(workspace)
	const sha256 = json(workspace, ['plan', 'show', 'checkout@2']).body.sha256 as string
	const stale = cli(workspace, ['plan', 'approve', 'checkout@2', '--rationale', 'Ok.', '--expect-sha', 'ffffffff'])
	assert.equal(stale.code, 1)
	assert.equal(stale.lines[0], 'rejected checkout@2 refusal=prohibited')
	assert.match(
		stale.lines[2],
		/^reason: checkout@2 has digest [a-f0-9]{64}, not ffffffff\. Read it again before you decide\.$/
	)
	const bad = cli(workspace, ['plan', 'approve', 'checkout@2', '--rationale', 'Ok.', '--expect-sha', 'xyz'])
	assert.equal(bad.lines[0], 'rejected checkout@2 refusal=malformed')
	assert.match(bad.lines[2], /Invalid --expect-sha: xyz/)
	const approved = cli(workspace, ['plan', 'approve', 'checkout@2', '--rationale', 'Ok.', '--expect-sha', sha256])
	assert.equal(approved.code, 0)
	assert.equal(approved.lines[0], `completed checkout@2 verdict=approved sha256=${sha256.slice(0, 8)}`)
})

test('inspection commands read committed records while another command holds the write lock', async (t) => {
	const writer = store(t)
	const { workspace } = writer
	ready(writer)
	assert.equal(passRun(writer, 'run-1', 'build-1').status, 'completed')
	const commands: Array<[string[], object]> = [
		[['status', 'checkout'], { subject: 'checkout' }],
		[['plan', 'show', 'checkout@2'], { subject: 'checkout@2', plan: { objective: planRequest().objective } }],
		[['run', 'show', 'run-1'], { subject: 'run-1', state: 'finalized' }],
		[
			['target', 'show', 'checkout-local@1', '--instance', 'local'],
			{ subject: 'checkout-local@1', instance: { instanceId: 'local' } },
		],
		[['run', 'list'], { subject: 'runs', runs: [{ runId: 'run-1' }] }],
	]
	writer.db.exec('BEGIN IMMEDIATE')
	try {
		writer.db.exec(`INSERT INTO instances (target_id, instance_id, body, operation_id)
			SELECT target_id, 'uncommitted-instance', body, operation_id FROM instances WHERE instance_id = 'local'`)
		for (const [args, expected] of commands)
			await t.test(args.join(' '), () => {
				const result = execFileSync(
					process.execPath,
					[join(root, 'plugin/dist/checkmate.js'), ...args, '--workspace', workspace, '--json'],
					{ encoding: 'utf8', env: { ...process.env, CHECKMATE_BUSY_TIMEOUT_MS: '10' } }
				)
				assert.partialDeepStrictEqual(JSON.parse(result), { status: 'completed', ...expected })
				assert.doesNotMatch(result, /uncommitted-instance/)
			})
	} finally {
		writer.db.exec('ROLLBACK')
	}
})

test('query is read-only and prints TSV with a header or JSON rows', (t) => {
	const workspace = setup(t)
	const rows = cli(workspace, ['query', 'SELECT plan_id, revision FROM plan_revisions'])
	assert.deepEqual(rows.lines, ['completed query rows=1', 'plan_id\trevision', 'checkout\t1'])
	assert.deepEqual(json(workspace, ['query', 'SELECT plan_id FROM plan_revisions WHERE 0']).body.columns, ['plan_id'])
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
	assert.deepEqual(cli(fresh, ['query', 'SELECT count(*) AS n FROM plan_revisions']).lines, [
		'completed query rows=1',
		'n',
		'0',
	])
})

test('--actor names the writer; parse errors are invalid requests', (t) => {
	const workspace = setup(t)
	const named = json(workspace, [
		'gap',
		'answer',
		'checkout',
		'G2',
		'--kind',
		'defer',
		'--value',
		'x',
		'--rationale',
		'y',
		'--actor',
		'reviewer',
	])
	assert.equal(named.code, 0)
	assert.equal(json(workspace, ['plan', 'show', 'checkout']).body.pendingDecisions[0].actor, 'reviewer')
	const showUsage = 'Usage: checkmate plan show <reference> [--tests <a,b>] [--fields <a,b>] [--gaps <open|all>]'
	const cases: Array<[string[], string, RegExp]> = [
		[
			['deploy'],
			'Unknown command: deploy',
			/^Use one of: init, inbox, status, target, plan, gap, run, finding, result,/,
		],
		[
			['target', 'instance', 'drop', 'x', 'y'],
			'Unknown command: target instance drop',
			/^Use one of: target instance add, target instance retire, target instance list\. Run checkmate --help/,
		],
		[['target', 'instance', '--json'], 'Unknown command: target instance', /^Use one of: target instance add,/],
		[
			['plan', 'show', 'checkout', '--verbose'],
			'Unknown option --verbose for plan show',
			/^Usage: checkmate plan show/,
		],
		[
			['plan', 'show', 'checkout', '--actor', 'x'],
			'Unknown option --actor for plan show',
			/^Usage: checkmate plan show/,
		],
		[['plan', 'show'], 'plan show needs 1 argument(s), not 0: <reference>', /^Usage: checkmate plan show/],
		[['plan', 'show', 'checkout', '--tests'], 'Missing value for --tests', /^Usage: checkmate plan show/],
		[
			['run', 'gate', 'checkout@1', '--build', 'a', '--build', 'b'],
			'Option --build is given twice',
			/^Usage: checkmate run gate <reference>/,
		],
		[['run', 'gate', 'checkout@1', '--tests', 'T1'], 'Missing --build', /--build <value>/],
	]
	for (const [args, reason, hint] of cases) {
		const outcome = json(workspace, args)
		assert.equal(outcome.code, 1, args.join(' '))
		assert.deepEqual(outcome.body.reasons, ['Refused: malformed request.', reason], args.join(' '))
		assert.equal(outcome.body.status, 'invalid_request')
		assert.equal(outcome.body.refusal, 'malformed')
		assert.match(outcome.body.hint, hint, args.join(' '))
	}
	assert.equal(json(workspace, ['plan', 'show', 'checkout', '--verbose']).body.hint, showUsage)
	const badJson = cli(workspace, ['run', 'finding', 'run-1'], '{not json')
	assert.equal(badJson.lines[0], 'rejected run-1 refusal=malformed')
	assert.match(badJson.lines[2], /^reason: Standard input is not valid JSON/)
	assert.match(badJson.lines[3], /^hint: Send one JSON object on standard input/)
})

test('the operation log has one row per write, records refusals, and lists subjects', (t) => {
	const workspace = setup(t)
	cli(workspace, ['plan', 'show', 'checkout'])
	cli(workspace, ['plan', 'approve', 'checkout@1', '--rationale', ''])
	cli(workspace, ['plan', 'approve', 'checkout@1', '--rationale', 'Ok.'])
	const log = json(workspace, ['log']).body.operations as Array<{
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
			['plan approve', 'completed', ['plan:checkout', 'inbox']],
			['plan approve', 'rejected', []],
			['plan save', 'needs_decision', ['plan:checkout', 'inbox']],
			['plan open', 'completed', ['plan:checkout', 'inbox']],
			['target instance add', 'completed', ['target:checkout-local']],
			['target save', 'completed', ['target:checkout-local']],
			['target open', 'completed', ['target:checkout-local']],
		]
	)
	assert.deepEqual(log[1].response.reasons, ['Missing rationale (--rationale)'])
	assert.equal(log[1].actor, 'tester')
	assert.deepEqual((log[2].arguments.candidate as { tests: unknown[] }).tests.length, 3)
	const compact = cli(workspace, ['log', '--subject', 'target:checkout-local', '--limit', '1'])
	assert.equal(compact.lines.length, 2)
	assert.match(
		compact.lines[1],
		/^[0-9A-Z]{26}\t\S+\ttester\ttarget instance add\tcompleted\ttarget:checkout-local\t3$/
	)
	const after = json(workspace, ['log', '--after', '4', '--limit', '2']).body.operations as typeof log
	assert.deepEqual(
		after.map((row) => [row.rowid, row.command]),
		[
			[5, 'plan save'],
			[6, 'plan approve'],
		]
	)
	assert.deepEqual(json(workspace, ['log', '--after', '7']).body.operations, [])
	assert.deepEqual(cli(workspace, ['log', '--subject', 'checkout-local']).lines, [
		'invalid_request log refusal=malformed',
		'reason: Refused: malformed request.',
		'reason: Invalid --subject: checkout-local. Use target:<targetId>, plan:<planId>, run:<runId>, chat:<chatId>, or inbox.',
	])
	for (const [flag, text, reason] of [
		['--after', 'x', 'Invalid --after: x. Use a whole number from 0'],
		['--limit', 'ten', 'Invalid --limit: ten. Use a whole number from 1 to 1000.'],
		['--limit', '0', 'Invalid --limit: 0. Use a whole number from 1 to 1000.'],
		['--limit', '1001', 'Invalid --limit: 1001. Use a whole number from 1 to 1000.'],
	]) {
		const refused = cli(workspace, ['log', flag, text])
		assert.equal(refused.lines[0], 'invalid_request log refusal=malformed')
		assert(refused.lines[2].startsWith(`reason: ${reason}`), refused.output)
	}
	const before = json(workspace, ['log']).body.operations.length
	assert.deepEqual(cli(workspace, ['run', 'check', 'run-9', 'T1', 'A1', '--result', 'maybe']).lines, [
		'invalid_request run check refusal=malformed',
		'reason: Refused: malformed request.',
		'reason: Invalid --result: maybe. Use one of: passed, failed, inconclusive, not_checked.',
	])
	assert.equal(
		cli(workspace, ['run', 'begin', 'run-9', 'checkout@1', '--build', 'b', '--timeout', '0']).lines[0],
		'invalid_request run begin refusal=malformed'
	)
	assert.equal(json(workspace, ['log']).body.operations.length, before)
})

test('a finished run exits 1 when it was interrupted, and export writes each format', (t) => {
	const workspace = setup(t)
	revise(workspace)
	cli(workspace, ['plan', 'approve', 'checkout@2', '--rationale', 'Ok.'])
	const begun = cli(workspace, [
		'run',
		'begin',
		'run-1',
		'checkout@2',
		'--tests',
		'T1',
		'--build',
		'b1',
		'--timeout',
		'120',
	])
	assert.match(
		begun.lines[0],
		/^completed run-1 instance=local tests=T1 startedAt=\S+ browserSession=cm-\S+ deadlineSeconds=120 deadline=\S+ evidenceDirectory=\.checkmate\/tmp\/run-1\/$/
	)
	const interrupt = (cause: string) =>
		cli(workspace, [
			'run',
			'finish',
			'run-1',
			'--completion',
			'interrupted',
			'--cause',
			cause,
			'--reason',
			'The worker stopped.',
			'--cleanup',
			'completed',
			'--cleanup-reason',
			'Closed.',
		])
	const early = interrupt('deadline')
	assert.equal(early.lines[0], 'rejected run-1 refusal=prohibited')
	assert.match(early.lines[2], /^reason: Only 0% of the deadline is used: \d+ of 120 seconds/)
	const finished = interrupt('host_stopped')
	assert.equal(finished.code, 1)
	assert.match(finished.lines[0], /^interrupted run-1 coverage=partial sha256=[a-f0-9]{8}$/)
	for (const format of ['md', 'html', 'json']) {
		assert.equal(
			cli(workspace, ['export', 'run', 'run-1', '--format', format, '--out', `report.${format}`]).code,
			0
		)
		assert.equal(
			cli(workspace, ['export', 'plan', 'checkout@2', '--format', format, '--out', `plan.${format}`]).code,
			0
		)
	}
	assert.match(readFileSync(join(workspace, 'report.md'), 'utf8'), /^# Test report: run-1/)
	assert.match(readFileSync(join(workspace, 'plan.html'), 'utf8'), /<title>Test plan: checkout revision 2<\/title>/)
	assert.equal(JSON.parse(readFileSync(join(workspace, 'report.json'), 'utf8')).result.completion, 'interrupted')
	const printed = cli(workspace, ['export', 'run', 'run-1', '--format', 'md'])
	assert.equal(printed.code, 0)
	assert.equal(printed.output + '\n', readFileSync(join(workspace, 'report.md'), 'utf8'))
	assert.equal(
		cli(workspace, ['export', 'plan', 'checkout@2', '--format', 'html']).output + '\n',
		readFileSync(join(workspace, 'plan.html'), 'utf8')
	)
	assert.equal(json(workspace, ['export', 'run', 'run-1', '--format', 'json']).body.format, 'json')
	assert.match(
		cli(workspace, ['export', 'run', 'run-1', '--format', 'pdf', '--out', 'x.pdf']).output,
		/^invalid_request export run refusal=malformed\nreason: Refused: malformed request\.\nreason: Invalid --format: pdf\. Use one of: md, html, json, junit\.$/
	)
	assert.match(
		cli(workspace, ['export', 'plan', 'checkout@2', '--format', 'junit']).output,
		/^invalid_request export plan refusal=malformed\nreason: Refused: malformed request\.\nreason: Invalid --format: junit\. Use one of: md, html, json\.$/
	)
	const shown = cli(workspace, ['run', 'show', 'run-1'])
	assert.match(
		shown.lines[0],
		/^completed run-1 state=finalized plan=checkout@2 build=b1 instance=local completion=interrupted/
	)
	assert.match(shown.lines[1], /^time\tdeadline=\S+Z\telapsed=\d+s\tremaining=\d+s$/)
	assert.equal(
		shown.lines[2],
		'T1\terror\tStandard order total\tRun stopped before the test closed. Actions may have occurred.'
	)
	assert.equal(
		cli(workspace, ['run', 'list']).lines[1],
		'run-1\tcheckout@2\tb1\tlocal\tfinalized\tinterrupted\tpartial\tpending'
	)
})

test('--version and --help need no workspace', () => {
	const manifest = JSON.parse(readFileSync(join(root, 'plugin/.claude-plugin/plugin.json'), 'utf8'))
	assert.equal(cli('/nonexistent', ['--version']).output, manifest.version)
	const help = cli('/nonexistent', ['--help']).output
	assert.match(help, /^checkmate init$/m)
	assert.equal(json('/nonexistent', ['--help']).body.usage[0], 'checkmate init')

	const group = cli('/nonexistent', ['plan', '--help'])
	assert.equal(group.code, 0)
	assert.equal(group.lines[0], 'completed plan')
	assert(group.lines.includes('checkmate plan diff <planId> <from> <to>'), group.output)
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
	const answer = (gap: string) =>
		cli(
			workspace,
			['gap', 'answer', 'checkout', gap, '--kind', 'defer', '--value', 'x', '--rationale', 'y'],
			undefined,
			env
		)
	assert.equal(answer('G2').code, 0)
	execFileSync('git', ['init', '-q'], { cwd: workspace, env })
	execFileSync('git', ['config', 'user.name', 'Repo User'], { cwd: workspace, env })
	assert.equal(answer('G1').code, 0)
	const actors = json(workspace, ['plan', 'show', 'checkout']).body.pendingDecisions.map(
		(decision: { gapId: string; actor: string }) => [decision.gapId, decision.actor]
	)
	assert.deepEqual(actors, [
		['G2', userInfo().username],
		['G1', 'Repo User'],
	])
})

function child(workspace: string, args: string[], input: string) {
	return new Promise<{ status: string; reasons: string[] }>((resolve, reject) => {
		const process_ = spawn(process.execPath, [join(root, 'plugin/bin/checkmate.ts'), ...args, '--json'], {
			cwd: workspace,
			env: { ...process.env, CHECKMATE_ACTOR: 'tester' },
		})
		let output = ''
		process_.stdout.on('data', (bytes: Buffer) => (output += bytes))
		process_.on('error', reject)
		process_.on('close', () => resolve(JSON.parse(output)))
		process_.stdin.end(input)
	})
}

test('parallel writers under lock contention all commit, and none is rejected', async (t) => {
	const workspace = directory(t)
	const opened = store(t, workspace)
	ready(opened)
	const runs = Array.from({ length: 8 }, (_, i) => `run-${i + 1}`)
	runs.forEach((runId, i) => begin(opened, runId, ['T1'], `build-${i}`))
	closeStore(opened)
	const evidence = 'x'.repeat(4 * 1024 * 1024)
	const writes = runs.flatMap((runId) =>
		['A1', 'A2'].map((assertionId) => {
			const args = ['run', 'check', runId, 'T1', assertionId, '--result', 'passed', '--observed', 'ok']
			return child(workspace, [...args, '--evidence', '-'], `${runId} ${assertionId} ${evidence}`)
		})
	)
	const replies = await Promise.all(writes)
	for (const reply of replies) assert.equal(reply.status, 'completed', reply.reasons.join('; '))
	const committed = json(workspace, ['query', 'SELECT count(*) AS n FROM assertion_results']).body.rows[0].n
	assert.equal(committed, writes.length)
	const logged = json(workspace, ['query', "SELECT status FROM operations WHERE command = 'run check'"]).body.rows
	assert.equal(logged.length, committed)
	assert(logged.every((row: { status: string }) => row.status === 'completed'))
})

test('payload commands read a shell heredoc on standard input', (t) => {
	const workspace = directory(t)
	const value = profile()
	const checkmate = `node ${JSON.stringify(join(root, 'plugin/bin/checkmate.ts'))}`
	const script = [
		`${checkmate} target open checkout-local --entry-point "web:url:Checkout web application and HTTP API." --capabilities ${value.capabilities.join(',')} --operations ${value.allowedOperations.join(',')}`,
		`${checkmate} target save checkout-local <<'EOF'\n${JSON.stringify(value, null, 2)}\nEOF`,
	].join('\n')
	const output = execFileSync('sh', ['-c', script], {
		cwd: workspace,
		env: { ...process.env, CHECKMATE_ACTOR: 'tester' },
		encoding: 'utf8',
	})
	assert.match(output, /^completed checkout-local@1 sha256=[a-f0-9]{8} recorded=true$/m)
})

test('plan open takes the objective, sources, and instructions as flags', (t) => {
	const workspace = setup(t)
	const open = (planId: string, ...flags: string[]) =>
		cli(workspace, ['plan', 'open', planId, '--target', 'checkout-local@1', ...flags])
	const flags = ['--objective', 'Verify totals.', '--source', 'docs/a.md', '--source', 'jira:SHOP-12']
	const opened = open('flags', ...flags, '--instructions', 'Use section 2.')
	assert.equal(opened.lines[0], 'completed flags target=checkout-local@1 recorded=true')
	assert.deepEqual(json(workspace, ['plan', 'request', 'flags']).body.context, {
		sources: ['docs/a.md', 'jira:SHOP-12'],
		instructions: 'Use section 2.',
	})
	const piped = { objective: 'Verify totals.', context: { sources: ['docs/a.md', 'jira:SHOP-12'] } }
	assert.equal(cli(workspace, ['plan', 'open', 'same', '--target', 'checkout-local@1'], piped).code, 0)
	assert.equal(open('same', ...flags).lines[0], 'completed same target=checkout-local@1 recorded=false')
	assert.deepEqual(open('lonely', '--source', 'docs/a.md').lines, [
		'rejected lonely refusal=malformed',
		'reason: Refused: malformed request.',
		'reason: Give --objective with --source and --instructions, or send the request on standard input',
	])
	assert.equal(
		open('empty', '--objective', 'Verify totals.').lines.at(-1),
		'reason: A plan request needs requirements or context sources'
	)
})

test('run gate and run begin with ready_only and no --tests print the selection and the tests left out', (t) => {
	const workspace = setup(t)
	cli(workspace, ['plan', 'approve', 'checkout@1', '--rationale', 'Run early.'])
	const early = ['--build', 'b1', '--partial', 'ready_only']
	const checked = cli(workspace, ['run', 'gate', 'checkout@1', ...early])
	assert.match(checked.lines[0], /^completed checkout@1 sha256=[a-f0-9]{8} tests=T1$/)
	assert.deepEqual(checked.lines.slice(1), ['T2\tleft_out\tblocked by G1', 'T3\tleft_out\tblocked by G2'])
	const begun = cli(workspace, ['run', 'begin', 'run-1', 'checkout@1', ...early])
	assert.match(begun.lines[0], /^completed run-1 instance=local tests=T1 startedAt=/)
	assert.deepEqual(begun.lines.slice(1), checked.lines.slice(1))
	assert.deepEqual(cli(workspace, ['run', 'gate', 'checkout@1', '--build', 'b1']).lines, checked.lines)
	const missing = cli(workspace, ['run', 'gate', 'checkout@1', '--build', 'b1', '--partial', 'wait_for_resolution'])
	assert.equal(missing.lines[2], 'reason: Select one or more tests with --tests, or use --partial ready_only')
})

test('plan edit reads the edited content on standard input and prints the edit kind', (t) => {
	const workspace = setup(t)
	const shown = json(workspace, ['plan', 'show', 'checkout@1']).body
	const content = {
		requirements: shown.plan.requirements,
		tests: shown.plan.tests.map(({ readiness, gapIds, ...test }: Record<string, unknown>) => test),
		gaps: shown.plan.gaps,
	}
	content.tests[0].title = 'Edited title'
	const edited = cli(workspace, ['plan', 'edit', 'checkout@1', '--expect-sha', shown.sha256], content)
	assert.equal(edited.code, 0, edited.output)
	assert.match(edited.lines[0], /^needs_decision checkout@1 sha256=[a-f0-9]{8} edit=in_place$/)
	assert.equal(json(workspace, ['plan', 'show', 'checkout@1']).body.plan.tests[0].title, 'Edited title')
	const stale = cli(workspace, ['plan', 'edit', 'checkout@1', '--expect-sha', shown.sha256], content)
	assert.equal(stale.code, 1)
	assert.match(stale.lines[2], /^reason: checkout@1 has digest/)
	const patched = cli(workspace, ['plan', 'edit', 'checkout@1', '--patch'], { tests: { T1: { title: 'Patched' } } })
	assert.match(patched.lines[0], /^needs_decision checkout@1 sha256=[a-f0-9]{8} edit=in_place$/)
	assert.equal(json(workspace, ['plan', 'show', 'checkout@1']).body.plan.tests[0].title, 'Patched')
})

test('run commands print overlap warnings and resume exits with the current gate reason', (t) => {
	const workspace = directory(t)
	const opened = store(t, workspace)
	ready(opened)
	begin(opened, 'run-1', ['T1'])
	const duplicate = cli(workspace, ['run', 'begin', 'run-2', 'checkout@2', '--tests', 'T1', '--build', 'build-1'])
	assert.equal(duplicate.code, 0)
	assert(duplicate.lines.includes('warning\tRun run-1 also has open tests on checkout-local/local: T1.'))
	assert.deepEqual(json(workspace, ['run', 'show', 'run-1']).body.warnings, [
		'Run run-2 also has open tests on checkout-local/local: T1.',
	])
	const resumed = cli(workspace, ['run', 'resume', 'run-1'])
	assert.equal(resumed.code, 0)
	assert(resumed.lines.includes('warning\tRun run-2 also has open tests on checkout-local/local: T1.'))
	rejectPlan(opened, 'oracle', { reference: 'checkout@2', rationale: 'Check the requirements again.' })
	const refused = cli(workspace, ['run', 'resume', 'run-1'])
	assert.equal(refused.code, 1)
	assert.equal(refused.lines[0], 'rejected run-1 refusal=prohibited')
	assert(refused.lines.includes('reason: Plan checkout@2 is not approved'))
})

test('a refusal says if the request is malformed or prohibited, and its hint gives the next command', (t) => {
	const workspace = setup(t)
	for (const [gap, value] of [
		['G1', 'Promotion replaces loyalty.'],
		['G2', 'Paid orders qualify.'],
	]) {
		const answered = cli(workspace, [
			'gap',
			'answer',
			'checkout',
			gap,
			'--kind',
			'clarify',
			'--value',
			value,
			'--source',
			'decisions#1',
			'--rationale',
			'Product.',
		])
		assert.equal(answered.code, 0, answered.output)
	}
	const revised = cli(workspace, ['plan', 'revise', 'checkout'], promotionDelta)
	assert.deepEqual(revised.lines, [
		'rejected checkout refusal=malformed',
		'reason: Refused: malformed request.',
		'reason: Ready test T3 needs one or more assertions',
		'hint: Add an assertion to T3 in the delta: {"tests": {"T3": {"assertions": {"A1": {"check": "<expected result>", "checkKind": "deterministic"}}}}}. When no decision or source gives an expected value, use "checkKind": "agent_observation" with a check that records the behavior and checks only what the sources state.',
	])
	const refund = { A1: { check: 'A paid order shows a refund button.', checkKind: 'agent_observation' } }
	const delta = { tests: { ...promotionDelta.tests, T3: { assertions: refund } } }
	assert.equal(cli(workspace, ['plan', 'revise', 'checkout'], delta).code, 0)
	const early = json(workspace, ['run', 'begin', 'run-0', 'checkout@2', '--tests', 'T2', '--build', 'b1'])
	assert.equal(early.body.status, 'needs_decision')
	assert.equal(early.body.refusal, 'prohibited')
	assert.deepEqual(early.body.reasons, [
		'Refused: prohibited in the current state.',
		'Plan checkout@2 is not approved',
		'Missing prerequisite: T1',
	])
	assert.equal(
		early.body.hint,
		'The oracle must approve checkout@2. Run checkmate status checkout to see who acts next. Add T1 to --tests.'
	)
	cli(workspace, ['plan', 'approve', 'checkout@2', '--rationale', 'Ok.'])
	assert.equal(cli(workspace, ['run', 'begin', 'run-1', 'checkout@2', '--tests', 'T1,T2', '--build', 'b1']).code, 0)
	const checked = (assertion: string, result: string, observed: string) =>
		cli(
			workspace,
			[
				'run',
				'check',
				'run-1',
				...assertion.split('.'),
				'--result',
				result,
				'--observed',
				observed,
				'--evidence',
				'-',
			],
			observed
		)
	assert.equal(checked('T1.A1', 'passed', 'The confirmation shows 400 PLN.').code, 0)
	assert.equal(checked('T1.A2', 'failed', 'The order has two items.').code, 0)
	assert.equal(cli(workspace, ['run', 'close', 'run-1', 'T1']).code, 0)
	const prerequisite = json(workspace, ['run', 'check', 'run-1', 'T2', 'A1', '--result', 'passed'])
	assert.equal(prerequisite.body.refusal, 'prohibited')
	assert.equal(prerequisite.body.reasons[1], 'Prerequisite T1 is failed, not passed. Do not check T2.')
	const close = 'checkmate run close run-1 T2 --outcome blocked --reason "Prerequisite T1 is failed"'
	assert.equal(prerequisite.body.hint, `Close T2 as blocked: ${close}`)
	assert.equal(
		cli(workspace, ['run', 'close', 'run-1', 'T2', '--outcome', 'blocked', '--reason', 'Prerequisite T1 is failed'])
			.code,
		0
	)
	const retest = json(workspace, [
		'run',
		'begin',
		'run-2',
		'checkout@2',
		'--tests',
		'T1',
		'--build',
		'b2',
		'--retest-of',
		'run-1',
	])
	assert.equal(retest.body.status, 'rejected')
	assert.equal(retest.body.refusal, 'prohibited')
	assert.deepEqual(retest.body.reasons, [
		'Refused: prohibited in the current state.',
		'Run run-1 is not finished. Retest a finished run.',
	])
	assert.match(
		retest.body.hint,
		/^Finish run-1 first: checkmate run finish run-1 --completion <completed\|interrupted/
	)
	const finish = [
		'run',
		'finish',
		'run-1',
		'--completion',
		'completed',
		'--cleanup',
		'completed',
		'--cleanup-reason',
		'Closed.',
	]
	const refused = json(workspace, finish)
	assert.equal(refused.body.refusal, 'prohibited')
	assert.equal(refused.body.reasons[1], 'Failed assertion T1.A2 needs a defect finding. Record it with run finding.')
	const example = /with your values: (\{.*\})\. Then run run finish again\./.exec(refused.body.hint)
	assert(example, refused.body.hint)
	assert(refused.body.hint.startsWith('Record the defect with checkmate run finding run-1. Send this JSON'))
	const finding = JSON.parse(example[1])
	assert.deepEqual(
		[
			finding.id,
			finding.type,
			finding.assertionIds,
			finding.requirementIds,
			finding.observed,
			finding.evidenceIds.length,
		],
		['F1', 'defect', ['T1.A2'], ['R1'], 'The order has two items.', 1]
	)
	const schema = json(workspace, ['run', 'finding', 'run-1'], { ...finding, severity: undefined, priority: 'p1' })
	assert.equal(schema.body.refusal, 'malformed')
	assert.equal(
		schema.body.reasons[1],
		'Invalid finding: finding needs field "severity", finding has unknown field "priority"'
	)
	assert.equal(
		schema.body.hint,
		'Fix each named field and send the finding again. The schema is contracts/finding.schema.json in the plugin.'
	)
	const recorded = {
		...finding,
		severity: 'high',
		title: 'Two items',
		expected: 'One item',
		reproduction: ['Check out.'],
	}
	assert.equal(cli(workspace, ['run', 'finding', 'run-1'], recorded).code, 0)
	assert.equal(json(workspace, finish).body.status, 'completed')
})

test('ui takes --new-hook-token as a flag without a value, and by default it does not renew the token', () => {
	assert.equal(uiOptions(['--new-hook-token', '--port', '4000'], '/w').newHookToken, true)
	assert.equal(uiOptions(['--port', '4000'], '/w').newHookToken, false)
})
