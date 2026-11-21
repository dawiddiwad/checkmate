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
	let falseReports = 0
	let additional = 0
	let duplicates = 0
	for (const { outcome, id, artifact, evidence, observedInArm } of entries) {
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
		falseReports,
		additional,
		duplicates,
	}
}

const results = {
	bare: { ...score(decisions.bare), usage: read('bare.json') },
	smoke: { ...score(decisions.smoke), usage: read('smoke.json') },
	smokeJournal: score(decisions.smokeJournal),
}
writeFileSync(join(folder, 'score.json'), JSON.stringify(results, null, 2) + '\n')
console.log(JSON.stringify(results, null, 2))
