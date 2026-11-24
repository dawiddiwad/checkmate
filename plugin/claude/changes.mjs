import { execFileSync } from 'node:child_process'

// After each Checkmate command in a chat turn, give the model what this turn has saved so far.
// Claude Code adds the output to the context before the model writes its reply.
// The list comes from the record, not from the model. The checkmate command path is the first argument.
const cli = process.argv[2]
let input = ''
process.stdin.on('data', (chunk) => {
	input += chunk
})
process.stdin.on('end', () => {
	let command
	try {
		command = JSON.parse(input).tool_input?.command
	} catch {
		return
	}
	if (!cli || typeof command !== 'string' || !command.includes(cli)) return
	let text
	try {
		text = execFileSync(process.execPath, [cli, 'chat', 'changes'], {
			env: process.env,
			encoding: 'utf8',
			timeout: 20_000,
			stdio: ['ignore', 'pipe', 'ignore'],
		})
	} catch {
		return
	}
	const saved = text
		.split('\n')
		.filter((line) => line.startsWith('- '))
		.join('\n')
	if (!saved) return
	process.stdout.write(
		JSON.stringify({
			hookSpecificOutput: {
				hookEventName: 'PostToolUse',
				additionalContext: `Saved in this turn so far, from the record:\n${saved}`,
			},
		})
	)
})
