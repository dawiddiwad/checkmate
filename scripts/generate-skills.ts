// Generates the skill files in plugin/skills/ from the templates in scripts/skills/.
// A template names an action tool as {{tool <action>}}. The build writes the tool name that the host calls.
// The action must be in the list below, so TypeScript fails when the action is renamed or removed.
import { readFile, writeFile } from 'node:fs/promises'
import assert from 'node:assert/strict'
import { toolName, type ActionName } from '../plugin/src/actions.ts'

const tools: ActionName[] = ['tester_step_done']
const skills = ['test']

for (const skill of skills) {
	const template = await readFile(new URL(`skills/${skill}/SKILL.md`, import.meta.url), 'utf8')
	const text = template.replace(/\{\{tool (\w+)\}\}/g, (_, name: string) => {
		assert(tools.includes(name as ActionName), `${skill} skill names unknown tool ${name}`)
		return toolName(name as ActionName)
	})
	assert.doesNotMatch(text, /\{\{/, `${skill} skill has a placeholder that is not filled`)
	const output = new URL(`../plugin/skills/${skill}/SKILL.md`, import.meta.url)
	if (process.argv.includes('--check'))
		assert.equal(await readFile(output, 'utf8').catch(() => ''), text, 'Run npm run build')
	else await writeFile(output, text)
}
