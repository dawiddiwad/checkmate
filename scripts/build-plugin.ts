import { build } from 'esbuild'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import assert from 'node:assert/strict'

const output = new URL('../plugin/dist/checkmate.js', import.meta.url)
const bundle = await build({
	entryPoints: [fileURLToPath(new URL('../plugin/bin/checkmate.ts', import.meta.url))],
	bundle: true,
	platform: 'node',
	format: 'esm',
	target: 'node24',
	legalComments: 'none',
	write: false,
})
const text = bundle.outputFiles[0].text
if (process.argv.includes('--check'))
	assert.equal(await readFile(output, 'utf8').catch(() => ''), text, 'Run npm run build')
else {
	await mkdir(new URL('.', output), { recursive: true })
	await writeFile(output, text)
}
