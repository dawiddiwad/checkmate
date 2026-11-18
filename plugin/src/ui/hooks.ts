import type { IncomingMessage, ServerResponse } from 'node:http'
import type { Store } from '../store.ts'
import type { ClosedCause, Suggestion } from '../permissions.ts'
import { timingSafeEqual } from 'node:crypto'
import { completed, one, write } from '../store.ts'
import { addEvent } from '../explorations.ts'
import { explorerActor } from '../recorder.ts'
import { closePermission, permissionAnswer, permissionOf, requestPermission, stoppedSince } from '../permissions.ts'

export type HookOptions = {
	holdMilliseconds?: number
	activityMilliseconds?: number
	log?: (line: string) => void
}

export type Hooks = {
	handles(pathname: string): boolean
	handle(req: IncomingMessage, res: ServerResponse, pathname: string): Promise<void>
	release(): void
	close(): void
}

type Held = { explorationId: string; id: string; res: ServerResponse; timer: NodeJS.Timeout }
type Line = { text: string; dirty: boolean; writtenAt: number; timer?: NodeJS.Timeout }

const name = '[A-Za-z0-9][A-Za-z0-9_-]{0,95}'
const route = new RegExp(`^/hooks/(permission|activity)/(${name})/(${name})$`)
const maxBody = 4 * 1024 * 1024
const lineLimit = 120
export const defaultHoldMilliseconds = 590_000
export const defaultActivityMilliseconds = 2000

export function sameSecret(a: string, b: string) {
	const x = Buffer.from(a)
	const y = Buffer.from(b)
	return x.length === y.length && timingSafeEqual(x, y)
}

