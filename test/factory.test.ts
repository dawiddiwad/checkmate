import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { chmodSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { delimiter, join } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import test from 'node:test'
import { pathToFileURL } from 'node:url'
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

const fakePi = (journal: string) => `#!/usr/bin/env node
const { randomUUID } = require('node:crypto')
const { appendFileSync, readFileSync, writeFileSync } = require('node:fs')
const { createInterface } = require('node:readline')
const { join } = require('node:path')
const args = process.argv.slice(2)
const after = flag => args.includes(flag) ? args[args.indexOf(flag) + 1] : undefined
const model = { provider: 'fixture', id: 'model', reasoning: true }
const emit = data => console.log(JSON.stringify(data))
const journal = ${JSON.stringify(journal)}
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
	let result
	if (prompt.startsWith('# Factory oracle scope')) {
		const first = !calls().some(call => call.stage === 'scope')
		record({ stage: 'scope', prompt })
		result = {
			objective: 'Display READY in the candidate preview.',
			requirements: [rule],
			decisions: first ? [{
				id: 'D1', question: 'How should the preview communicate readiness?',
				options: [
					{ id: 'text', label: 'Use status text', tradeoff: 'Simple to read.' },
					{ id: 'badge', label: 'Use a badge', tradeoff: 'Easy to scan.' },
				], recommended: 'text', reason: 'The labels are both suitable for the fixture.',
			}] : [],
		}
	} else if (prompt.startsWith('# Factory worker')) {
		const prior = readFileSync('message.txt', 'utf8')
		record({ stage: 'worker', prior, cwd: process.cwd(), prompt })
		writeFileSync('message.txt', prior === 'BASE' ? 'FIRST' : 'READY')
		result = 'Updated the preview.'
	} else if (prompt.startsWith('# Factory oracle review')) {
		record({ stage: 'review', prompt })
		result = {
			answers: [{ id: 'a1/Q1', value: 'Display READY after the preview loads.', source: 'The fixture request.', rationale: 'The request names the preview output.' }],
			claims: [{ id: 'a1/D1', decision: 'accept', rationale: 'QA saw FIRST instead of READY.' }],
			decisions: [],
		}
	} else if (prompt.startsWith('A change of the application')) {
		const url = prompt.match(/http:\\/\\/127\\.0\\.0\\.1:\\d+/)?.[0]
		if (!url) throw new Error('The QA study lacks a preview URL')
		record({ stage: 'study', session, url })
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
const { requestSource } = await import(process.argv[1])
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

test(
	'the factory pauses for a scope choice, records a QA defect, fixes it, and passes a new build',
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
			'factory.yml',
			`oracle: {model: fixture/model, effort: medium}\nfactory: {model: fixture/model, effort: medium}\nqa: {model: fixture/model, effort: medium, level: smoke, minutes: 1}\nmaxBuilds: 3\nmaxExplorations: 4\nverify: [node, scripts/verify.ts]\ntimeoutSeconds: 60\n`
		)
		writeFileSync(join(bin, 'pi'), fakePi(calls))
		chmodSync(join(bin, 'pi'), 0o700)
		execute('git', ['init', '-q', '-b', 'main'])
		execute('git', ['add', '.'])
		execute('git', ['commit', '-qm', 'Fixture baseline'])
		const baseline = execute('git', ['rev-parse', 'HEAD']).trim()

		run(['start', '--prompt', 'Display READY in the preview.', '--output', campaign, '--config', 'factory.yml'], 2)
		assert.match(
			readFileSync(join(campaign, 'decisions.json'), 'utf8'),
			/How should the preview communicate readiness/
		)
		assert.doesNotMatch(readFileSync(calls, 'utf8'), /"stage":"worker"/)
		const answers = join(home, 'answers.json')
		writeFileSync(answers, JSON.stringify({ D1: 'text' }))
		run(['resume', campaign, '--answers', answers])
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
				assert(operations.includes(command), command)
		} finally {
			db.close()
		}
		const trace = readFileSync(calls, 'utf8')
			.trim()
			.split('\n')
			.map((line) => JSON.parse(line))
		assert.match(trace.find((call) => call.stage === 'worker').prompt, /Use status text/)
		const tested = trace.filter((call) => call.stage === 'test')
		assert.deepEqual(
			tested.map((call) => call.body),
			['FIRST', 'READY']
		)
		for (const { url } of tested) await assert.rejects(fetch(url, { signal: AbortSignal.timeout(2000) }))
	}
)
