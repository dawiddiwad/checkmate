export const testLevels = {
	smoke: { explorers: 1, model: 'haiku', verifier: false, studySeconds: 300, testSeconds: 600, followSeconds: 300 },
	normal: { explorers: 2, model: 'haiku', verifier: true, studySeconds: 600, testSeconds: 900, followSeconds: 600 },
	deep: { explorers: 3, model: 'haiku', verifier: true, studySeconds: 600, testSeconds: 900, followSeconds: 600 },
} as const
export type TestLevel = keyof typeof testLevels
export const levelNames = Object.keys(testLevels) as TestLevel[]
export const defaultLevel: TestLevel = 'normal'

export function storedLevel<T extends string | undefined>(name: T) {
	return (name === 'standard' ? 'normal' : name) as T
}
