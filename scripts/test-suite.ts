import { readdirSync } from 'node:fs'
import { resolve } from 'node:path'
import { run } from 'node:test'
import { inspect } from 'node:util'
import { cases } from './test-cases.ts'
import { scenarios } from './test-scenarios.ts'
import { owners } from './scenario-owners.ts'

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
const name = process.argv[2]
if (scenarios.length !== 42 || owners.length !== 42) throw Error('The scenario map must have 42 entries.')
for (const [index, scenario] of scenarios.entries()) {
	const owner = owners[index]
	if (!owner && !scenario.limit) throw Error(`Scenario has no owner or documented gap: ${scenario.name}`)
	if (owner && (!scenario.tests.includes(owner.file) || !cases[owner.file]?.includes(owner.title)))
		throw Error(`Scenario owner is not selected: ${scenario.name}`)
}
if (name === 'map') {
	for (const [index, scenario] of scenarios.entries()) {
		const owner = owners[index]
		console.log(
			`${index + 1}. ${scenario.name}: ${owner ? `${owner.file}: ${owner.title}` : 'gap'}${scenario.limit ? ` (${scenario.limit})` : ''}`
		)
	}
	process.exit(0)
}
if (!['primary', 'merge', 'extended'].includes(name)) throw Error('Use primary, merge, extended, or map.')
const requiredFiles = name === 'primary' ? primary : merged
for (const file of requiredFiles) {
	if (!all.includes(file)) throw Error(`Missing test file: ${file}`)
	if (!cases[file]?.length) throw Error(`No required cases mapped for ${file}`)
}
const selected = requiredFiles.flatMap((file) => cases[file].map((title) => ({ file, title })))
const titles = [...new Set(selected.map((item) => item.title))]
const escaped = titles.map((title) => title.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|')
const pattern = new RegExp(`^(?:${escaped})$`)
const missing = new Set(selected.map(({ file, title }) => `${resolve(file)}\n${title}`))
let passed = 0
let failed = 0
let skipped = 0
const started = Date.now()
console.log(`${name}: ${name === 'extended' ? 'remaining cases' : `${selected.length} required cases`}`)
const stream = run({
	files: name === 'extended' ? all : requiredFiles,
	...(name === 'extended' ? { testSkipPatterns: [pattern] } : { testNamePatterns: [pattern] }),
	concurrency: 4,
})
for await (const event of stream) {
	if (event.type === 'test:stdout') process.stdout.write(event.data.message)
	if (event.type === 'test:stderr') process.stderr.write(event.data.message)
	if (event.type !== 'test:pass' && event.type !== 'test:fail') continue
	const data = event.data
	const file = data.entryFile ?? data.file
	if (event.type === 'test:pass' && !data.entryFile && file && resolve(data.name) === file) continue
	if (name === 'extended' && data.skip && file && missing.has(`${file}\n${data.name}`)) continue
	if (file && data.nesting === 0 && name !== 'extended') missing.delete(`${file}\n${data.name}`)
	if (data.skip) {
		skipped++
		console.log(`- ${data.name} # SKIP ${String(data.skip)}`)
		if (name !== 'extended' && (process.env.CHECKMATE_BROWSER_EXECUTABLE || !file?.endsWith('.browser.test.ts'))) {
			failed++
			console.error(`Required case skipped: ${data.name}`)
		}
	} else if (event.type === 'test:fail') {
		failed++
		console.error(`✖ ${data.name}\n${inspect(data.details.error, { depth: 5 })}`)
	} else {
		passed++
		console.log(`✔ ${data.name}`)
	}
}
if (name !== 'extended' && missing.size) {
	failed += missing.size
	for (const item of missing) console.error(`Required case did not run: ${item.replace('\n', ': ')}`)
}
console.log(`Passed ${passed}; failed ${failed}; skipped ${skipped}; ${(Date.now() - started) / 1000}s`)
if (failed) process.exitCode = 1
