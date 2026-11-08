import test from 'node:test'
import assert from 'node:assert/strict'
import { writeFile, chmod, readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { worker, delegate } from '../plugin/src/launcher.ts'
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

async function executable(workspace: string, code: string) {
	const path = join(workspace, 'fake-claude')
	await writeFile(path, `#!/usr/bin/env node\n${code}\n`)
	await chmod(path, 0o700)
	return path
}
test('launcher rejects prose, missing output, denial, and wrong identity', async (t) => {
	const workspace = await sandbox(t)
	for (const output of [
		'not json',
		JSON.stringify({ type: 'result', subtype: 'success' }),
		JSON.stringify({ type: 'result', subtype: 'error', is_error: true }),
	]) {
		const path = await executable(workspace, `console.log(${JSON.stringify(output)})`)
		await assert.rejects(worker(path, [], { cwd: workspace, prompt: 'test', timeoutSeconds: 2 }))
	}
	const p = await prepare(workspace)
	await write(workspace, 'request.json', p.planRequest)
	const path = await executable(
		workspace,
		`console.log(JSON.stringify({type:'result',subtype:'success',structured_output:{contractVersion:'toolkit-1',requestId:'wrong',operation:'plan',status:'needs_decision',artifact:null,reasons:['Permission denied']}}))`
	)
	assert.equal(
		(await delegate(workspace, 'request.json', { allowedTools: ['Read', 'Write'], claude: path })).status,
		'operational_error'
	)
})
test('launcher reads the candidate it named and publishes the plan', async (t) => {
	const workspace = await sandbox(t),
		p = await prepare(workspace)
	const request = { ...p.planRequest, requestId: 'plan-2', outputPlanId: 'second', planDirectory: 'plans/second' }
	await write(workspace, 'request.json', request)
	const candidate = { ...(await fixtureJson<PlanCandidate>('plan')), planId: 'second', target: p.target }
	const response = { contractVersion: 'toolkit-1', requestId: 'plan-2', operation: 'plan', reasons: [] }
	const path = await executable(
		workspace,
		`let prompt='';process.stdin.on('data',(b)=>prompt+=b).on('end',()=>{` +
			`const file=prompt.match(/Write the candidate JSON to (\\S+)\\./)[1];` +
			`require('node:fs').writeFileSync(file,${JSON.stringify(JSON.stringify(candidate))});` +
			`console.log(JSON.stringify({type:'result',subtype:'success',structured_output:{...${JSON.stringify(response)},status:process.env.WORKER_STATUS,artifact:null}}))})`
	)
	process.env.WORKER_STATUS = 'operational_error'
	assert.equal(
		(await delegate(workspace, 'request.json', { allowedTools: ['Read', 'Write'], claude: path })).status,
		'operational_error'
	)
	process.env.WORKER_STATUS = 'completed'
	t.after(() => delete process.env.WORKER_STATUS)
	const result = await delegate(workspace, 'request.json', { allowedTools: ['Read', 'Write'], claude: path })
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
		claude: path,
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
		claude: '/does-not-exist',
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
	const first = await delegate(workspace, 'request.json', { ...options, claude: loggedOut })
	assert.equal(first.status, 'operational_error')
	assert.equal(first.artifact, null)
	assert.deepEqual(first.reasons, ['Claude did not complete the stage: Invalid API key · Please run /login'])
	const exits = await executable(workspace, `console.error('Not logged in. Run claude auth login.'); process.exit(1)`)
	const second = await delegate(workspace, 'request.json', { ...options, claude: exits })
	assert.deepEqual(second.reasons, ['Worker exited with code 1: Not logged in. Run claude auth login.'])
	await assert.rejects(readFile(join(workspace, 'plans/checkout/v2.json')), { code: 'ENOENT' })
})

test('worker cannot silently change a pinned request', async (t) => {
	const workspace = await sandbox(t),
		p = await prepare(workspace)
	await write(workspace, 'request.json', p.planRequest)
	const response = {
		contractVersion: 'toolkit-1',
		requestId: p.planRequest.requestId,
		operation: 'plan',
		status: 'needs_decision',
		artifact: null,
		reasons: ['Needs access.'],
	}
	const path = await executable(
		workspace,
		`require('node:fs').appendFileSync('request.json',' ');console.log(JSON.stringify({type:'result',subtype:'success',structured_output:${JSON.stringify(response)}}))`
	)
	const result = await delegate(workspace, 'request.json', { allowedTools: ['Read', 'Write'], claude: path })
	assert.equal(result.status, 'operational_error')
	assert.match(result.reasons[0], /digest/)
})

test('delegate without tool rules names the minimum rules and reserves no run', async (t) => {
	const workspace = await sandbox(t),
		p = await prepare(workspace),
		r = await revised(workspace, p)
	await write(workspace, 'request.json', executeRequest(p, r))
	await assert.rejects(
		delegate(workspace, 'request.json', { claude: '/does-not-exist' }),
		/Minimum for execute: Read, Write, Bash\(node \*\), Bash\(playwright-cli \*\)/
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
	const result = await delegate(workspace, 'request.json', { allowedTools: ['Read', 'Write'], claude, playwright })
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
	const response = { contractVersion: 'toolkit-1', requestId: request.requestId, operation: 'execute', reasons: [] }
	const claude = await executable(
		workspace,
		`let prompt='';process.stdin.on('data',(b)=>prompt+=b).on('end',()=>{` +
			`const file=prompt.match(/Write the candidate JSON to (\\S+)\\./)[1];` +
			`require('node:fs').writeFileSync(file,'{}');` +
			`console.log(JSON.stringify({type:'result',subtype:'success',structured_output:{...${JSON.stringify(response)},status:'completed',artifact:null}}))})`
	)
	const result = await delegate(workspace, 'request.json', {
		allowedTools: ['Read', 'Write'],
		claude,
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
