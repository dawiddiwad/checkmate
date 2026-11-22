import { cpSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { createHash } from 'node:crypto'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const source = dirname(fileURLToPath(import.meta.url))
const [directory, build, mode, ticket] = process.argv.slice(2)
if (!directory || !build || !['broken', 'fixed'].includes(mode) || !ticket)
	throw Error('Usage: build.mjs <directory> <build> <broken|fixed> <ticket>')
const output = resolve(directory, build)
mkdirSync(output, { recursive: true })
cpSync(join(source, 'app.mjs'), join(output, 'app.mjs'))
const sourceSha256 = createHash('sha256').update(readFileSync(ticket)).digest('hex')
writeFileSync(join(output, 'build.json'), JSON.stringify({ build, mode, ticket: 'SHOP-12', sourceSha256 }) + '\n')
process.stdout.write(`${output}\n`)
