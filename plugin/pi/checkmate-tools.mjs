import { actionToolDefinitions, callActionTool } from '../dist/checkmate.js'

export default function checkmateTools(pi) {
	const env = { ...process.env, CHECKMATE_HARNESS: 'pi', CHECKMATE_HOST_SESSION: '1' }
	for (const tool of actionToolDefinitions(env)) {
		pi.registerTool({
			name: tool.name,
			label: tool.name,
			description: tool.description,
			parameters: tool.inputSchema,
			execute: async (_id, input, _signal, _onUpdate, ctx) => {
				const reply = callActionTool(tool.name, input, ctx.cwd, env)
				return { content: [{ type: 'text', text: JSON.stringify(reply) }], details: reply }
			},
		})
	}
}
