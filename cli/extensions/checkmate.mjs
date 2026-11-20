import { spawn } from 'node:child_process'
import { closeSync, existsSync, mkdirSync, openSync } from 'node:fs'
import { join } from 'node:path'
import { createInterface } from 'node:readline'
import { fileURLToPath } from 'node:url'

const installedCli = new URL('../plugin/dist/checkmate.js', import.meta.url)
const repositoryCli = new URL('../../plugin/dist/checkmate.js', import.meta.url)
const sourceCli = new URL('../src/main.ts', import.meta.url)

async function runUi(workspace, stop) {
	const cli = fileURLToPath(existsSync(sourceCli) ? repositoryCli : installedCli)
	if (!existsSync(cli)) throw new Error('The Checkmate UI bundle is missing. Reinstall the Checkmate package.')
	const folder = join(workspace, '.checkmate', 'tmp')
	mkdirSync(folder, { recursive: true })
	const logPath = join(folder, 'pi-ui.log')
	const log = openSync(logPath, 'a', 0o600)
	let child
	try {
		child = spawn('node', [cli, 'ui', '--json', ...(stop ? ['--stop'] : [])], {
			cwd: workspace,
			env: { ...process.env, CHECKMATE_PI_UI: '1' },
			detached: true,
			stdio: ['ignore', 'pipe', log],
		})
	} finally {
		closeSync(log)
	}
	const lines = createInterface({ input: child.stdout })
	try {
		const result = await new Promise((resolve, reject) => {
			const timer = setTimeout(
				() => reject(new Error(`The UI command did not finish within 30 seconds. See ${logPath}.`)),
				30_000
			)
			lines.once('line', (line) => {
				clearTimeout(timer)
				resolve(line)
			})
			lines.once('close', () => {
				clearTimeout(timer)
				reject(new Error(`The UI command exited before replying. See ${logPath}.`))
			})
			child.once('error', (error) => {
				clearTimeout(timer)
				reject(error)
			})
		})
		const reply = JSON.parse(result)
		if (reply.status !== 'completed') throw new Error(reply.reasons?.join(' ') || `See ${logPath}.`)
		return reply
	} finally {
		lines.close()
		child.stdout.destroy()
		child.unref()
	}
}

export default function checkmate(pi) {
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
			if (!pi.getCommands().some((command) => command.source === 'skill' && command.name === 'skill:checkmate')) {
				ctx.ui.notify(
					'The Checkmate skill is disabled or unavailable. Enable skills in Pi or load the Checkmate skill, then try again.',
					'warning'
				)
				return
			}
			pi.sendUserMessage(`/skill:checkmate ${request}`, { expandPromptTemplates: true })
		},
	})

	pi.registerCommand('checkmate-ui', {
		description: 'Open the Checkmate review UI, or use /checkmate-ui stop to stop it',
		handler: async (args, ctx) => {
			const action = args.trim()
			if (action && action !== 'stop') {
				ctx.ui.notify('Use /checkmate-ui to open the review UI or /checkmate-ui stop to stop it.', 'warning')
				return
			}
			try {
				const reply = await runUi(ctx.cwd, action === 'stop')
				if (action === 'stop') {
					ctx.ui.notify(
						reply.stopped ? 'Stopped the Checkmate UI.' : 'The Checkmate UI is already stopped.',
						'info'
					)
					return
				}
				const harness = reply.harness === 'pi' ? 'Pi' : 'Claude Code'
				const settings =
					reply.harness === 'claude' ? ` Change the saved choice at ${reply.url}settings/harness.` : ''
				ctx.ui.notify(`Checkmate UI: ${reply.url} Coding harness: ${harness}.${settings}`, 'info')
			} catch (error) {
				ctx.ui.notify(
					`Could not ${action === 'stop' ? 'stop' : 'open'} the Checkmate UI. ${error.message}`,
					'error'
				)
			}
		},
	})
}
