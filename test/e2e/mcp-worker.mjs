#!/usr/bin/env node
// A Claude Code stand-in for a delegated execute worker that uses the MCP server of its --mcp-config, as Claude does.
// It lists the tools, tries a tool that the recipe does not name, takes a screenshot in a flow, records the check with
// that file as evidence, and exits without closing the server, as a host that ends abruptly.
import { appendFileSync, readFileSync } from 'node:fs'
import { execFileSync, spawn } from 'node:child_process'
import { createInterface } from 'node:readline'

const args = process.argv.slice(2)
const after = (flag) => (args.includes(flag) ? args[args.indexOf(flag) + 1] : undefined)
const prompt = readFileSync(0, 'utf8')
const log = (value) => appendFileSync(process.env.FAKE_WORKER_LOG, JSON.stringify(value) + '\n')
const allowed = args.flatMap((arg, index) => (args[index - 1] === '--allowedTools' ? [arg] : []))
log({ prompt, allowed, mcpConfig: after('--mcp-config') ?? null, strict: args.includes('--strict-mcp-config') })
const finish = () => {
	console.log(
		JSON.stringify({
			type: 'result',
			subtype: 'success',
			structured_output: { status: 'completed', subject: 'run-1', reasons: [] },
		})
	)
	process.exit(0)
}
const config = JSON.parse(after('--mcp-config') ?? '{"mcpServers":{}}').mcpServers.maestro_mcp
if (!config || prompt.includes('exploration probe')) finish()
const server = spawn(config.command, config.args, { stdio: ['pipe', 'pipe', 'inherit'] })
const waiting = new Map()
createInterface({ input: server.stdout }).on('line', (line) => {
	const reply = JSON.parse(line)
	waiting.get(reply.id)?.(reply)
})
let id = 0
const call = (method, params) =>
	new Promise((resolve) => {
		id++
		waiting.set(id, resolve)
		server.stdin.write(JSON.stringify({ jsonrpc: '2.0', id, method, params }) + '\n')
	})
await call('initialize', {
	protocolVersion: '2025-06-18',
	capabilities: {},
	clientInfo: { name: 'fake', version: '1' },
})
server.stdin.write(JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized' }) + '\n')
const listed = (await call('tools/list', {})).result.tools.map((tool) => tool.name)
const device = /device: (\S+)\./.exec(prompt)?.[1] ?? 'emulator-5554'
const cloud = await call('tools/call', { name: 'run_on_cloud', arguments: { device_id: device } })
const yaml = 'appId: com.example.shop\n---\n- launchApp\n- takeScreenshot: T1-A1\n'
const folder = await call('tools/call', { name: 'run', arguments: { device_id: device, dir: '/' } })
const other = await call('tools/call', { name: 'run', arguments: { device_id: 'another-simulator', yaml } })
const run = await call('tools/call', { name: 'run', arguments: { device_id: device, yaml } })
await call('tools/call', { name: 'inspect_screen', arguments: {} })
log({
	listed,
	cloud: cloud.error?.message ?? null,
	folder: folder.error?.message ?? null,
	other: other.error?.message ?? null,
	run: run.result?.content?.[0]?.text ?? null,
})
const work = config.args[3].slice(config.args[3].indexOf('.checkmate/'))
const cli = (more) => {
	try {
		execFileSync(process.execPath, [process.env.FAKE_CHECKMATE_CLI, ...more], { encoding: 'utf8', stdio: 'pipe' })
	} catch (error) {
		log({ failed: more, output: `${error.stdout}${error.stderr}` })
		throw error
	}
}
cli(['run', 'check', 'run-1', 'T1', 'A1', '--observed', 'on', '--evidence', `${work}/T1-A1.png:screenshot`])
cli(['run', 'close', 'run-1', 'T1'])
finish()
