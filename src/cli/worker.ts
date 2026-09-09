import { fileURLToPath } from 'node:url'
import { resolve } from 'node:path'
import { executePreparedRun } from '../api/execute-prepared-run.js'
import { serializeJson } from '../contracts/serialize.js'
import type { Diagnostic } from '../contracts/types.js'
import type { RuntimeLogger } from '../logging/types.js'
import { scrub } from '../redaction/scrub.js'
import {
	assertIpcFrameSize,
	diagnosticFrame,
	parseParentMessage,
	sendIpcFrame,
	terminalDigest,
	type ParentMessage,
	type WorkerMessage,
} from './protocol.js'

export type WorkerProcess = Pick<NodeJS.Process, 'on' | 'send' | 'disconnect'>

export function runWorkerProcess(workerProcess: WorkerProcess = process): void {
	const controller = new AbortController()
	let started = false
	let runId: string | undefined

	workerProcess.on('message', (raw: unknown) => {
		let message: ParentMessage
		try {
			message = parseParentMessage(raw)
		} catch {
			return
		}
		if (message.type === 'abort') {
			controller.abort(message.signal)
			return
		}
		if (started) return
		started = true
		runId = message.identity.runId
		void execute(message, controller, workerProcess).catch((error) => {
			if (!runId) return
			send(workerProcess, {
				type: 'fatal',
				runId,
				diagnostic: fatalDiagnostic(error),
			})
			workerProcess.disconnect?.()
		})
	})
}

async function execute(
	message: Extract<ParentMessage, { type: 'start' }>,
	controller: AbortController,
	workerProcess: WorkerProcess
): Promise<void> {
	const runId = message.identity.runId
	const logger = workerLogger(runId, workerProcess)
	const result = await executePreparedRun(message.prepared, message.identity, {
		signal: controller.signal,
		logger,
		onCleanupStarted: () => send(workerProcess, { type: 'cleanup-started', runId }),
	})
	const resultJson = serializeJson(result)
	const committed = result.reason !== 'result-write-failed'

	if (!committed) {
		const terminal: WorkerMessage = { type: 'terminal-inline', runId, committed: false, resultJson }
		try {
			assertIpcFrameSize(terminal)
			send(workerProcess, terminal)
		} catch {
			send(workerProcess, {
				type: 'fatal',
				runId,
				diagnostic: {
					code: 'worker.result-unavailable',
					path: '',
					message: 'The uncommitted terminal result exceeded the IPC frame limit',
				},
			})
		}
		workerProcess.disconnect?.()
		return
	}

	const digest = terminalDigest(resultJson)
	const inline: WorkerMessage = { type: 'terminal-inline', runId, committed: true, resultJson, digest }
	try {
		assertIpcFrameSize(inline)
		send(workerProcess, inline)
	} catch {
		send(workerProcess, { type: 'terminal-file', runId, committed: true, digest })
	}
	workerProcess.disconnect?.()
}

function workerLogger(runId: string, workerProcess: WorkerProcess): RuntimeLogger {
	const write = (level: 'debug' | 'info' | 'warn' | 'error', message: string): void => {
		send(workerProcess, diagnosticFrame(runId, { code: `worker.log.${level}`, path: '', message }))
	}
	return {
		debug: (message) => write('debug', message),
		info: (message) => write('info', message),
		warn: (message) => write('warn', message),
		error: (message) => write('error', message),
	}
}

function send(workerProcess: WorkerProcess, message: WorkerMessage): void {
	if (!workerProcess.send) return
	try {
		sendIpcFrame((frame) => workerProcess.send!(frame), message)
	} catch {
		return
	}
}

function fatalDiagnostic(error: unknown): Diagnostic {
	return {
		code: 'worker.fatal',
		path: '',
		message: scrub(error instanceof Error ? error.message : String(error)),
	}
}

const entry = process.argv[1] ? resolve(process.argv[1]) : ''
if (entry === resolve(fileURLToPath(import.meta.url))) runWorkerProcess()
