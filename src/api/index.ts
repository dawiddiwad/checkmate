import type {
	DescribeResultV1,
	ExecutionResultV1,
	InvalidInvocationResultV1,
	ValidationResultV1,
	Diagnostic,
} from '../contracts/types.js'
import { describeEnvironment, prepareRun, type PreparationOptions } from './prepare-run.js'
import { allocateRunIdentity, type AllocatePreparedRunIdentityOptions } from './allocate-run-identity.js'
import { executePreparedRun, type ExecutePreparedRunOptions } from './execute-prepared-run.js'

export type CheckmateOptions = Readonly<{
	cwd?: string
	configPath?: string
	signal?: AbortSignal
}>

export type ApiDependencies = Readonly<{
	prepare?: typeof prepareRun
	allocate?: typeof allocateRunIdentity
	execute?: typeof executePreparedRun
	preparation?: Omit<PreparationOptions, 'cwd' | 'configPath'>
	allocation?: AllocatePreparedRunIdentityOptions
	execution?: Omit<ExecutePreparedRunOptions, 'signal'>
}>

export class CheckmateOperationalError extends Error {
	readonly diagnostics: readonly Diagnostic[]

	constructor(diagnostics: readonly Diagnostic[]) {
		super(diagnostics.map((diagnostic) => diagnostic.message).join('; '))
		this.name = 'CheckmateOperationalError'
		this.diagnostics = diagnostics.map((diagnostic) => ({ ...diagnostic }))
	}
}

export async function run(
	request: unknown,
	options: CheckmateOptions = {},
	dependencies: ApiDependencies = {}
): Promise<ExecutionResultV1 | InvalidInvocationResultV1> {
	const preparation = await (dependencies.prepare ?? prepareRun)(request, {
		cwd: options.cwd,
		configPath: options.configPath,
		...dependencies.preparation,
	})
	if (preparation.ok === false) {
		if (preparation.status === 'error') throw new CheckmateOperationalError(preparation.diagnostics)
		return {
			kind: 'run-result',
			schemaVersion: 1,
			status: 'invalid',
			category: 'invalid',
			reason: 'invalid-invocation',
			targetMutation: 'not-attempted',
			diagnostics: preparation.diagnostics,
		}
	}

	const identity = await (dependencies.allocate ?? allocateRunIdentity)(preparation.prepared, {
		...dependencies.allocation,
		...(dependencies.allocation?.now || !dependencies.execution?.now
			? {}
			: { now: () => new Date(dependencies.execution!.now!()) }),
	})
	return (dependencies.execute ?? executePreparedRun)(preparation.prepared, identity, {
		signal: options.signal,
		readEnvironment: dependencies.preparation?.readEnvironment,
		...dependencies.execution,
	})
}

export async function validate(
	request: unknown,
	options: Omit<CheckmateOptions, 'signal'> = {},
	dependencies: Pick<ApiDependencies, 'preparation'> = {}
): Promise<ValidationResultV1> {
	const preparation = await prepareRun(request, { ...options, ...dependencies.preparation })
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
		policy: { id: preparation.prepared.policy.id, effectiveLimits: { ...preparation.prepared.effectiveLimits } },
		driver: {
			id: preparation.prepared.driver.id,
			contractVersion: preparation.prepared.driver.descriptor.driverContractVersion,
		},
		diagnostics: [],
	}
}

export function describe(
	options: Omit<CheckmateOptions, 'signal'> = {},
	dependencies: Pick<ApiDependencies, 'preparation'> = {}
): Promise<DescribeResultV1> {
	return describeEnvironment({ ...options, ...dependencies.preparation })
}
