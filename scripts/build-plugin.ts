// Bundles plugin/bin/checkmate.ts into plugin/dist/checkmate.js.
// Node.js does not strip types in node_modules, so the skills and the npm package run this bundle.
import { build } from 'esbuild'
import { cp, mkdir, readFile, readdir, writeFile } from 'node:fs/promises'
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

const assets = new URL('../plugin/dist/assets/', import.meta.url)
const sources = [
	[new URL('../cli/src/ui/assets/', import.meta.url), assets],
	[new URL('../cli/fonts/', import.meta.url), new URL('fonts/', assets)],
] as const
for (const [source, destination] of sources) {
	if (process.argv.includes('--check')) {
		for (const name of await readdir(source))
			assert.deepEqual(
				await readFile(new URL(name, destination)).catch(() => null),
				await readFile(new URL(name, source)),
				`Run npm run build: ${name}`
			)
	} else await cp(source, destination, { recursive: true })
}
