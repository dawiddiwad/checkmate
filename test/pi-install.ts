import assert from 'node:assert/strict'
import { execFileSync, spawn } from 'node:child_process'
import { cpSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { createServer } from 'node:http'
import { dirname, join } from 'node:path'
import { createInterface } from 'node:readline'
import { once } from 'node:events'
import { test } from 'node:test'
import type { TestContext } from 'node:test'
import { setTimeout as delay } from 'node:timers/promises'
import { running } from '../plugin/src/sessions.ts'
import { closeStore, openStore } from '../plugin/src/store.ts'
import { saveWorkspaceHarness } from '../plugin/src/settings.ts'
import { directory, root } from './support.ts'

test('Pi installs Checkmate from git and opens its UI in a clean workspace', { timeout: 90_000 }, async (t) => {
	const base = directory(t)
	const repository = join(base, 'repository')
	const workspace = directory(t)
	const home = join(base, 'home')
	mkdirSync(repository)
	mkdirSync(home)
	const files = execFileSync('git', ['ls-files', '-z'], { cwd: root }).toString().split('\0').filter(Boolean)
	for (const file of files) {
		const source = join(root, file)
		if (!existsSync(source)) continue
		const destination = join(repository, file)
		mkdirSync(dirname(destination), { recursive: true })
		cpSync(source, destination)
	}
	const git = (...args: string[]) => execFileSync('git', args, { cwd: repository, stdio: 'pipe' })
	git('init', '-qb', 'fixture')
	git('add', '.')
	git('-c', 'user.name=Test', '-c', 'user.email=test@example.com', 'commit', '-qm', 'fixture')
	const wrapper = join(base, 'bin')
	mkdirSync(wrapper)
	writeFileSync(
		join(wrapper, 'node'),
		`#!/bin/sh
case "$1:$2" in
	*/plugin/dist/checkmate.js:ui) printf '%s\n' "$$" >> "${join(base, 'ui-pids')}" ;;
esac
exec "${process.execPath}" "$@"
`,
		{ mode: 0o700 }
	)
	const env = {
		PATH: `${wrapper}:${process.env.PATH}`,
		CHECKMATE_HARNESS: 'claude',
		HOME: home,
		PI_CODING_AGENT_DIR: join(home, 'agent'),
		PI_OFFLINE: '1',
		PI_TELEMETRY: '0',
		npm_config_cache: join(base, 'npm-cache'),
		npm_config_offline: 'true',
		GIT_CONFIG_GLOBAL: join(home, 'gitconfig'),
	}
	execFileSync(
		'git',
		['config', '--global', `url.file://${repository}.insteadOf`, 'https://github.com/checkmate-fixture/checkmate'],
		{ env }
	)
	execFileSync('pi', ['install', 'git:github.com/checkmate-fixture/checkmate@fixture'], {
		cwd: workspace,
		env,
		timeout: 60_000,
		stdio: 'pipe',
	})
	const server = createServer(async (request, response) => {
		let body = ''
		for await (const chunk of request) body += chunk
		modelRequest(JSON.parse(body))
		response.writeHead(200, { 'Content-Type': 'text/event-stream' })
		response.write(
			`data: ${JSON.stringify({ id: 'fixture', object: 'chat.completion.chunk', model: 'fixture', choices: [{ index: 0, delta: { role: 'assistant', content: 'Done.' }, finish_reason: null }] })}\n\n`
		)
		response.write(
			`data: ${JSON.stringify({ id: 'fixture', object: 'chat.completion.chunk', model: 'fixture', choices: [{ index: 0, delta: {}, finish_reason: 'stop' }] })}\n\n`
		)
		response.end('data: [DONE]\n\n')
	})
	let modelRequest: (value: unknown) => void = () => {}
	const requested = new Promise<unknown>((resolve) => {
		modelRequest = resolve
	})
	server.listen(0, '127.0.0.1')
	await once(server, 'listening')
	t.after(() => server.close())
	const address = server.address()
	assert.ok(address && typeof address !== 'string')
	mkdirSync(env.PI_CODING_AGENT_DIR, { recursive: true })
	writeFileSync(
		join(env.PI_CODING_AGENT_DIR, 'models.json'),
		JSON.stringify({
			providers: {
				localfixture: {
					baseUrl: `http://127.0.0.1:${address.port}/v1`,
					api: 'openai-completions',
					apiKey: 'fixture',
					models: [{ id: 'fixture' }],
				},
			},
		})
	)
	const { pi, send, wait, notify, openUi } = rpc(t, workspace, env)
	send({ id: 'commands', type: 'get_commands' })
	const reply = await wait((event) => event.id === 'commands')
	assert.equal(reply.success, true)
	const commands = (reply.data as { commands: Array<{ name: string }> }).commands.map((command) => command.name)
	assert.ok(commands.includes('checkmate-ui'))
	assert.ok(commands.includes('checkmate'))
	assert.ok(commands.includes('skill:checkmate'))
	send({ id: 'request', type: 'prompt', message: '/checkmate inspect the checkout fixture' })
	assert.equal((await wait((event) => event.id === 'request')).success, true)
	const modelInput = JSON.stringify(
		await Promise.race([
			requested,
			new Promise((_, reject) => {
				setTimeout(() => reject(new Error('Pi did not call the fixture provider')), 10_000).unref()
			}),
		])
	)
	assert.match(modelInput, /inspect the checkout fixture/)
	assert.match(modelInput, /Run `target list` and `plan list`/)
	const wrongServer = createServer((_request, response) => response.end('{"harness":"pi"}'))
	t.after(() => wrongServer.close())
	wrongServer.listen(0, '127.0.0.1')
	await once(wrongServer, 'listening')
	const wrongAddress = wrongServer.address()
	assert.ok(wrongAddress && typeof wrongAddress !== 'string')
	const markerPath = join(workspace, '.checkmate', 'ui.json')
	mkdirSync(dirname(markerPath), { recursive: true })
	writeFileSync(markerPath, JSON.stringify({ port: wrongAddress.port, pid: process.pid, hookToken: 'fake' }))
	for (const command of ['/checkmate-ui', '/checkmate-ui stop']) {
		const message = await notify(command)
		assert.match(message, /could not verify/i)
		assert.ok(!message.includes(`127.0.0.1:${wrongAddress.port}`))
	}
	assert.equal((await fetch(`http://127.0.0.1:${wrongAddress.port}`)).status, 200)
	wrongServer.close()
	await once(wrongServer, 'close')

	const sessions = Array.from({ length: 3 }, () => rpc(t, workspace, env))
	await Promise.all(
		sessions.map(async (session) => {
			session.send({ id: 'commands', type: 'get_commands' })
			assert.equal((await session.wait((event) => event.id === 'commands')).success, true)
		})
	)
	const urls = await Promise.all([openUi(), ...sessions.map((session) => session.openUi())])
	const url = urls[0]
	assert.deepEqual(
		urls,
		urls.map(() => url)
	)
	const pid = JSON.parse(readFileSync(markerPath, 'utf8')).pid
	const pidLog = join(base, 'ui-pids')
	const children = readFileSync(pidLog, 'utf8').trim().split('\n').map(Number).slice(-urls.length)
	assert.ok(children.includes(pid))
	const deadline = Date.now() + 5000
	while (children.some((child) => child !== pid && running(child))) {
		assert.ok(Date.now() < deadline, 'More than one UI command process remained alive after cold start')
		await delay(50)
	}
	assert.equal(await openUi(), url)
	const page = await fetch(url)
	assert.equal(page.status, 200)
	const html = await page.text()
	const assets = [...html.matchAll(/(?:href|src)="([^"]+\.(?:css|js)(?:\?[^"]*)?)"/g)].map((match) => match[1])
	assert.ok(assets.some((asset) => asset.includes('.css')))
	assert.ok(assets.some((asset) => asset.includes('.js')))
	for (const asset of assets) {
		assert.equal((await fetch(new URL(asset, url))).status, 200, asset)
	}
	const settings = await (await fetch(new URL('/settings/harness', url))).text()
	assert.match(settings, /value="pi"[^>]*selected/)
	pi.stdin.end()
	await once(pi, 'exit')
	assert.equal((await fetch(url)).status, 200)
	const noSkills = rpc(t, workspace, env, '--no-skills')
	assert.match(await noSkills.notify('/checkmate inspect the fixture'), /skill is disabled/i)
	noSkills.send({ id: 'messages', type: 'get_messages' })
	assert.deepEqual((await noSkills.wait((event) => event.id === 'messages')).data, { messages: [] })
	assert.match(await noSkills.notify('/checkmate-ui stop'), /stopped/i)
	assert.equal(existsSync(markerPath), false)
	await assert.rejects(fetch(url), { name: 'TypeError' })

	const cli = join(root, 'plugin', 'dist', 'checkmate.js')
	const manual = spawn(process.execPath, [cli, 'ui', '--json'], { cwd: workspace, env })
	t.after(() => manual.kill())
	const manualLines = createInterface({ input: manual.stdout })
	const [line] = await once(manualLines, 'line')
	const manualUrl = JSON.parse(line).url
	const getHarness = async () => await (await fetch(new URL('/settings/harness', manualUrl))).text()
	assert.match(await getHarness(), /value="claude"[^>]*selected/)
	assert.equal(await noSkills.openUi(), manualUrl)
	assert.match(await getHarness(), /value="pi"[^>]*selected/)
	const store = openStore(workspace)
	try {
		assert.equal(store.db.prepare("SELECT value FROM workspace_settings WHERE name = 'harness'").get(), undefined)
		saveWorkspaceHarness(store, 'qa-lead', 'claude')
	} finally {
		closeStore(store)
	}
	assert.match(await noSkills.notify('/checkmate-ui'), /Coding harness: Claude Code.*settings\/harness/)
	assert.match(await getHarness(), /value="claude"[^>]*selected/)
	assert.throws(
		() => execFileSync(process.execPath, [cli, 'ui', '--json'], { cwd: workspace, env, stdio: 'pipe' }),
		(error: { status: number; stdout: Buffer }) => {
			assert.equal(error.status, 1)
			const reply = JSON.parse(error.stdout.toString())
			assert.equal(reply.status, 'rejected')
			assert.ok(reply.reasons.some((reason: string) => reason.includes(manualUrl)))
			return true
		}
	)
	const exited = once(manual, 'exit')
	const stopped = execFileSync(process.execPath, [cli, 'ui', '--stop', '--json'], { cwd: workspace, env })
	assert.equal(JSON.parse(stopped.toString()).stopped, true)
	await exited
})

function rpc(t: TestContext, workspace: string, env: NodeJS.ProcessEnv, ...flags: string[]) {
	const pi = spawn(
		'pi',
		['--mode', 'rpc', '--no-session', '--provider', 'localfixture', '--model', 'fixture', ...flags],
		{
			cwd: workspace,
			env,
			stdio: 'pipe',
		}
	)
	t.after(() => pi.kill())
	let stderr = ''
	pi.stderr.on('data', (chunk) => {
		stderr += chunk
	})
	const lines = createInterface({ input: pi.stdout })
	const events: Record<string, unknown>[] = []
	let wake: (() => void) | undefined
	lines.on('line', (line) => {
		try {
			const event = JSON.parse(line)
			if (event.type === 'response' || event.type === 'extension_ui_request') {
				events.push(event)
				wake?.()
			}
		} catch {
			// Pi can emit startup diagnostics before the RPC stream.
		}
	})
	const send = (value: object) => pi.stdin.write(JSON.stringify(value) + '\n')
	const wait = async (predicate: (event: Record<string, unknown>) => boolean) => {
		const deadline = Date.now() + 30_000
		while (true) {
			const index = events.findIndex(predicate)
			if (index >= 0) return events.splice(index, 1)[0]
			assert.ok(Date.now() < deadline, `Timed out waiting for Pi RPC response. stderr: ${stderr}`)
			await new Promise<void>((resolve) => {
				const timer = setTimeout(resolve, Math.min(1000, deadline - Date.now()))
				wake = () => {
					clearTimeout(timer)
					resolve()
				}
			})
			wake = undefined
		}
	}
	let request = 0
	const notify = async (message: string) => {
		const id = `notify-${++request}`
		send({ id, type: 'prompt', message })
		const response = await wait((event) => event.id === id)
		assert.equal(response.success, true)
		const notification = await wait((event) => event.type === 'extension_ui_request' && event.method === 'notify')
		return String(notification.message)
	}
	const openUi = async () => {
		const message = await notify('/checkmate-ui')
		const url = message.match(/http:\/\/127\.0\.0\.1:\d+\//)?.[0]
		assert.ok(url, message)
		assert.match(message, /Coding harness: Pi/)
		return url
	}
	return { pi, send, wait, notify, openUi }
}