const secrets: Array<[RegExp, string]> = [
	[/(:\/\/)[^\s/@:]+:[^\s/@]+@/g, '$1…@'],
	[/(authorization:\s*(?:bearer\s+|basic\s+|token\s+)?)[^\s"']+/gi, '$1…'],
	[/(bearer\s+)[^\s"']+/gi, '$1…'],
	[/(--?[\w-]*(?:token|password|passwd|secret|api-?key|apikey|auth)[\w-]*(?:=|\s+))[^\s"']+/gi, '$1…'],
	[/(\b[\w]*(?:token|password|passwd|secret|api_?key|apikey)[\w]*=)[^\s"']+/gi, '$1…'],
]

const lineKeys = ['command', 'file_path', 'notebook_path', 'path', 'pattern', 'url', 'query', 'description']

function relative(path: string, cwd: unknown) {
	return typeof cwd === 'string' && cwd && path.startsWith(`${cwd}/`) ? path.slice(cwd.length + 1) : path
}

export function inputLine(input: unknown, cwd?: unknown) {
	const fields = input && typeof input === 'object' ? (input as Record<string, unknown>) : {}
	const key = lineKeys.find((item) => typeof fields[item] === 'string' && fields[item])
	if (!key) return ''
	const first = (fields[key] as string).trim().split('\n')[0]
	const shown = key.endsWith('path') ? relative(first, cwd) : first
	return secrets.reduce((text, [pattern, replacement]) => text.replace(pattern, replacement), shown)
}

export function activityLine(tool: string, input: unknown, cwd?: unknown) {
	const shown = inputLine(input, cwd)
	const line = shown ? `${tool}: ${shown}` : tool
	return line.length > lineLimit ? `${line.slice(0, lineLimit - 1)}…` : line
}

function readJson(req: IncomingMessage): Promise<unknown> {
	return new Promise((resolve) => {
		const chunks: Buffer[] = []
		let length = 0
		req.on('data', (chunk: Buffer) => {
			length += chunk.length
			if (length <= maxBody) chunks.push(chunk)
		})
		req.on('end', () => {
			try {
				resolve(length > maxBody ? null : JSON.parse(Buffer.concat(chunks).toString('utf8')))
			} catch {
				resolve(null)
			}
		})
		req.on('error', () => resolve(null))
	})
}

function refuse(res: ServerResponse) {
	res.writeHead(403, { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'no-store' })
	res.end('Refused: a hook call needs the hook token and no Origin header.')
}

function answer(res: ServerResponse, body: string) {
	res.writeHead(200, {
		'Cache-Control': 'no-store',
		...(body ? { 'Content-Type': 'application/json' } : {}),
		'Content-Length': Buffer.byteLength(body),
	})
	res.end(body)
}

export function createHooks(store: Store, token: string, options: HookOptions = {}): Hooks {
	const holdMilliseconds = options.holdMilliseconds ?? defaultHoldMilliseconds
	const activityMilliseconds = options.activityMilliseconds ?? defaultActivityMilliseconds
	const log = options.log ?? ((line: string) => process.stderr.write(`checkmate ui: ${line}\n`))
	const held = new Map<string, Held>()
	const lines = new Map<string, Line>()

	function finish(entry: Held, cause?: ClosedCause) {
		held.delete(`${entry.explorationId}/${entry.id}`)
		clearTimeout(entry.timer)
		let body = ''
		try {
			if (cause) closePermission(store, entry.explorationId, entry.id, cause)
			const request = permissionOf(store, entry.explorationId, entry.id)
			if (request?.decision) body = permissionAnswer(request, request.decision)
		} catch (error) {
			log(`could not answer ${entry.id} of ${entry.explorationId}: ${(error as Error).message}`)
		}
		answer(entry.res, body)
	}

	function release() {
		for (const entry of [...held.values()]) {
			try {
				const request = permissionOf(store, entry.explorationId, entry.id)
				if (!request || request.decision) finish(entry)
				else if (stoppedSince(store, request)) finish(entry, 'stopped')
			} catch (error) {
				log(`could not release ${entry.id} of ${entry.explorationId}: ${(error as Error).message}`)
			}
		}
	}

	function hold(explorationId: string, id: string, res: ServerResponse) {
		const key = `${explorationId}/${id}`
		const entry: Held = {
			explorationId,
			id,
			res,
			timer: setTimeout(() => finish(entry, 'timeout'), holdMilliseconds),
		}
		held.set(key, entry)
		res.on('close', () => {
			if (held.get(key) !== entry) return
			held.delete(key)
			clearTimeout(entry.timer)
			try {
				closePermission(store, explorationId, id, 'disconnected')
			} catch (error) {
				log(`could not close ${id} of ${explorationId}: ${(error as Error).message}`)
			}
		})
	}

	function permission(explorationId: string, who: string, body: Record<string, unknown>, res: ServerResponse) {
		const input = body.tool_input
		if (typeof body.tool_name !== 'string' || !input || typeof input !== 'object') {
			log(`permission call of ${who} in ${explorationId} has no tool_name and tool_input`)
			return answer(res, '')
		}
		const suggestions = Array.isArray(body.permission_suggestions)
			? (body.permission_suggestions.filter((item) => item && typeof item === 'object') as Suggestion[])
			: []
		try {
			const cwd = typeof body.cwd === 'string' && body.cwd ? body.cwd : undefined
			const made = requestPermission(store, { explorationId, who, tool: body.tool_name, input, suggestions, cwd })
			if (!made.byRule) return hold(explorationId, made.id, res)
			const request = permissionOf(store, explorationId, made.id)!
			answer(res, permissionAnswer(request, request.decision!))
		} catch (error) {
			log(`could not record the permission call of ${who} in ${explorationId}: ${(error as Error).message}`)
			answer(res, '')
		}
	}

	function writeLine(explorationId: string, who: string, line: Line) {
		line.timer = undefined
		if (!line.dirty) return
		line.dirty = false
		line.writtenAt = Date.now()
		const operation = { actor: explorerActor(who), command: 'explore activity', subject: explorationId }
		try {
			write(store, { ...operation, input: { who } }, (operationId, at) => {
				addEvent(
					store,
					explorationId,
					{ step: 'activity', explorer: who, status: 'started', detail: { activity: line.text } },
					operationId,
					at
				)
				return { reply: completed(explorationId), subjects: [`exploration:${explorationId}`] }
			})
		} catch (error) {
			log(`could not record the activity of ${who} in ${explorationId}: ${(error as Error).message}`)
		}
	}

	function activity(explorationId: string, who: string, body: Record<string, unknown>) {
		if (typeof body.tool_name !== 'string')
			return log(`activity call of ${who} in ${explorationId} has no tool_name`)
		const tester = one(
			store,
			"SELECT 1 FROM exploration_events WHERE exploration_id = ? AND step = 'launch' AND explorer = ?",
			explorationId,
			who
		)
		if (!tester) return
		const key = `${explorationId}/${who}`
		const line = lines.get(key) ?? { text: '', dirty: false, writtenAt: 0 }
		lines.set(key, line)
		line.text = activityLine(body.tool_name, body.tool_input, body.cwd)
		line.dirty = true
		const wait = line.writtenAt + activityMilliseconds - Date.now()
		if (wait <= 0) writeLine(explorationId, who, line)
		else line.timer ??= setTimeout(() => writeLine(explorationId, who, line), wait)
	}

	return {
		handles: (pathname) => route.test(pathname),
		async handle(req, res, pathname) {
			const [, kind, explorationId, who] = route.exec(pathname)!
			const bearer = req.headers.authorization
			if (
				req.headers.origin !== undefined ||
				typeof bearer !== 'string' ||
				!sameSecret(bearer, `Bearer ${token}`)
			)
				return refuse(res)
			const body = await readJson(req)
			const expected = kind === 'permission' ? 'PermissionRequest' : 'PreToolUse'
			const known = one(store, 'SELECT 1 FROM explorations WHERE exploration_id = ?', explorationId)
			const valid =
				body && typeof body === 'object' && (body as Record<string, unknown>).hook_event_name === expected
			if (!known || !valid) {
				log(`${kind} call of ${who} in ${explorationId} is not a ${expected} event of a known exploration`)
				return answer(res, '')
			}
			if (kind === 'permission') return permission(explorationId, who, body as Record<string, unknown>, res)
			activity(explorationId, who, body as Record<string, unknown>)
			answer(res, '')
		},
		release,
		close() {
			for (const entry of [...held.values()]) finish(entry, 'ui-stopped')
			for (const [key, line] of lines) {
				clearTimeout(line.timer)
				const [explorationId, who] = key.split('/')
				writeLine(explorationId, who, line)
			}
			lines.clear()
		},
	}
}
