import test from 'node:test'
import assert from 'node:assert/strict'
import { writeFile, chmod, readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { delegate } from '../plugin/src/launcher.ts'
import { hosts } from '../plugin/src/hosts.ts'
import type { Plan, Result } from '../plugin/src/types.ts'
import {
	sandbox,
	prepare,
	revised,
	executeRequest,
	write,
	fixtureJson,
	artifact,
	load,
	observation,
} from './support.ts'
import { finalize } from '../plugin/src/stages.ts'
import { planCoverage, type PlanCandidate } from '../plugin/src/contracts.ts'

async function executable(workspace: string, code: string, name = 'fake-claude') {
	const path = join(workspace, name)
	await writeFile(path, `#!/usr/bin/env node\n${code}\n`)
	await chmod(path, 0o700)
	return path
}
function answering(code: string, output = `{type:'result',subtype:'success'}`) {
	return (
		`let prompt=process.argv.slice(2).join(' ');process.stdin.on('data',(b)=>prompt+=b).on('end',()=>{` +
		`const candidate=prompt.match(/Write the candidate JSON to (\\S+)\\./)[1];` +
		`const answer=prompt.match(/Write the response JSON to (\\S+)\\./)[1];` +
		`const fs=require('node:fs');${code};console.log(JSON.stringify(${output}))})`
	)
}
const reply = (fields: object) =>
	`fs.writeFileSync(answer,JSON.stringify({contractVersion:'toolkit-2',artifact:null,reasons:[],...${JSON.stringify(fields)}}))`

test('the Claude adapter rejects prose, an unfinished stage, and an error', () => {
	for (const output of [
		'not json',
		JSON.stringify({ type: 'result', subtype: 'error' }),
		JSON.stringify({ type: 'result', subtype: 'success', is_error: true }),
	])
		assert.throws(() => hosts.claude.read(output))
	const usage = { modelUsage: { small: { outputTokens: 5 }, main: { outputTokens: 900 } } }
	assert.equal(hosts.claude.read(JSON.stringify({ type: 'result', subtype: 'success', ...usage })).model, 'main')
})
test('the Codex adapter maps sandbox rules and reads failures from events', () => {
	const run = { prompt: 'p', pluginRoot: '/p', skill: '/p/skills/checkmate-plan', allow: ['workspace-write'] }
	const args = hosts.codex.args(run)
	assert.deepEqual(args.slice(0, 2), ['exec', '--json'])
	assert.equal(args[args.indexOf('--sandbox') + 1], 'workspace-write')
	assert(!args.includes('sandbox_workspace_write.network_access=true'))
	assert(
		hosts.codex
			.args({ ...run, allow: ['workspace-write', 'network'] })
			.includes('sandbox_workspace_write.network_access=true')
	)
	assert.throws(() => hosts.codex.args({ ...run, allow: ['Bash(node *)'] }), /Unknown Codex rule/)
	assert.throws(() => hosts.codex.args({ ...run, allow: ['network'] }), /exactly one Codex sandbox mode/)
	const events = (...lines: object[]) => lines.map((line) => JSON.stringify(line)).join('\n')
	assert.throws(
		() =>
			hosts.codex.read(
				events({ type: 'thread.started' }, { type: 'turn.failed', error: { message: 'Not logged in' } })
			),
		/Not logged in/
	)
	assert.throws(() => hosts.codex.read(events({ type: 'thread.started' })), /did not complete/)
	assert.deepEqual(hosts.codex.read(events({ type: 'thread.started' }, { type: 'turn.completed' })), {
		model: null,
		usage: null,
	})
})
test('the pi adapter passes the prompt as an argument and reads errors from events', () => {
	const args = hosts.pi.args({
		prompt: 'do it',
		pluginRoot: '/p',
		skill: '/p/skills/checkmate-plan',
		allow: ['read', 'write'],
	})
	assert.equal(args.at(-1), 'do it')
	assert.equal(args[args.indexOf('--skill') + 1], '/p/skills/checkmate-plan')
	assert.equal(args[args.indexOf('--tools') + 1], 'read,write')
	assert(args.includes('--no-approve') && args.includes('--no-session'))
	assert.equal(hosts.pi.promptOnStdin, false)
	const error = { type: 'message_update', assistantMessageEvent: { type: 'error', error: 'No API key' } }
	assert.throws(() => hosts.pi.read(JSON.stringify(error)), /No API key/)
	const done = { type: 'message_end', message: { role: 'assistant', model: 'pi-model' } }
	assert.equal(hosts.pi.read(JSON.stringify(done)).model, 'pi-model')
})
test('each adapter reads tokens, peak context, and cost as the host reports them', () => {
	const claude = {
		type: 'result',
		subtype: 'success',
		total_cost_usd: 0.0125,
		usage: {
			input_tokens: 10,
			cache_read_input_tokens: 30000,
			cache_creation_input_tokens: 2000,
			output_tokens: 500,
			iterations: [{ input_tokens: 4, cache_read_input_tokens: 31000, cache_creation_input_tokens: 100 }],
		},
		modelUsage: { main: { outputTokens: 500, contextWindow: 200000, costBasis: 'list' } },
	}
	assert.deepEqual(hosts.claude.read(JSON.stringify(claude)).usage, {
		inputTokens: 32010,
		cacheReadTokens: 30000,
		cacheWriteTokens: 2000,
		outputTokens: 500,
		peakContextTokens: 31104,
		contextWindowTokens: 200000,
		costUSD: 0.0125,
		costSource: 'Claude Code (list prices)',
	})
	const turn = (input: number, output: number) => ({
		type: 'turn.completed',
		usage: { input_tokens: input, cached_input_tokens: 100, cache_write_input_tokens: 50, output_tokens: output },
	})
	const codex = [{ type: 'thread.started' }, turn(1000, 20), turn(3000, 40)].map((e) => JSON.stringify(e))
	assert.deepEqual(hosts.codex.read(codex.join('\n')).usage, {
		inputTokens: 4000,
		cacheReadTokens: 200,
		cacheWriteTokens: 100,
		outputTokens: 60,
		peakContextTokens: null,
		contextWindowTokens: null,
		costUSD: null,
		costSource: null,
	})
	const message = (input: number, cacheRead: number, cost: number) => ({
		type: 'message_end',
		message: {
			role: 'assistant',
			model: 'pi-model',
			usage: { input, output: 10, cacheRead, cacheWrite: 0, cost: { total: cost, totalFromProvider: false } },
		},
	})
	const pi = [
		{ type: 'message_end', message: { role: 'user' } },
		message(600, 0, 0.001),
		message(200, 900, 0.0005),
	].map((e) => JSON.stringify(e))
	assert.deepEqual(hosts.pi.read(pi.join('\n')).usage, {
		inputTokens: 1700,
		cacheReadTokens: 900,
		cacheWriteTokens: 0,
		outputTokens: 20,
		peakContextTokens: 1100,
		contextWindowTokens: null,
		costUSD: 0.0015,
		costSource: 'pi (model catalog prices)',
	})
})
test('launcher rejects a response with the wrong identity', async (t) => {
	const workspace = await sandbox(t)
	const p = await prepare(workspace)
	await write(workspace, 'request.json', p.planRequest)
	const path = await executable(
		workspace,
		answering(
			reply({ requestId: 'wrong', operation: 'plan', status: 'needs_decision', reasons: ['Permission denied'] })
		)
	)
	assert.equal(
		(await delegate(workspace, 'request.json', { allowedTools: ['Read', 'Write'], executable: path })).status,
		'operational_error'
	)
})
test('launcher fails a stage when the worker writes no response file', async (t) => {
	const workspace = await sandbox(t)
	const p = await prepare(workspace)
	await write(workspace, 'request.json', p.planRequest)
	const path = await executable(workspace, answering(''))
	const result = await delegate(workspace, 'request.json', { allowedTools: ['Read', 'Write'], executable: path })
	assert.equal(result.status, 'operational_error')
	assert.deepEqual(result.reasons, ['Worker wrote no response file'])
})
test('launcher reads the candidate it named and publishes the plan', async (t) => {
	const workspace = await sandbox(t),
		p = await prepare(workspace)
	const request = { ...p.planRequest, requestId: 'plan-2', outputPlanId: 'second', planDirectory: 'plans/second' }
	await write(workspace, 'request.json', request)
	const candidate = { ...(await fixtureJson<PlanCandidate>('plan')), planId: 'second', target: p.target }
	const path = await executable(
		workspace,
		answering(
			`fs.writeFileSync(candidate,${JSON.stringify(JSON.stringify(candidate))});` +
				`fs.writeFileSync(answer,JSON.stringify({contractVersion:'toolkit-2',requestId:'plan-2',operation:'plan',reasons:[],artifact:null,status:process.env.WORKER_STATUS}))`
		)
	)
	process.env.WORKER_STATUS = 'operational_error'
	assert.equal(
		(await delegate(workspace, 'request.json', { allowedTools: ['Read', 'Write'], executable: path })).status,
		'operational_error'
	)
	process.env.WORKER_STATUS = 'completed'
	t.after(() => delete process.env.WORKER_STATUS)
	const result = await delegate(workspace, 'request.json', { allowedTools: ['Read', 'Write'], executable: path })
	assert.equal(result.status, 'needs_decision')
	assert.equal(artifact(result).path, 'plans/second/v1.json')
	const saved = await load<Plan>(workspace, artifact(result))
	assert.deepEqual(saved.coverage, planCoverage(saved))
})
test('launcher deadline terminates the worker group and records no completed result', async (t) => {
	const workspace = await sandbox(t),
		p = await prepare(workspace),
		r = await revised(workspace, p)
	const request = executeRequest(p, r)
	await write(workspace, 'request.json', request)
	const path = await executable(
		workspace,
		`const {spawn}=require('node:child_process'); const {writeFileSync}=require('node:fs'); const child=spawn(process.execPath,['-e','setInterval(()=>{},1000)'],{stdio:'ignore'});writeFileSync('child.pid',String(child.pid));setInterval(()=>{},1000)`
	)
	const result = await delegate(workspace, 'request.json', {
		allowedTools: ['Read', 'Write'],
		timeoutSeconds: 1,
		executable: path,
		playwright: '/missing-playwright',
	})
	assert.equal(result.status, 'interrupted')
	assert(result.artifact)
	const interrupted = JSON.parse(await readFile(join(workspace, 'runs/run-1/result.json'), 'utf8')) as Result
	assert.equal(interrupted.completion, 'interrupted')
	const invocation = JSON.parse(await readFile(join(workspace, 'runs/run-1/invocation.json'), 'utf8'))
	assert.equal(invocation.request.timeoutSeconds, 180)
	assert.equal(invocation.deadlineSeconds, 1)
	assert(interrupted.tests.every((test) => test.outcome === 'error' || test.outcome === 'not_run'))
	assert(interrupted.tests.every((test) => test.observed === null))
	const pid = Number(await readFile(join(workspace, 'child.pid'), 'utf8'))
	try {
		process.kill(pid, 0)
		const state = await readFile(`/proc/${pid}/stat`, 'utf8')
		assert.match(state, /\) Z /)
	} catch (error) {
		const code = (error as NodeJS.ErrnoException).code
		if (code !== 'ESRCH' && code !== 'ENOENT') throw error
	}
})
test('preflight rejection never launches Claude', async (t) => {
	const workspace = await sandbox(t),
		p = await prepare(workspace)
	await write(workspace, 'request.json', executeRequest(p, { reference: p.base }, { selectedTestIds: ['T1'] }))
	const result = await delegate(workspace, 'request.json', {
		allowedTools: ['Read', 'Write'],
		executable: '/does-not-exist',
	})
	assert.equal(result.status, 'needs_decision')
})

