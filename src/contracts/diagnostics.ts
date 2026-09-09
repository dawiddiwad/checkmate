import type { ErrorObject } from 'ajv'
import type { Diagnostic } from './types.js'

export function schemaDiagnostics(errors: ErrorObject[] | null | undefined): Diagnostic[] {
	return (errors ?? []).map(toDiagnostic).sort(compareDiagnostics)
}

function toDiagnostic(error: ErrorObject): Diagnostic {
	return {
		code: `schema.${error.keyword}`,
		path: diagnosticPath(error),
		message: error.message ?? `failed ${error.keyword} validation`,
	}
}

function diagnosticPath(error: ErrorObject): string {
	if (error.keyword === 'required') {
		return appendPath(error.instancePath, String(error.params.missingProperty))
	}

	if (error.keyword === 'additionalProperties') {
		return appendPath(error.instancePath, String(error.params.additionalProperty))
	}

	return error.instancePath
}

function appendPath(path: string, member: string): string {
	return `${path}/${member.replaceAll('~', '~0').replaceAll('/', '~1')}`
}

function compareDiagnostics(left: Diagnostic, right: Diagnostic): number {
	return (
		compareText(left.path, right.path) ||
		compareText(left.code, right.code) ||
		compareText(left.message, right.message)
	)
}

function compareText(left: string, right: string): number {
	return left < right ? -1 : left > right ? 1 : 0
}
