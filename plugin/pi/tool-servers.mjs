// Registers the MCP servers that Checkmate attaches to this tester session. Each one is `checkmate tool-server`.
export default function toolServers(pi) {
	let servers = {}
	try {
		servers = JSON.parse(process.env.CHECKMATE_TOOL_SERVERS ?? '{}')
	} catch {}
	for (const [name, config] of Object.entries(servers)) pi.registerMcpServer(name, config)
}
