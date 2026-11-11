import { startUi } from './server.ts'
import { resolve } from 'node:path'

type Parsed = { positionals: string[]; values: Record<string, string>; json: boolean }
const uiUsage = 'checkmate ui [--port <n>] [--workspace <path>]'

function parse(tokens: string[], options: string[]): Parsed {
	const parsed: Parsed = { positionals: [], values: {}, json: false }
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
		if (name in parsed.values) throw new Error(`Option ${token} is given twice`)
		else parsed.values[name] = next
	}
	return parsed
}

function fail(error: unknown, json: boolean) {
	const message = (error as Error).message
	process.stdout.write(
		(json
			? JSON.stringify({ status: 'invalid_request', subject: 'ui', reasons: [message] })
			: `invalid_request ui\nreason: ${message}`) + '\n'
	)
	process.exitCode = 1
}

export async function runUi(tokens: string[]) {
	const json = tokens.includes('--json')
	let parsed: Parsed
	try {
		parsed = parse(tokens, ['workspace', 'port'])
		if (parsed.positionals.length) throw new Error(`Usage: ${uiUsage}`)
	} catch (error) {
		return fail(error, json)
	}
	const port = parsed.values.port === undefined ? undefined : Number(parsed.values.port)
	if (port !== undefined && !(Number.isInteger(port) && port >= 0 && port <= 65535))
		return fail(new Error(`Invalid --port: ${parsed.values.port}`), json)
	const ui = await startUi({ workspace: resolve(parsed.values.workspace ?? '.'), port })
	process.stdout.write((json ? JSON.stringify({ status: 'completed', subject: 'ui', url: ui.url }) : ui.url) + '\n')
	const stop = async () => {
		await ui.close()
		process.exit(0)
	}
	process.once('SIGINT', stop)
	process.once('SIGTERM', stop)
}
