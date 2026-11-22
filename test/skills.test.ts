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

test('the test skill runs the session loop and names no removed level', () => {
	const text = readFileSync(join(root, 'plugin/skills/test/SKILL.md'), 'utf8')
	assert.doesNotMatch(text, /standard/i)
	assert.match(text, /--level smoke\|normal\|deep/)
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

test('the test skill names when to ask with the tool, and asks the first-run questions in one call', () => {
	const text = readFileSync(join(root, 'plugin/skills/test/SKILL.md'), 'utf8')
	assert.match(
		text,
		/The environment of a URL that is not local, and whether testers can make and change data there\./
	)
	assert.match(text, /The target or the instance, when more than one exists\./)
	assert.match(text, /The level, only when the person asks for a choice\./)
	assert.match(text, /for example stop, use another URL, or continue\. Record the pause first\./)
	assert.match(text, /Accept or reject of a `suspected` or `unresolved` claim, when the person asks to triage\./)
	assert.match(text, /Ask the two questions in one call, as Ask the person says\./)
	assert.match(text, /Ask only for what the message of the person does not give\./)
})