test('a worker that is not logged in fails the stage with its reason', async (t) => {
	const workspace = await sandbox(t),
		p = await prepare(workspace)
	await write(workspace, 'request.json', p.planRequest)
	const options = { allowedTools: ['Read', 'Write'] }
	const envelope = {
		type: 'result',
		subtype: 'success',
		is_error: true,
		result: 'Invalid API key · Please run /login',
	}
	const loggedOut = await executable(workspace, `console.log(${JSON.stringify(JSON.stringify(envelope))})`)
	const first = await delegate(workspace, 'request.json', { ...options, executable: loggedOut })
	assert.equal(first.status, 'operational_error')
	assert.equal(first.artifact, null)
	assert.deepEqual(first.reasons, ['Claude did not complete the stage: Invalid API key · Please run /login'])
	const exits = await executable(workspace, `console.error('Not logged in. Run claude auth login.'); process.exit(1)`)
	const second = await delegate(workspace, 'request.json', { ...options, executable: exits })
	assert.deepEqual(second.reasons, ['Worker exited with code 1: Not logged in. Run claude auth login.'])
	await assert.rejects(readFile(join(workspace, 'plans/checkout/v2.json')), { code: 'ENOENT' })
})

test('worker cannot silently change a pinned request', async (t) => {
	const workspace = await sandbox(t),
		p = await prepare(workspace)
	await write(workspace, 'request.json', p.planRequest)
	const path = await executable(
		workspace,
		answering(
			`fs.appendFileSync('request.json',' ');` +
				reply({
					requestId: p.planRequest.requestId,
					operation: 'plan',
					status: 'needs_decision',
					reasons: ['Needs access.'],
				})
		)
	)
	const result = await delegate(workspace, 'request.json', { allowedTools: ['Read', 'Write'], executable: path })
	assert.equal(result.status, 'operational_error')
	assert.match(result.reasons[0], /digest/)
})

