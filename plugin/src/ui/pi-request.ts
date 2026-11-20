import { spawn } from 'node:child_process'
import type { PiEvent } from '../pi.ts'
import { piTurnUsage } from '../pi.ts'
import type { Env, StopDelays, StreamEnd, StreamedClaude } from '../sessions.ts'

export function streamPi(
	program: string,
	args: string[],
	prompt: string,
	cwd: string,
	env: Env,
	extension: string,
	sessionId: string,
	onLine: (line: string) => void,
	delays: StopDelays
): StreamedClaude {
	const child = spawn(program, args, { cwd, env, stdio: ['pipe', 'pipe', 'pipe'], detached: true })
	child.stdout.setEncoding('utf8')
	let pending = ''
	let stderr = ''
	let error: string | null = null
	let ready = false
	let stopped = false
	let prompted = false
	let settled = false
	const usage = piTurnUsage()
	const timers: NodeJS.Timeout[] = []
	const send = (value: unknown) => child.stdin.write(`${JSON.stringify(value)}\n`)
	const kill = (signal: NodeJS.Signals) => {
		try {
			process.kill(-child.pid!, signal)
		} catch {}
	}
	let closing = false
	const shutdown = () => {
		if (closing) return
		closing = true
		child.stdin.end()
		timers.push(
			setTimeout(() => kill('SIGTERM'), delays.terminate),
			setTimeout(() => kill('SIGKILL'), delays.terminate + delays.kill)
		)
	}

	const timeout = setTimeout(() => {
		error = 'Pi did not verify the permission gate.'
		kill('SIGTERM')
		timers.push(setTimeout(() => kill('SIGKILL'), delays.kill))
	}, 10000)
	child.stdin.on('error', () => {})
	child.on('error', (cause) => {
		error = `pi failed: ${cause.message}`
	})
	child.stderr.on('data', (bytes: Buffer) => {
		stderr = (stderr + bytes.toString()).slice(-16384)
	})
	child.stdout.on('data', (bytes: string) => {
		const lines = (pending + bytes).split('\n')
		pending = lines.pop() ?? ''
		for (const line of lines) {
			let value: PiEvent & {
				success?: boolean
				error?: string
				data?: { commands?: Array<{ name?: string; source?: string; sourceInfo?: { path?: string } }> }
			}
			try {
				value = JSON.parse(line)
				if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Invalid event')
			} catch {
				error = 'Pi printed a line that is not JSON.'
				shutdown()
				continue
			}
			if (prompted) usage.read(value)
			if (value.type === 'response' && value.id === 'checkmate-ready') {
				const commands = value.data?.commands
				ready =
					value.success === true &&
					Array.isArray(commands) &&
					commands.some(
						(command) =>
							command.name === 'checkmate-permission-ready' &&
							command.source === 'extension' &&
							command.sourceInfo?.path === extension
					)
				clearTimeout(timeout)
				if (!ready) {
					error = 'Pi did not load the permission gate.'
					shutdown()
					continue
				}
				onLine(JSON.stringify({ type: 'session', id: sessionId }))
				if (!stopped) {
					prompted = true
					send({ id: 'checkmate-prompt', type: 'prompt', message: prompt })
				}
			} else if (value.type === 'response' && value.id === 'checkmate-prompt' && value.success !== true) {
				error = `Pi rejected the request: ${value.error || 'unknown error'}`
				shutdown()
			} else if (value.type === 'agent_settled') {
				settled = value.aborted !== true
				onLine(line)
				shutdown()
			} else onLine(line)
		}
	})
	const finished = new Promise<StreamEnd>((resolve) => {
		child.on('close', (status, signal) => {
			clearTimeout(timeout)
			for (const timer of timers) clearTimeout(timer)
			resolve({
				status,
				signal,
				stderr,
				...usage.finish(!settled || Boolean(error)),
				error: error ?? (!ready && !stopped ? 'Pi did not verify the permission gate.' : null),
			})
		})
	})
	send({ id: 'checkmate-ready', type: 'get_commands' })
	return {
		pid: child.pid,
		finished,
		stop() {
			if (stopped) return
			stopped = true
			send({ type: 'abort' })
			shutdown()
		},
	}
}
