import type { TestLevel } from './types.ts'
import testLevelSchema from '../contracts/test-level.schema.json' with { type: 'json' }

export const testLevels = {
	smoke: { explorers: 1, model: 'haiku', verifier: false, studySeconds: 300, testSeconds: 600, followSeconds: 300 },
	normal: { explorers: 2, model: 'haiku', verifier: true, studySeconds: 600, testSeconds: 900, followSeconds: 600 },
	deep: { explorers: 3, model: 'haiku', verifier: true, studySeconds: 600, testSeconds: 900, followSeconds: 600 },
} as const satisfies Record<TestLevel, unknown>
export type { TestLevel }
export const levelNames = testLevelSchema.enum as TestLevel[]
export const defaultLevel: TestLevel = 'normal'
