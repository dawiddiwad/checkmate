import type { Profile } from './types.ts'
import { spawnSync } from 'node:child_process'
import { requireCondition } from './contracts.ts'

const readPrefixes = ['read_', 'list_', 'get_', 'view_']

export function changesData(operation: string) {
	return !readPrefixes.some((prefix) => operation.startsWith(prefix))
}

export function requireResetFor(profile: Profile, operations: string[], subject: string, url: string) {
	const changing = operations.filter(changesData)
	requireCondition(
		!changing.length || profile.reset,
		`${subject} can change data (${changing.join(', ')}), and target ${profile.targetId} has no reset.`,
		`Record the reset. Give the command that restores the seed data: checkmate setup --url ${url} --reset "<command>". When the data never changes, or the factory resets it before each run: checkmate setup --url ${url} --reset factory.`
	)
}

export function runReset(workspace: string, profile: Profile) {
	const command = profile.reset?.owner === 'checkmate' ? profile.reset.command : null
	if (!command) return
	const result = spawnSync(command[0], command.slice(1), { cwd: workspace, encoding: 'utf8', timeout: 120000 })
	requireCondition(
		result.status === 0,
		`The reset ${command.join(' ')} failed${result.status === null ? ' before it finished' : ` with exit code ${result.status}`}.`,
		'Run the reset by hand and read its output. Fix it, then start the run again.'
	)
}

export function resetCommand(text: string) {
	const words = text.trim().split(/\s+/).filter(Boolean)
	requireCondition(words.length, 'The reset command is empty. Give a command, or factory.')
	return words
}
