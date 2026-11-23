import { execFileSync } from 'node:child_process'

// After each Checkmate command in a chat turn, add what this turn has saved so far to the tool result.
// The model reads the result before it writes its reply. The list comes from the record, not the model.
function chatCli() {
	let hook
	try {
		hook = JSON.parse(process.env.CHECKMATE_PI_HOOK || '')
	} catch {
		return undefined
	}
	return hook?.chat === true && Array.isArray(hook.clis) && typeof hook.clis[0] === 'string'
		? hook.clis[0]
		: undefined
}

export default function (pi) {
	pi.on('tool_result', (event) => {
		if (event.toolName !== 'bash') return
		const cli = chatCli()
		const command = event.input?.command
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
			.filter((line) => /^(Saved this turn|- )/.test(line))
			.join('\n')
		if (!saved) return
		return { content: [...event.content, { type: 'text', text: `\n${saved}` }] }
	})
}
