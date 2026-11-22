import type { Stage, DelegateResponse } from './launcher.ts'
import type { Reply } from '../../plugin/src/index.ts'
import { busyReason, formatReply, isBusy, main as core, refused, run as coreRun } from '../../plugin/src/index.ts'
import { delegate, stages } from './launcher.ts'
import { exploreSpec } from './spec.ts'
import { existsSync, readFileSync } from 'node:fs'

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
	const plugin = new URL('../.claude-plugin/plugin.json', import.meta.url)
	const manifest = existsSync(plugin) ? plugin : new URL('../package.json', import.meta.url)
	return JSON.parse(readFileSync(manifest, 'utf8')).version as string
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
	const [first, ...rest] = formatReply(command!, { ...reply, data: data! }, false).split('\n')
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
					...(response.hint ? [`hint: ${cell(response.hint)}`] : []),
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

async function runDelegate(tokens: string[]) {
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
	if (argv[0] === '--version') process.stdout.write(version() + '\n')
	else if (!argv.length || argv[0] === '--help' || (argv[0] === '--json' && argv[1] === '--help'))
		process.stdout.write(help(argv.includes('--json')) + '\n')
	else if (argv[0] === 'delegate') await runDelegate(argv.slice(1))
	else await core(argv)
}
