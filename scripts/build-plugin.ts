import { build } from 'esbuild'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import assert from 'node:assert/strict'

const shared = {
	absWorkingDir: fileURLToPath(new URL('..', import.meta.url)),
	bundle: true,
	legalComments: 'none',
	write: false,
} as const
const cli = await build({
	...shared,
	entryPoints: [fileURLToPath(new URL('../cli/src/main.ts', import.meta.url))],
	platform: 'node',
	format: 'esm',
	target: 'node24',
	banner: { js: '#!/usr/bin/env node' },
})
const client = await build({
	...shared,
	entryPoints: [fileURLToPath(new URL('../plugin/src/ui/client/main.js', import.meta.url))],
	platform: 'browser',
	format: 'iife',
})
const outputs: Array<[URL, string]> = [
	[new URL('../plugin/dist/checkmate.js', import.meta.url), cli.outputFiles[0].text],
	[new URL('../plugin/dist/client.js', import.meta.url), client.outputFiles[0].text],
]
for (const [output, text] of outputs) {
	if (process.argv.includes('--check')) {
		assert.equal(await readFile(output, 'utf8').catch(() => ''), text, 'Run npm run build')
	} else {
		await mkdir(new URL('.', output), { recursive: true })
		await writeFile(output, text)
	}
}
