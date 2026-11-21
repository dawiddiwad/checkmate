import assert from 'node:assert/strict'
import { execFileSync, spawn } from 'node:child_process'
import { closeSync, existsSync, mkdirSync, mkdtempSync, openSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { setTimeout as sleep } from 'node:timers/promises'
import { parseArgs } from 'node:util'
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
const scenarios = {
	discovery: {
		mode: 'exploratory',
		prompt: 'Explore the open PR in PR.md using the app and its source. Report reproducible defects and regressions with steps, expected behavior, actual behavior, and evidence.',
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
	},
	core: {
		mode: 'regression',
		prompt: 'Regression-test the core workflows documented in PRODUCT.md on both deployed builds. Exercise asset search, booking lists and pagination, availability and pricing, single-booking reschedule and cancellation, booking history, and desk filters and CSV export. Use the running app and inspect the source as needed. Report reproducible defects and regressions with steps, expected behavior, actual behavior, and evidence. The new bulk rescheduling flow is outside this run.',
		requirements: [
			{
				id: 'R1',
				text: 'Asset search, booking lists and pagination follow the product rules.',
				source: 'PRODUCT.md',
			},
			{ id: 'R2', text: 'Availability and pricing follow the product rules.', source: 'PRODUCT.md' },
			{
				id: 'R3',
				text: 'Single reschedule, cancellation and history follow the product rules.',
				source: 'PRODUCT.md',
			},
			{ id: 'R4', text: 'Desk filtering and CSV export follow the product rules.', source: 'PRODUCT.md' },
		],
	},
}
const levels = { smoke: 1, normal: 2 }
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

async function bare(arm, folder, prompt) {
	const { name, cwd, env } = arm
	const output = join(folder, name + '.ndjson')
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
	writeFileSync(join(folder, name + '-report.md'), text)
	const summary = {
		...outcome,
		finalReport: Boolean(text.trim()),
		...nativeUsage(env.PI_CODING_AGENT_SESSION_DIR, model, thinking),
	}
	json(join(folder, name + '.json'), summary)
	assert(summary.finalReport, 'Bare Pi did not return a final report')
	return summary
}

function prepareCheckmate({ cwd, env, entries }, scenario) {
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
			...entries.flatMap(({ name, purpose }) => ['--entry-point', name + ':url:' + purpose]),
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
			entryPoints: entries.map(({ name, purpose }) => ({ name, purpose, kind: 'url' })),
			capabilities: ['browser', 'cli'],
			tools: [
				{ name: 'curl', kind: 'cli', purpose: 'Exercise preview APIs', reachable: true },
				{ name: 'playwright-cli', kind: 'cli', purpose: 'Use a browser on the previews', reachable: true },
			],
			authentication: { kind: 'none', references: [] },
			allowedOperations: ['read_reservations', 'change_reservations'],
			startup: { owner: 'factory', command: null },
			cleanup: 'The fixture runner closes the previews.',
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
			...entries.flatMap(({ name, url }) => ['--entry', name + '=' + url]),
			'--environment',
			'Local PR previews',
		])
	)
	checked(
		command(['plan', 'open', plan, '--target', 'harbor@1'], {
			objective: scenario.prompt,
			requirements: scenario.requirements,
			context: {
				sources: ['PR.md', 'PRODUCT.md', 'TARGETS.md'],
				instructions:
					'Use only the preview pair assigned to your tester in TARGETS.md. Each pair has separate data.',
			},
		})
	)
}

