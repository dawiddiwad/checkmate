export const testLevels = {
	smoke: { explorers: 1, model: 'haiku', verifier: false },
	standard: { explorers: 3, model: 'haiku', verifier: true },
	deep: { explorers: 2, model: 'sonnet', verifier: true },
} as const
export type TestLevel = keyof typeof testLevels
export const levelNames = Object.keys(testLevels) as TestLevel[]
export const defaultLevel: TestLevel = 'standard'
