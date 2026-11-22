import test from 'node:test'
import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import { mkdirSync, symlinkSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { slugId } from '../plugin/src/contracts.ts'
import { ticketFile } from '../plugin/src/rules.ts'
import {
	isLocalAddress,
	readOnlyOperation,
	requireAnswer,
	setupTarget,
	targetRevision,
	urlReachable,
	urlTargetId,
} from '../plugin/src/targets.ts'
import { ruleTokens, saveTesterRules, testerRulesText } from '../plugin/src/settings.ts'
import { explorerBrief } from '../plugin/src/briefs.ts'
import { actor, directory, store } from './support.ts'

test('an address is local when it is loopback or in a private range', () => {
	for (const url of [
		'http://localhost:3000',
		'http://app.localhost',
		'http://127.0.0.1:8080/x',
		'http://127.9.9.9',
		'http://[::1]:3000',
		'http://10.1.2.3',
		'http://192.168.0.7',
		'http://172.16.0.1',
		'http://172.31.255.255',
	])
		assert.equal(isLocalAddress(url), true, url)
	for (const url of [
		'http://shop.example.com',
		'https://8.8.8.8',
		'http://172.32.0.1',
		'http://172.15.0.1',
		'http://192.169.0.1',
		'http://11.0.0.1',
		'http://999.1.1.1',
		'not a url',
	])
		assert.equal(isLocalAddress(url), false, url)
})

test('an ID from a text is made the way the product makes the ID of a target', () => {
	assert.equal(slugId('Checkout Ticket'), 'checkout-ticket')
	assert.equal(slugId('  --Fix the cart!! '), 'fix-the-cart')
	assert.equal(slugId('x'.repeat(200)).length, 96)
	assert.equal(slugId('???'), '')
	assert.equal(urlTargetId('http://Localhost:3000/shop'), 'localhost-3000')
	assert.equal(urlTargetId('nonsense'), 'app')
})

test('a target that testers may only read has the sentence that says so in the brief', (t) => {
	const opened = store(t)
	setupTarget(opened, actor, {
		url: 'http://localhost:3999',
		env: { PATH: '' },
		answered: true,
		operations: [readOnlyOperation],
	})
	const profile = targetRevision(opened, 'localhost-3999').profile
	assert.deepEqual(profile.allowedOperations, ['read_only'])
	const brief = explorerBrief(
		{
			goal: 'Test.',
			requirements: [],
			sources: [],
			capabilities: [],
			operations: profile.allowedOperations,
			tools: [],
			instructions: '',
			scope: [],
		} as never,
		[],
		'qa-',
		'.checkmate/work/x/a1/',
		{ study: 60, test: 60 }
	)
	assert.match(brief.study, /You can only read\. Do not create, change, or delete data in the application\./)
})

test('an application that does not answer is refused with a sentence and a next step', async (t) => {
	const server = createServer((_, res) => res.end('ok'))
	await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
	t.after(() => server.close())
	const port = (server.address() as { port: number }).port
	assert.equal(await urlReachable(`http://127.0.0.1:${port}/`), true)
	assert.equal(await urlReachable('http://127.0.0.1:1/'), false)
	assert.equal(await urlReachable('ftp://anything'), true)
	assert.doesNotThrow(() => requireAnswer(true, 'http://x'))
	assert.throws(
		() => requireAnswer(false, 'http://127.0.0.1:1/'),
		(error: Error & { hint?: string }) =>
			error.message === 'The application did not answer at http://127.0.0.1:1/.' &&
			/Start the application/.test(error.hint ?? '')
	)
})

test('a ticket is a file inside the workspace', (t) => {
	const workspace = directory(t)
	const outside = directory(t)
	const opened = store(t, workspace)
	mkdirSync(join(workspace, 'docs'))
	writeFileSync(join(workspace, 'docs', 'ticket.md'), 'AC1')
	writeFileSync(join(outside, 'secret.md'), 'no')
	symlinkSync(join(outside, 'secret.md'), join(workspace, 'docs', 'link.md'))
	assert.equal(ticketFile(opened, 'docs/ticket.md'), 'docs/ticket.md')
	assert.equal(ticketFile(opened, ` ${join(workspace, 'docs', 'ticket.md')} `), 'docs/ticket.md')
	assert.equal(ticketFile(opened, './docs/../docs/ticket.md'), 'docs/ticket.md')
	const refused = (name: string) => {
		try {
			ticketFile(opened, name)
		} catch (error) {
			return (error as Error).message
		}
		return assert.fail(`${name} was not refused`)
	}
	assert.match(refused('../outside.md'), /^The ticket \.\.\/outside\.md is outside the workspace\.$/)
	assert.match(refused(join(outside, 'secret.md')), /is outside the workspace\./)
	assert.match(refused('docs/link.md'), /is outside the workspace\./)
	assert.equal(refused('docs/none.md'), 'The ticket file docs/none.md does not exist.')
	assert.equal(refused('docs'), 'The ticket docs is not a file.')
})

test('the rules of testers are words, a rule with a space in its brackets is one word, and the latest save wins', (t) => {
	assert.deepEqual(ruleTokens(' Read  Bash(git log:*)\nGrep '), ['Read', 'Bash(git log:*)', 'Grep'])
	assert.deepEqual(ruleTokens('Bash(open'), ['Bash(open'])
	assert.deepEqual(ruleTokens('  '), [])
	const opened = store(t)
	assert.equal(testerRulesText(opened), 'Read Bash')
	assert.throws(() => saveTesterRules(opened, actor, ' '), /Give at least one tool rule/)
	saveTesterRules(opened, actor, 'Read')
	saveTesterRules(opened, actor, 'Read  Edit')
	assert.equal(testerRulesText(opened), 'Read Edit')
	assert.equal(
		opened.db
			.prepare("SELECT count(*) AS n FROM operations WHERE command = 'setting set' AND status = 'rejected'")
			.get()!.n,
		1
	)
})

test('setup reports the instance probe and saved profile readiness separately', (t) => {
	const opened = store(t)
	const input = { targetId: 'shop', env: { PATH: '' } }
	const first = setupTarget(opened, actor, {
		...input,
		url: 'http://localhost:1',
		instanceId: 'bad',
		answered: false,
	})
	assert.equal(first.data.ready, false)
	assert.equal(first.data.instanceReachable, false)
	const recovered = setupTarget(opened, actor, {
		...input,
		url: 'http://localhost:2',
		instanceId: 'good',
		answered: true,
	})
	assert.equal(recovered.data.ready, false)
	assert.equal(recovered.data.instanceReachable, true)
	assert.match(String(recovered.data.next), /checkmate delegate setup shop/)
	const other = { ...input, targetId: 'other' }
	setupTarget(opened, actor, { ...other, url: 'http://localhost:2', instanceId: 'good', answered: true })
	const dead = setupTarget(opened, actor, { ...other, url: 'http://localhost:1', instanceId: 'bad', answered: false })
	assert.equal(dead.data.ready, true)
	assert.equal(dead.data.instanceReachable, false)
})
