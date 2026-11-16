export const testLevels = {
	smoke: { explorers: 1, model: 'haiku', verifier: false, minutes: 5 },
	standard: { explorers: 3, model: 'haiku', verifier: true, minutes: 10 },
	deep: { explorers: 2, model: 'sonnet', verifier: true, minutes: 20 },
} as const
export type TestLevel = keyof typeof testLevels
export const levelNames = Object.keys(testLevels) as TestLevel[]
export const defaultLevel: TestLevel = 'standard'
