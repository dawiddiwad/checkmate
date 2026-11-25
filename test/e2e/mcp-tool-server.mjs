#!/usr/bin/env node
// A device-free stand-in for `maestro mcp --no-viewer`. It logs how it started, keeps a child in its process group like
// the iOS driver, offers the tools of Maestro 2.12.1, and writes a takeScreenshot file in its working directory.
// With the argument other, it is an unrelated server of the user with one tool.
import { appendFileSync, writeFileSync } from 'node:fs'
import { execFileSync, spawn } from 'node:child_process'
import { createInterface } from 'node:readline'

const log = (value) => appendFileSync(process.env.FIXTURE_MCP_LOG, JSON.stringify(value) + '\n')
const other = process.argv[2] === 'other'
const driver = spawn(process.execPath, ['-e', 'setInterval(() => {}, 1000)'], { stdio: 'ignore' })
const group = Number(execFileSync('ps', ['-o', 'pgid=', '-p', String(process.pid)], { encoding: 'utf8' }).trim())
const env = Object.fromEntries(
	Object.entries(process.env).filter(([name]) => name.startsWith('MAESTRO_') || name === 'XDG_STATE_HOME')
)
log({ started: { args: process.argv.slice(2), cwd: process.cwd(), pid: process.pid, group, driver: driver.pid, env } })
const names = other
	? ['other_tool']
	: [
			'list_devices',
			'take_screenshot',
			'run',
			'inspect_screen',
			'cheat_sheet',
			'open_maestro_viewer',
			'list_cloud_devices',
			'run_on_cloud',
			'get_cloud_run_status',
			'describe_cloud_run',
		]
const tools = names.map((name) => ({
	name,
	description: `Fixture ${name}.`,
	inputSchema: { type: 'object', properties: { device_id: { type: 'string' }, yaml: { type: 'string' } } },
}))
const screen = {
	elements: [{ a11y: 'Character Preview', rid: 'preview', b: '[300,370][360,410]', val: '1', checked: true }],
}
const send = (value) => process.stdout.write(JSON.stringify({ jsonrpc: '2.0', ...value }) + '\n')
createInterface({ input: process.stdin }).on('line', (line) => {
	const request = JSON.parse(line)
	if (request.id === undefined) return
	if (request.method === 'initialize')
		return send({
			id: request.id,
			result: {
				protocolVersion: request.params.protocolVersion,
				capabilities: { tools: {} },
				serverInfo: { name: other ? 'other' : 'maestro', version: '2.12.1' },
			},
		})
	if (request.method === 'tools/list') return send({ id: request.id, result: { tools } })
	if (request.method === 'tools/call') {
		const { name, arguments: input = {} } = request.params
		log({ call: name, arguments: input })
		const shot = /takeScreenshot: (\S+)/.exec(input.yaml ?? '')
		if (shot) writeFileSync(`${shot[1]}.png`, Buffer.from('89504e470d0a1a0a', 'hex'))
		const text = name === 'inspect_screen' ? JSON.stringify(screen) : JSON.stringify({ success: true, tool: name })
		return send({ id: request.id, result: { content: [{ type: 'text', text }] } })
	}
	send({ id: request.id, error: { code: -32601, message: `Unknown method ${request.method}` } })
})
