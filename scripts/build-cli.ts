import { build } from 'esbuild'
import { cp, rm } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'

const root = fileURLToPath(new URL('..', import.meta.url))

await build({
	entryPoints: [`${root}cli/src/main.ts`],
	outfile: `${root}cli/dist/checkmate.js`,
	bundle: true,
	format: 'esm',
	platform: 'node',
	target: 'node24',
	legalComments: 'none',
	banner: { js: '#!/usr/bin/env node' },
})
await rm(`${root}cli/plugin`, { recursive: true, force: true })
await cp(`${root}plugin`, `${root}cli/plugin`, { recursive: true })
console.log('Built cli/dist/checkmate.js and copied plugin/ to cli/plugin/.')
