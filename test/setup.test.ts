import test from 'node:test'
import assert from 'node:assert/strict'
import type { TestContext } from 'node:test'
import { spawn } from 'node:child_process'
import { chmodSync, mkdirSync, realpathSync, writeFileSync } from 'node:fs'
import { delimiter, join } from 'node:path'
import { once } from 'node:events'
import { run } from '../plugin/src/cli.ts'
import { closeStore, openStore } from '../plugin/src/store.ts'
import { explorerBrief } from '../plugin/src/briefs.ts'
import { addInstance, anyTestOperation, anyTestOperationText, targetRevision } from '../plugin/src/targets.ts'
import { gate } from '../plugin/src/plans.ts'
import { actor, directory, plan, store, target } from './support.ts'
import { fakeClaude } from './claude.ts'

function workspace(t: TestContext, name = 'My Shop') {
	const folder = join(realpathSync(directory(t)), name)
	mkdirSync(folder)
	return folder
}

function command(folder: string, args: string[], env: Record<string, string | undefined> = {}, stdin = '') {
	const outcome = run([...args, '--workspace', folder], {
		cwd: folder,
		env: { CHECKMATE_ACTOR: actor, PATH: process.env.PATH, ...env },
		stdin: () => stdin,
	})
	return { ...outcome, lines: outcome.output.split('\n') }
}

async function server(t: TestContext) {
	const child = spawn(process.execPath, [
		'-e',
		"const s = require('node:http').createServer((q, r) => r.end('ok')).listen(0, '127.0.0.1', () => console.log(s.address().port))",
	])
	t.after(() => child.kill())
	const [port] = (await once(child.stdout, 'data')) as [Buffer]
	return `http://127.0.0.1:${port.toString().trim()}`
}

test('setup saves a target from a URL with defaults and prints each assumed value', async (t) => {
	const folder = workspace(t)
	const url = await server(t)
	const reply = command(folder, ['setup', '--url', url], { PATH: directory(t) })
	assert.equal(reply.code, 0, reply.output)
	assert.deepEqual(reply.lines, [
		'completed my-shop revision=1 instance=local capabilities=http operations=any_test_operation ready=true',
		'assumed: target=my-shop (the workspace folder name)',
		'assumed: instance=local',
		'assumed: entry point=web (url)',
		'assumed: capabilities=http (no browser tool on PATH)',
		`assumed: operations=any_test_operation: ${anyTestOperationText}`,
		'assumed: reset=none',
		'assumed: authentication=none',
	])
	assert.equal(command(folder, ['setup', '--url', url]).lines.length, 1)
	const store = openStore(folder)
	t.after(() => closeStore(store))
	assert.equal(targetRevision(store, 'my-shop').profile.readyForLiveExecution, true)
})

test('setup finds a browser tool, takes explicit values, and marks a silent URL as not ready', (t) => {
	const folder = workspace(t)
	const bin = directory(t)
	writeFileSync(join(bin, 'playwright-cli'), '#!/bin/sh\necho "Version 0.1.23"\n')
	chmodSync(join(bin, 'playwright-cli'), 0o755)
	const reply = command(
		folder,
		['setup', '--url', 'http://127.0.0.1:1', '--target', 'shop', '--instance', 'uat', '--operations', 'read,order'],
		{ PATH: `${bin}${delimiter}${process.env.PATH}` }
	)
	assert.equal(reply.code, 0, reply.output)
	assert.match(
		reply.lines[0],
		/^completed shop revision=1 instance=uat capabilities=browser,http operations=read,order ready=false$/
	)
	assert(!reply.lines.some((line) => /target=|instance=|operations=/.test(line.replace(reply.lines[0], ''))))
	assert(reply.lines.includes('assumed: ready=false (http://127.0.0.1:1 did not answer)'))
	const store = openStore(folder)
	t.after(() => closeStore(store))
	const tool = targetRevision(store, 'shop').profile.tools.find((item) => item.name === 'playwright-cli')
	assert.equal(tool?.version, '0.1.23')
})

