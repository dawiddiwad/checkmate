import type { DescribeResultV1, Diagnostic, ValidationResultV1 } from '../contracts/types.js'
import { boundDiagnostics, type JsonInputSource } from '../config/ingestion.js'
import { describeEnvironment, prepareRun, prepareRunSource, type PreparationOptions } from '../api/prepare-run.js'

export async function validateStaticRequest(
	request: unknown,
	options: PreparationOptions = {}
): Promise<ValidationResultV1> {
	const preparation = await prepareRun(request, options)
	return validationResult(preparation)
}

export async function validateStaticSource(
	source: JsonInputSource,
	options: PreparationOptions = {}
): Promise<ValidationResultV1> {
	const preparation = await prepareRunSource(source, options)
	return validationResult(preparation)
}

function validationResult(preparation: Awaited<ReturnType<typeof prepareRun>>): ValidationResultV1 {
	if (preparation.ok === false) {
		return {
			kind: 'validation-result',
			schemaVersion: 1,
			status: preparation.status,
			diagnostics: preparation.diagnostics,
		}
	}

	return {
		kind: 'validation-result',
		schemaVersion: 1,
		status: 'valid',
		scenarioId: preparation.prepared.request.scenario.id,
		policy: {
			id: preparation.prepared.policy.id,
			effectiveLimits: { ...preparation.prepared.effectiveLimits },
		},
		driver: {
			id: preparation.prepared.driver.id,
			contractVersion: preparation.prepared.driver.descriptor.driverContractVersion,
		},
		diagnostics: [],
	}
}

export async function describeStaticEnvironment(options: PreparationOptions = {}): Promise<DescribeResultV1> {
	return describeEnvironment(options)
}

export function validationError(diagnostic: Diagnostic): ValidationResultV1 {
	return {
		kind: 'validation-result',
		schemaVersion: 1,
		status: 'invalid',
		diagnostics: boundDiagnostics([diagnostic]),
	}
}

export function describeError(diagnostic: Diagnostic): DescribeResultV1 {
	return {
		kind: 'describe-result',
		schemaVersion: 1,
		status: 'invalid',
		diagnostics: boundDiagnostics([diagnostic]),
	}
}

export function unexpectedValidationError(): ValidationResultV1 {
	return {
		kind: 'validation-result',
		schemaVersion: 1,
		status: 'error',
		diagnostics: boundDiagnostics([
			{
				code: 'internal-error',
				path: '',
				message: 'validation failed because of an unexpected operational error',
			},
		]),
	}
}

export function unexpectedDescribeError(): DescribeResultV1 {
	return {
		kind: 'describe-result',
		schemaVersion: 1,
		status: 'error',
		diagnostics: boundDiagnostics([
			{
				code: 'internal-error',
				path: '',
				message: 'description failed because of an unexpected operational error',
			},
		]),
	}
}
