import type { Stage, DelegateResponse } from './launcher.ts'
import type { Reply } from '../../plugin/src/index.ts'
import { busyReason, formatReply, isBusy, main as core, refused, run as coreRun } from '../../plugin/src/index.ts'
import { versionLines } from '../../plugin/src/build.ts'
import { hostSession } from '../../plugin/src/actor.ts'
import { pluginRoot } from '../../plugin/src/sessions.ts'
import { delegate, minimumRules, stages } from './launcher.ts'
import { selectedHarness } from '../../plugin/src/pi.ts'
import { exploreSpec } from './spec.ts'
import { existsSync, mkdirSync, openSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { spawn, spawnSync } from 'node:child_process'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { actionInput } from '../../plugin/src/actions.ts'
import { serveActions } from '../../plugin/src/action-mcp.ts'
export { actionToolDefinitions, callActionTool } from '../../plugin/src/action-tools.ts'

type Parsed = {
	positionals: string[]
	values: Record<string, string>
	allow: string[]
	claudeArgs: string[]
	json: boolean
	help: boolean
}

const delegateUsage =
	'checkmate delegate <setup|plan|revise|execute> <targetId|planId|planId|runId> [--timeout <seconds>]'
const delegateSpecUsage = 'checkmate delegate spec <planId@revision> [--timeout <seconds>]'
const delegateHarnessUsage =
	'With Pi, omit --allow and --claude-arg. Claude requires --allow <rule> and accepts --claude-arg <arg>. CHECKMATE_HARNESS overrides the workspace harness. The default is Claude. delegate spec uses no tools and needs no --allow.'

function version() {
	const manifest = join(pluginRoot, '.claude-plugin', 'plugin.json')
	return versionLines(
		JSON.parse(readFileSync(manifest, 'utf8')).version as string,
		import.meta.url,
		process.env
	).join('\n')
}

function help(json: boolean) {
	const commands = coreRun(['--help'], { cwd: process.cwd(), env: {}, stdin: () => '' }).output.split('\n')
	const usage = [...commands.slice(0, -1), delegateUsage, delegateSpecUsage, delegateHarnessUsage, commands.at(-1)]
	return json ? JSON.stringify({ status: 'completed', subject: 'checkmate', reasons: [], usage }) : usage.join('\n')
}

function parse(tokens: string[], options: string[]): Parsed {
	const parsed: Parsed = { positionals: [], values: {}, allow: [], claudeArgs: [], json: false, help: false }
	for (let i = 0; i < tokens.length; i++) {
		const token = tokens[i]
		if (!token.startsWith('--')) {
			parsed.positionals.push(token)
			continue
		}
		if (token === '--json') {
			parsed.json = true
			continue
		}
		if (token === '--help') {
			parsed.help = true
			continue
		}
		const name = token.slice(2)
		if (!options.includes(name)) throw new Error(`Unknown option ${token}`)
		const next = tokens[++i]
		if (next === undefined || (next.startsWith('--') && name !== 'claude-arg'))
			throw new Error(`Missing value for ${token}`)
		if (name === 'allow') parsed.allow.push(next)
		else if (name === 'claude-arg') parsed.claudeArgs.push(next)
		else if (name in parsed.values) throw new Error(`Option ${token} is given twice`)
		else parsed.values[name] = next
	}
	return parsed
}

function seconds(text: string | undefined, name: string) {
	if (text === undefined) return undefined
	if (!/^[0-9]+$/.test(text) || Number(text) < 1 || Number(text) > 3600)
		throw new Error(`Invalid --${name}: ${text}. Use a whole number from 1 to 3600.`)
	return Number(text)
}

function cell(field: string) {
	return field.replace(/\\/g, '\\\\').replace(/\t/g, '\\t').replace(/\r/g, '\\r').replace(/\n/g, '\\n')
}

function usageFields({ observedModels, costUsd, costPartial }: DelegateResponse) {
	return [
		...(observedModels?.length ? [`model=${cell(observedModels.join(','))}`] : []),
		...(costUsd === undefined ? [] : [`costUsd=${costUsd}`]),
		...(costPartial ? ['costPartial=true'] : []),
	]
}

function recorded(response: DelegateResponse, json: boolean) {
	const { operation, command, data, observedModels, costUsd, costPartial, usageWarning, ...reply } = response
	if (json)
		return JSON.stringify({ ...reply, ...data, operation, observedModels, costUsd, costPartial, usageWarning })
	const [first, ...rest] = formatReply(command!, { ...reply, data: data! }, false, hostSession(process.env)).split(
		'\n'
	)
	return [[`${first} operation=${operation}`, ...usageFields(response)].join(' '), ...rest].join('\n')
}

function print(response: DelegateResponse & Pick<Reply, 'refusal' | 'hint'>, json: boolean) {
	const output = response.command
		? recorded(response, json)
		: json
			? JSON.stringify(response)
			: [
					[
						response.status,
						response.subject,
						...(response.refusal ? [`refusal=${response.refusal}`] : []),
						...(response.operation ? [`operation=${response.operation}`] : []),
						...usageFields(response),
					].join(' '),
					...response.reasons.map((reason) => `reason: ${cell(reason)}`),
					...(response.hint
						? [`${hostSession(process.env) ? 'agent-only hint' : 'hint'}: ${cell(response.hint)}`]
						: []),
				].join('\n')
	const warning = !json && response.usageWarning ? `\nwarning: ${cell(response.usageWarning)}` : ''
	process.stdout.write(`${output}${warning}\n`)
	process.exitCode = response.status === 'completed' || response.status === 'needs_decision' ? 0 : 1
}

function printHelp(json: boolean) {
	const usage = [delegateUsage, delegateSpecUsage, delegateHarnessUsage]
	const output = json
		? JSON.stringify({ status: 'completed', subject: 'delegate', reasons: [], usage })
		: ['completed delegate', ...usage].join('\n')
	process.stdout.write(output + '\n')
}

function refuse(status: 'invalid_request' | 'rejected', subject: string, error: unknown, json: boolean) {
	const { data, ...reply } = refused(status, subject, error)
	const hint = reply.hint ?? (status === 'invalid_request' ? `Usage: ${delegateUsage}` : undefined)
	print({ ...reply, ...(hint ? { hint } : {}), operation: null }, json)
}

export function parseDelegate(tokens: string[]) {
	const parsed = parse(tokens, ['allow', 'claude-arg', 'timeout', 'workspace'])
	if (parsed.help) return parsed
	seconds(parsed.values.timeout, 'timeout')
	if (parsed.positionals.length !== 2)
		throw new Error(`delegate needs 2 argument(s), not ${parsed.positionals.length}: <stage> <subject>`)
	if (parsed.positionals[0] !== 'spec' && !stages.includes(parsed.positionals[0] as Stage))
		throw new Error(`Unknown stage: ${parsed.positionals[0]}. Use one of: ${[...stages, 'spec'].join(', ')}.`)
	return parsed
}

// A planning or revise run can outlast a shell call. --detach starts it in the background and writes its JSON reply
// to a file. `delegate wait <stage> <subject>` reads that file for a bounded time and says `running` if it is not done.
function resultFile(workspace: string, stage: string, subject: string) {
	return join(workspace, '.checkmate', 'tmp', `delegate-${stage}-${subject}.json`)
}

function detachDelegate(tokens: string[]) {
	const rest = tokens.filter((token) => token !== '--detach')
	const parsed = parseDelegate(rest.filter((token) => token !== '--json'))
	const [stage, subject] = parsed.positionals as [Stage, string]
	const workspace = parsed.values.workspace ?? process.cwd()
	// A background run starts before delegate checks its rules, so a claude run without --allow is refused here, before it starts.
	if (selectedHarness(process.env) === 'claude' && !parsed.allow.length)
		return refuse(
			'rejected',
			subject,
			`delegate needs --allow rules. Minimum: ${minimumRules.join(', ')}`,
			tokens.includes('--json')
		)
	const file = resultFile(workspace, stage, subject)
	mkdirSync(join(workspace, '.checkmate', 'tmp'), { recursive: true })
	rmSync(file, { force: true })
	// The reply goes to a temporary file and is renamed only when the delegate has finished, so wait never reads a partial reply.
	const quote = (text: string) => `'${text.replaceAll("'", "'\\''")}'`
	const command = [process.execPath, fileURLToPath(import.meta.url), 'delegate', ...rest, '--json']
		.map(quote)
		.join(' ')
	const child = spawn(
		'/bin/sh',
		['-c', `${command} > ${quote(file + '.tmp')}; mv ${quote(file + '.tmp')} ${quote(file)}`],
		{
			cwd: workspace,
			detached: true,
			stdio: ['ignore', 'ignore', openSync(file + '.log', 'w')],
		}
	)
	child.unref()
	writeFileSync(file + '.started', String(Date.now()))
	writeFileSync(file + '.pid', String(child.pid))
	print(
		{
			status: 'running',
			subject,
			reasons: [`delegate ${stage} ${subject} started in the background and is still running.`],
			operation: null,
			hint: `Run checkmate delegate wait ${stage} ${subject} --timeout 90 until it reports completed or refused.`,
		},
		true
	)
}

// A detached delegate is alive when its recorded PID runs a delegate command that started after the record was written.
// A PID that was reused by another process is not alive.
function delegateAlive(file: string) {
	if (!existsSync(file + '.pid') || !existsSync(file + '.started')) return false
	const pid = Number(readFileSync(file + '.pid', 'utf8'))
	if (!Number.isInteger(pid) || pid <= 0) return false
	try {
		process.kill(pid, 0)
	} catch {
		return false
	}
	const ps = spawnSync('ps', ['-p', String(pid), '-o', 'lstart=,command='], { encoding: 'utf8' })
	const line = ps.stdout.trim()
	if (!line.includes('delegate')) return false
	const started = Number(readFileSync(file + '.started', 'utf8'))
	const processStarted = Date.parse(line.slice(0, 24))
	return Number.isNaN(processStarted) || processStarted >= started - 5000
}

function waitDelegate(tokens: string[]) {
	const parsed = parse(tokens.slice(1), ['timeout', 'workspace'])
	const [stage, subject] = parsed.positionals as [Stage, string]
	const workspace = parsed.values.workspace ?? process.cwd()
	const file = resultFile(workspace, stage, subject)
	const limit = (seconds(parsed.values.timeout, 'timeout') ?? 90) * 1000
	const until = Date.now() + limit
	while (!existsSync(file) && Date.now() < until && delegateAlive(file))
		Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 500)
	if (!existsSync(file) && !delegateAlive(file)) {
		// The delegate stopped without a reply. Settle the record: it is not running, and the plan record says what was saved.
		rmSync(file + '.started', { force: true })
		rmSync(file + '.pid', { force: true })
		print(
			{
				status: 'operational_error',
				subject,
				reasons: [`delegate ${stage} ${subject} stopped before it wrote a reply. It is not running.`],
				operation: null,
				hint: `Run checkmate status ${subject} to read what was saved. Then run checkmate delegate ${stage} ${subject} --detach again if nothing was saved.`,
			},
			true
		)
		return
	}
	if (!existsSync(file)) {
		print(
			{
				status: 'running',
				subject,
				reasons: [
					`delegate ${stage} ${subject} has not finished within ${limit / 1000} seconds; it is still running.`,
				],
				operation: null,
				hint: `Run checkmate delegate wait ${stage} ${subject} --timeout 90 again. Do not start the delegate again.`,
			},
			true
		)
		return
	}
	const text = readFileSync(file, 'utf8')
	rmSync(file, { force: true })
	rmSync(file + '.started', { force: true })
	rmSync(file + '.pid', { force: true })
	rmSync(file + '.log', { force: true })
	process.stdout.write(text.endsWith('\n') ? text : text + '\n')
}

