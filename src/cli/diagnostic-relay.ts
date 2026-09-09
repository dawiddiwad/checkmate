import type { Diagnostic } from '../contracts/types.js'
import { normalizeSingleLine } from '../config/ingestion.js'
import { scrub } from '../redaction/scrub.js'

export type DiagnosticWriter = { write(value: string): unknown }

export function relayDiagnostic(diagnostic: Diagnostic, stderr: DiagnosticWriter): void {
	stderr.write(
		`${normalizeSingleLine(diagnostic.code)} ${normalizeSingleLine(diagnostic.path || '/')}: ${normalizeSingleLine(scrub(diagnostic.message))}\n`
	)
}