test('delegate without tool rules names the minimum rules and reserves no run', async (t) => {
	const workspace = await sandbox(t),
		p = await prepare(workspace),
		r = await revised(workspace, p)
	await write(workspace, 'request.json', executeRequest(p, r))
	await assert.rejects(
		delegate(workspace, 'request.json', { executable: '/does-not-exist' }),
		/Minimum for execute on claude: Read, Write, Bash\(node \*\), Bash\(playwright-cli \*\)/
	)
	await assert.rejects(readFile(join(workspace, 'runs/run-1/invocation.json')), { code: 'ENOENT' })
})

test('a failed execute worker closes the browser session once', async (t) => {
	const workspace = await sandbox(t),
		p = await prepare(workspace),
		r = await revised(workspace, p)
	await write(workspace, 'request.json', executeRequest(p, r))
	const claude = await executable(workspace, 'process.exit(3)')
	const playwright = join(workspace, 'fake-playwright')
	await writeFile(
		playwright,
		`#!/usr/bin/env node\nrequire('node:fs').appendFileSync('closed.log', process.argv.slice(2).join(' ') + '\\n')\n`
	)
	await chmod(playwright, 0o700)
	const result = await delegate(workspace, 'request.json', {
		allowedTools: ['Read', 'Write'],
		executable: claude,
		playwright,
	})
	assert.equal(result.status, 'operational_error')
	const closed = (await readFile(join(workspace, 'closed.log'), 'utf8')).trim().split('\n')
	assert.equal(closed.length, 1)
	assert.match(closed[0], /^-s=cm-.* close$/)
	const saved = JSON.parse(await readFile(join(workspace, 'runs/run-1/result.json'), 'utf8')) as Result
	assert.equal(saved.cleanup.status, 'completed')
})

