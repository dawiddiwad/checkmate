import test from 'node:test'
import type { TestContext } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { discoverModels } from '../plugin/src/model-catalog.ts'
import { directory } from './support.ts'

function fixture(t: TestContext, host: 'claude' | 'pi', body: string) {
	const workspace = directory(t)
	const bin = directory(t)
	writeFileSync(join(bin, host), `#!${process.execPath}\n${body}\n`, { mode: 0o700 })
	return { workspace, list: (mode = '') => discoverModels(host, workspace, { PATH: bin, FIXTURE: mode }) }
}

test('Claude Code model discovery sends an initialization request and no user message', async (t) => {
	const { list, workspace } = fixture(
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
	{ value: 'default', displayName: 'Default' },
	{ value: 'sonnet', displayName: 'Sonnet from the host' },
	{ value: 'restricted-alias' },
]))
`
	)
	assert.deepEqual(await list(), [
		{ value: 'sonnet', label: 'Sonnet from the host' },
		{ value: 'restricted-alias', label: 'restricted-alias' },
	])
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
		`const { readFileSync, writeFileSync } = require('node:fs')
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
