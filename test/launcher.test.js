import test from 'node:test'
import assert from 'node:assert/strict'
import { writeFile, chmod, readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { worker, delegate } from '../src/launcher.ts'
import { sandbox, prepare, revised, executeRequest, write } from './support.js'

async function executable(workspace, code) {
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
	assert.equal((await delegate(workspace, 'request.json', { claude: path })).status, 'operational_error')
})
test('launcher deadline terminates the worker group and records no completed result', async (t) => {
	const workspace = await sandbox(t),
		p = await prepare(workspace),
		r = await revised(workspace, p)
	const request = executeRequest(p, r, { timeoutSeconds: 1 })
	await write(workspace, 'request.json', request)
	const path = await executable(
		workspace,
		`const {spawn}=require('node:child_process'); const {writeFileSync}=require('node:fs'); const child=spawn(process.execPath,['-e','setInterval(()=>{},1000)'],{stdio:'ignore'});writeFileSync('child.pid',String(child.pid));setInterval(()=>{},1000)`
	)
	const result = await delegate(workspace, 'request.json', { claude: path, playwright: '/missing-playwright' })
	assert.equal(result.status, 'interrupted')
	assert(result.artifact)
	const interrupted = JSON.parse(await readFile(join(workspace, 'runs/run-1/result.json'), 'utf8'))
	assert.equal(interrupted.completion, 'interrupted')
	assert(interrupted.tests.every((test) => test.outcome === 'error' || test.outcome === 'not_run'))
	assert(interrupted.tests.every((test) => test.observed === null))
	const pid = Number(await readFile(join(workspace, 'child.pid'), 'utf8'))
	try {
		process.kill(pid, 0)
		const state = await readFile(`/proc/${pid}/stat`, 'utf8')
		assert.match(state, /\) Z /)
	} catch (error) {
		if (error.code !== 'ESRCH' && error.code !== 'ENOENT') throw error
	}
})
test('preflight rejection never launches Claude', async (t) => {
	const workspace = await sandbox(t),
		p = await prepare(workspace)
	await write(workspace, 'request.json', executeRequest(p, { reference: p.base }, { selectedTestIds: ['T1'] }))
	const result = await delegate(workspace, 'request.json', { claude: '/does-not-exist' })
	assert.equal(result.status, 'needs_decision')
})

test('Claude reports missing authentication in a clean host configuration', async (t) => {
	const { execFile } = await import('node:child_process')
	const { promisify } = await import('node:util')
	const { root } = await import('./support.js')
	const workspace = await sandbox(t)
	const environment = { ...process.env, CLAUDE_CONFIG_DIR: workspace }
	for (const name of ['CLAUDE_CODE_OAUTH_TOKEN', 'ANTHROPIC_API_KEY', 'ANTHROPIC_AUTH_TOKEN'])
		delete environment[name]
	const output = await promisify(execFile)(join(root, 'node_modules/.bin/claude'), ['auth', 'status'], {
		env: environment,
	}).catch((error) => {
		assert(error.stdout, 'Expected a structured authentication status')
		return error
	})
	assert.equal(JSON.parse(output.stdout).loggedIn, false)
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
	const result = await delegate(workspace, 'request.json', { claude: path })
	assert.equal(result.status, 'operational_error')
	assert.match(result.reasons[0], /digest/)
})
