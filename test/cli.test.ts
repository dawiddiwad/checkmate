import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { execFileSync, spawn } from 'node:child_process'
import { userInfo } from 'node:os'
import { join } from 'node:path'
import { closeStore } from '../plugin/src/store.ts'
import {
	begin,
	candidate,
	cli,
	directory,
	json,
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
	assert.deepEqual(shown.lines.slice(1), [
		'R1\tplanned\tA standard order for a 400 PLN item has a total of 400 PLN.',
		'R2\tblocked\tA 40 percent promotion applies; stacking is unspecified.',
		'R3\tblocked\tRefund eligibility is unspecified.',
		'T1\tready\tbrowser\tStandard order total',
		'T2\tblocked\thttp\tPromotion quote',
		'T3\tblocked\thttp\tRefund eligibility',
		'G1\tblocking\topen\tDoes the promotion stack with loyalty?',
		'G2\tblocking\topen\tWhich orders qualify for refunds?',
	])
	const { code, body } = json(workspace, ['plan', 'show', 'checkout@1'])
	assert.equal(code, 0)
	assert.deepEqual([body.status, body.subject, body.reasons, body.revision], ['completed', 'checkout@1', [], 1])
	assert.equal(body.plan.tests.length, 3)
	assert.equal(shown.lines[0].split('sha256=')[1].split(' ')[0], body.sha256.slice(0, 8))
	const saved = cli(workspace, ['plan', 'save', 'checkout'], candidate())
	assert.equal(saved.code, 1)
	assert.deepEqual(saved.lines, [
		'rejected checkout',
		'reason: Plan checkout has revision 1. Use plan edit, or gap answer and plan revise, to change it.',
	])
	const needs = json(workspace, ['run', 'gate', 'checkout@1', '--tests', 'T1', '--build', 'b'])
	assert.equal(needs.code, 0)
	assert.deepEqual(needs.body.reasons, [
		'Plan checkout@1 is not approved',
		'Open blocking gap: G1',
		'Open blocking gap: G2',
	])
	assert.equal(
		cli(workspace, ['plan', 'show', 'checkout', '--gaps', 'open']).lines.filter((line) => line.startsWith('G'))
			.length,
		2
	)
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
	assert.match(unknown.lines[1], /^reason: Unknown field: expected\. Use: title, readiness/)
	assert.match(
		cli(workspace, ['plan', 'show', 'checkout@2', '--tests', 'T9']).lines[1],
		/Unknown test in checkout@2: T9/
	)
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
	assert.equal(stale.lines[0], 'rejected checkout@2')
	assert.match(
		stale.lines[1],
		/^reason: checkout@2 has digest [a-f0-9]{64}, not ffffffff\. Read it again before you decide\.$/
	)
	const bad = cli(workspace, ['plan', 'approve', 'checkout@2', '--rationale', 'Ok.', '--expect-sha', 'xyz'])
	assert.match(bad.lines[1], /Invalid --expect-sha: xyz/)
	const approved = cli(workspace, ['plan', 'approve', 'checkout@2', '--rationale', 'Ok.', '--expect-sha', sha256])
	assert.equal(approved.code, 0)
	assert.equal(approved.lines[0], `completed checkout@2 verdict=approved sha256=${sha256.slice(0, 8)}`)
})

