import { constants, accessSync, readFileSync } from 'node:fs'
import { spawn, spawnSync } from 'node:child_process'
import { availableParallelism } from 'node:os'

const browser = process.env.CHECKMATE_BROWSER_EXECUTABLE
if (!browser) throw Error('Set CHECKMATE_BROWSER_EXECUTABLE to an executable Chromium browser.')
try {
	accessSync(browser, constants.X_OK)
} catch {
	throw Error(`Cannot execute Chromium at ${browser}. Set CHECKMATE_BROWSER_EXECUTABLE.`)
}
const pi = spawnSync('pi', ['--version'], { encoding: 'utf8' })
if (pi.error || pi.status !== 0) throw Error('Install the Pi CLI and ensure pi --version works on PATH.')

const build = spawnSync(process.execPath, ['../scripts/build-cli.ts'], { cwd: 'cli', stdio: 'inherit' })
if (build.status !== 0) process.exit(build.status ?? 1)
const cores = availableParallelism()
const shards = Number(process.env.CHECKMATE_TEST_SHARDS) || (cores === 1 ? 1 : Math.max(3, cores))
const local = Array.from({ length: shards }, (_, index) => ({
	files: ['test/e2e/local.test.ts'],
	shard: `${index + 1}/${shards}`,
}))
const groups = [{ files: ['test/e2e/factory.test.ts', 'test/e2e/oracle-ui.test.ts'], shard: '1/1' }, ...local]
const results = await Promise.all(
	groups.map(
		({ files, shard }) =>
			new Promise<{ status: number | null; output: string }>((resolve, reject) => {
				const child = spawn(process.execPath, ['--test', '--test-reporter=tap', ...files], {
					env: { ...process.env, CHECKMATE_TEST_SHARD: shard },
					stdio: ['ignore', 'pipe', 'inherit'],
				})
				let output = ''
				child.stdout.on('data', (chunk) => (output += chunk))
				child.on('error', reject)
				child.on('close', (status) => resolve({ status, output }))
			})
	)
)
for (const result of results) process.stdout.write(result.output)
const failed = results.find((result) => result.status !== 0)
if (failed) process.exit(failed.status ?? 1)
const output = results.map((result) => result.output).join('')
const sum = (name: string) =>
	[...output.matchAll(new RegExp(`^# ${name} (\\d+)$`, 'gm'))].reduce((total, match) => total + Number(match[1]), 0)
const count = sum('tests')
const skipped = sum('skipped')
if (count !== 161 || skipped !== 0)
	throw Error(`Expected 161 executed cases with no skips; got ${count} cases and ${skipped} skips.`)
const catalog = JSON.parse(readFileSync('test/e2e/scenarios.json', 'utf8')) as Array<{ test?: string }>
if (catalog.length !== 43) throw Error(`Expected 43 proposal scenarios; got ${catalog.length}.`)
for (const name of new Set(catalog.flatMap((scenario) => (scenario.test ? [scenario.test] : [])))) {
	if (!output.includes(` - ${name}\n`)) throw Error(`Required scenario case did not execute: ${name}`)
}
