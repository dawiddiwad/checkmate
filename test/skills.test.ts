import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { root } from './support.ts'

test('the test skill preserves remote target and production scope questions', () => {
	const text = readFileSync(join(root, 'plugin/skills/test/SKILL.md'), 'utf8')
	assert.match(
		text,
		/is this a test environment, staging, or production, and can testers make and change data there\?/
	)
	assert.match(text, /For production, also add `--operations <a,b>`/)
})

const skillNames = ['test', 'plan', 'execute', 'revise', 'setup', 'status', 'report', 'ui']
const asksForChoice = /\bask (the person|the oracle|one question|which)|\band ask\b|AskUserQuestion/i

function askSection(text: string) {
	return /\n## Ask the person\n\n([\s\S]*?)(?=\n## |\nAsk with the tool|$)/.exec(text)?.[1]
}

test('each skill that asks the person for a choice has the shared question rules with the fallback', () => {
	const asking = skillNames.filter((skill) =>
		asksForChoice.test(readFileSync(join(root, 'plugin/skills', skill, 'SKILL.md'), 'utf8'))
	)
	assert.deepEqual(asking, ['test', 'setup', 'report'])
	const sections = asking.map((skill) =>
		askSection(readFileSync(join(root, 'plugin/skills', skill, 'SKILL.md'), 'utf8'))
	)
	for (const [index, section] of sections.entries()) {
		assert(section, asking[index])
		assert.equal(section, sections[0], asking[index])
	}
	const rules = sections[0]!
	assert.match(rules, /the `AskUserQuestion` tool is in your tool list, ask with that tool\./)
	assert.match(rules, /one call with at most 4 questions and 2 to 4 options for each question/)
	assert.match(rules, /Put the recommended option first, and add "\(Recommended\)" to its label\./)
	assert.match(rules, /a header of at most 12 characters/)
	assert.match(rules, /Do not add an "Other" option\. The tool adds it\./)
	assert.match(
		rules,
		/When the tool is not in your tool list, or your task came from an agent, a factory, or a script, do not use the tool\./
	)
	assert.match(rules, /as a short numbered list, or return `needs_decision` with the reason\./)
	assert.match(rules, /An agent that is the oracle answers in text or with the CLI commands\./)
	assert.match(rules, /Do not ask for a secret\. Ask where it is kept\./)
})
