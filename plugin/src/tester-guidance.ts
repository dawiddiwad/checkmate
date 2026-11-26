import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { filled, type SessionValues } from './recipes.ts'
import { pluginRoot } from './sessions.ts'

const builtInTools = new Set(['maestro', 'maestro-mcp', 'node', 'playwright-cli'])

export function toolGuidance(names: string[], execute?: SessionValues, root = pluginRoot) {
	return names
		.filter((name) => builtInTools.has(name))
		.flatMap((name) => {
			const folder = join(root, 'references', 'tester-tools')
			const guide = readFileSync(join(folder, `${name}.md`), 'utf8').trimEnd()
			if (!execute) return [guide]
			const instruction = readFileSync(join(folder, `${name}-execute.md`), 'utf8').trimEnd()
			return [filled(instruction, execute), guide]
		})
}

export function sessionToolGuidance(names: string[], session: string) {
	return names.includes('playwright-cli')
		? [
				`Your shell does not keep settings between commands. Start each shell command with export PLAYWRIGHT_CLI_SESSION=${session}; so that your browser is your own.`,
			]
		: []
}
