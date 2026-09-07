import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { resolve } from 'node:path'
import process from 'node:process'
import { fileURLToPath } from 'node:url'

const tarball = process.argv[2]
assert(tarball, 'usage: npm run test:package:final -- <candidate.tgz> [--live]')
assert(process.argv.length <= 4 && (!process.argv[3] || process.argv[3] === '--live'), 'unknown argument')
const probes = ['../package/active-exports.mjs', '../acceptance/agent-workflow.mjs']
if (process.argv[3] === '--live') probes.push('../acceptance/ollama-cli.mjs')
for (const probe of probes) {
	execFileSync(process.execPath, [fileURLToPath(import.meta.resolve(probe)), resolve(tarball)], { stdio: 'inherit' })
}
