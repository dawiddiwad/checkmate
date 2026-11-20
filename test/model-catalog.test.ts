import test from 'node:test'
import type { TestContext } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { discoverModelCatalog, discoverModels, effortArgs, resolvedEffort } from '../plugin/src/model-catalog.ts'
import { directory } from './support.ts'

function fixture(t: TestContext, host: 'claude' | 'pi', body: string) {
	const workspace = directory(t)
	const bin = directory(t)
	writeFileSync(join(bin, host), `#!${process.execPath}\n${body}\n`, { mode: 0o700 })
	return {
		workspace,
		list: (mode = '') => discoverModels(host, workspace, { PATH: bin, FIXTURE: mode }),
		catalog: () => discoverModelCatalog(host, workspace, { PATH: bin }),
	}
}

test('Claude Code model discovery sends an initialization request and no user message', async (t) => {
	const { list, catalog, workspace } = fixture(
		t,
		'claude',
		`const { readFileSync, writeFileSync } = require('node:fs')
const input = readFileSync(0, 'utf8')
writeFileSync('catalog-input.json', input)
writeFileSync('catalog-args.json', JSON.stringify(process.argv.slice(2)))
const request = JSON.parse(input)
const response = (request_id, models) => JSON.stringify({
	type: 'control_response',
	response: { subtype: 'success', request_id, response: { models } },
})
console.log(response('unrelated', [{ value: 'different-model' }]))
console.log(response(request.request_id, [
	{ value: 'default', displayName: 'Default', supportedEffortLevels: ['high'] },
	{ value: 'sonnet', displayName: 'Sonnet from the host', supportsEffort: true, supportedEffortLevels: ['high', 'medium', 'wrong'] },
	{ value: 'restricted-alias', supportsEffort: false, supportedEffortLevels: ['medium'] },
]))
`
	)
	assert.deepEqual(await list(), [
		{ value: 'sonnet', label: 'Sonnet from the host', effortLevels: ['medium', 'high'] },
		{ value: 'restricted-alias', label: 'restricted-alias' },
	])
	const found = await catalog()
	assert.deepEqual(found.defaultModel, { value: 'default', label: 'Default', effortLevels: ['high'] })
	assert.equal(resolvedEffort('claude', found, 'sonnet', ''), 'medium')
	assert.equal(resolvedEffort('claude', found, '', ''), undefined)
	assert.equal(resolvedEffort('claude', found, 'default', 'high'), 'high')
	assert.equal(resolvedEffort('claude', found, 'restricted-alias', 'medium'), undefined)
	assert.equal(resolvedEffort('claude', found, 'unknown', 'high'), undefined)
	assert.deepEqual(effortArgs('claude', 'medium'), ['--effort', 'medium'])
	const request = JSON.parse(readFileSync(join(workspace, 'catalog-input.json'), 'utf8'))
	assert.deepEqual(request, {
		type: 'control_request',
		request_id: 'checkmate-models',
		request: { subtype: 'initialize' },
	})
	const args = JSON.parse(readFileSync(join(workspace, 'catalog-args.json'), 'utf8'))
	assert.equal(args[args.indexOf('--input-format') + 1], 'stream-json')
	assert(args.includes('--no-session-persistence'))
	assert(args.includes('--strict-mcp-config'))
})

test('Pi lists host models and keeps provider IDs separate', async (t) => {
	const { list, workspace } = fixture(
		t,
		'pi',
		`if (process.argv.includes('--mode')) process.exit(1)
const { readFileSync, writeFileSync } = require('node:fs')
writeFileSync('catalog-input.json', readFileSync(0, 'utf8'))
writeFileSync('catalog-args.json', JSON.stringify(process.argv.slice(2)))
console.log('Loading fixture provider.')
if (process.env.FIXTURE === 'empty') console.log('No models available. Use /login to log into a provider.')
else if (process.env.FIXTURE === 'malformed') console.log('unrecognized stdout')
else if (process.env.FIXTURE === 'failed') {
	console.error('fixture sensitive stderr')
	process.exit(1)
} else console.log([
	'provider  model           context  max-out  thinking  images',
	'local     one/model       8K       1K       no        no',
	'host      one/model       1M       128K     yes       yes',
	'host      one/model       1M       128K     yes       yes',
].join('\\n'))
`
	)
	assert.deepEqual(await list(), [
		{ value: 'local/one/model', label: 'local/one/model' },
		{ value: 'host/one/model', label: 'host/one/model' },
	])
	assert.equal(readFileSync(join(workspace, 'catalog-input.json'), 'utf8'), '')
	assert.deepEqual(JSON.parse(readFileSync(join(workspace, 'catalog-args.json'), 'utf8')), [
		'--no-mcp',
		'--list-models',
	])
	assert.deepEqual(await list('empty'), [])
	for (const mode of ['malformed', 'failed'])
		await assert.rejects(list(mode), { message: 'Pi could not list models. Check the host configuration.' })
	await assert.rejects(discoverModels('pi', workspace, { PATH: '' }), /No pi executable on PATH/)
})

test('Pi discovers the active model and derives exact levels from the provider mapping', async (t) => {
	const { catalog } = fixture(
		t,
		'pi',
		`
const lines = require('node:readline').createInterface({ input: process.stdin })
const local = { provider: 'local', id: 'one/model', reasoning: false }
const host = { provider: 'host', id: 'one/model', reasoning: true, thinkingLevelMap: {
	off: null, minimal: null, medium: null, xhigh: 'xhigh', max: null,
} }
const usual = { provider: 'host', id: 'usual', reasoning: true }
lines.on('line', (line) => {
	const { id, type } = JSON.parse(line)
	const data = type === 'get_state' ? { model: host } : { models: [local, host, usual] }
	console.log(JSON.stringify({ type: 'response', command: type, id, success: true, data }))
})
`
	)
	const found = await catalog()
	assert.deepEqual(found.defaultModel, {
		value: 'host/one/model',
		label: 'host/one/model',
		effortLevels: ['low', 'high', 'xhigh'],
	})
	assert.deepEqual(found.models, [
		{ value: 'local/one/model', label: 'local/one/model' },
		found.defaultModel,
		{ value: 'host/usual', label: 'host/usual', effortLevels: ['off', 'minimal', 'low', 'medium', 'high'] },
	])
	assert.equal(resolvedEffort('pi', found, '', ''), undefined)
	assert.equal(resolvedEffort('pi', found, '', 'max'), undefined)
	assert.equal(resolvedEffort('pi', found, 'host/usual', ''), 'medium')
	assert.equal(resolvedEffort('pi', found, 'one/model', 'xhigh'), undefined)
	assert.equal(resolvedEffort('pi', found, 'one/model', 'xhigh', 'host'), 'xhigh')
	assert.equal(resolvedEffort('pi', found, 'one/model', 'xhigh', 'local'), undefined)
	assert.deepEqual(effortArgs('pi', 'off'), ['--thinking', 'off'])
	assert.deepEqual(effortArgs('pi', undefined), [])
})
