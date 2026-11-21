import assert from 'node:assert/strict'
import { execFileSync, spawn } from 'node:child_process'
import { closeSync, existsSync, mkdirSync, mkdtempSync, openSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { setTimeout as sleep } from 'node:timers/promises'
import { saveModels } from '../../src/settings.ts'
import { closeStore, openStore } from '../../src/store.ts'
import { buildSource, deploy } from './releases.mjs'
import { verifyFixture } from './oracle.mjs'
import { events, nativeUsage } from './usage.mjs'

const here = fileURLToPath(new URL('.', import.meta.url))
const root = fileURLToPath(new URL('../../../', import.meta.url))
const model = 'openai-codex/gpt-6-luna'
const thinking = 'medium'
const limit = 420
const plan = 'harbor-pr-27'
const prompt =
	'Explore the open PR in PR.md using the app and its source. Report reproducible defects and regressions with steps, expected behavior, actual behavior, and evidence.'
const tools = ['read', 'bash', 'edit', 'write']
const cli = join(root, 'cli/dist/checkmate.js')

function json(path, data) {
	writeFileSync(path, JSON.stringify(data, null, 2) + '\n')
}

function command(file, args, cwd, options = {}) {
	return execFileSync(file, args, { cwd, encoding: 'utf8', timeout: 30_000, ...options }).trim()
}

function checkmate(cwd, env, args, input) {
	try {
		return JSON.parse(command(process.execPath, [cli, ...args, '--json'], cwd, { env, input }))
	} catch (error) {
		if (error.stdout) return JSON.parse(error.stdout)
		throw error
	}
}

function checked(reply) {
	assert.equal(reply.status, 'completed', JSON.stringify(reply))
	return reply
}

function workspace(cwd) {
	mkdirSync(cwd)
	const git = (...args) => command('git', args, cwd)
	const commit = (subject) => {
		git('add', '.')
		command(
			'git',
			['-c', 'user.name=Fixture', '-c', 'user.email=fixture@example.invalid', 'commit', '-qm', subject],
			cwd,
			{
				env: {
					...process.env,
					GIT_AUTHOR_DATE: '2027-03-20T12:00:00Z',
					GIT_COMMITTER_DATE: '2027-03-20T12:00:00Z',
				},
			}
		)
		return git('rev-parse', 'HEAD')
	}
	const save = (name, contents) => writeFileSync(join(cwd, name), contents)
	git('init', '-qb', 'main')
	save('PRODUCT.md', readFileSync(join(here, 'product.md')))
	save('app.mjs', buildSource('base'))
	const base = commit('Document existing Harbor Rentals workflows')
	git('checkout', '-qb', 'pr/27-bulk-reschedule')
	save('app.mjs', buildSource('pr'))
	save(
		'PR.md',
		readFileSync(join(here, 'change.md'), 'utf8') +
			'\nPreview URLs and tool entry points are in [TARGETS.md](TARGETS.md).\n'
	)
	const head = commit('PR 27: bulk reschedule and shared reservation handling')
	return { base, head }
}

function runChild(file, args, cwd, env, output, seconds) {
	const stdout = openSync(output, 'w', 0o600)
	const stderr = openSync(output + '.stderr', 'w', 0o600)
	const start = Date.now()
	return new Promise((resolve, reject) => {
		const child = spawn(file, args, { cwd, env, detached: true, stdio: ['ignore', stdout, stderr] })
		closeSync(stdout)
		closeSync(stderr)
		let timedOut = false
		let kill
		const signal = (value) => {
			try {
				process.kill(-child.pid, value)
			} catch (error) {
				if (error.code !== 'ESRCH') throw error
			}
		}
		const timeout = setTimeout(() => {
			timedOut = true
			signal('SIGTERM')
			kill = setTimeout(() => signal('SIGKILL'), 2_000)
		}, seconds * 1_000)
		child.once('error', (error) => {
			clearTimeout(timeout)
			reject(error)
		})
		child.once('close', (code) => {
			clearTimeout(timeout)
			clearTimeout(kill)
			resolve({ code, timedOut, seconds: (Date.now() - start) / 1_000 })
		})
	})
}

async function bare(cwd, env, folder) {
	const output = join(folder, 'bare.ndjson')
	const outcome = await runChild(
		'pi',
		[
			'-p',
			'--mode',
			'json',
			'--model',
			model,
			'--thinking',
			thinking,
			'--no-context-files',
			'--no-skills',
			'--no-prompt-templates',
			'--no-tools',
			'--tools',
			tools.map((tool) => '+' + tool).join(','),
			prompt,
		],
		cwd,
		env,
		output,
		limit
	)
	const replies = events(output).filter(
		(event) => event.type === 'message_end' && event.message?.role === 'assistant'
	)
	const text =
		replies
			.filter((event) => event.message.stopReason === 'stop')
			.at(-1)
			?.message.content.filter((block) => block.type === 'text')
			.map((block) => block.text)
			.join('\n') ?? ''
	writeFileSync(join(folder, 'bare-report.md'), text)
	const summary = {
		...outcome,
		finalReport: Boolean(text.trim()),
		...nativeUsage(env.PI_CODING_AGENT_SESSION_DIR, model, thinking),
	}
	json(join(folder, 'bare.json'), summary)
	assert(summary.finalReport, 'Bare Pi did not return a final report')
	return summary
}

function prepareSmoke(cwd, env, urls) {
	const command = (args, input) => checkmate(cwd, env, args, input === undefined ? undefined : JSON.stringify(input))
	const store = openStore(cwd)
	try {
		const reply = saveModels(store, 'eval', 'pi', '', model, undefined, thinking)
		assert.equal(reply.status, 'completed', JSON.stringify(reply))
	} finally {
		closeStore(store)
	}
	checked(
		command([
			'target',
			'open',
			'harbor',
			'--entry-point',
			'pr:url:PR preview',
			'--entry-point',
			'base:url:Base preview',
			'--capabilities',
			'browser,cli',
			'--operations',
			'read_reservations,change_reservations',
			'--tool',
			'curl:cli:Read and exercise the preview APIs.',
			'--tool',
			'playwright-cli:cli:Use a browser on the previews.',
		])
	)
	checked(
		command(['target', 'save', 'harbor'], {
			contractVersion: 'toolkit-2',
			targetId: 'harbor',
			revision: 1,
			entryPoints: [
				{ name: 'pr', kind: 'url', purpose: 'PR preview' },
				{ name: 'base', kind: 'url', purpose: 'Base preview' },
			],
			capabilities: ['browser', 'cli'],
			tools: [
				{ name: 'curl', kind: 'cli', purpose: 'Exercise preview APIs', reachable: true },
				{ name: 'playwright-cli', kind: 'cli', purpose: 'Use a browser on the previews', reachable: true },
			],
			authentication: { kind: 'none', references: [] },
			allowedOperations: ['read_reservations', 'change_reservations'],
			startup: { owner: 'factory', command: null },
			cleanup: 'The fixture runner closes both previews.',
			readyForLiveExecution: true,
		})
	)
	checked(
		command([
			'target',
			'instance',
			'add',
			'harbor',
			'previews',
			'--entry',
			'pr=' + urls.pr,
			'--entry',
			'base=' + urls.base,
			'--environment',
			'Local PR previews',
		])
	)
	checked(
		command(['plan', 'open', plan, '--target', 'harbor@1'], {
			objective:
				'Explore the open PR for bulk rescheduling and verify existing reservation workflows in Harbor Rentals.',
			requirements: [
				{
					id: 'R1',
					text: 'Valid batches update all bookings. Invalid batches leave all bookings unchanged.',
					source: 'PR.md',
				},
				{
					id: 'R2',
					text: 'Existing desk and API workflows follow the product rules after the change.',
					source: 'PRODUCT.md',
				},
			],
			context: { sources: ['PR.md', 'PRODUCT.md', 'TARGETS.md'] },
		})
	)
}

async function smoke(cwd, env, folder, refs) {
	const command = (args) => checkmate(cwd, env, args)
	const started = Date.now()
	const launch = checked(
		command([
			'explore',
			'start',
			plan,
			'--build',
			refs.head,
			'--instance',
			'previews',
			'--since',
			refs.base,
			'--until',
			refs.head,
			'--mode',
			'exploratory',
			'--level',
			'smoke',
			'--minutes',
			'4',
			'--timeout',
			'300',
			...tools.flatMap((tool) => ['--allow', tool]),
		])
	)
	const id = launch.explorationId
	json(join(folder, 'smoke-launch.json'), launch)
	assert(launch.explorers === 1 && launch.verifier === false && launch.model === model, JSON.stringify(launch))
	let previous
	let detail
	const rawReport = join(cwd, '.checkmate', 'work', id, 'a1', 'report.md')
	try {
		while (Date.now() - started < limit * 1_000) {
			detail = checked(command(['explore', 'status', id]))
			if (existsSync(rawReport)) writeFileSync(join(folder, 'smoke-report.md'), readFileSync(rawReport))
			if (detail.state !== previous) {
				console.log(`Checkmate ${id} ${detail.state}`)
				previous = detail.state
			}
			if (['completed', 'failed', 'interrupted', 'stopped'].includes(detail.state)) break
			await sleep(2_000)
		}
	} finally {
		if (!['completed', 'failed', 'interrupted', 'stopped'].includes(detail?.state)) {
			command(['explore', 'stop', id, '--reason', 'Eval wall-clock limit'])
		}
	}
	try {
		execFileSync('playwright-cli', ['-s=qa-' + id + '-a1', 'close'], { cwd, env, stdio: 'ignore', timeout: 5_000 })
	} catch {}
	const shown = checked(command(['explore', 'show', id]))
	json(join(folder, 'smoke-show.json'), shown)
	const summary = {
		state: shown.state,
		exploration: id,
		seconds: (Date.now() - started) / 1_000,
		recordedClaims: shown.claims.length,
		...nativeUsage(env.PI_CODING_AGENT_SESSION_DIR, model, thinking),
	}
	json(join(folder, 'smoke.json'), summary)
	assert.equal(summary.state, 'completed', JSON.stringify(shown))
	return summary
}

async function main() {
	const oracle = await verifyFixture()
	console.log(`Verified ${oracle.length} seeded cases in base, PR, and fixed control`)
	if (process.argv.includes('--verify')) return
	assert(existsSync(cli), 'Build the CLI with node scripts/build-cli.ts first')
	const base = join(root, 'plugin/evals/results')
	mkdirSync(base, { recursive: true })
	const folder = mkdtempSync(join(base, 'exploration-discovery-'))
	console.log('Results: ' + folder)
	json(join(folder, 'oracle.json'), oracle)
	const bin = join(folder, 'bin')
	mkdirSync(bin)
	const pi = command('which', ['pi'], root)
	writeFileSync(join(bin, 'pi'), '#!/bin/sh\nexec "$EVAL_PI_BIN" --no-extensions --no-mcp "$@"\n', { mode: 0o700 })
	const previews = []
	try {
		const arms = {}
		for (const name of ['bare', 'smoke']) {
			const cwd = join(mkdtempSync(join(tmpdir(), 'harbor-' + name + '-')), 'preview')
			const refs = workspace(cwd)
			const pr = await deploy(readFileSync(join(cwd, 'app.mjs'), 'utf8'))
			previews.push(pr)
			const base = await deploy(
				execFileSync('git', ['show', refs.base + ':app.mjs'], { cwd, encoding: 'utf8', timeout: 30_000 })
			)
			previews.push(base)
			const urls = { pr: pr.url, base: base.url }
			writeFileSync(
				join(cwd, 'TARGETS.md'),
				`# Deployed previews

- PR build \`${refs.head}\`: ${urls.pr}
- Base build \`${refs.base}\`: ${urls.base}

Read PRODUCT.md for the product rules. Inspect app.mjs and use git diff main...HEAD for the PR changes. Both HTTP previews start with the same seeded records. Use curl or playwright-cli. Use this workspace and the named previews only.
`
			)
			const sessions = join(folder, name + '-sessions')
			mkdirSync(sessions, { mode: 0o700 })
			const env = {
				...process.env,
				PATH: bin + ':' + process.env.PATH,
				EVAL_PI_BIN: pi,
				PI_CODING_AGENT_SESSION_DIR: sessions,
				CHECKMATE_HARNESS: 'pi',
				CHECKMATE_PI_MODEL: undefined,
				CHECKMATE_PI_PROVIDER: undefined,
				PLAYWRIGHT_CLI_SESSION: 'harbor-' + name + '-' + folder.split('-').at(-1),
			}
			arms[name] = { cwd, env, urls, refs }
		}
		assert.deepEqual(arms.bare.refs, arms.smoke.refs)
		command('git', ['bundle', 'create', join(folder, 'fixture.bundle'), '--all'], arms.bare.cwd)
		prepareSmoke(arms.smoke.cwd, arms.smoke.env, arms.smoke.urls)
		json(join(folder, 'run.json'), {
			model,
			thinking,
			armWallSeconds: limit,
			level: 'smoke',
			barePrompt: prompt,
			code: command('git', ['rev-parse', 'HEAD'], root),
			refs: arms.bare.refs,
			workspaces: { bare: arms.bare.cwd, smoke: arms.smoke.cwd },
		})
		const results = await Promise.allSettled([
			bare(arms.bare.cwd, arms.bare.env, folder),
			smoke(arms.smoke.cwd, arms.smoke.env, folder, arms.smoke.refs),
		])
		for (const arm of Object.values(arms)) {
			try {
				command('playwright-cli', ['-s=' + arm.env.PLAYWRIGHT_CLI_SESSION, 'close'], arm.cwd, { env: arm.env })
			} catch {}
		}
		json(
			join(folder, 'arms.json'),
			results.map((result) =>
				result.status === 'fulfilled' ? result : { status: result.status, error: String(result.reason) }
			)
		)
		const failures = results.filter((result) => result.status === 'rejected')
		if (failures.length) throw new AggregateError(failures.map((result) => result.reason))
		console.log(
			JSON.stringify(
				results.map((result) => result.value),
				null,
				2
			)
		)
	} finally {
		await Promise.all(previews.map((preview) => preview.close()))
	}
}

await main()