test('a production instance needs an explicit list of operations', (t) => {
	const folder = workspace(t)
	for (const args of [
		['--instance', 'prod-eu'],
		['--instance', 'live', '--environment', 'Production EU'],
	]) {
		const refused = command(folder, ['setup', '--url', 'http://127.0.0.1:1', ...args])
		assert.equal(refused.code, 1)
		assert.match(refused.output, /is a production instance\. any_test_operation is not permitted on it\./)
		assert.match(refused.output, /hint: Give the allowed operations as an explicit list/)
	}
	assert.equal(
		command(folder, ['setup', '--url', 'http://127.0.0.1:1', '--instance', 'prod', '--operations', 'read']).code,
		0
	)
	const other = workspace(t, 'other')
	assert.equal(command(other, ['setup', '--url', 'http://127.0.0.1:1']).code, 0)
	const store = openStore(other)
	t.after(() => closeStore(store))
	assert.throws(
		() =>
			addInstance(store, actor, {
				targetId: 'other',
				instanceId: 'production',
				instance: { entries: { web: 'http://x' } },
			}),
		/production instance/
	)
	assert.throws(
		() =>
			addInstance(store, actor, {
				targetId: 'other',
				instanceId: 'uat',
				instance: { entries: { web: 'http://x' }, environment: 'prod mirror' },
			}),
		/production instance/
	)
})

test('the plan and the gate accept any operation of the default, and the brief says it in one sentence', (t) => {
	const opened = store(t)
	target(opened, { allowedOperations: [anyTestOperation], approvals: { plan: 'none', result: 'none' } })
	assert.equal(plan(opened).status, 'needs_decision')
	const checked = gate(opened, { reference: 'checkout@1', build: 'b' })
	assert.equal(checked.reply.status, 'completed', checked.reply.reasons.join(' '))
	assert.deepEqual(checked.reply.data.tests, ['T1'])
	const brief = explorerBrief(
		{
			goal: 'g',
			requirements: [],
			sources: [],
			instructions: null,
			capabilities: ['http'],
			operations: [anyTestOperation],
			tools: [],
			scope: [],
			change: null,
			knownState: null,
		},
		[],
		'qa-',
		'qa-evidence',
		{ study: 600, test: 900 }
	).study
	assert.match(brief, new RegExp(`\\n${anyTestOperationText} Do not change the code`))
	assert.doesNotMatch(brief, /any_test_operation/)
})

test('test with no build, no git, and no target sets up the target from --url and names each assumed value', (t) => {
	const folder = workspace(t, 'cart-app')
	writeFileSync(join(folder, 'ticket.md'), 'The cart shows the total.')
	const fake = fakeClaude(t, { explorer: 'Tested.', recorder: [{ kind: 'note', text: 'Explored.' }] })
	const env = { ...process.env, ...fake.env }
	const none = command(folder, ['test', 'cart', '--source', 'ticket.md', '--allow', 'Read'], env)
	assert.match(none.output, /reason: The store has no target\. Give the URL of the application with --url\./)
	const reply = command(
		folder,
		['test', 'cart', '--source', 'ticket.md', '--url', 'http://127.0.0.1:1', '--level', 'smoke', '--allow', 'Read'],
		env
	)
	assert.equal(reply.code, 0, reply.output)
	assert.match(reply.output, /\nassumed: build=local-[0-9]{8}-[0-9]{4}\n/)
	assert.match(reply.output, /\nassumed: target=cart-app \(the workspace folder name\)\n/)
	assert.match(reply.output, /\nassumed: objective=Test the change that ticket\.md describes\.$/m)
	assert.match(
		reply.output,
		/\nassumed: since=none \(no diff is given: no --since, and no default branch of origin behind the checked-out commit\)/
	)
	assert.equal(command(folder, ['explore', 'wait', 'x-1', '--timeout', '60'], env).code, 0)
	const again = command(
		folder,
		['test', 'cart2', '--source', 'ticket.md', '--build', 'b2', '--level', 'smoke', '--allow', 'Read'],
		env
	)
	assert.equal(again.code, 0, again.output)
	assert.match(again.output, /\nassumed: target=cart-app \(the only target\)\n/)
	assert.doesNotMatch(again.output, /assumed: build=/)
	assert.equal(command(folder, ['explore', 'wait', 'x-2', '--timeout', '60'], env).code, 0)
})