test('query is read-only and prints TSV with a header or JSON rows', (t) => {
	const workspace = setup(t)
	const rows = cli(workspace, ['query', 'SELECT plan_id, revision FROM plan_revisions'])
	assert.deepEqual(rows.lines, ['completed query rows=1', 'plan_id\trevision', 'checkout\t1'])
	assert.deepEqual(json(workspace, ['query', 'SELECT plan_id FROM plan_revisions WHERE 0']).body.columns, ['plan_id'])
	for (const sql of ['DELETE FROM operations', "INSERT INTO meta VALUES ('a', 'b')", 'DROP TABLE meta']) {
		const refused = cli(workspace, ['query', sql])
		assert.equal(refused.code, 1, sql)
		assert.deepEqual(refused.lines, ['rejected query', 'reason: attempt to write a readonly database'])
	}
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
	const cases: Array<[string[], string]> = [
		[['deploy'], 'Unknown command: deploy. Run checkmate --help.'],
		[
			['plan', 'show', 'checkout', '--verbose'],
			'Unknown option --verbose for plan show. Usage: checkmate plan show <reference> [--tests <a,b>] [--fields <a,b>] [--gaps <value>]',
		],
		[
			['plan', 'show', 'checkout', '--actor', 'x'],
			'Unknown option --actor for plan show. Usage: checkmate plan show <reference> [--tests <a,b>] [--fields <a,b>] [--gaps <value>]',
		],
		[['plan', 'show'], 'Usage: checkmate plan show <reference> [--tests <a,b>] [--fields <a,b>] [--gaps <value>]'],
		[['plan', 'show', 'checkout', '--tests'], 'Missing value for --tests'],
		[['run', 'gate', 'checkout@1', '--build', 'a', '--build', 'b'], 'Option --build is given twice'],
	]
	for (const [args, reason] of cases) {
		const outcome = json(workspace, args)
		assert.equal(outcome.code, 1, args.join(' '))
		assert.deepEqual(outcome.body.reasons, [reason], args.join(' '))
		assert.equal(outcome.body.status, 'invalid_request')
	}
	const badJson = cli(workspace, ['run', 'finding', 'run-1'], '{not json')
	assert.equal(badJson.lines[0], 'rejected run-1')
	assert.match(badJson.lines[1], /^reason: Standard input is not valid JSON/)
	const missing = cli(workspace, ['run', 'gate', 'checkout@1', '--tests', 'T1'])
	assert.equal(missing.code, 1)
	assert.equal(missing.lines[0], 'invalid_request run gate')
	assert.match(
		missing.lines[1],
		/^reason: Missing --build\. Usage: checkmate run gate <reference> \[--tests <a,b>\] --build <value>/
	)
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
	assert.match(cli(workspace, ['log', '--after', 'x']).lines[1], /Invalid --after: x/)
	assert.match(cli(workspace, ['log', '--limit', 'ten']).lines[1], /Invalid --limit: ten/)
	assert.deepEqual(cli(workspace, ['log', '--subject', 'checkout-local']).lines, [
		'rejected log',
		'reason: Invalid --subject: checkout-local. Use target:<targetId>, plan:<planId>, run:<runId>, or inbox.',
	])
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
		/^completed run-1 instance=local tests=T1 startedAt=\S+ browserSession=cm-\S+ deadlineSeconds=120 evidenceDirectory=\.checkmate\/tmp\/run-1\/$/
	)
	const finished = cli(workspace, [
		'run',
		'finish',
		'run-1',
		'--completion',
		'interrupted',
		'--cleanup',
		'completed',
		'--cleanup-reason',
		'Closed.',
	])
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
		cli(workspace, ['export', 'run', 'run-1', '--format', 'pdf', '--out', 'x.pdf']).lines[1],
		/Invalid format/
	)
	const shown = cli(workspace, ['run', 'show', 'run-1'])
	assert.match(
		shown.lines[0],
		/^completed run-1 state=finalized plan=checkout@2 build=b1 instance=local completion=interrupted/
	)
	assert.equal(
		shown.lines[1],
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
	assert.match(help, /checkmate run check <runId> <testId> <assertionId> --result <value> \[--observed <value>\]/)
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

test('inbox lists gaps to answer, plans to approve, and results to accept', (t) => {
	const workspace = setup(t)
	const first = cli(workspace, ['inbox'])
	assert.equal(first.code, 0)
	assert.equal(first.lines[0], 'completed inbox gaps=2 plans=1 results=0 requests=0')
	assert.deepEqual(first.lines.slice(1, 3), [
		'checkout@1/G1\tgap\tblocking\tDoes the promotion stack with loyalty?',
		'checkout@1/G2\tgap\tblocking\tWhich orders qualify for refunds?',
	])
	assert.match(
		first.lines[3],
		/^checkout@1\tplan\t[a-f0-9]{8}\t3 tests: 1 ready, 2 blocked, 0 deferred; 2 open gaps$/
	)
	revise(workspace)
	cli(workspace, ['plan', 'approve', 'checkout@2', '--rationale', 'Ok.'])
	cli(workspace, ['run', 'begin', 'run-1', 'checkout@2', '--tests', 'T1', '--build', 'b1'])
	cli(workspace, [
		'run',
		'finish',
		'run-1',
		'--completion',
		'interrupted',
		'--cleanup',
		'completed',
		'--cleanup-reason',
		'Closed.',
	])
	const later = cli(workspace, ['inbox'])
	assert.deepEqual(later.lines, [
		'completed inbox gaps=0 plans=0 results=1 requests=0',
		'run-1\tresult\tcheckout@2\tb1\tpartial\terror=1',
	])
	const body = json(workspace, ['inbox']).body
	assert.deepEqual(
		[body.gaps, body.plans, body.results.map((row: { runId: string }) => row.runId)],
		[[], [], ['run-1']]
	)
})

test('inbox and plan list show a plan request without a revision', (t) => {
	const workspace = setup(t)
	const request = { objective: 'Draft later.', requirements: [{ id: 'R1', text: 'Later.', source: 'brief#1' }] }
	cli(workspace, ['plan', 'open', 'later', '--target', 'checkout-local@1'], request)
	const waiting = cli(workspace, ['inbox'])
	assert.equal(waiting.lines[0], 'completed inbox gaps=2 plans=1 results=0 requests=1')
	assert.equal(waiting.lines.at(-1), 'later\trequested\tcheckout-local@1\tDraft later.')
	const plans = cli(workspace, ['plan', 'list'])
	assert.equal(plans.lines[0], 'completed plans count=2')
	assert.match(plans.lines[1], /^checkout@1\tgaps=G1,G2\tapproval=pending/)
	assert.equal(plans.lines[2], 'later\tstatus=requested\tstate=needs_plan\twaitsOn=planner')
	assert.deepEqual(cli(workspace, ['plan', 'list', '--awaiting-approval']).lines.slice(1).length, 1)
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
		'rejected lonely',
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
	const missing = cli(workspace, ['run', 'gate', 'checkout@1', '--build', 'b1'])
	assert.equal(missing.lines[1], 'reason: Select one or more tests with --tests, or add --partial ready_only')
})

test('a run gap shows in the inbox, and plan adopt-gaps or gap answer brings it into the plan', (t) => {
	const workspace = setup(t)
	revise(workspace)
	cli(workspace, ['plan', 'approve', 'checkout@2', '--rationale', 'Ok.'])
	cli(workspace, ['run', 'begin', 'run-1', 'checkout@2', '--tests', 'T1', '--build', 'b1'])
	const gap = (id: string) => ({
		id,
		severity: 'non_blocking',
		status: 'open',
		requirementIds: [],
		testIds: ['T1'],
		question: `Is ${id} a question?`,
		consequence: 'Unknown.',
		decisionId: null,
	})
	cli(workspace, ['run', 'gap', 'run-1'], gap('G3'))
	cli(workspace, ['run', 'gap', 'run-1'], gap('G4'))
	const waiting = cli(workspace, ['inbox'])
	assert.equal(waiting.lines[0], 'completed inbox gaps=2 plans=0 results=0 requests=0')
	assert.deepEqual(waiting.lines.slice(1), [
		'checkout@2/G3\trun_gap\tnon_blocking\trun-1\tIs G3 a question?',
		'checkout@2/G4\trun_gap\tnon_blocking\trun-1\tIs G4 a question?',
	])
	assert.deepEqual(json(workspace, ['plan', 'list']).body.plans[0].openGaps, ['G3', 'G4'])
	const adopted = cli(workspace, ['plan', 'adopt-gaps', 'checkout@2', '--run', 'run-1', '--gaps', 'G3'])
	assert.match(adopted.lines[0], /^completed checkout@3 sha256=[a-f0-9]{8} edit=new_revision adopted=G3$/)
	const answered = cli(workspace, [
		'gap',
		'answer',
		'checkout',
		'G4',
		'--kind',
		'defer',
		'--value',
		'Later.',
		'--rationale',
		'Scope.',
	])
	assert.match(
		answered.lines[0],
		/^completed checkout decision=[0-9A-Z]{26} gap=G4 from=run-1 revision=3 edit=in_place$/
	)
	assert.deepEqual(cli(workspace, ['inbox']).lines.slice(1, 2), [
		'checkout@3/G3\tgap\tnon_blocking\tIs G3 a question?',
	])
})

test('status prints the loop state, who it waits on, and the open items', (t) => {
	const workspace = setup(t)
	const status = cli(workspace, ['status', 'checkout'])
	assert.equal(status.code, 0)
	assert.deepEqual(status.lines, [
		'completed checkout state=needs_answers waitsOn=oracle revision=1 approval=pending',
		'why\t2 open gaps',
		'why\tcheckout@1 waits for approval',
		'next\tcheckmate gap answer checkout <gapId> --kind <kind> --value "<answer>" --rationale "<why>"',
		'G1\tgap\tblocking\tDoes the promotion stack with loyalty?',
		'G2\tgap\tblocking\tWhich orders qualify for refunds?',
	])
	const body = json(workspace, ['status', 'checkout']).body
	assert.deepEqual([body.waitsOn, body.stage], ['oracle', 'none'])
	assert.deepEqual(cli(workspace, ['status', 'nothing']).lines, [
		'rejected nothing',
		'reason: Unknown plan: nothing. Run plan open first.',
	])
	assert.equal(cli(workspace, ['plan', 'list', '--waits-on', 'oracle']).lines[0], 'completed plans count=1')
	assert.equal(cli(workspace, ['plan', 'list', '--waits-on', 'qa']).lines[0], 'completed plans count=0')
	assert.match(
		cli(workspace, ['plan', 'list', '--waits-on', 'boss']).lines[1],
		/^reason: Invalid role \(--waits-on\): boss/
	)
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
	assert.match(stale.lines[1], /^reason: checkout@1 has digest/)
	const patched = cli(workspace, ['plan', 'edit', 'checkout@1', '--patch'], { tests: { T1: { title: 'Patched' } } })
	assert.match(patched.lines[0], /^needs_decision checkout@1 sha256=[a-f0-9]{8} edit=in_place$/)
	assert.equal(json(workspace, ['plan', 'show', 'checkout@1']).body.plan.tests[0].title, 'Patched')
})
