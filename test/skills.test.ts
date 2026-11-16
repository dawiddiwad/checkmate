import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { root } from './support.ts'

function description(skill: string) {
	const text = readFileSync(join(root, 'plugin/skills', skill, 'SKILL.md'), 'utf8')
	const line = /^description: (.*)$/m.exec(text.split('---')[1])
	assert(line, skill)
	return line[1]
}

const testTrigger = /\b(test|qa|check|verify|retest)\s+(a |the )?(change|ticket|build)\b/i

test('a request to test a change routes to the test skill, not to plan, execute, or revise', () => {
	const entry = description('test')
	assert.match(entry, /test, QA, check, verify, or retest a change, a ticket, or a build/)
	assert.match(entry, /acceptance criteria are in a file/)
	for (const skill of ['plan', 'execute', 'revise']) {
		const text = description(skill)
		assert.match(text, /a request to test( a change)? goes to the test skill/i, skill)
		for (const sentence of text.split(/(?<=\.)\s+/).filter((item) => !/test skill/.test(item)))
			assert.doesNotMatch(sentence, testTrigger, `${skill}: ${sentence}`)
	}
	assert.match(
		description('plan'),
		/Use only when the oracle asks for a test plan, test cases, or a review of the requirements/
	)
})

test('each skill description stays short', () => {
	for (const skill of ['test', 'plan', 'execute', 'revise', 'setup', 'status', 'report', 'ui'])
		assert(description(skill).length <= 300, skill)
})