async function runDelegate(tokens: string[]) {
	if (tokens[0] === 'wait') return waitDelegate(tokens)
	if (tokens.includes('--detach')) return detachDelegate(tokens)
	if (/^(pi|claude):(setup|plan|revise|execute)$/.test(process.env.CHECKMATE_ACTOR ?? ''))
		return refuse(
			'rejected',
			'delegate',
			'A delegated worker cannot start another delegate.',
			tokens.includes('--json')
		)
	let parsed: Parsed
	try {
		parsed = parseDelegate(tokens)
		if (parsed.help) return printHelp(parsed.json)
	} catch (error) {
		return refuse('invalid_request', 'delegate', error, tokens.includes('--json'))
	}
	const [stage, subject] = parsed.positionals as [Stage | 'spec', string]
	try {
		if (stage === 'spec') {
			if (parsed.allow.length || parsed.claudeArgs.length)
				throw new Error('delegate spec uses no tools and does not accept --allow or --claude-arg.')
			return print(
				exploreSpec(
					parsed.values.workspace ?? process.cwd(),
					subject,
					seconds(parsed.values.timeout, 'timeout') ?? 300
				),
				parsed.json
			)
		}
		actionInput('delegate_work', { stage, subject })
		const response = await delegate(parsed.values.workspace ?? process.cwd(), stage, subject, {
			allowedTools: parsed.allow,
			claudeArgs: parsed.claudeArgs,
			timeoutSeconds: seconds(parsed.values.timeout, 'timeout'),
		})
		print(response, parsed.json)
	} catch (error) {
		if (!isBusy(error)) return refuse('rejected', subject, error, parsed.json)
		const reasons = [(error as Error).message, busyReason]
		print({ status: 'operational_error', subject, reasons, operation: null }, parsed.json)
	}
}

if (import.meta.main) {
	const argv = process.argv.slice(2)
	if (argv[0] === 'mcp' && argv.length === 1) await serveActions()
	else if (argv[0] === '--version') process.stdout.write(version() + '\n')
	else if (!argv.length || argv[0] === '--help' || (argv[0] === '--json' && argv[1] === '--help'))
		process.stdout.write(help(argv.includes('--json')) + '\n')
	else if (argv[0] === 'delegate') await runDelegate(argv.slice(1))
	else await core(argv)
}
