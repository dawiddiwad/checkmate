import assert from 'node:assert/strict'
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { basename, join, resolve } from 'node:path'

const directory = process.argv[2]
assert(directory, 'Pass the result directory containing adjudication.json')
const folder = resolve(directory)
const read = (file) => JSON.parse(readFileSync(join(folder, file), 'utf8'))
const oracle = read('oracle.json')
const decisions = read('adjudication.json')
const cases = new Map(oracle.map((item) => [item.id, item]))

function score(entries) {
	assert(Array.isArray(entries), 'Give the adjudicated findings for each output')
	const found = new Set()
	const observed = new Set()
	const classified = new Set()
	const wrongOrigin = new Set()
	let falseReports = 0
	let additional = 0
	let duplicates = 0
	for (const { outcome, id, artifact, evidence, observedInArm, origin } of entries) {
		assert(typeof evidence === 'string' && evidence.trim(), 'Cite the finding and its observed outcome')
		assert(
			typeof artifact === 'string' && artifact === basename(artifact) && existsSync(join(folder, artifact)),
			'Name the run artifact'
		)
		if (outcome === 'matched') {
			assert(cases.has(id), 'Unknown seeded case ' + id)
			if (found.has(id)) duplicates++
			found.add(id)
			if (observedInArm === true) observed.add(id)
			if (origin === 'correct') classified.add(id)
			if (origin === 'wrong') wrongOrigin.add(id)
		} else if (outcome === 'false') falseReports++
		else if (outcome === 'additional') additional++
		else assert.fail('Unrecognized outcome ' + outcome)
	}
	const fraction = (type) => {
		const ids = [...cases.keys()].filter((id) => id.startsWith(type))
		const caught = ids.filter((id) => found.has(id)).length
		return { caught, possible: ids.length, percent: Number(((100 * caught) / ids.length).toFixed(2)) }
	}
	return {
		existingDefects: fraction('D'),
		prRegressions: fraction('R'),
		total: {
			caught: found.size,
			possible: cases.size,
			percent: Number(((100 * found.size) / cases.size).toFixed(2)),
		},
		matches: [...found].sort(),
		observedInArm: [...observed].sort(),
		originCorrect: [...classified].sort(),
		originWrong: [...wrongOrigin].sort(),
		falseReports,
		additional,
		duplicates,
	}
}

function teamUsage(names) {
	const usage = names.map((name) => read(name + '.json'))
	if (usage.length === 1) return usage[0]
	const charged = usage.filter((run) => run.costUsd !== null)
	return {
		model: usage[0].model,
		effort: usage[0].effort,
		seconds: Math.max(...usage.map((run) => run.seconds)),
		assistantTurns: usage.reduce((count, run) => count + run.assistantTurns, 0),
		costUsd: charged.length ? charged.reduce((total, run) => total + run.costUsd, 0) : null,
		costPartial: charged.length !== usage.length || usage.some((run) => run.costPartial),
	}
}

const run = read('run.json')
const level = run.level
const bareNames = run.bareAgents ?? ['bare']
const checkmateNames = run.checkmateReports ?? [level]
const entries = (names) =>
	names.flatMap((name) => {
		assert(Array.isArray(decisions[name]), 'Give adjudication for ' + name)
		return decisions[name]
	})
const results = {
	bare: { ...score(entries(bareNames)), usage: teamUsage(bareNames) },
	[level]: { ...score(entries(checkmateNames)), usage: read(level + '.json') },
	[level + 'Journal']: score(decisions[level + 'Journal']),
	testers: Object.fromEntries([...bareNames, ...checkmateNames].map((name) => [name, score(decisions[name])])),
}
writeFileSync(join(folder, 'score.json'), JSON.stringify(results, null, 2) + '\n')
console.log(JSON.stringify(results, null, 2))
