import { createInterface } from 'node:readline'
import { resolve } from 'node:path'
import { actionToolDefinitions, callActionTool } from './action-tools.ts'
import { isActionTool } from './tool-names.ts'

const protocols = ['2024-11-05', '2025-03-26', '2025-06-18', '2025-11-25']

type Request = {
	jsonrpc?: string
	id?: string | number
	method?: string
	params?: { protocolVersion?: string; name?: string; arguments?: unknown }
}

export async function serveActions() {
	const env = { ...process.env, CHECKMATE_HARNESS: 'claude', CHECKMATE_HOST_SESSION: '1' }
	const workspace = resolve(process.env.CLAUDE_PROJECT_DIR ?? process.cwd())
	const tools = actionToolDefinitions(env)
	const lines = createInterface({ input: process.stdin, crlfDelay: Infinity })
	function send(id: Request['id'] | null, body: { result: unknown } | { error: { code: number; message: string } }) {
		process.stdout.write(JSON.stringify({ jsonrpc: '2.0', id, ...body }) + '\n')
	}
	let initialized = false
	for await (const line of lines) {
		let request: Request
		try {
			request = JSON.parse(line)
		} catch {
			send(null, { error: { code: -32700, message: 'Invalid JSON' } })
			continue
		}
		if (!request || request.jsonrpc !== '2.0' || typeof request.method !== 'string') {
			send(request?.id ?? null, { error: { code: -32600, message: 'Invalid JSON-RPC request' } })
			continue
		}
		const { id, params, method } = request
		if (id === undefined) continue
		if (method === 'initialize') {
			const protocolVersion = params?.protocolVersion ?? ''
			initialized = true
			send(id, {
				result: {
					protocolVersion: protocols.includes(protocolVersion) ? protocolVersion : protocols.at(-1),
					capabilities: { tools: {} },
					serverInfo: { name: 'checkmate', version: '1' },
				},
			})
		} else if (method === 'ping') send(id, { result: {} })
		else if (!initialized) send(id, { error: { code: -32002, message: 'Initialize the Checkmate server first' } })
		else if (method === 'tools/list') send(id, { result: { tools } })
		else if (method === 'tools/call') {
			const name = params?.name
			if (!name || !isActionTool(name)) {
				send(id, { error: { code: -32602, message: 'Choose a Checkmate tool from tools/list' } })
				continue
			}
			const reply = await callActionTool(name, params?.arguments ?? {}, workspace, env)
			send(id, {
				result: {
					content: [{ type: 'text', text: JSON.stringify(reply) }],
					structuredContent: reply,
					isError: ['rejected', 'invalid_request', 'operational_error'].includes(reply.status),
				},
			})
		} else send(id, { error: { code: -32601, message: 'Unknown method' } })
	}
}
