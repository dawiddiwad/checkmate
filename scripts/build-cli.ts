import { build } from 'esbuild'
import { cp, readFile, rm, writeFile } from 'node:fs/promises'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { resolve } from 'node:path'

const root = fileURLToPath(new URL('..', import.meta.url))
const repository = 'dawiddiwad/checkmate'
const image = /\.(gif|png|jpe?g|svg|webp)$/i

function absolute(target: string, ref: string) {
	const raw = target.match(/^https:\/\/github\.com\/([^/]+\/[^/]+)\/blob\/([^?#]+)\?raw=true$/)
	if (raw) return `https://raw.githubusercontent.com/${raw[1]}/${raw[2]}`
	if (/^([a-z]+:|#)/i.test(target)) return target
	const [path, anchor] = target.replace(/^\.\//, '').split('#')
	if (image.test(path)) return `https://raw.githubusercontent.com/${repository}/${ref}/${path}`
	return `https://github.com/${repository}/blob/${ref}/${path}${anchor === undefined ? '' : `#${anchor}`}`
}

export function packageReadme(markdown: string, version: string) {
	const ref = `v${version}`
	return markdown
		.replace(/\]\(([^)\s]+)\)/g, (_, target: string) => `](${absolute(target, ref)})`)
		.replace(/\b(src|href)="([^"]+)"/g, (_, name: string, target: string) => `${name}="${absolute(target, ref)}"`)
}

async function buildCli() {
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
	const version = JSON.parse(await readFile(`${root}cli/package.json`, 'utf8')).version
	await writeFile(`${root}cli/README.md`, packageReadme(await readFile(`${root}README.md`, 'utf8'), version))
	await cp(`${root}LICENSE`, `${root}cli/LICENSE`)
	console.log('Built cli/dist/checkmate.js and copied plugin/, README.md, and LICENSE to cli/.')
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) await buildCli()
