export const testLevels = {
	smoke: { explorers: 1, model: 'haiku', verifier: false, studySeconds: 300, testSeconds: 600 },
	standard: { explorers: 3, model: 'haiku', verifier: true, studySeconds: 600, testSeconds: 900 },
	deep: { explorers: 2, model: 'sonnet', verifier: true, studySeconds: 600, testSeconds: 1500 },
} as const
export type TestLevel = keyof typeof testLevels
export const levelNames = Object.keys(testLevels) as TestLevel[]
export const defaultLevel: TestLevel = 'standard'
