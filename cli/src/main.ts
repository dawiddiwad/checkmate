import type { Stage, DelegateResponse } from './launcher.ts'
import { main as core, run as coreRun } from '../../plugin/src/index.ts'
import { delegate, stages } from './launcher.ts'
import { startUi } from './ui/server.ts'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

type Parsed = { positionals: string[]; values: Record<string, string>; allow: string[]; json: boolean }

const delegateUsage =
	'checkmate delegate <setup|plan|revise|execute> <targetId|planId|planId|runId> --allow <rule>... [--timeout <seconds>]'
const uiUsage = 'checkmate ui [--port <n>]'

function version() {
	return JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8')).version as string
}

function help() {
	const commands = coreRun(['--help'], { cwd: process.cwd(), env: {}, stdin: () => '' }).output.split('\n')
	return [...commands.slice(0, -1), delegateUsage, uiUsage, commands.at(-1)].join('\n')
}

function parse(tokens: string[], options: string[]): Parsed {
	const parsed: Parsed = { positionals: [], values: {}, allow: [], json: false }
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
		const name = token.slice(2)
		if (!options.includes(name)) throw new Error(`Unknown option ${token}`)
		const next = tokens[++i]
		if (next === undefined || next.startsWith('--')) throw new Error(`Missing value for ${token}`)
		if (name === 'allow') parsed.allow.push(next)
		else if (name in parsed.values) throw new Error(`Option ${token} is given twice`)
		else parsed.values[name] = next
	}
	return parsed
}

function seconds(text: string | undefined, name: string) {
	if (text === undefined) return undefined
	if (!/^[1-9][0-9]*$/.test(text)) throw new Error(`Invalid --${name}: ${text}. Use a whole number.`)
	return Number(text)
}

function cell(field: string) {
	return field.replace(/\\/g, '\\\\').replace(/\t/g, '\\t').replace(/\r/g, '\\r').replace(/\n/g, '\\n')
}

function print(response: DelegateResponse, json: boolean) {
	const output = json
		? JSON.stringify(response)
		: [
				[
					response.status,
					response.subject,
					...(response.operation ? [`operation=${response.operation}`] : []),
				].join(' '),
				...response.reasons.map((reason) => `reason: ${cell(reason)}`),
			].join('\n')
	process.stdout.write(output + '\n')
	process.exitCode = response.status === 'completed' || response.status === 'needs_decision' ? 0 : 1
}

function refuse(status: 'invalid_request' | 'rejected', subject: string, error: unknown, json: boolean) {
	print({ status, subject, reasons: [(error as Error).message], operation: null }, json)
}

async function runDelegate(tokens: string[]) {
	const json = tokens.includes('--json')
	let parsed: Parsed
	try {
		parsed = parse(tokens, ['allow', 'timeout', 'workspace'])
		if (parsed.positionals.length !== 2) throw new Error(`Usage: ${delegateUsage}`)
		if (!stages.includes(parsed.positionals[0] as Stage))
			throw new Error(`Unknown stage: ${parsed.positionals[0]}. Use one of: ${stages.join(', ')}.`)
	} catch (error) {
		return refuse('invalid_request', 'delegate', error, json)
	}
	const [stage, subject] = parsed.positionals as [Stage, string]
	try {
		const response = await delegate(parsed.values.workspace ?? process.cwd(), stage, subject, {
			allowedTools: parsed.allow,
			timeoutSeconds: seconds(parsed.values.timeout, 'timeout'),
		})
		print(response, json)
	} catch (error) {
		refuse('rejected', subject, error, json)
	}
}

async function runUi(tokens: string[]) {
	const json = tokens.includes('--json')
	let parsed: Parsed
	try {
		parsed = parse(tokens, ['workspace', 'port'])
		if (parsed.positionals.length) throw new Error(`Usage: ${uiUsage}`)
	} catch (error) {
		return refuse('invalid_request', 'ui', error, json)
	}
	const port = parsed.values.port === undefined ? undefined : Number(parsed.values.port)
	if (port !== undefined && !(Number.isInteger(port) && port >= 0 && port <= 65535))
		return refuse('invalid_request', 'ui', new Error(`Invalid --port: ${parsed.values.port}`), json)
	const ui = await startUi({ workspace: resolve(parsed.values.workspace ?? '.'), port })
	process.stdout.write((json ? JSON.stringify({ status: 'completed', subject: 'ui', url: ui.url }) : ui.url) + '\n')
	const stop = async () => {
		await ui.close()
		process.exit(0)
	}
	process.once('SIGINT', stop)
	process.once('SIGTERM', stop)
}

const argv = process.argv.slice(2)
if (argv[0] === '--version') process.stdout.write(version() + '\n')
else if (!argv.length || argv[0] === '--help') process.stdout.write(help() + '\n')
else if (argv[0] === 'delegate') await runDelegate(argv.slice(1))
else if (argv[0] === 'ui') await runUi(argv.slice(1))
else core(argv)