async function explore({ cwd, env, refs }, folder, level, mode, reports) {
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
			mode,
			'--level',
			level,
			'--minutes',
			'4',
			'--timeout',
			'300',
			...tools.flatMap((tool) => ['--allow', tool]),
		])
	)
	const id = launch.explorationId
	json(join(folder, level + '-launch.json'), launch)
	assert(
		launch.explorers === levels[level] && launch.verifier === (level === 'normal') && launch.model === model,
		JSON.stringify(launch)
	)
	let previous
	let detail
	const workDir = join(cwd, '.checkmate', 'work', id)
	try {
		while (Date.now() - started < limit * 1_000) {
			detail = checked(command(['explore', 'status', id]))
			for (const [index, report] of reports.entries()) {
				const path = join(workDir, 'a' + (index + 1), 'report.md')
				try {
					writeFileSync(join(folder, report + '-report.md'), readFileSync(path))
				} catch (error) {
					if (error.code !== 'ENOENT') throw error
				}
			}
			if (detail.state !== previous) {
				console.log(`${mode} Checkmate ${id} ${detail.state}`)
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
	for (const index of reports.keys()) {
		closeBrowser(cwd, env, 'qa-' + id + '-a' + (index + 1))
	}
	const shown = checked(command(['explore', 'show', id]))
	json(join(folder, level + '-show.json'), shown)
	const summary = {
		state: shown.state,
		exploration: id,
		seconds: (Date.now() - started) / 1_000,
		recordedClaims: shown.claims.length,
		...nativeUsage(env.PI_CODING_AGENT_SESSION_DIR, model, thinking),
	}
	json(join(folder, level + '.json'), summary)
	assert.equal(summary.state, 'completed', JSON.stringify(shown))
	return summary
}

function closeBrowser(cwd, env, session) {
	try {
		execFileSync('playwright-cli', ['-s=' + session, 'close'], { cwd, env, stdio: 'ignore', timeout: 5_000 })
	} catch {}
}

async function main() {
	const args = parseArgs({
		options: {
			verify: { type: 'boolean' },
			level: { type: 'string', default: 'smoke' },
			scenario: { type: 'string', default: 'discovery' },
		},
	}).values
	const level = args.level
	const count = levels[level]
	const scenario = scenarios[args.scenario]
	assert(
		Object.hasOwn(levels, level) && Object.hasOwn(scenarios, args.scenario),
		'Use --level smoke|normal and --scenario discovery|core'
	)
	const oracle = await verifyFixture()
	console.log(`Verified ${oracle.length} seeded cases in base, PR, and fixed control`)
	if (args.verify) return
	assert(existsSync(cli), 'Build the CLI with node scripts/build-cli.ts first')
	const base = join(root, 'plugin/evals/results')
	mkdirSync(base, { recursive: true })
	const folder = mkdtempSync(join(base, `exploration-${args.scenario}-${level}-`))
	console.log('Results: ' + folder)
	json(join(folder, 'oracle.json'), oracle)
	const bin = join(folder, 'bin')
	mkdirSync(bin)
	const pi = command('which', ['pi'], root)
	writeFileSync(join(bin, 'pi'), '#!/bin/sh\nexec "$EVAL_PI_BIN" --no-extensions --no-mcp "$@"\n', { mode: 0o700 })
	const testers = Array.from({ length: count }, (_, index) => 'a' + (index + 1))
	const bareAgents = testers.map((name) => (count === 1 ? 'bare' : 'bare-' + name))
	const checkmateReports = testers.map((name) => (count === 1 ? level : level + '-' + name))
	const previews = []
	try {
		const arms = []
		for (const name of [...bareAgents, level]) {
			const cwd = join(mkdtempSync(join(tmpdir(), 'harbor-' + name + '-')), 'preview')
			const refs = workspace(cwd)
			const sources = {
				pr: readFileSync(join(cwd, 'app.mjs'), 'utf8'),
				base: execFileSync('git', ['show', refs.base + ':app.mjs'], { cwd, encoding: 'utf8', timeout: 30_000 }),
			}
			const entries = []
			const lanes = name === level ? testers : [null]
			for (const tester of lanes) {
				for (const build of ['pr', 'base']) {
					const preview = await deploy(sources[build])
					previews.push(preview)
					entries.push({
						name: tester && count > 1 ? build + '-' + tester : build,
						purpose:
							(tester ? 'Tester ' + tester + ' ' : '') + (build === 'pr' ? 'PR preview' : 'Base preview'),
						build: refs[build === 'pr' ? 'head' : 'base'],
						url: preview.url,
					})
				}
			}
			const laneNote =
				name === level && count > 1
					? 'Use the pair for your own tester name (a1 or a2, as in your work folder). Each pair has separate data.'
					: 'The base and PR previews start with the same seeded records.'
			writeFileSync(
				join(cwd, 'TARGETS.md'),
				[
					'# Deployed previews',
					'',
					...entries.map(({ purpose, build, url }) => '- ' + purpose + ' (' + build + '): ' + url),
					'',
					laneNote,
					'Read PRODUCT.md for the product rules. Inspect app.mjs and use git diff main...HEAD for the PR changes.',
					'Use curl or playwright-cli. Use this workspace and the named previews only.',
					'',
				].join('\n')
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
			arms.push({ name, cwd, env, entries, refs })
		}
		const checkmateArm = arms.at(-1)
		const refs = arms[0].refs
		for (const arm of arms) assert.deepEqual(arm.refs, refs)
		command('git', ['bundle', 'create', join(folder, 'fixture.bundle'), '--all'], arms[0].cwd)
		prepareCheckmate(checkmateArm, scenario)
		json(join(folder, 'run.json'), {
			model,
			thinking,
			armWallSeconds: limit,
			testMinutes: 4,
			level,
			scenario: args.scenario,
			mode: scenario.mode,
			barePrompt: scenario.prompt,
			bareAgents,
			checkmateReports,
			code: command('git', ['rev-parse', 'HEAD'], root),
			refs,
			workspaces: Object.fromEntries(arms.map(({ name, cwd }) => [name, cwd])),
			previews: Object.fromEntries(arms.map(({ name, entries }) => [name, entries])),
		})
		const results = await Promise.allSettled([
			...arms.slice(0, -1).map((arm) => bare(arm, folder, scenario.prompt)),
			explore(checkmateArm, folder, level, scenario.mode, checkmateReports),
		])
		for (const arm of arms) closeBrowser(arm.cwd, arm.env, arm.env.PLAYWRIGHT_CLI_SESSION)
		json(
			join(folder, 'arms.json'),
			results.map((result, index) =>
				result.status === 'fulfilled'
					? { name: arms[index].name, ...result }
					: { name: arms[index].name, status: result.status, error: String(result.reason) }
			)
		)
		const failures = results.filter((result) => result.status === 'rejected')
		if (failures.length) throw new AggregateError(failures.map((result) => result.reason))
		console.log(
			JSON.stringify(Object.fromEntries(arms.map(({ name }, index) => [name, results[index].value])), null, 2)
		)
	} finally {
		await Promise.all(previews.map((preview) => preview.close()))
	}
}

await main()
