import assert from 'node:assert/strict'
import { mkdirSync, symlinkSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import test from 'node:test'
import { pathToFileURL } from 'node:url'
import { piErrorText, piResult, piStderr } from '../plugin/src/pi.ts'
import {
	authenticationFailed,
	callChild,
	claudeResult,
	costOf,
	launchChild,
	workDenyRules,
} from '../plugin/src/sessions.ts'
import { directory } from './support.ts'

// @ts-expect-error Pi loads this JavaScript extension directly.
import child from '../plugin/pi/child.mjs'

test('Pi result uses the last completed assistant turn and recognizes host errors', () => {
	const session = { type: 'session', id: 'test-session' }
	const end = (stopReason: string, errorMessage?: string, willRetry = false) => ({
		type: 'agent_end',
		willRetry,
		messages: [
			{ role: 'assistant', content: [{ type: 'text', text: 'Old response.' }] },
			{ role: 'toolResult' },
			{
				role: 'assistant',
				stopReason,
				errorMessage,
				content: [
					{ type: 'thinking', text: 'Thinking' },
					{ type: 'text', text: 'Pi ' },
					{ type: 'text', text: 'reply.' },
				],
			},
		],
	})
	const read = (...events: unknown[]) =>
		piResult(events.map((event) => JSON.stringify(event)).join('\n'), '', 0, null)
	assert.deepEqual(read(session, end('stop')), {
		failure: undefined,
		sessionId: 'test-session',
		result: 'Pi reply.',
	})
	assert(authenticationFailed(read(session, end('error', 'No API key found'))))
	assert.equal(read(session, end('aborted')).failure?.[0], 'interrupted')
	assert.equal(read(session, end('stop'), end('error', 'Wait', true)).failure?.[0], 'operational_error')
	assert.equal(read(session, end('toolUse')).failure?.[0], 'operational_error')
})

test('Pi adds fresh usage across turns and retries without counting event copies', () => {
	const assistant = (cost: number | undefined, stopReason: string) => ({
		role: 'assistant',
		stopReason,
		content: [],
		...(cost === undefined ? {} : { usage: { cost: { total: cost } } }),
	})
	const first = assistant(0.125, 'toolUse')
	const tool = { role: 'toolResult', usage: { cost: { total: 0.25 } } }
	const failed = assistant(0, 'error')
	const last = assistant(0.5, 'stop')
	const output = (...events: unknown[]) => events.map((event) => JSON.stringify(event)).join('\n')
	const events = [
		{ type: 'session', id: 'new-session', parentSession: '/source-session' },
		{ type: 'agent_start' },
		{ type: 'message_update', usage: first.usage },
		{ type: 'message_end', message: first },
		{ type: 'message_end', message: tool },
		{ type: 'message_end', message: failed },
		{ type: 'agent_end', messages: [first, tool, failed], willRetry: true },
		{ type: 'agent_start' },
		{ type: 'message_end', message: last },
		{ type: 'agent_end', messages: [last] },
	]
	const result = piResult(output(...events), '', 0, null)
	assert.equal(result.costUsd, 0.875)
	assert.equal(result.costPartial, undefined)
	const incomplete = piResult(output(...events.slice(0, -1)), '', 1, null)
	assert.equal(incomplete.costUsd, 0.875)
	assert.equal(incomplete.costPartial, true)
	const fallback = piResult(output({ type: 'agent_end', messages: [assistant(0, 'stop')] }), '', 0, null)
	assert.equal(fallback.costUsd, 0)
	const missing = piResult(output({ type: 'agent_end', messages: [assistant(undefined, 'stop')] }), '', 0, null)
	assert.equal(missing.costUsd, undefined)
})

test('phase cost uses Claude reported totals, preserves zero and flags missing call costs', () => {
	const call = (cost: number | undefined) => claudeResult(JSON.stringify({ total_cost_usd: cost }), '', 0, null)
	assert.deepEqual(costOf([call(0.25), call(0)]), { costUsd: 0.25 })
	assert.deepEqual(costOf([call(0), call(undefined)]), { costUsd: 0, costPartial: true })
	assert.deepEqual(costOf([call(undefined)]), {})
	assert.deepEqual(costOf([call(-1)]), {})
})

test('Pi failures keep the provider message and status without headers or credential values', () => {
	const body = '{"message":"API key expired.","code":401,"headers":{"authorization":"sensitive"}}'
	const message = { role: 'assistant', stopReason: 'error', errorMessage: `401 ${body}` }
	const output = JSON.stringify({ type: 'message_end', message })
	const result = piResult(output, 'Warning: startup flag ignored\nAuthorization:sensitive', 1, null)
	assert.deepEqual(result.failure, ['operational_error', 'pi exited with code 1: HTTP 401: API key expired.'])
	assert.deepEqual(result.stderr, ['Warning: startup flag ignored'])
	assert(authenticationFailed(result))
	assert.equal(
		piErrorText('pi ended with an error: 401 ' + body.slice(0, -10)),
		'pi ended with an error: HTTP 401: API key expired.'
	)
	assert.equal(
		piErrorText('Error: 402: {"message":"Insufficient credits for this API key."}'),
		'HTTP 402: Insufficient credits for this API key.'
	)
	assert.equal(piErrorText('HTTP 403 refresh token expired.'), 'HTTP 403: refresh token expired.')
	assert.equal(
		piErrorText('401 {"error":{"message":"Incorrect API key provided: demo-secret"}}'),
		'HTTP 401: Incorrect API key provided: [redacted]'
	)
	assert.deepEqual(
		piStderr('Authorization:dummytoken\nCookie:sample=demo\nWWW-Authenticate: Basic realm="service"'),
		[]
	)
})

test('Pi children stop and report output overflow', async (t) => {
	const cwd = directory(t)
	const args = ['-e', "process.stdout.write('x'.repeat(5 * 1024 * 1024)); setInterval(() => {}, 1000)"]
	const sync = callChild(process.execPath, args, '', cwd, {}, 10, 'pi')
	const spawned = await launchChild(process.execPath, args, '', cwd, {}, 10, undefined, 'pi')
	for (const result of [sync, spawned]) {
		assert.equal(result.failure?.[0], 'operational_error')
		assert.match(result.failure?.[1] ?? '', /pi output exceeded 4 MiB/)
	}
})

test('Pi tool policy protects the store, other explorers and aliases of their paths', (t) => {
	const cwd = directory(t)
	mkdirSync(join(cwd, '.checkmate/work/x-1/a2'), { recursive: true })
	mkdirSync(join(cwd, '.checkmate/work/x-1/a1'), { recursive: true })
	writeFileSync(join(cwd, 'source.ts'), '')
	symlinkSync(join(cwd, 'source.ts'), join(cwd, '.checkmate/work/x-1/a1/source.ts'))
	symlinkSync(join(cwd, 'new.ts'), join(cwd, '.checkmate/work/x-1/a1/new.ts'))
	writeFileSync(join(cwd, '.checkmate/checkmate.db'), '')
	symlinkSync(join(cwd, '.checkmate/checkmate.db'), join(cwd, 'alias'))
	type Event = { toolName: string; input: { path?: string; command?: string } }
	const handlers: ((event: Event, context: { cwd: string }) => { block: boolean } | undefined)[] = []
	const setup = () => child({ on: (_name: string, fn: (typeof handlers)[number]) => handlers.push(fn) })
	const previous = process.env.CHECKMATE_PI_POLICY
	try {
		process.env.CHECKMATE_PI_POLICY = JSON.stringify({
			deny: workDenyRules(['.checkmate/work/x-1/a2']),
			work: '.checkmate/work/x-1/a1',
			scoped: ['write'],
		})
		setup()
		process.env.CHECKMATE_PI_POLICY = 'invalid'
		setup()
	} finally {
		if (previous === undefined) delete process.env.CHECKMATE_PI_POLICY
		else process.env.CHECKMATE_PI_POLICY = previous
	}
	const [valid, invalid] = handlers
	for (const [event, blocked] of [
		[{ toolName: 'read', input: { path: '@.checkmate/checkmate.db-wal' } }, true],
		[{ toolName: 'read', input: { path: 'alias' } }, true],
		[{ toolName: 'write', input: { path: '.checkmate/work/x-1/a2/report.md' } }, true],
		[{ toolName: 'write', input: { path: '.checkmate/work/x-1/a1/report.md' } }, false],
		[{ toolName: 'write', input: { path: 'source.ts' } }, true],
		[{ toolName: 'write', input: { path: '.checkmate/work/x-1/a1/../../../../source.ts' } }, true],
		[{ toolName: 'write', input: { path: '.checkmate/work/x-1/a1/source.ts' } }, true],
		[{ toolName: 'write', input: { path: '.checkmate/work/x-1/a1/new.ts' } }, true],
		[{ toolName: 'edit', input: { path: 'source.ts' } }, false],
		[{ toolName: 'read', input: { path: pathToFileURL(join(cwd, '.checkmate/checkmate.db')).href } }, true],
		[{ toolName: 'bash', input: { command: 'pwd && sqlite3 .checkmate/checkmate.db' } }, true],
		[{ toolName: 'bash', input: { command: 'pwd' } }, false],
	] as const)
		assert.equal(valid(event, { cwd })?.block === true, blocked, JSON.stringify(event))
	assert.equal(invalid({ toolName: 'read', input: { path: 'README.md' } }, { cwd })?.block, true)
})
