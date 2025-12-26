export type Step = {
	action: string
	expect: string
}

export type StepStatus = {
	passed: boolean
	actual: string
}

export type StepFinishedCallback = Promise<StepStatus>
export type StepStatusCallback = (current: StepStatus) => void
