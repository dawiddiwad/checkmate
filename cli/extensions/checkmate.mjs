import { spawn } from 'node:child_process'
import { closeSync, existsSync, mkdirSync, openSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { setTimeout as delay } from 'node:timers/promises'
import { fileURLToPath } from 'node:url'

const installedCli = new URL('../plugin/dist/checkmate.js', import.meta.url)
const repositoryCli = new URL('../../plugin/dist/checkmate.js', import.meta.url)
const sourceCli = new URL('../src/main.ts', import.meta.url)

function runningUi(workspace) {
	try {
		const { port, pid, hookToken } = JSON.parse(readFileSync(join(workspace, '.checkmate', 'ui.json'), 'utf8'))
		if (!Number.isInteger(port) || port < 1 || port > 65535) return
		if (!Number.isInteger(pid) || pid < 1 || typeof hookToken !== 'string' || !hookToken) return
		process.kill(pid, 0)
		return `http://127.0.0.1:${port}/`
	} catch {}
}

async function startUi(workspace) {
	const cli = fileURLToPath(existsSync(sourceCli) ? repositoryCli : installedCli)
	if (!existsSync(cli)) throw new Error('The Checkmate UI bundle is missing. Reinstall the Checkmate package.')
	const folder = join(workspace, '.checkmate', 'tmp')
	mkdirSync(folder, { recursive: true })
	const logPath = join(folder, 'pi-ui.log')
	const log = openSync(logPath, 'w', 0o600)
	let child
	try {
		child = spawn('node', [cli, 'ui'], {
			cwd: workspace,
			env: { ...process.env, CHECKMATE_HARNESS: 'pi' },
			detached: true,
			stdio: ['ignore', log, log],
		})
	} finally {
		closeSync(log)
	}
	let spawnError
	child.once('error', (error) => {
		spawnError = error
	})
	child.unref()
	const deadline = Date.now() + 15_000
	while (Date.now() < deadline) {
		if (spawnError) throw spawnError
		if (child.exitCode !== null || child.signalCode !== null)
			throw new Error(readFileSync(logPath, 'utf8').trim().slice(-1000) || `See ${logPath}.`)
		const address = runningUi(workspace)
		if (address) return address
		await delay(50)
	}
	child.kill()
	throw new Error(`The UI did not start within 15 seconds. See ${logPath}.`)
}

export default function checkmate(pi) {
	const starting = new Map()

	pi.registerCommand('checkmate', {
		description: 'Set up a QA target, plan or run tests, and inspect evidence',
		handler: async (args, ctx) => {
			const request = args.trim()
			if (!request) {
				ctx.ui.notify(
					'Use /checkmate <request> to start a workflow or /checkmate-ui to open the review UI.',
					'info'
				)
				return
			}
			await ctx.waitForIdle()
			pi.sendUserMessage(`/skill:checkmate ${request}`, { expandPromptTemplates: true })
		},
	})

	pi.registerCommand('checkmate-ui', {
		description: 'Open the Checkmate review UI for this workspace',
		handler: async (_args, ctx) => {
			const workspace = ctx.cwd
			try {
				let address = runningUi(workspace)
				if (!address) {
					if (!starting.has(workspace))
						starting.set(
							workspace,
							startUi(workspace).finally(() => starting.delete(workspace))
						)
					address = await starting.get(workspace)
				}
				ctx.ui.notify(`Checkmate UI: ${address}`, 'info')
			} catch (error) {
				ctx.ui.notify(`Could not start Checkmate UI. ${error.message}`, 'error')
			}
		},
	})
}
