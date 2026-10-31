import assert from 'node:assert/strict'
import { test } from 'node:test'
import { parsePackResult } from './pack-result.mjs'

const pack = {
	name: '@xoxoai/checkmate',
	filename: 'xoxoai-checkmate-0.6.5.tgz',
	files: [{ path: 'package.json' }],
}

test('reads array and package-name keyed npm pack output', () => {
	for (const output of [[pack], { [pack.name]: pack }]) {
		assert.deepEqual(parsePackResult(JSON.stringify(output), pack.name), pack)
	}
})

test('rejects missing, additional, wrong, and incomplete package results', () => {
	for (const output of [
		[],
		{},
		[pack, pack],
		[{ ...pack, name: 'other' }],
		[{ ...pack, files: undefined }],
		[{ ...pack, filename: undefined }],
	]) {
		assert.throws(() => parsePackResult(JSON.stringify(output), pack.name))
	}
})
