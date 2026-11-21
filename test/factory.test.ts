import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { chmodSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { delimiter, join } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import test from 'node:test'
import { pathToFileURL } from 'node:url'
import { startUi } from '../plugin/src/ui/server.ts'
import { directory, json, root } from './support.ts'

const preview = `import { createServer } from 'node:http'
import { readFileSync } from 'node:fs'
const text = readFileSync(new URL('../../message.txt', import.meta.url), 'utf8')
if (process.argv[2] !== 'ui') process.exit(1)
const server = createServer((request, response) => response.end(text))
server.listen(0, '127.0.0.1', () => {
	console.log(JSON.stringify({ status: 'completed', subject: 'ui', reasons: [], url: 'http://127.0.0.1:' + server.address().port }))
})
process.on('SIGTERM', () => server.close())
`

const fakePi = (journal: string, oracleCorrections: boolean) => `#!/usr/bin/env node
const { randomUUID } = require('node:crypto')
const { appendFileSync, readFileSync, writeFileSync } = require('node:fs')
const { createInterface } = require('node:readline')
const { join } = require('node:path')
const args = process.argv.slice(2)
const after = flag => args.includes(flag) ? args[args.indexOf(flag) + 1] : undefined
const model = { provider: 'fixture', id: 'model', reasoning: true }
const emit = data => console.log(JSON.stringify(data))
const journal = ${JSON.stringify(journal)}
const oracleCorrections = ${oracleCorrections}
const record = data => appendFileSync(journal, JSON.stringify(data) + '\\n')
const calls = () => readFileSync(journal, 'utf8').trim().split('\\n').filter(Boolean).map(JSON.parse)
if (after('--mode') === 'rpc') {
	createInterface({ input: process.stdin }).on('line', line => {
		const { id, type } = JSON.parse(line)
		emit({ type: 'response', command: type, id, success: true, data: type === 'get_state' ? { model } : { models: [model] } })
	})
} else {
	main().catch(error => { console.error(error); process.exitCode = 1 })
}
async function main() {
	const prompt = readFileSync(0, 'utf8') || args.at(-1)
	const session = after('--session-id') || after('--session') || after('--fork') || randomUUID()
	const work = process.env.PLAYWRIGHT_MCP_OUTPUT_DIR
	const rule = 'The deployed preview displays READY.'
	const readiness = {
		id: 'D1', question: 'How should the preview communicate readiness?',
		options: [
			{ id: 'text', label: 'Use status text', tradeoff: 'Simple to read.' },
			{ id: 'badge', label: 'Use a badge', tradeoff: 'Easy to scan.' },
		], recommended: 'text', reason: 'The labels are both suitable for the fixture.',
	}
	let result
	if (prompt.startsWith('# Factory oracle scope')) {
		const firstScope = !calls().some(call => call.stage === 'scope')
		record({ stage: 'scope', prompt })
		const awaitingChoice = !prompt.includes('Selected text: Use status text')
		result = {
			objective: 'Display READY in the candidate preview.',
			requirements: [rule],
			decisions: awaitingChoice ? [readiness] : [],
		}
		if (firstScope) result = '{'
	} else if (prompt.startsWith('# Factory worker')) {
		const prior = readFileSync('message.txt', 'utf8')
		record({ stage: 'worker', prior, cwd: process.cwd(), prompt })
		writeFileSync('message.txt', prior === 'BASE' && !prompt.includes('Questions and answers from baseline') ? 'FIRST' : 'READY')
		result = 'Updated the preview.'
	} else if (prompt.startsWith('# Factory oracle review')) {
		const firstReview = !calls().some(call => call.stage === 'review')
		record({ stage: 'review', prompt })
		result = {
			answers: [{ id: 'a1/Q1', value: 'Display READY after the preview loads.', source: 'The fixture request.', rationale: 'The request names the preview output.' }],
			claims: [{ id: 'a1/D1', decision: 'accept', rationale: 'QA observed a preview without READY.' }],
			decisions: [],
		}
		if (oracleCorrections) {
			const id = prompt.includes('Oracle decision ID already answered: D1') ? 'D2'
				: prompt.includes('Invalid Oracle decision ID "merge/T1"') ? 'D1' : 'merge/T1'
			result.answers = []
			result.decisions = [{
				...readiness, id, questionIds: ['a1/Q1'], question: 'When should READY be displayed?',
				options: [
					{ id: 'text', label: 'Display READY after the preview loads.', tradeoff: 'Reflects readiness.' },
					{ id: 'badge', label: 'Display READY before the preview loads.', tradeoff: 'Shows the label sooner.' },
				],
			}]
		}
		else if (firstReview) result = { answers: [], claims: [], decisions: [] }
	} else if (prompt.startsWith('A change of the application')) {
		const url = prompt.match(/http:\\/\\/127\\.0\\.0\\.1:\\d+/)?.[0]
		if (!url) throw new Error('The QA study lacks a preview URL')
		record({ stage: 'study', session, url, prompt })
		writeFileSync(join(work, 'plan.md'), 'Read the deployed preview output.')
		writeFileSync(join(work, 'questions.md'), 'None')
		result = 'The test approach is ready.'
	} else if (prompt.startsWith('Now test')) {
		const { url } = calls().find(call => call.stage === 'study' && call.session === session)
		const body = await (await fetch(url)).text()
		record({ stage: 'test', session, url, body })
		writeFileSync(join(work, 'observed.txt'), body)
		writeFileSync(join(work, 'report.md'), 'The deployed preview displayed ' + body + '.')
		result = 'Tested the preview.'
	} else if (prompt.startsWith('Now write the record')) {
		const observation = calls().find(call => call.stage === 'test' && call.session === after('--fork'))
		const ready = observation.body === 'READY'
		result = [{ kind: 'criterion', rule: 'R1', text: rule, verdict: ready ? 'ok' : 'wrong', saw: observation.body }]
		if (ready) result.push({ kind: 'verdict', defect: 'a1/D1', result: 'fixed', saw: 'The preview displayed READY.' })
		else result.push(
			{ kind: 'defect', id: 'D1', rule: 'R1', title: 'Wrong preview text', severity: 'medium', steps: 'Open the deployed preview.', expected: 'READY', actual: observation.body, evidence: ['observed.txt'] },
			{ kind: 'question', id: 'Q1', rule: 'R1', question: 'When should READY be displayed?', blocking: true },
		)
	} else throw new Error('Unexpected fake Pi prompt: ' + prompt.slice(0, 200))
	const text = typeof result === 'string' ? result : JSON.stringify(result)
	const message = { role: 'assistant', provider: model.provider, model: model.id, stopReason: 'stop', content: [{ type: 'text', text }], usage: { cost: { total: 0 } } }
	emit({ type: 'session', id: session })
	emit({ type: 'message_end', message })
	emit({ type: 'agent_end', messages: [message] })
	emit({ type: 'agent_settled', aborted: false })
}
`

test('the factory reads local files and GitHub requests and rejects invalid input', (t) => {
	const workspace = directory(t)
	const file = join(workspace, 'Factory ticket.md')
	const calls = join(workspace, 'gh-calls.jsonl')
	const gh = join(workspace, 'gh')
	writeFileSync(file, 'The local request.')
	writeFileSync(
		gh,
		String.raw`#!/usr/bin/env node
const { appendFileSync } = require('node:fs')
const args = process.argv.slice(2)
appendFileSync(${JSON.stringify(calls)}, JSON.stringify(args) + '\n')
const [command, action] = args
const resource = args.at(-1)
if (command === 'issue' && action === 'view') {
	console.log(JSON.stringify({ title: 'Issue request', body: 'Body from GitHub.', url: 'https://github.com/acme/checkmate/issues/27' }))
} else if (resource === 'repos/acme/checkmate/contents/pi/docs/Factory%20ticket.md?ref=wip') {
	console.error('gh: Not Found (HTTP 404)')
	process.exitCode = 1
} else if (resource === 'repos/acme/checkmate/contents/docs/Factory%20ticket.md?ref=wip%2Fpi') {
	console.log(JSON.stringify({ encoding: 'base64', content: Buffer.from('Request from branch.').toString('base64') }))
} else {
	console.error('Unexpected gh request', args)
	process.exitCode = 1
}
`
	)
	chmodSync(gh, 0o700)
	const moduleURL = pathToFileURL(join(root, 'scripts/factory-config.mjs')).href
	const script = String.raw`
import assert from 'node:assert/strict'
import { pathToFileURL } from 'node:url'
const { requestSource, validateConfig, validateDecisions } = await import(process.argv[1])
const workspace = process.cwd()
const read = options => requestSource(workspace, options)
const file = 'Factory ticket.md'
const fileURL = pathToFileURL(workspace + '/' + file).href
const blob = 'https://github.com/acme/checkmate/blob/wip/pi/docs/Factory%20ticket.md'
for (const label of [file, fileURL]) {
	assert.deepEqual(await read({ file: label }), { source: { kind: 'file', label }, text: 'The local request.' })
}
assert.deepEqual(await read({ issue: '27' }), {
	source: { kind: 'issue', label: 'https://github.com/acme/checkmate/issues/27' },
	text: '# Issue request\n\nBody from GitHub.',
})
assert.deepEqual(await read({ file: blob }), { source: { kind: 'file', label: blob }, text: 'Request from branch.' })
await assert.rejects(read({}), /Give one of/)
await assert.rejects(read({ prompt: 'Also this', issue: '27' }), /Give one of/)
await assert.rejects(read({ prompt: '  ' }), /Give one of/)
await assert.rejects(read({ issue: 'https://example.invalid/issues/27' }), /GitHub issue number or URL/)
await assert.rejects(read({ prompt: '🦉'.repeat(32769) }), /at most 128 KiB/)
const role = { model: 'fixture/model' }
const config = { oracle: role, factory: role, qa: { ...role, level: 'normal', minutes: 2 }, maxBuilds: 3, maxExplorations: 4, timeoutSeconds: 60 }
assert.equal(validateConfig(config).oracle.maxCorrections, 2)
assert.equal(validateConfig({ ...config, oracle: { ...role, maxCorrections: 0 } }).oracle.maxCorrections, 0)
assert.throws(() => validateConfig({ ...config, oracle: { ...role, maxCorrections: -1 } }), /oracle.maxCorrections must be between 0 and 10/)
assert.deepEqual(validateConfig({ ...config, verify: ['node', 'test.ts'] }).jobs, { afterFactory: [['node', 'test.ts']] })
assert.deepEqual(validateConfig({ ...config, jobs: { afterReview: [] } }).jobs, { afterReview: [] })
assert.throws(() => validateConfig({ ...config, jobs: { afterRun: [] } }), /Unknown jobs setting afterRun/)
assert.throws(() => validateConfig({ ...config, jobs: { afterFactory: ['node', 'test.ts'] } }), /must be a command and its arguments/)
assert.throws(() => validateConfig({ ...config, jobs: { afterFactory: [] }, verify: ['node'] }), /Use either verify or jobs.afterFactory/)
assert.throws(() => validateConfig({ ...config, qa: { ...config.qa, exploreBeforeFactory: 'true' } }), /must be true or false/)
assert.throws(() => validateConfig({ ...config, maxExplorations: 1, qa: { ...config.qa, exploreBeforeFactory: true } }), /maxExplorations must be between 2 and 50/)
const decision = { id: 'D1', question: 'Question?', reason: 'Reason.', recommended: 'one', options: [
	{ id: 'one', label: 'One', tradeoff: 'First tradeoff.' },
	{ id: 'two', label: 'Two', tradeoff: 'Second tradeoff.' },
] }
assert.throws(() => validateDecisions([{ ...decision, id: 'merge/T1' }], new Set()), /Invalid Oracle decision ID "merge\/T1"/)
assert.throws(() => validateDecisions([decision, decision], new Set()), /Duplicate oracle decision ID: D1/)
assert.throws(() => validateDecisions([decision], new Set(['D1'])), /Oracle decision ID already answered: D1/)
`
	const result = spawnSync(process.execPath, ['--input-type=module', '--eval', script, moduleURL], {
		cwd: workspace,
		env: { PATH: `${workspace}${delimiter}${process.env.PATH}` },
		encoding: 'utf8',
		timeout: 5000,
	})
	assert.ifError(result.error)
	assert.equal(result.status, 0, result.stdout + result.stderr)
	assert.deepEqual(
		readFileSync(calls, 'utf8')
			.trim()
			.split('\n')
			.map((line) => JSON.parse(line)),
		[
			['issue', 'view', '27', '--json', 'title,body,url'],
			['api', '--method', 'GET', 'repos/acme/checkmate/contents/pi/docs/Factory%20ticket.md?ref=wip'],
			['api', '--method', 'GET', 'repos/acme/checkmate/contents/docs/Factory%20ticket.md?ref=wip%2Fpi'],
		]
	)
})

for (const exploreBeforeFactory of [false, true])
	test(
		exploreBeforeFactory
			? 'factory phase jobs run in order, and baseline findings reach the worker before the first edit'
			: 'the factory pauses for a scope choice, records a QA defect, fixes it, and passes a new build',
		{ timeout: 120_000 },
		async (t) => {
			const home = directory(t)
			const repository = join(home, 'source')
			const campaign = join(home, 'campaign')
			const bin = join(home, 'bin')
			const calls = join(home, 'calls.jsonl')
			mkdirSync(join(repository, 'scripts'), { recursive: true })
			mkdirSync(bin)
			writeFileSync(calls, '')
			const env = {
				...process.env,
				PATH: `${bin}${delimiter}${process.env.PATH}`,
				GIT_AUTHOR_NAME: 'Fixture',
				GIT_AUTHOR_EMAIL: 'fixture@example.invalid',
				GIT_COMMITTER_NAME: 'Fixture',
				GIT_COMMITTER_EMAIL: 'fixture@example.invalid',
				npm_config_audit: 'false',
				npm_config_fund: 'false',
				npm_config_offline: 'true',
			}
			function execute(file: string, args: string[], expected = 0) {
				const result = spawnSync(file, args, { cwd: repository, env, encoding: 'utf8', timeout: 90_000 })
				assert.ifError(result.error)
				assert.equal(result.status, expected, result.stdout + result.stderr)
				return result.stdout
			}
			const run = (args: string[], expected = 0) =>
				execute(process.execPath, [join(root, 'scripts/factory.mjs'), ...args], expected)
			const save = (name: string, data: string) => writeFileSync(join(repository, name), data)
			const manifest = { name: 'checkmate-factory-fixture', version: '1.0.0', type: 'module', private: true }
			save('package.json', JSON.stringify(manifest))
			save(
				'package-lock.json',
				JSON.stringify({
					name: manifest.name,
					version: manifest.version,
					lockfileVersion: 3,
					packages: { '': manifest },
				})
			)
			save('.gitignore', 'node_modules/\ncli/dist/\n')
			save('message.txt', 'BASE')
			save('scripts/preview.mjs', preview)
			save(
				'scripts/build-cli.ts',
				`import { copyFileSync, mkdirSync } from 'node:fs'\nmkdirSync('cli/dist', { recursive: true })\ncopyFileSync('scripts/preview.mjs', 'cli/dist/checkmate.js')\n`
			)
			save(
				'scripts/verify.ts',
				`import assert from 'node:assert/strict'\nimport { readFileSync } from 'node:fs'\nassert(['FIRST', 'READY'].includes(readFileSync('message.txt', 'utf8')))\n`
			)
			save(
				'scripts/job.mjs',
				String.raw`import assert from 'node:assert/strict'
import { appendFileSync, existsSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
const [stage, marker] = process.argv.slice(2)
const { CHECKMATE_FACTORY_BUILD: build, CHECKMATE_FACTORY_CAMPAIGN_DIR: campaign,
	CHECKMATE_FACTORY_RECORDS_DIR: records, CHECKMATE_FACTORY_EXPLORATION: exploration } = process.env
assert.equal(records, join(campaign, 'records'))
assert.ok(existsSync(join(records, '.checkmate', 'checkmate.db')))
assert.equal(process.env.CHECKMATE_HARNESS, undefined)
assert.equal(process.env.CHECKMATE_ACTOR, undefined)
const trace = ${JSON.stringify(calls)}
const body = readFileSync('message.txt', 'utf8')
appendFileSync(trace, JSON.stringify({ stage, build, exploration, body, marker }) + '\n')
if (stage === 'afterVerify') assert.ok(existsSync('cli/dist/checkmate.js'))
if (stage === 'afterExploration' && exploration === 'x-1') {
	const firstFailure = join(campaign, 'hook-failed')
	const attempts = readFileSync(trace, 'utf8').trim().split('\n').map(JSON.parse)
	const { url } = attempts.find(record => record.stage === 'test')
	await assert.rejects(fetch(url, { signal: AbortSignal.timeout(2000) }))
	if (!existsSync(firstFailure)) {
		writeFileSync(firstFailure, 'failed')
		throw new Error('Phase job interrupted the baseline before oracle review.')
	}
}
if (stage === 'afterFactory' && !existsSync(join(campaign, 'verification-ready')))
	throw new Error('The configured gate could not reach its fixture.')
`
			)
			save(
				'factory.yml',
				`oracle: {model: fixture/model, effort: medium, maxCorrections: ${exploreBeforeFactory ? 2 : 0}}\nfactory: {model: fixture/model, effort: medium}\nqa: {model: fixture/model, effort: medium, level: smoke, minutes: 1, exploreBeforeFactory: ${exploreBeforeFactory}}\nmaxBuilds: 3\nmaxExplorations: 4\ntimeoutSeconds: 60\n` +
					(exploreBeforeFactory
						? `jobs:
  afterScope:
    - [node, scripts/job.mjs, afterScope, 'one argument']
    - [node, scripts/job.mjs, afterScope, second]
  afterFactory:
    - [node, scripts/job.mjs, afterFactory]
  afterVerify:
    - [node, scripts/job.mjs, afterVerify]
  afterExploration:
    - [node, scripts/job.mjs, afterExploration]
  afterReview:
    - [node, scripts/job.mjs, afterReview]
`
						: 'verify: [node, scripts/verify.ts]\n')
			)
			writeFileSync(join(bin, 'pi'), fakePi(calls, exploreBeforeFactory))
			chmodSync(join(bin, 'pi'), 0o700)
			execute('git', ['init', '-q', '-b', 'main'])
			execute('git', ['add', '.'])
			execute('git', ['commit', '-qm', 'Fixture baseline'])
			const baseline = execute('git', ['rev-parse', 'HEAD']).trim()

			const start = [
				'start',
				'--prompt',
				'Display READY in the preview.',
				'--output',
				campaign,
				'--config',
				'factory.yml',
			]
			if (exploreBeforeFactory) run(start, 2)
			else {
				const failed = JSON.parse(run(start, 1))
				assert.equal(failed.phase, 'scope')
				assert.match(failed.reason, /Oracle reply is invalid after one attempt/)
				assert.equal(readFileSync(calls, 'utf8').match(/"stage":"scope"/g)?.length, 1)
				run(['resume', campaign], 2)
			}
			assert.match(
				readFileSync(join(campaign, 'decisions.json'), 'utf8'),
				/How should the preview communicate readiness/
			)
			assert.doesNotMatch(readFileSync(calls, 'utf8'), /"stage":"worker"/)
			const answers = join(home, 'answers.json')
			writeFileSync(answers, JSON.stringify({ D1: 'text' }))
			const resumed = JSON.parse(run(['resume', campaign, '--answers', answers], 1))
			if (exploreBeforeFactory) {
				assert.equal(resumed.phase, 'afterExploration')
				assert.equal(resumed.builds, 0)
				assert.equal(resumed.explorations, 1)
				assert.match(resumed.reason, /Phase job interrupted the baseline/)
				assert.doesNotMatch(readFileSync(calls, 'utf8'), /"stage":"(worker|review)"/)
				const pending = JSON.parse(run(['resume', campaign], 2))
				assert.equal(pending.explorations, 1)
				assert.equal(pending.builds, 0)
				assert.equal(pending.decisions[0].id, 'D2')
				assert.deepEqual(pending.decisions[0].questionIds, ['a1/Q1'])
				writeFileSync(answers, JSON.stringify({ D2: 'text' }))
				const blocked = JSON.parse(run(['resume', campaign, '--answers', answers], 1))
				assert.equal(blocked.baselineExploration, 'x-1')
				assert.equal(blocked.nativeState, 'passed')
				assert.equal(blocked.lastExploration, 'x-2')
				assert.equal(blocked.builds, 1)
				assert.match(blocked.reason, /The configured gate could not reach its fixture/)
				const ui = await startUi({ workspace: join(campaign, 'records') })
				try {
					const page = await fetch(new URL('/explorations/x-2', ui.url))
					assert.equal(page.status, 200)
					assert.match(await page.text(), /Display READY/)
				} finally {
					await ui.close()
				}
				const rechecked = JSON.parse(run(['resume', campaign], 1))
				assert.equal(rechecked.builds, 1)
				assert.equal(rechecked.explorations, 2)
				assert.equal(rechecked.candidate, blocked.candidate)
				writeFileSync(join(campaign, 'verification-ready'), '')
				const passed = JSON.parse(run(['resume', campaign]))
				assert.equal(passed.candidate, blocked.candidate)
				assert.equal(passed.lastExploration, 'x-2')
				assert.equal(passed.verificationError, null)
			} else {
				assert.equal(resumed.phase, 'review')
				assert.equal(resumed.explorations, 1)
				assert.match(resumed.reason, /Oracle review omitted questions a1\/Q1 and claims a1\/D1/)
				const open = json(join(campaign, 'records'), ['status', 'checkmate-self']).body
				assert.equal(open.questions.length, 1)
				assert.equal(open.claims.length, 1)
				assert.equal(open.claims[0].handoff, null)
				run(['resume', campaign])
			}
			assert.match(run(['status', campaign]), /passed/)
			assert.equal(execute('git', ['rev-parse', 'HEAD']).trim(), baseline)
			assert.equal(execute('git', ['status', '--porcelain']), '')
			const bundleRefs = execute('git', ['bundle', 'list-heads', join(campaign, 'candidate.bundle')])

			const records = join(campaign, 'records')
			const db = new DatabaseSync(join(records, '.checkmate', 'checkmate.db'), { readOnly: true })
			try {
				const plan = db.prepare('SELECT plan_id FROM plan_requests').get()!.plan_id as string
				const attempts = db.prepare('SELECT build FROM explorations ORDER BY rowid').all()
				assert.equal(attempts.length, 2)
				assert.equal(attempts[0].build === baseline, exploreBeforeFactory)
				assert.notEqual(attempts[0].build, attempts[1].build)
				assert(
					bundleRefs.split('\n').some((line) => line.startsWith(`${attempts[1].build} `)),
					bundleRefs
				)
				const status = json(records, ['status', plan])
				assert.equal(status.code, 0, JSON.stringify(status.body))
				assert.equal(status.body.state, 'passed')
				const retested = json(records, ['claim', 'list', plan, '--all']).body.claims
				assert.equal(retested.length, 1)
				assert.equal(retested[0].latestRetest, 'fixed')
				assert.equal(retested[0].open, false)
				const operations = db
					.prepare('SELECT command FROM operations ORDER BY rowid')
					.all()
					.map((row) => row.command)
				for (const command of ['gap answer', 'claim accept', 'claim handoff'])
					assert.equal(operations.filter((operation) => operation === command).length, 1, command)
			} finally {
				db.close()
			}
			const trace = readFileSync(calls, 'utf8')
				.trim()
				.split('\n')
				.map((line) => JSON.parse(line))
			assert.match(trace.find((call) => call.stage === 'worker').prompt, /Use status text/)
			if (exploreBeforeFactory) {
				assert.deepEqual(
					trace.map(({ stage }) => stage),
					[
						'scope',
						'scope',
						'scope',
						'afterScope',
						'afterScope',
						'afterVerify',
						'study',
						'test',
						'afterExploration',
						'afterExploration',
						'review',
						'review',
						'review',
						'afterReview',
						'worker',
						'afterFactory',
						'afterVerify',
						'study',
						'test',
						'afterExploration',
						'afterReview',
						'afterFactory',
						'afterVerify',
						'afterFactory',
						'afterVerify',
					]
				)
				const scope = trace.filter(({ stage }) => stage === 'scope')
				assert.match(scope[1].prompt, /Oracle reply must contain valid JSON/)
				const [badId, reusedId, corrected] = trace.filter(({ stage }) => stage === 'review')
				assert.doesNotMatch(badId.prompt, /Oracle reply correction/)
				assert.match(reusedId.prompt, /Invalid Oracle decision ID "merge\/T1"/)
				assert.match(corrected.prompt, /Oracle decision ID already answered: D1/)
				const scopeJobs = trace.filter(({ stage }) => stage === 'afterScope')
				assert.deepEqual(
					scopeJobs.map(({ marker }) => marker),
					['one argument', 'second']
				)
				assert.equal(scopeJobs[0].build, baseline)
				assert.equal(trace.find(({ stage }) => stage === 'afterReview').exploration, 'x-1')
				const [baselineStudy, candidateStudy] = trace.filter(({ stage }) => stage === 'study')
				assert.doesNotMatch(baselineStudy.prompt, /Read the diff first/)
				assert.match(candidateStudy.prompt, /Read the diff first/)
				const firstWorker = trace.find(({ stage }) => stage === 'worker')
				assert.match(firstWorker.prompt, /Questions and answers from baseline x-1/)
				assert.match(firstWorker.prompt, /Display READY after the preview loads/)
				assert.match(firstWorker.prompt, /Wrong preview text/)
			}
			const tested = trace.filter((call) => call.stage === 'test')
			assert.deepEqual(
				tested.map((call) => call.body),
				[exploreBeforeFactory ? 'BASE' : 'FIRST', 'READY']
			)
			for (const { url } of tested) await assert.rejects(fetch(url, { signal: AbortSignal.timeout(2000) }))
		}
	)
