export type ControlExpirationReason = 'step-timeout' | 'scenario-timeout' | 'interrupted'

export type ControlPoll = { expired: false } | { expired: true; reason: ControlExpirationReason }

export type StepControl = Readonly<{
	signal: AbortSignal
	deadline: number
	now(): number
	poll(): ControlPoll
	dispose(): void
}>

export type ScenarioControlOptions = Readonly<{
	timeoutMs: number
	signal?: AbortSignal
	now?: () => number
	setTimer?: typeof setTimeout
	clearTimer?: typeof clearTimeout
}>

export class ScenarioControl {
	readonly signal: AbortSignal
	readonly interruptionSignal: AbortSignal
	readonly deadline: number
	private readonly controller = new AbortController()
	private readonly interruptionController = new AbortController()
	private readonly now: () => number
	private readonly setTimer: typeof setTimeout
	private readonly clearTimer: typeof clearTimeout
	private readonly timer: ReturnType<typeof setTimeout>
	private readonly externalSignal?: AbortSignal
	private disposed = false

	constructor(options: ScenarioControlOptions) {
		if (!Number.isFinite(options.timeoutMs) || options.timeoutMs < 0) {
			throw new Error('Scenario timeout must be a non-negative finite number')
		}
		this.now = options.now ?? Date.now
		this.setTimer = options.setTimer ?? setTimeout
		this.clearTimer = options.clearTimer ?? clearTimeout
		this.deadline = this.now() + options.timeoutMs
		this.signal = this.controller.signal
		this.interruptionSignal = this.interruptionController.signal
		this.externalSignal = options.signal
		if (options.signal?.aborted) this.handleExternalAbort()
		else options.signal?.addEventListener('abort', this.handleExternalAbort, { once: true })
		this.timer = this.setTimer(() => this.controller.abort('scenario-timeout'), options.timeoutMs)
	}

	poll(): ControlPoll {
		if (this.externalSignal?.aborted || this.interruptionSignal.aborted) {
			this.handleExternalAbort()
			return { expired: true, reason: 'interrupted' }
		}
		if (this.signal.reason === 'scenario-timeout' || this.now() >= this.deadline) {
			this.controller.abort('scenario-timeout')
			return { expired: true, reason: 'scenario-timeout' }
		}
		return { expired: false }
	}

	createStepControl(stepTimeoutMs: number): StepControl {
		if (!Number.isFinite(stepTimeoutMs) || stepTimeoutMs < 0) {
			throw new Error('Step timeout must be a non-negative finite number')
		}
		const now = this.now()
		const stepDeadline = now + stepTimeoutMs
		const deadline = Math.min(stepDeadline, this.deadline)
		const owner: Exclude<ControlExpirationReason, 'interrupted'> =
			this.deadline <= stepDeadline ? 'scenario-timeout' : 'step-timeout'
		const controller = new AbortController()
		const onScenarioAbort = () => controller.abort(this.signal.reason ?? 'scenario-timeout')
		if (this.signal.aborted) onScenarioAbort()
		else this.signal.addEventListener('abort', onScenarioAbort, { once: true })
		const timer = this.setTimer(() => controller.abort(owner), Math.max(0, deadline - now))
		let disposed = false

		return {
			signal: controller.signal,
			deadline,
			now: this.now,
			poll: () => {
				const scenario = this.poll()
				if (scenario.expired) return scenario
				if (controller.signal.reason === 'interrupted') return { expired: true, reason: 'interrupted' }
				if (controller.signal.aborted || this.now() >= deadline) {
					controller.abort(owner)
					return { expired: true, reason: owner }
				}
				return { expired: false }
			},
			dispose: () => {
				if (disposed) return
				disposed = true
				this.clearTimer(timer)
				this.signal.removeEventListener('abort', onScenarioAbort)
			},
		}
	}

	dispose(): void {
		if (this.disposed) return
		this.disposed = true
		this.clearTimer(this.timer)
		this.externalSignal?.removeEventListener('abort', this.handleExternalAbort)
	}

	private readonly handleExternalAbort = (): void => {
		this.interruptionController.abort('interrupted')
		this.controller.abort('interrupted')
	}
}
