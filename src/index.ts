import { run as runInProcess, validate as validateRequest, describe as describeEnvironment } from './api/index.js'
import type { CheckmateOptions } from './api/index.js'
import type {
	DescribeResultV1,
	ExecutionResultV1,
	InvalidInvocationResultV1,
	ValidationResultV1,
} from './contracts/types.js'

export { CheckmateOperationalError } from './api/index.js'
export type { CheckmateOptions } from './api/index.js'
export type * from './contracts/types.js'

export function run(
	request: unknown,
	options?: CheckmateOptions
): Promise<ExecutionResultV1 | InvalidInvocationResultV1> {
	return runInProcess(request, options)
}

export function validate(request: unknown, options?: Omit<CheckmateOptions, 'signal'>): Promise<ValidationResultV1> {
	return validateRequest(request, options)
}

export function describe(options?: Omit<CheckmateOptions, 'signal'>): Promise<DescribeResultV1> {
	return describeEnvironment(options)
}