test('a rejected observation stays recoverable with finalize', async (t) => {
	const workspace = await sandbox(t),
		p = await prepare(workspace),
		r = await revised(workspace, p)
	const request = executeRequest(p, r)
	await write(workspace, 'request.json', request)
	const claude = await executable(
		workspace,
		answering(
			`fs.writeFileSync(candidate,'{}');` +
				reply({ requestId: request.requestId, operation: 'execute', status: 'completed' })
		)
	)
	const result = await delegate(workspace, 'request.json', {
		allowedTools: ['Read', 'Write'],
		executable: claude,
		playwright: '/missing-playwright',
	})
	assert.equal(result.status, 'operational_error')
	await assert.rejects(readFile(join(workspace, 'runs/run-1/result.json')), { code: 'ENOENT' })
	const record = JSON.parse(await readFile(join(workspace, 'runs/run-1/launcher-error.json'), 'utf8'))
	assert.match(record.reason, /Invalid observation/)
	assert.match(record.candidate, /^\.checkmate\/candidates\/execute-1-.*\.json$/)
	await readFile(join(workspace, record.candidate))
	const corrected = await observation(workspace, request, r.plan, 220, false)
	assert.equal((await finalize(workspace, request, corrected)).status, 'completed')
})

test('a Codex worker reads the prompt on standard input and the plan is published', async (t) => {
	const workspace = await sandbox(t),
		p = await prepare(workspace)
	const request = { ...p.planRequest, requestId: 'plan-codex', outputPlanId: 'codex', planDirectory: 'plans/codex' }
	await write(workspace, 'request.json', request)
	const candidate = { ...(await fixtureJson<PlanCandidate>('plan')), planId: 'codex', target: p.target }
	const codex = await executable(
		workspace,
		`if (process.argv[2] === '--version') { console.log('codex-cli 9.9.9'); process.exit(0) }\n` +
			answering(
				`fs.writeFileSync('codex.args',JSON.stringify(process.argv.slice(2)));` +
					`fs.writeFileSync(candidate,${JSON.stringify(JSON.stringify(candidate))});` +
					reply({ requestId: 'plan-codex', operation: 'plan', status: 'completed' }),
				`{type:'turn.completed'}`
			),
		'fake-codex'
	)
	const result = await delegate(workspace, 'request.json', {
		host: 'codex',
		executable: codex,
		allowedTools: ['workspace-write'],
	})
	assert.equal(artifact(result).path, 'plans/codex/v1.json')
	const args = JSON.parse(await readFile(join(workspace, 'codex.args'), 'utf8'))
	assert.equal(args.at(-1), '-')
})

