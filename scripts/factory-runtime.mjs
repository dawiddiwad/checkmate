import assert from 'node:assert/strict'
import { spawn, spawnSync } from 'node:child_process'
import { closeSync, existsSync, mkdirSync, openSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { setTimeout as pause } from 'node:timers/promises'
import { planQuestions } from '../plugin/src/journal.ts'
import { discoverModelCatalog } from '../plugin/src/model-catalog.ts'
import { executableOnPath } from '../plugin/src/sessions.ts'
import { saveModels } from '../plugin/src/settings.ts'
import { closeStore, openReadOnlyStore, openStore } from '../plugin/src/store.ts'
import { claimEvidence as readClaimEvidence } from '../plugin/src/views.ts'

const checkmate = fileURLToPath(new URL('../plugin/bin/checkmate.ts', import.meta.url))
const toolDirectory = fileURLToPath(new URL('../node_modules/.bin', import.meta.url))
const node = process.execPath

export function hostEnvironment(campaign) {
	const env = Object.fromEntries(
		Object.entries(process.env).filter(
			([name]) =>
				!/^(CHECKMATE_|ACTIONS_|GH_|GITHUB_|RUNNER_|FACTORY_|NODE_AUTH_TOKEN$|NPM_TOKEN$|GIT_(DIR|WORK_TREE|INDEX_FILE)$|NODE_OPTIONS$)/.test(
					name
				) || name === 'CHECKMATE_BROWSER_EXECUTABLE'
		)
	)
	return {
		...env,
		CHECKMATE_HARNESS: 'pi',
		CHECKMATE_ACTOR: 'factory',
		PATH: [env.PATH, toolDirectory].filter(Boolean).join(':'),
		PI_CODING_AGENT_SESSION_DIR: join(campaign, 'logs', 'pi-sessions'),
	}
}

function tail(path) {
	return readFileSync(path, 'utf8').trim().slice(-2000)
}

function signalGroup(child, signal) {
	if (!child.pid) return
	try {
		process.kill(-child.pid, signal)
	} catch (error) {
		if (error.code !== 'ESRCH') throw error
	}
}

function job(file, args, cwd, env, stdout, stderr) {
	const out = openSync(stdout, 'w', 0o600)
	try {
		const err = openSync(stderr, 'w', 0o600)
		try {
			const child = spawn(file, args, { cwd, env, detached: true, stdio: ['ignore', out, err] })
			let ended = false
			const result = new Promise((resolve) => {
				child.once('error', (error) => {
					ended = true
					resolve({ error })
				})
				child.once('exit', (code, signal) => {
					ended = true
					resolve({ code, signal })
				})
			})
			return {
				result,
				ended: () => ended,
				async stop() {
					if (ended) return
					signalGroup(child, 'SIGTERM')
					const timer = setTimeout(() => signalGroup(child, 'SIGKILL'), 2000)
					try {
						await result
					} finally {
						clearTimeout(timer)
					}
				},
			}
		} finally {
			closeSync(err)
		}
	} finally {
		closeSync(out)
	}
}

function reply(output) {
	let parsed
	try {
		parsed = JSON.parse(output.trim())
	} catch {
		throw new Error('Checkmate returned no JSON receipt')
	}
	return parsed
}

function roleReply(output, role, model, requireJson) {
	let latest
	for (const line of output.split('\n')) {
		if (!line.startsWith('{')) continue
		let event
		try {
			event = JSON.parse(line)
		} catch {
			continue
		}
		if (event.type === 'message_end' && event.message?.role === 'assistant') latest = event.message
	}
	assert(
		latest && latest.stopReason === 'stop',
		role + ' did not finish: ' + (latest?.errorMessage ?? latest?.stopReason ?? 'no reply')
	)
	assert(latest.provider + '/' + latest.model === model, role + ' used a different model than requested')
	const text = latest.content
		.filter((block) => block.type === 'text')
		.map((block) => block.text)
		.join('\n')
		.trim()
	assert(text, role + ' did not reply')
	return requireJson ? JSON.parse(text.replace(/^\x60\x60\x60(?:json)?\s*|\s*\x60\x60\x60$/g, '')) : text
}

export function createRuntime(directory, config) {
	const records = join(directory, 'records')
	const logs = join(directory, 'logs')
	mkdirSync(logs, { recursive: true, mode: 0o700 })
	const env = hostEnvironment(directory)
	const buildEnv = Object.fromEntries(
		Object.entries(env).filter(
			([name]) => !/^(PI_CODING_AGENT_|OPENAI_|OPENROUTER_|ANTHROPIC_|CODEX_ACCESS_TOKEN$)/.test(name)
		)
	)
	const jobs = new Set()
	let cancelled = false

	const stop = () => {
		cancelled = true
		for (const running of jobs) void running.stop()
	}

	const abort = () => {
		if (cancelled) throw new Error('Factory interrupted')
	}

	async function logged(file, args, cwd, name, selectedEnv = buildEnv) {
		abort()
		const stdout = join(logs, name + '.out')
		const stderr = join(logs, name + '.err')
		const running = job(file, args, cwd, selectedEnv, stdout, stderr)
		jobs.add(running)
		let timedOut = false
		const timer = setTimeout(() => {
			timedOut = true
			void running.stop()
		}, config.timeoutSeconds * 1000)
		try {
			const result = await running.result
			abort()
			return { ...result, stdout, stderr, timedOut }
		} finally {
			clearTimeout(timer)
			jobs.delete(running)
		}
	}

	function failure(output, fallback) {
		if (output.timedOut) return `Timed out after ${config.timeoutSeconds} seconds.`
		if (output.signal) return 'Stopped by ' + output.signal + '.'
		return output.error?.message ?? (tail(output.stderr) || fallback)
	}

	async function run(file, args, cwd, name, context) {
		const output = await logged(file, args, cwd, name, context && { ...buildEnv, ...context })
		if (output.code !== 0)
			throw new Error(`${name} failed. See ${output.stderr}. ${failure(output, tail(output.stdout))}`)
		return output
	}

	function git(cwd, ...args) {
		const result = spawnSync('git', args, {
			cwd,
			env: buildEnv,
			encoding: 'utf8',
			timeout: 60_000,
			maxBuffer: 4 * 1024 * 1024,
		})
		if (result.status !== 0)
			throw new Error('git ' + args[0] + ' failed: ' + (result.error?.message ?? result.stderr.trim()))
		return result.stdout.trim()
	}

	function cm(args, { input, actor, allowFailure = false } = {}) {
		const result = spawnSync(
			node,
			[checkmate, ...args, '--workspace', records, ...(actor ? ['--actor', actor] : []), '--json'],
			{
				cwd: records,
				env,
				encoding: 'utf8',
				input: input === undefined ? undefined : JSON.stringify(input),
				timeout: 60_000,
				maxBuffer: 16 * 1024 * 1024,
			}
		)
		if (result.error) throw result.error
		const data = reply(result.stdout)
		if (!allowFailure && data.status !== 'completed')
			throw new Error('Checkmate ' + args.slice(0, 2).join(' ') + ' failed: ' + (data.reasons ?? []).join(' '))
		return data
	}

	async function models() {
		const catalog = await discoverModelCatalog('pi', records, env, true)
		for (const name of ['oracle', 'factory', 'qa']) {
			const settings = config[name]
			const model = catalog.models.find((option) => option.value === settings.model)
			assert(model, name + '.model is unavailable in Pi: ' + settings.model)
			assert(
				!settings.effort || model.effortLevels?.includes(settings.effort),
				name + '.effort is unsupported for ' + settings.model + ': ' + settings.effort
			)
		}
		const store = openStore(records)
		try {
			const saved = saveModels(store, 'factory', 'pi', '', config.qa.model, undefined, config.qa.effort)
			assert.equal(saved.status, 'completed', 'Could not save QA model settings')
		} finally {
			closeStore(store)
		}
	}

	function claimEvidence(plan, claims) {
		const store = openReadOnlyStore(records)
		try {
			return claims.map((claim) => ({
				...claim,
				excerpts: claim.evidence.slice(0, 2).flatMap((item, index) => {
					if (item.size > 128 * 1024 || !/\.(txt|md|json|csv|log)$/i.test(item.path)) return []
					const evidence = readClaimEvidence(store, plan, claim.id, index)
					return [{ name: evidence.name, text: Buffer.from(evidence.bytes).toString('utf8', 0, 2000) }]
				}),
			}))
		} finally {
			closeStore(store)
		}
	}

	function explorationQuestions(plan, explorationId) {
		const store = openReadOnlyStore(records)
		try {
			return planQuestions(store, plan)
				.filter((item) => item.explorationId === explorationId)
				.map(({ id, question, answer }) => ({ id, question, answer }))
		} finally {
			closeStore(store)
		}
	}

	async function role(name, cwd, label, prompt) {
		const settings = config[name]
		const tools = name === 'oracle' ? '+read,+grep,+find,+ls' : '+read,+grep,+find,+ls,+bash,+write,+edit'
		const output = await logged(
			'pi',
			[
				'-p',
				'--mode',
				'json',
				'--no-session',
				'--no-skills',
				'--no-extensions',
				'--no-mcp',
				'--no-prompt-templates',
				'--no-tools',
				'--tools',
				tools,
				'--model',
				settings.model,
				...(settings.effort ? ['--thinking', settings.effort] : []),
				prompt,
			],
			cwd,
			label,
			env
		)
		if (output.code !== 0)
			throw new Error(
				label + ' failed. See ' + output.stderr + '. ' + failure(output, 'Check the Pi host authentication.')
			)
		return roleReply(readFileSync(output.stdout, 'utf8'), label, settings.model, name === 'oracle')
	}

	async function preview(work, name) {
		abort()
		const workspace = join(directory, name)
		mkdirSync(workspace, { recursive: true, mode: 0o700 })
		const seed = join(work, 'scripts', 'ui-demo.ts')
		if (existsSync(seed)) {
			await run(
				node,
				[
					'--input-type=module',
					'-e',
					"import { pathToFileURL } from 'node:url'; const { seedDemo } = await import(pathToFileURL(process.argv[1])); seedDemo(process.argv[2])",
					seed,
					workspace,
				],
				work,
				name + '-seed'
			)
		}
		const cli = join(work, 'cli', 'dist', 'checkmate.js')
		const stdout = join(logs, name + '.out')
		const stderr = join(logs, name + '.err')
		const running = job(
			node,
			[cli, 'ui', '--workspace', workspace, '--port', '0', '--json'],
			work,
			buildEnv,
			stdout,
			stderr
		)
		jobs.add(running)
		const close = async () => {
			await running.stop()
			jobs.delete(running)
		}
		try {
			const end = Date.now() + 15_000
			while (Date.now() < end && !running.ended()) {
				abort()
				const line = readFileSync(stdout, 'utf8')
					.split('\n')
					.find((line) => line.startsWith('{') && line.endsWith('}'))
				if (line) {
					const data = reply(line)
					assert.equal(data.status, 'completed', JSON.stringify(data))
					const url = new URL(data.url)
					assert(
						url.protocol === 'http:' && url.hostname === '127.0.0.1' && url.port,
						'Candidate UI must serve a private IPv4 loopback port'
					)
					return { url: url.href, workspace, cli, close }
				}
				await pause(150)
			}
			throw new Error('Candidate UI did not start. See ' + stderr + '. ' + tail(stderr))
		} catch (error) {
			await close()
			throw error
		}
	}

	return {
		records,
		logs,
		stop,
		abort,
		run,
		git,
		cm,
		models,
		claimEvidence,
		explorationQuestions,
		role,
		preview,
		playwright: Boolean(executableOnPath('playwright-cli', env)),
		cancelled: () => cancelled,
	}
}
