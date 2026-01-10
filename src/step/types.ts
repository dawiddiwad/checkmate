export type Step = {
	action: string
	expect: string
	search?: string[]
	threshold?: number
}

export type StepStatus = {
	passed: boolean
	actual: string
}

export type StepFinishedCallback = Promise<StepStatus>
export type StepStatusCallback = (current: StepStatus) => void
