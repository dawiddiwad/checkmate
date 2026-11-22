import test from 'node:test'
import assert from 'node:assert/strict'
import { execFileSync, spawn, spawnSync } from 'node:child_process'
import { once } from 'node:events'
import { join } from 'node:path'
import { writeFileSync } from 'node:fs'
import { closeStore } from '../plugin/src/store.ts'
import { openTarget, saveTarget } from '../plugin/src/targets.ts'
import { actor, directory, profile, root, store } from './support.ts'
import { fakeClaude } from './claude.ts'

test('specification handoff requires reviewed and resolved ticket rules before builds', async (t) => {
	const workspace = directory(t)
	writeFileSync(join(workspace, 'ticket.md'), 'A promotion quote is 240. Does it replace loyalty?\n')
	const opened = store(t, workspace)
	const target = profile({ capabilities: ['http'], tools: [] })
	openTarget(opened, actor, {
		targetId: target.targetId,
		entryPoints: target.entryPoints,
		capabilities: target.capabilities,
		allowedOperations: target.allowedOperations,
	})
	saveTarget(opened, actor, { targetId: target.targetId, profile: target })
	closeStore(opened)
	const fake = fakeClaude(t, { recorder: [{ kind: 'note', text: 'Explored the build.' }] }, 'pi')
	const command = (args: string[], input = '') => {
		const result = spawnSync(process.execPath, [join(root, 'plugin/dist/checkmate.js'), ...args, '--json'], {
			cwd: workspace,
			input,
			encoding: 'utf8',
			timeout: 70000,
			env: { ...process.env, ...fake.env, CHECKMATE_ACTOR: 'oracle', CHECKMATE_HARNESS: 'pi' },
		})
		assert.ok(result.stdout, result.stderr)
		return { code: result.status, body: JSON.parse(result.stdout), output: result.stdout + result.stderr }
	}
	const ok = (args: string[], input = '') => {
		const result = command(args, input)
		assert.equal(result.code, 0, result.output)
		return result.body
	}
	const refused = (args: string[], reason: RegExp) => {
		const result = command(args)
		assert.equal(result.code, 1, result.output)
		assert.match(result.output, reason)
	}
	ok([
		'plan',
		'open',
		'ticket',
		'--target',
		'checkout-local@1',
		'--objective',
		'Review the ticket.',
		'--source',
		'ticket.md',
	])
	const saved = ok(
		['plan', 'save', 'ticket'],
		JSON.stringify({
			requirements: [{ id: 'R1', text: 'The quote is 240.', source: 'ticket.md' }],
			tests: [
				{
					id: 'T1',
					title: 'Quote',
					requirementIds: ['R1'],
					capability: 'http',
					operations: ['read_catalog'],
					dependsOn: [],
					preconditions: [],
					action: 'Read the quote.',
					assertions: [{ id: 'A1', check: 'The quote is 240.', checkKind: 'deterministic' }],
				},
			],
			gaps: [
				{
					id: 'G1',
					severity: 'blocking',
					status: 'open',
					requirementIds: ['R1'],
					testIds: ['T1'],
					question: 'Does it replace loyalty?',
					consequence: 'The expected combination is unclear.',
					decisionId: null,
				},
			],
		})
	)
	const sha1 = saved.sha256
	const quote = ['--source', 'ticket.md', '--evidence', 'Does it replace loyalty?', '--expect-sha', sha1]
	refused(
		['spec', 'handoff', 'ticket@1', '--expect-sha', sha1, '--rationale', 'Ready.'],
		/Review the current specification/
	)
	refused(
		[
			'spec',
			'finding',
			'ticket@1',
			'G1',
			'--kind',
			'question',
			'--source',
			'ticket.md',
			'--evidence',
			'invented',
			'--expect-sha',
			sha1,
		],
		/not present/
	)
	ok(['spec', 'finding', 'ticket@1', 'G1', '--kind', 'question', ...quote])
	ok(['spec', 'review', 'ticket@1', ...quote, '--rationale', 'Reviewed the ticket and its open question.'])
	assert.equal(ok(['spec', 'status', 'ticket@1']).ready, false)
	refused(['spec', 'handoff', 'ticket@1', '--expect-sha', sha1, '--rationale', 'Ready.'], /Gap G1 is open/)
	ok([
		'gap',
		'answer',
		'ticket',
		'G1',
		'--kind',
		'clarify',
		'--value',
		'The promotion replaces loyalty.',
		'--source',
		'oracle',
		'--rationale',
		'Owner decision.',
	])
	refused(['spec', 'handoff', 'ticket@1', '--expect-sha', sha1, '--rationale', 'Ready.'], /pending oracle decision/)
	const revised = ok(['plan', 'revise', 'ticket'], JSON.stringify({ tests: {} }))
	const sha2 = revised.sha256
	refused(['spec', 'handoff', 'ticket@1', '--expect-sha', sha1, '--rationale', 'Ready.'], /stale/)
	refused(
		['spec', 'handoff', 'ticket@2', '--expect-sha', sha2, '--rationale', 'Ready.'],
		/Review the current specification/
	)
	ok([
		'spec',
		'review',
		'ticket@2',
		'--source',
		'ticket.md',
		'--evidence',
		'A promotion quote is 240.',
		'--expect-sha',
		sha2,
		'--rationale',
		'Reviewed the ticket and oracle answer.',
	])
	refused(['spec', 'handoff', 'ticket@2', '--expect-sha', sha2, '--rationale', 'Ready.'], /needs oracle approval/)
	ok(['plan', 'approve', 'ticket@2', '--rationale', 'Approved the resolved rules.'])
	const status = ok(['spec', 'status', 'ticket@2'])
	assert.equal(status.ready, true)
	assert.equal(status.findings[0].evidence, 'Does it replace loyalty?')
	writeFileSync(join(workspace, 'ticket.md'), 'Changed ticket.\n')
	refused(['spec', 'handoff', 'ticket@2', '--expect-sha', sha2, '--rationale', 'Ready.'], /sources changed/)
	writeFileSync(join(workspace, 'ticket.md'), 'A promotion quote is 240. Does it replace loyalty?\n')
	ok(['spec', 'handoff', 'ticket@2', '--expect-sha', sha2, '--rationale', 'The factory can build these rules.'])
	for (const table of ['instances', 'runs', 'explorations', 'plan_builds'])
		assert.equal(ok(['query', `SELECT count(*) AS n FROM ${table}`]).rows[0].n, 0)
	const app = spawn(
		process.execPath,
		[
			'-e',
			`const http = require('node:http'); const server = http.createServer((req, res) => res.end(req.url === '/broken' ? '220' : '240')); server.listen(0, '127.0.0.1', () => console.log(server.address().port))`,
		],
		{ stdio: ['ignore', 'pipe', 'inherit'] }
	)
	t.after(async () => {
		if (app.exitCode === null && app.signalCode === null) {
			const exited = once(app, 'exit')
			app.kill()
			await exited
		}
	})
	const [chunk] = await once(app.stdout!, 'data')
	const url = `http://127.0.0.1:${String(chunk).trim()}`
	const observe = (path: string) =>
		execFileSync(
			process.execPath,
			['-e', `fetch(process.argv[1]).then(r => r.text()).then(console.log)`, url + path],
			{ encoding: 'utf8' }
		).trim()
	ok(['target', 'instance', 'add', 'checkout-local', 'local', '--entry', `web=${url}`])
	const explored = ok([
		'explore',
		'start',
		'ticket',
		'--build',
		'broken',
		'--instance',
		'local',
		'--level',
		'smoke',
		'--allow',
		'Read',
	])
	assert.equal(ok(['explore', 'wait', explored.explorationId, '--timeout', '60']).state, 'completed')
	ok(['run', 'begin', 'broken-run', 'ticket@2', '--build', 'broken', '--instance', 'local', '--tests', 'T1'])
	const broken = observe('/broken')
	assert.equal(broken, '220')
	const failed = ok(
		['run', 'check', 'broken-run', 'T1', 'A1', '--result', 'failed', '--observed', broken, '--evidence', '-'],
		`HTTP 200: ${broken}`
	)
	ok(
		['run', 'finding', 'broken-run'],
		JSON.stringify({
			id: 'F1',
			type: 'defect',
			severity: 'high',
			assertionIds: ['T1.A1'],
			requirementIds: ['R1'],
			title: 'Wrong quote',
			expected: '240',
			observed: '220',
			reproduction: ['Read the quote.'],
			evidenceIds: failed.evidenceIds,
		})
	)
	ok(['run', 'close', 'broken-run', 'T1'])
	ok([
		'run',
		'finish',
		'broken-run',
		'--completion',
		'completed',
		'--cleanup',
		'completed',
		'--cleanup-reason',
		'No state.',
	])
	const exploredFixed = ok([
		'explore',
		'start',
		'ticket',
		'--build',
		'fixed',
		'--instance',
		'local',
		'--level',
		'smoke',
		'--allow',
		'Read',
	])
	assert.equal(ok(['explore', 'wait', exploredFixed.explorationId, '--timeout', '60']).state, 'completed')
	ok([
		'run',
		'begin',
		'fixed-run',
		'ticket@2',
		'--build',
		'fixed',
		'--instance',
		'local',
		'--tests',
		'T1',
		'--retest-of',
		'broken-run',
	])
	const fixed = observe('/fixed')
	assert.equal(fixed, '240')
	ok(
		['run', 'check', 'fixed-run', 'T1', 'A1', '--result', 'passed', '--observed', fixed, '--evidence', '-'],
		`HTTP 200: ${fixed}`
	)
	ok(['run', 'close', 'fixed-run', 'T1'])
	ok([
		'run',
		'finish',
		'fixed-run',
		'--completion',
		'completed',
		'--cleanup',
		'completed',
		'--cleanup-reason',
		'No state.',
	])
	ok(['result', 'accept', 'fixed-run', '--rationale', 'Fixed build passes.'])
	const promoted = ok([
		'plan',
		'promote',
		'ticket@2',
		'--run',
		'fixed-run',
		'--build',
		'fixed',
		'--rationale',
		'Save the ticket tests.',
	])
	assert.deepEqual([promoted.subject, promoted.tests], ['ticket@3', ['T1']])
})
