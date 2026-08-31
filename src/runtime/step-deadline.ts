import { TerminationReason } from './types.js'

export const TEST_TIMEOUT_MARGIN_MS = 10_000

export type StepDeadlineDependencies = {
	stepTimeout: number
	testTimeoutRemaining?: number
	marginMs?: number
}

export class StepDeadline {
	readonly signal: AbortSignal
	private readonly controller = new AbortController()
	private readonly expiresAt: number
	private readonly expirationReason: TerminationReason
	private readonly timer: ReturnType<typeof setTimeout>

	constructor({ stepTimeout, testTimeoutRemaining, marginMs = TEST_TIMEOUT_MARGIN_MS }: StepDeadlineDependencies) {
		const testBudget = testTimeoutRemaining === undefined ? undefined : testTimeoutRemaining - marginMs
		const usesTestBudget = testBudget !== undefined && testBudget < stepTimeout
		const timeout = usesTestBudget ? Math.max(0, testBudget) : stepTimeout

		this.signal = this.controller.signal
		this.expiresAt = Date.now() + timeout
		this.expirationReason = usesTestBudget ? 'test-budget-exhausted' : 'step-timeout'
		this.timer = setTimeout(() => this.controller.abort(), timeout)
	}

	poll(): TerminationReason | undefined {
		if (!this.signal.aborted && Date.now() < this.expiresAt) {
			return undefined
		}

		this.controller.abort()
		return this.expirationReason
	}

	dispose(): void {
		clearTimeout(this.timer)
	}
}
