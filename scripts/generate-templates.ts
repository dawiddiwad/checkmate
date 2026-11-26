// Generates plugin files from the templates in scripts/templates/. A template has the path of the file that it makes,
// for example scripts/templates/plugin/skills/test/SKILL.md makes plugin/skills/test/SKILL.md.
// A template names an action tool as {{tool <action>}}. The build writes the tool name that the host calls.
// The action must be in the list below, so TypeScript fails when the action is renamed or removed.
// A template names an input field of a tool as {{field <action>.<field>}}. The build fails when the action schema has no such field.
import { readdir, readFile, writeFile } from 'node:fs/promises'
import assert from 'node:assert/strict'
import type { Actions } from '../plugin/src/types.ts'
import { toolName } from '../plugin/src/tool-names.ts'
import { requiredRecipeFields } from '../plugin/src/recipes.ts'

const tools: Array<keyof Actions> = [
	'answer_gap',
	'begin_run',
	'delegate_work',
	'follow_test',
	'inbox',
	'list_targets',
	'next_tester_steps',
	'open_plan',
	'pause_test',
	'read_run',
	'replace_instance',
	'resume_run',
	'setup',
	'start_test',
	'status',
	'test_status',
	'tester_step_done',
	'tester_steps_started',
]

const actions = JSON.parse(await readFile(new URL('../plugin/contracts/actions.schema.json', import.meta.url), 'utf8'))
	.properties as Record<string, { properties?: Record<string, unknown> }>

const templates = new URL('templates/', import.meta.url)
for (const path of (await readdir(templates, { recursive: true })).filter((path) => path.endsWith('.md')).sort()) {
	const template = await readFile(new URL(path, templates), 'utf8')
	const text = template
		.replaceAll('{{recipe-fields}}', requiredRecipeFields.map((field) => '`' + field + '`').join(', '))
		.replace(/\{\{tool (\w+)\}\}/g, (_, name: string) => {
			assert(tools.includes(name as keyof Actions), `${path} names unknown tool ${name}`)
			return toolName(name as keyof Actions)
		})
		.replace(/\{\{field (\w+)\.(\w+)\}\}/g, (_, name: string, field: string) => {
			assert(actions[name]?.properties?.[field], `${path} names field ${field}, which ${name} does not have`)
			return field
		})
	assert.doesNotMatch(text, /\{\{/, `${path} has a placeholder that is not filled`)
	const output = new URL(`../${path}`, import.meta.url)
	if (process.argv.includes('--check'))
		assert.equal(await readFile(output, 'utf8').catch(() => ''), text, `${path} is stale. Run npm run build`)
	else await writeFile(output, text)
}
