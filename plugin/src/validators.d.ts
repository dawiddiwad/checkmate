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
export const instance: Validator
export const journalCriterion: Validator
export const journalDefect: Validator
export const journalEntry: Validator
export const journalIssue: Validator
export const journalNote: Validator
export const journalObservation: Validator
export const journalQuestion: Validator
export const journalVerdict: Validator
export const profile: Validator
