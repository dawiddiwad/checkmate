export const testLevels = {
	smoke: { explorers: 1, model: 'haiku', verifier: false, studySeconds: 300, testSeconds: 600, followSeconds: 300 },
	standard: { explorers: 3, model: 'haiku', verifier: true, studySeconds: 600, testSeconds: 900, followSeconds: 600 },
	deep: { explorers: 2, model: 'sonnet', verifier: true, studySeconds: 600, testSeconds: 1500, followSeconds: 900 },
} as const
export type TestLevel = keyof typeof testLevels
export const levelNames = Object.keys(testLevels) as TestLevel[]
export const defaultLevel: TestLevel = 'standard'
