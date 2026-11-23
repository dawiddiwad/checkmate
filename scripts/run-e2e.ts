import { constants, accessSync, readFileSync } from 'node:fs'
import { spawnSync } from 'node:child_process'

const browser = process.env.CHECKMATE_BROWSER_EXECUTABLE
if (!browser) throw Error('Set CHECKMATE_BROWSER_EXECUTABLE to an executable Chromium browser.')
try {
	accessSync(browser, constants.X_OK)
} catch {
	throw Error(`Cannot execute Chromium at ${browser}. Set CHECKMATE_BROWSER_EXECUTABLE.`)
}
const pi = spawnSync('pi', ['--version'], { encoding: 'utf8' })
if (pi.error || pi.status !== 0) throw Error('Install the Pi CLI and ensure pi --version works on PATH.')

const build = spawnSync(process.execPath, ['scripts/build-cli.ts'], { stdio: 'inherit' })
if (build.status !== 0) process.exit(build.status ?? 1)
const files = ['test/e2e/factory.test.ts', 'test/e2e/local.test.ts', 'test/e2e/oracle-ui.test.ts']
const result = spawnSync(process.execPath, ['--test', '--test-reporter=tap', ...files], {
	encoding: 'utf8',
	maxBuffer: 32 * 1024 * 1024,
})
process.stdout.write(result.stdout ?? '')
process.stderr.write(result.stderr ?? '')
if (result.error) throw result.error
if (result.status !== 0) process.exit(result.status ?? 1)
const output = result.stdout ?? ''
const count = Number(/^# tests (\d+)$/m.exec(output)?.[1])
const skipped = Number(/^# skipped (\d+)$/m.exec(output)?.[1])
if (count !== 66 || skipped !== 0)
	throw Error(`Expected 66 executed cases with no skips; got ${count} cases and ${skipped} skips.`)
const catalog = JSON.parse(readFileSync('test/e2e/scenarios.json', 'utf8')) as Array<{ test?: string }>
if (catalog.length !== 42) throw Error(`Expected 42 proposal scenarios; got ${catalog.length}.`)
for (const name of new Set(catalog.flatMap((scenario) => (scenario.test ? [scenario.test] : [])))) {
	if (!output.includes(` - ${name}\n`)) throw Error(`Required scenario case did not execute: ${name}`)
}
