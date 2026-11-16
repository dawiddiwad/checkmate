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

test('the test skill runs the session loop and names no removed level', () => {
	const text = readFileSync(join(root, 'plugin/skills/test/SKILL.md'), 'utf8')
	assert.doesNotMatch(text, /deep/i)
	assert.match(text, /checkmate test <planId> --source <ticket or file> --session/)
	assert.match(text, /checkmate explore next <explorationId>/)
	assert.match(text, /checkmate explore done <explorationId> <name> <step> --agent <agent id>/)
	assert.match(text, /Carry out all the actions of one `next` in one message/)
	assert.match(text, /`model` parameter of the Agent tool/)
	assert.match(text, /Set `subagent_type` to `<type>` and `description` to `<description>`/)
	assert.match(text, /--reply-line "<last line of the reply>"/)
	assert.match(text, /Do not stop to ask the person about a mistake in the agent IDs\./)
	assert.match(text, /A later build never needs a decision before the test\./)
	assert.match(text, /checkmate explore started <explorationId> <names>/)
	assert.match(text, /When the host of the URL is not local \(`localhost`, `127\.0\.0\.1`, a private address/)
	assert.match(
		text,
		/is this a test environment, staging, or production, and can testers make and change data there\?/
	)
	assert.match(text, /Do not ask when the URL is local\./)
	assert.match(text, /Add `--environment "<the answer>"` when you asked\./)
	assert.match(text, /For production, also add `--operations <a,b>`/)
	assert.match(
		text,
		/Before you ask the person anything in the middle of a run, record the pause: `checkmate explore pause/
	)
	assert.match(text, /Offer `harvest` only in the final report, as an option\./)
})
