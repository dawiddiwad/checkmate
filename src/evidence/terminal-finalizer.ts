import type { Diagnostic, ExecutionResultV1 } from '../contracts/types.js'
import { serializeJson } from '../contracts/serialize.js'
import { validateRunResult } from '../contracts/validator.js'
import { AtomicWriteError } from './atomic-file.js'
import type { CommittedResult, EvidenceStore, PreparedTerminalResult } from './store.js'

export type TerminalResult =
	| Readonly<{ committed: true; result: ExecutionResultV1; bytes: string; path: string }>
	| Readonly<{ committed: false; result: ExecutionResultV1; bytes: string }>

export class TerminalFinalizer {
	constructor(private readonly store: EvidenceStore) {}

	async finalize(candidate: ExecutionResultV1): Promise<TerminalResult> {
		assertExecutionResult(candidate)
		const prepared = this.store.prepareResult(candidate)
		assertExecutionResult(prepared.result)
		try {
			const committed: CommittedResult = await this.store.writeResult(prepared)
			return { committed: true, ...committed, result: parseExecutionResult(committed.bytes) }
		} catch (error) {
			const failure = resultWriteFailure(prepared, this.failureDiagnostic(error))
			assertExecutionResult(failure)
			const bytes = serializeJson(failure)
			return { committed: false, result: parseExecutionResult(bytes), bytes }
		}
	}

	private failureDiagnostic(error: unknown): Diagnostic {
		const detail = error instanceof Error ? error.message : String(error)
		const durability =
			error instanceof AtomicWriteError && error.durability === 'uncertain'
				? ' The destination was renamed, but durability was not confirmed; no committed terminal result was accepted.'
				: ''
		return {
			code: 'result.write-failed',
			path: '',
			message: this.store.sanitizeDiagnosticText(`Could not commit result.json: ${detail}.${durability}`.trim()),
		}
	}
}

function parseExecutionResult(bytes: string): ExecutionResultV1 {
	const result = JSON.parse(bytes) as ExecutionResultV1
	assertExecutionResult(result)
	return result
}

function resultWriteFailure(prepared: PreparedTerminalResult, diagnostic: Diagnostic): ExecutionResultV1 {
	return {
		...prepared.result,
		status: 'failed',
		category: 'infra',
		reason: 'result-write-failed',
		diagnostics: [...prepared.result.diagnostics, diagnostic],
	}
}

function assertExecutionResult(result: ExecutionResultV1): void {
	const validation = validateRunResult(result)
	if (validation.ok === false) {
		throw new TypeError(
			`Invalid execution result: ${validation.diagnostics.map((item) => item.message).join('; ')}`
		)
	}
}
