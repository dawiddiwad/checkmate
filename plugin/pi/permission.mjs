import { request as httpRequest } from 'node:http'

// Chat turns may run these Checkmate commands without asking. Anything else still asks the person.
// A segment is allowed only when it runs the Checkmate CLI at a listed path with an allowed subcommand.
const readOnly = [
	['inbox'],
	['status'],
	['plan', 'list'],
	['plan', 'show'],
	['plan', 'pending'],
	['plan', 'diff'],
	['plan', 'promotions'],
	['plan', 'request'],
	['target', 'list'],
	['target', 'show'],
	['run', 'list'],
	['run', 'show'],
	['claim', 'list'],
	['claim', 'show'],
	['finding', 'list'],
	['explore', 'show'],
	['explore', 'status'],
	['explore', 'wait'],
]
// These record what the person asked for in chat. Only plan edit, revise, and save take a JSON body on stdin.
const recordWrites = [
	['gap', 'answer'],
	['delegate', 'revise'],
]
const planBodies = [
	['plan', 'edit'],
	['plan', 'revise'],
	['plan', 'save'],
]
const heredocMarker = "<<'EOF'\n"

function words(segment) {
	const tokens = []
	let token = null
	let quote = null
	for (let i = 0; i < segment.length; i++) {
		const char = segment[i]
		if (quote === "'") {
			if (char === "'") quote = null
			else token += char
			continue
		}
		if (quote === '"') {
			if (char === '"') quote = null
			else if ('$`\\\n'.includes(char)) return null
			else token += char
			continue
		}
		if (char === ' ') {
			if (token !== null) tokens.push(token)
			token = null
		} else if (char === "'" || char === '"') {
			quote = char
			token = token ?? ''
		} else if (';|&<>$`()\\\n\t'.includes(char)) return null
		else token = (token ?? '') + char
	}
	if (quote) return null
	if (token !== null) tokens.push(token)
	return tokens
}

function allowedArguments(args, body) {
	if (body === null && args.at(-1) === '--help' && args.length <= 2) return true
	const starts = (prefix) => prefix.every((word, index) => args[index] === word)
	if (readOnly.some((prefix) => starts(prefix)) && body === null) return true
	if (recordWrites.some((prefix) => starts(prefix)) && body === null) return true
	if (planBodies.some((prefix) => starts(prefix)) && body !== null) return true
	return false
}

export function chatCommandAllowed(command, clis) {
	if (typeof command !== 'string' || !Array.isArray(clis)) return false
	let text = command
	let body = null
	const at = text.indexOf(heredocMarker)
	if (at >= 0) {
		const tail = text.slice(at + heredocMarker.length)
		if (!tail.endsWith('\nEOF')) return false
		body = tail.slice(0, -'\nEOF'.length)
		if (body.split('\n').includes('EOF')) return false
		text = text.slice(0, at).trimEnd()
	}
	const segments = text.split(' && ')
	if (segments.length === 0 || segments.some((segment) => segment.trim() === '')) return false
	return segments.every((segment, index) => {
		const tokens = words(segment)
		if (!tokens) return false
		const lead = tokens[0] === 'CHECKMATE_HARNESS=pi' ? 1 : 0
		if (tokens[lead] !== 'node' || !clis.includes(tokens[lead + 1])) return false
		const args = tokens.slice(lead + 2)
		return allowedArguments(args, index === segments.length - 1 ? body : null)
	})
}

// fetch ends a request after 5 minutes without response headers, whatever the signal says.
// A person may take up to 10 minutes to answer a permission, so the hook uses node:http, which only
// applies the socket timeout.
function post(hook, kind, body, timeout) {
	return new Promise((resolve, reject) => {
		const text = JSON.stringify(body)
		const request = httpRequest(
			`http://127.0.0.1:${hook.port}/hooks/${kind}/${hook.explorationId}/${hook.who}`,
			{
				method: 'POST',
				headers: {
					Authorization: `Bearer ${hook.token}`,
					'Content-Type': 'application/json',
					'Content-Length': Buffer.byteLength(text),
				},
				timeout,
			},
			(response) => {
				let received = ''
				response.setEncoding('utf8')
				response.on('data', (chunk) => (received += chunk))
				response.on('end', () =>
					resolve({ ok: response.statusCode >= 200 && response.statusCode < 300, text: received })
				)
				response.on('error', reject)
			}
		)
		request.on('timeout', () => request.destroy(new Error('The permission request timed out.')))
		request.on('error', reject)
		request.end(text)
	})
}

export default function (pi) {
	pi.registerCommand('checkmate-permission-ready', { handler: async () => {} })
	pi.on('tool_call', async (event, ctx) => {
		let hook
		try {
			hook = JSON.parse(process.env.CHECKMATE_PI_HOOK || '')
			if (
				!Number.isInteger(hook.port) ||
				typeof hook.token !== 'string' ||
				!/^[A-Za-z0-9][A-Za-z0-9_-]{0,95}$/.test(hook.explorationId) ||
				!/^[A-Za-z0-9][A-Za-z0-9_-]{0,95}$/.test(hook.who)
			)
				throw new Error('Invalid hook')
			const body = { tool_name: event.toolName, tool_input: event.input, cwd: ctx.cwd }
			const send = (kind, name, timeout) => post(hook, kind, { ...body, hook_event_name: name }, timeout)
			await send('activity', 'PreToolUse', 5000).catch(() => {})
			if (Array.isArray(hook.allow) && hook.allow.includes(event.toolName)) return
			if (hook.chat === true && event.toolName === 'bash' && chatCommandAllowed(event.input?.command, hook.clis))
				return
			const response = await send('permission', 'PermissionRequest', 600000)
			if (!response.ok) throw new Error('Permission request failed')
			const answer = JSON.parse(response.text)
			const decision = answer?.hookSpecificOutput?.decision
			if (decision?.behavior === 'allow') return
			return { block: true, reason: decision?.message || 'Permission was not granted.' }
		} catch {
			return { block: true, reason: 'Checkmate could not get permission for this tool.' }
		}
	})
}
