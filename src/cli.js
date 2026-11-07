import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { readDocument, requireCondition } from './files.js'
import { validate, profileCheck, planCheck } from './contracts.js'
import { setup, savePlan, gate, beginRun, finalize, reports, response } from './stages.js'
import { delegate } from './launcher.js'

export async function main(args) {
	let request
	try {
		if (args[0] === '--version') {
			console.log(JSON.parse(readFileSync(new URL('../package.json', import.meta.url))).version)
			return
		}
		if (!args.length || args[0] === '--help') {
			console.log(
				'checkmate <validate|setup|save-plan|gate|begin|finalize|report|delegate> <file> [candidate]\nOptions: --workspace <path>, --allow <Claude tool rule>, --timeout <seconds>'
			)
			return
		}
		const positional = []
		const options = { allowedTools: [] }
		let workspace = process.cwd()
		for (let i = 0; i < args.length; i++) {
			if (args[i] === '--workspace') workspace = resolve(args[++i])
			else if (args[i] === '--allow') options.allowedTools.push(args[++i])
			else if (args[i] === '--timeout') options.timeoutSeconds = Number(args[++i])
			else {
				requireCondition(!args[i].startsWith('--'), 'Unknown option')
				positional.push(args[i])
			}
		}
		if (options.timeoutSeconds !== undefined)
			requireCondition(
				Number.isInteger(options.timeoutSeconds) &&
					options.timeoutSeconds > 0 &&
					options.timeoutSeconds <= 3600,
				'Invalid timeout'
			)
		requireCondition(
			options.allowedTools.every((value) => typeof value === 'string' && value.length > 0),
			'Missing tool rule'
		)
		const [command, path, candidatePath] = positional
		requireCondition(positional.length >= 2 && positional.length <= 3, 'Invalid arguments')
		const document = await readDocument(workspace, path)
		if (command === 'validate') {
			const value = document.value
			if (value.operation) validate(`${value.operation}-request`, value)
			else if (value.planId) planCheck(value)
			else if (value.targetId) profileCheck(value)
			else validate('result', value)
			console.log(JSON.stringify({ valid: true, artifact: document.reference }))
			return
		}
		request = validate(`${document.value.operation}-request`, document.value)
		let result
		if (command === 'delegate') result = await delegate(workspace, path, options)
		else if (command === 'gate') {
			const checked = await gate(workspace, request)
			result = response(request, checked.status, null, checked.reasons)
		} else if (command === 'begin') result = await beginRun(workspace, request)
		else if (command === 'report') {
			validate('report-request', request)
			await reports(workspace, request.result)
			result = response(request, 'completed', request.result)
		} else {
			requireCondition(
				['setup', 'save-plan', 'finalize'].includes(command) && candidatePath,
				'Command needs a candidate file'
			)
			const candidate = (await readDocument(workspace, candidatePath)).value
			if (command === 'setup') result = await setup(workspace, request, candidate)
			if (command === 'save-plan') result = await savePlan(workspace, request, candidate)
			if (command === 'finalize') result = await finalize(workspace, request, candidate)
		}
		console.log(JSON.stringify(result))
		if (['invalid_request', 'operational_error', 'interrupted'].includes(result.status)) process.exitCode = 1
	} catch (error) {
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
