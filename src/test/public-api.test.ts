import { describe, expect, it } from 'vitest'
import * as checkmate from '../index'
import type { CheckmateOptions, ExecutionResultV1, InvalidInvocationResultV1 } from '../index'

describe('final public root', () => {
	it('exports only the embedding operations and operational error', () => {
		expect(Object.keys(checkmate).sort()).toEqual(['CheckmateOperationalError', 'describe', 'run', 'validate'])
		const run: (
			request: unknown,
			options?: CheckmateOptions
		) => Promise<ExecutionResultV1 | InvalidInvocationResultV1> = checkmate.run
		expect(run).toBeTypeOf('function')
	})
})
