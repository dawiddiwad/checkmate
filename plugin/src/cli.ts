import type { Request, Response } from './types.ts'
import type { DelegateOptions } from './launcher.ts'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { readDocument, requireCondition } from './files.ts'
import { validate, profileCheck, planCheck, requestCheck } from './contracts.ts'
import { setup, savePlan, gate, beginRun, finalize, reports, response } from './stages.ts'
import { delegate } from './launcher.ts'

const commands = ['validate', 'setup', 'save-plan', 'gate', 'begin', 'finalize', 'report', 'delegate']
// validate <kind> <file> checks one document against the named contract.
const kinds = ['request', 'profile', 'plan', 'plan-candidate', 'observation', 'result']

export async function main(args: string[]) {
	let request: Request | undefined
	try {
		if (args[0] === '--version') {
			console.log(
				JSON.parse(readFileSync(new URL('../.claude-plugin/plugin.json', import.meta.url), 'utf8')).version
			)
			return
		}
		if (!args.length || args[0] === '--help') {
			console.log(
				'checkmate validate <request|profile|plan|plan-candidate|observation|result> <file>\ncheckmate <setup|save-plan|gate|begin|finalize|report|delegate> <request> [candidate]\nOptions: --workspace <path>\nDelegate options: --host <claude|codex|pi>, --allow <host rule>, --unrestricted-host, --timeout <seconds>'
			)
			return
		}
		const positional = []
		const options: DelegateOptions & { allowedTools: string[] } = { allowedTools: [] }
		let workspace = process.cwd()
		for (let i = 0; i < args.length; i++) {
			const option = args[i]
			const value = () => {
				const next = args[++i]
				requireCondition(next !== undefined && !next.startsWith('--'), `Missing value for ${option}`)
				return next
			}
			if (option === '--workspace') workspace = resolve(value())
			else if (option === '--allow') options.allowedTools.push(value())
			else if (option === '--timeout') options.timeoutSeconds = Number(value())
			else if (option === '--host') options.host = value()
			else if (option === '--unrestricted-host') options.unrestrictedHost = true
			else {
				requireCondition(!option.startsWith('--'), `Unknown option: ${option}`)
				positional.push(option)
			}
		}
		if (options.timeoutSeconds !== undefined)
			requireCondition(
				Number.isInteger(options.timeoutSeconds) &&
					options.timeoutSeconds > 0 &&
					options.timeoutSeconds <= 3600,
				'Invalid timeout'
			)
		const [command] = positional
		requireCondition(commands.includes(command), `Unknown command: ${command}`)
		requireCondition(
			command === 'delegate' ||
				(options.timeoutSeconds === undefined &&
					!options.allowedTools.length &&
					options.host === undefined &&
					!options.unrestrictedHost),
			'--host, --allow, --unrestricted-host, and --timeout apply only to delegate'
		)
		if (command === 'validate') {
			const [, kind, file] = positional
			requireCondition(positional.length === 3, 'Usage: checkmate validate <kind> <file>')
			requireCondition(kinds.includes(kind), `Unknown kind: ${kind}. Use one of: ${kinds.join(', ')}`)
			const document = await readDocument(workspace, file)
			if (kind === 'request') requestCheck(document.value)
			else if (kind === 'profile') profileCheck(document.value)
			else if (kind === 'plan') planCheck(document.value)
			else validate(kind as 'plan-candidate' | 'observation' | 'result', document.value)
			console.log(JSON.stringify({ valid: true, kind, artifact: document.reference }))
			return
		}
		const [, path, candidatePath] = positional
		requireCondition(positional.length >= 2 && positional.length <= 3, 'Invalid arguments')
		const document = await readDocument(workspace, path)
		request = requestCheck(document.value)
		let result: Response
		if (command === 'delegate') result = await delegate(workspace, path, options)
		else if (command === 'gate') {
			const checked = await gate(workspace, request)
			result = response(request, checked.status, null, checked.reasons)
		} else if (command === 'begin') result = await beginRun(workspace, request)
		else if (command === 'report') {
			requireCondition(request.operation === 'report', 'Expected a report request')
			await reports(workspace, request.result)
			result = response(request, 'completed', request.result)
		} else {
			requireCondition(candidatePath, `${command} needs a candidate file`)
			const candidate = (await readDocument(workspace, candidatePath)).value
			if (command === 'setup') result = await setup(workspace, request, candidate)
			else if (command === 'save-plan') result = await savePlan(workspace, request, candidate)
			else result = await finalize(workspace, request, candidate)
		}
		console.log(JSON.stringify(result))
		if (['invalid_request', 'operational_error', 'interrupted'].includes(result.status)) process.exitCode = 1
	} catch (caught) {
		const error = caught instanceof Error ? caught : new Error('Unknown failure')
		console.log(
			JSON.stringify(
				request
					? response(request, 'invalid_request', null, [error.message])
					: { status: 'invalid_request', reasons: [error.message] }
			)
		)
		process.exitCode = 1
	}
}
