import { readdirSync } from 'node:fs'
import { spawnSync } from 'node:child_process'
import { scenarios } from './test-scenarios.ts'

const primary = [
	'test/package.test.ts',
	'test/spec.test.ts',
	'test/promotion.test.ts',
	'test/qa-status.test.ts',
	'test/lifecycle.test.ts',
	'test/invariants.test.ts',
	'test/pi-permission.test.ts',
]
const merged = [...new Set([...primary, ...scenarios.flatMap((scenario) => scenario.tests)])]
const all = readdirSync('test')
	.filter((name) => name.endsWith('.test.ts'))
	.map((name) => `test/${name}`)
const selections: Record<string, string[]> = {
	primary,
	merge: merged,
	extended: all.filter((name) => !merged.includes(name)),
}
const name = process.argv[2]
if (scenarios.length !== 42) throw Error('The scenario map must have 42 entries.')
if (name === 'map') {
	for (const [index, scenario] of scenarios.entries())
		console.log(
			`${index + 1}. ${scenario.name}: ${scenario.tests.join(', ') || 'not covered'}${scenario.limit ? ` (${scenario.limit})` : ''}`
		)
	process.exit(0)
}
if (!(name in selections)) throw Error('Use primary, merge, extended, or map.')
const files = selections[name]
const missing = files.filter((file) => !all.includes(file))
if (missing.length) throw Error(`Missing test files: ${missing.join(', ')}`)
console.log(`${name}: ${files.length} test files`)
const options = name === 'merge' ? ['--test-concurrency=4'] : []
const result = spawnSync(process.execPath, ['--test', ...options, ...files], { stdio: 'inherit' })
if (result.error) throw result.error
process.exitCode = result.status ?? 1
