export type Step = {
	action: string
	expect: string
	search?: string[]
	threshold?: number
}

export type StepResult = {
	passed: boolean
	actual: string
}

export type StepResultPromise = Promise<StepResult>
export type ResolveStepResult = (result: StepResult) => void
