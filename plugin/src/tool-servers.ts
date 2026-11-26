// The MCP server of a recipe of kind mcp. A host starts `checkmate tool-server`, and it starts the server of the recipe
// in the work folder, in a process group of its own. When the host closes it, it stops the group.
// The built-in Maestro target limits calls to its device and to inline flows.
import { spawn } from 'node:child_process'
import { mkdirSync } from 'node:fs'
import { join } from 'node:path'
import { createInterface } from 'node:readline'
import { signalChild, trackGroup } from './processes.ts'
import { filled, recipes, recipesFor, serverName, testerTools, type SessionValues } from './recipes.ts'

export type AttachedServer = { name: string; command: string; args: string[]; tools: string[] }

const stopGraceMilliseconds = 3000
const maestroTargetTools = ['inspect_screen', 'run', 'take_screenshot']

export function mcpTargetTools(name: string) {
	return name === 'maestro-mcp' ? maestroTargetTools : []
}

export function piServerTools(servers: AttachedServer[]) {
	return servers.flatMap(({ name, tools }) => (tools.length ? tools : [`mcp__${name}__*`]))
}

// The servers that Checkmate attaches to one tester session, one for each recipe of kind mcp that the tester uses.
// The built-in Maestro server receives the device of the target instance.
export function attachedServers(
	workspace: string,
	toolNames: string[],
	values: SessionValues,
	script: string,
	entries: Record<string, string>
): AttachedServer[] {
	return recipesFor(workspace, testerTools(workspace, toolNames, true))
		.filter((recipe) => recipe.kind === 'mcp')
		.map((recipe) => ({
			name: serverName(recipe),
			command: process.execPath,
			args: [
				script,
				'tool-server',
				recipe.name,
				values.workFolder,
				values.session,
				workspace,
				...(recipe.name === 'maestro-mcp' && entries.device ? [`device=${entries.device}`] : []),
			],
			tools: mcpTargetTools(recipe.name).map((tool) => `mcp__${serverName(recipe)}__${tool}`),
		}))
}

// Claude Code: the MCP config and allow rules for the built-in target tools. --strict-mcp-config is not given,
// because it also drops the MCP server of the plugin, which delegated workers use.
export function claudeServerArgs(servers: AttachedServer[]) {
	if (!servers.length) return []
	const config = Object.fromEntries(
		servers.map((server) => [server.name, { type: 'stdio', command: server.command, args: server.args }])
	)
	return [
		'--mcp-config',
		JSON.stringify({ mcpServers: config }),
		...servers.flatMap((server) => server.tools.flatMap((tool) => ['--allowedTools', tool])),
	]
}

// Pi: the extension tool-servers.mjs registers the servers of this environment variable with pi.registerMcpServer.
export function piServerEnv(servers: AttachedServer[]): Record<string, string> {
	if (!servers.length) return {}
	const config = Object.fromEntries(
		servers.map((server) => [server.name, { command: server.command, args: server.args, exposure: 'direct' }])
	)
	return { CHECKMATE_TOOL_SERVERS: JSON.stringify(config) }
}

export function piServerExtension(pluginRoot: string) {
	return join(pluginRoot, 'pi', 'tool-servers.mjs')
}

type Message = {
	id?: unknown
	method?: string
	params?: { name?: unknown; arguments?: Record<string, unknown> }
	result?: { tools?: unknown }
}

// Why a Maestro call cannot go to the server, or undefined. An omitted device gets the instance device.
function maestroRefusal(request: Message, device: string | undefined) {
	const tool = String(request.params?.name)
	if (!maestroTargetTools.includes(tool))
		return `The Maestro target does not allow ${tool}. Its tools are ${maestroTargetTools.join(', ')}.`
	const input = (request.params!.arguments ??= {})
	if (tool === 'run') {
		const given = ['files', 'dir'].filter((name) => input[name] !== undefined)
		if (given.length) return `The Maestro target does not allow ${given.join(' or ')} on run.`
	}
	if (device !== undefined) {
		if (input.device_id === undefined) input.device_id = device
		else if (input.device_id !== device) return `Give device_id ${device}, the device entry of the instance.`
	}
	return undefined
}

function message(line: string): Message | undefined {
	try {
		const value = JSON.parse(line)
		return typeof value === 'object' && value !== null && !Array.isArray(value) ? value : undefined
	} catch {
		return undefined
	}
}

export function serveToolServer(
	recipeName: string,
	workFolder: string,
	session: string,
	workspace: string,
	pinned: string[]
) {
	const entries = Object.fromEntries(
		pinned.map((item) => [item.slice(0, item.indexOf('=')), item.slice(item.indexOf('=') + 1)])
	)
	const recipe = recipes(workspace).find((item) => item.name === recipeName && item.kind === 'mcp')
	if (!recipe?.server || !workFolder) {
		process.stderr.write(
			`checkmate tool-server: no recipe of kind mcp is named ${recipeName}, or no work folder.\n`
		)
		process.exit(2)
	}
	const values = { session, workFolder }
	const cwd = filled(recipe.server.cwd, values)
	mkdirSync(cwd, { recursive: true })
	const environment = Object.entries(recipe.environment).map(([name, value]) => [name, filled(value, values)])
	const server = spawn(
		recipe.server.command,
		recipe.server.args.map((arg) => filled(arg, values)),
		{
			cwd,
			env: { ...process.env, ...Object.fromEntries(environment) },
			detached: true,
			stdio: ['pipe', 'pipe', 'inherit'],
		}
	)
	trackGroup(server)
	const maestro = recipe.name === 'maestro-mcp'
	const lists = new Set<unknown>()
	const send = (line: string) => process.stdout.write(`${line}\n`)
	createInterface({ input: process.stdin })
		.on('line', (line) => {
			const request = message(line)
			if (maestro && request?.method === 'tools/list') lists.add(request.id)
			if (maestro && request?.method === 'tools/call') {
				const refused = maestroRefusal(request, entries.device)
				if (refused)
					return send(
						JSON.stringify({ jsonrpc: '2.0', id: request.id, error: { code: -32602, message: refused } })
					)
				line = JSON.stringify(request)
			}
			if (server.stdin.writable) server.stdin.write(`${line}\n`)
		})
		.on('close', stop)
	createInterface({ input: server.stdout }).on('line', (line) => {
		const reply = message(line)
		if (reply && !reply.method && lists.has(reply.id) && Array.isArray(reply.result?.tools)) {
			lists.delete(reply.id)
			reply.result.tools = reply.result.tools.filter((tool: { name?: string }) =>
				maestroTargetTools.includes(tool.name ?? '')
			)
			return send(JSON.stringify(reply))
		}
		send(line)
	})
	server.stdin.on('error', () => {})
	server.on('error', (error) => {
		process.stderr.write(`checkmate tool-server: cannot start ${recipe.server!.command}: ${error.message}\n`)
		process.exit(1)
	})
	// The leader can end before the processes that it started, for example a device driver.
	server.on('exit', (code) => {
		try {
			if (server.pid) process.kill(-server.pid, 'SIGTERM')
		} catch {}
		process.exit(code ?? 0)
	})
	let stopping = false
	function stop() {
		if (stopping) return
		stopping = true
		server.stdin.end()
		signalChild(server, 'SIGTERM')
		setTimeout(() => {
			signalChild(server, 'SIGKILL')
			process.exit(0)
		}, stopGraceMilliseconds)
	}
	for (const signal of ['SIGTERM', 'SIGINT', 'SIGHUP'] as const) process.on(signal, stop)
}
