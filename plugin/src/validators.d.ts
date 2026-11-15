export type Validator = ((value: unknown) => boolean) & {
	errors?: Array<{
		instancePath: string
		schemaPath: string
		keyword: string
		params: {
			additionalProperty?: string
			allowedValues?: unknown[]
			missingProperty?: string
			type?: string | string[]
		}
		propertyName?: string
		message?: string
	}> | null
}
export const finding: Validator
export const gap: Validator
export const instance: Validator
export const journalCriterion: Validator
export const journalDefect: Validator
export const journalEntry: Validator
export const journalNote: Validator
export const journalObservation: Validator
export const journalQuestion: Validator
export const journalVerdict: Validator
export const liteChecklist: Validator
export const liteRecord: Validator
export const plan: Validator
export const planCandidate: Validator
export const planDelta: Validator
export const planPatch: Validator
export const planRequest: Validator
export const profile: Validator
export const response: Validator
export const result: Validator