test('a pi worker needs --unrestricted-host and gets its skill and prompt as arguments', async (t) => {
	const workspace = await sandbox(t),
		p = await prepare(workspace)
	const request = { ...p.planRequest, requestId: 'plan-pi', outputPlanId: 'pi', planDirectory: 'plans/pi' }
	await write(workspace, 'request.json', request)
	const candidate = { ...(await fixtureJson<PlanCandidate>('plan')), planId: 'pi', target: p.target }
	const pi = await executable(
		workspace,
		answering(
			`fs.writeFileSync(candidate,${JSON.stringify(JSON.stringify(candidate))});` +
				reply({ requestId: 'plan-pi', operation: 'plan', status: 'completed' }),
			`{type:'message_end',message:{role:'assistant',model:'pi-model',usage:{input:700,output:40,cacheRead:0,cacheWrite:0,cost:{total:0.002,totalFromProvider:false}}}}`
		),
		'fake-pi'
	)
	const options = { host: 'pi', executable: pi, allowedTools: ['read', 'write'] }
	await assert.rejects(delegate(workspace, 'request.json', options), /--unrestricted-host/)
	const result = await delegate(workspace, 'request.json', { ...options, unrestrictedHost: true })
	assert.equal(artifact(result).path, 'plans/pi/v1.json')
	assert.equal(result.usage?.costUSD, 0.002)
	assert.deepEqual((await load<Plan>(workspace, artifact(result))).usage, result.usage)
	assert.match(
		await readFile(join(workspace, 'plans/pi/v1.md'), 'utf8'),
		/\| plan \| 700 \| 0 \/ 0 \| 40 \| 700 \| \$0\.0020 \| pi \(model catalog prices\) \|/
	)
	await assert.rejects(
		delegate(workspace, 'request.json', { ...options, host: 'other' }),
		/Unknown host: other. Use one of: claude, codex, pi/
	)
})

test('an execute run records the worker host in the invocation and the result', async (t) => {
	const workspace = await sandbox(t),
		p = await prepare(workspace),
		r = await revised(workspace, p)
	const request = executeRequest(p, r)
	await write(workspace, 'request.json', request)
	const corrected = await observation(
		workspace,
		{ ...request, runId: 'shape', outputDirectory: 'runs/shape' },
		r.plan,
		240
	)
	const codex = await executable(
		workspace,
		`if (process.argv[2] === '--version') { console.log('codex-cli 9.9.9'); process.exit(0) }\n` +
			answering(
				`const invocation=JSON.parse(fs.readFileSync('runs/run-1/invocation.json','utf8'));` +
					`const observation={...${JSON.stringify(corrected)},runId:'run-1',startedAt:invocation.startedAt};` +
					`for(const e of observation.evidence)fs.writeFileSync('runs/run-1/'+e.path,'observed');` +
					`fs.writeFileSync(candidate,JSON.stringify(observation));` +
					reply({ requestId: request.requestId, operation: 'execute', status: 'completed' }),
				`{type:'turn.completed',model:'codex-model',usage:{input_tokens:5000,cached_input_tokens:4000,cache_write_input_tokens:0,output_tokens:300}}`
			),
		'fake-codex'
	)
	const result = await delegate(workspace, 'request.json', {
		host: 'codex',
		executable: codex,
		allowedTools: ['workspace-write', 'network'],
		playwright: '/missing-playwright',
	})
	assert.equal(result.status, 'completed', JSON.stringify(result))
	const invocation = JSON.parse(await readFile(join(workspace, 'runs/run-1/invocation.json'), 'utf8'))
	assert.deepEqual(invocation.host, { name: 'codex', version: 'codex-cli 9.9.9', permissions: 'allow_rules' })
	const saved = await load<Result>(workspace, artifact(result))
	assert.deepEqual(saved.host, {
		name: 'codex',
		version: 'codex-cli 9.9.9',
		model: 'codex-model',
		source: 'launcher',
		permissions: 'allow_rules',
	})
	assert.deepEqual(result.usage, saved.usage)
	assert.equal(saved.usage?.inputTokens, 5000)
	assert.equal(saved.usage?.costUSD, null)
	const report = await readFile(join(workspace, 'runs/run-1/report.md'), 'utf8')
	assert.match(report, /\| plan \(revision 1\) \| not measured \|/)
	assert.match(report, /\| execute \(run-1\) \| 5,000 \| 4,000 \/ 0 \| 300 \| not reported \| not reported \|/)
	assert.match(report, /The total includes only the measured stages\./)
})
