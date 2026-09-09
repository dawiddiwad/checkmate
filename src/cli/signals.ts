export type ParentPhase =
	| 'starting'
	| 'running'
	| 'cleaning'
	| 'stopping'
	| 'terminal-accepted'
	| 'contained'
	| 'forced-signal-exit'
	| 'settled'
export type ParentSignal = 'SIGINT' | 'SIGTERM'
export type StopCause = 'run-deadline-expired' | ParentSignal

export const STOP_RESULT_ELIGIBILITY: Readonly<Record<StopCause, readonly RunReason[]>> = {
	SIGINT: ['interrupted', 'driver-teardown-failed', 'result-write-failed'],
	SIGTERM: ['interrupted', 'driver-teardown-failed', 'result-write-failed'],
	'run-deadline-expired': ['scenario-timeout', 'driver-teardown-failed', 'result-write-failed'],
}

export type SignalTransition =
	| { action: 'none' }
	| { action: 'arm-cleanup' }
	| { action: 'abort'; signal: ParentSignal }
	| { action: 'force-exit'; exitCode: 130 | 143 }

export class ContainmentState {
	private current: ParentPhase = 'starting'
	private stopCause: StopCause | undefined

	get phase(): ParentPhase {
		return this.current
	}

	get cause(): StopCause | undefined {
		return this.stopCause
	}

	forked(): void {
		if (this.current !== 'starting') throw new Error(`Cannot fork while parent is ${this.current}`)
		this.current = 'running'
	}

	cleanupStarted(): SignalTransition {
		if (this.current !== 'running') return { action: 'none' }
		this.current = 'cleaning'
		return { action: 'arm-cleanup' }
	}

	runDeadlineExpired(): SignalTransition {
		if (this.current !== 'running') return { action: 'none' }
		this.stopCause = 'run-deadline-expired'
		this.current = 'stopping'
		return { action: 'abort', signal: 'SIGTERM' }
	}

	signal(signal: ParentSignal): SignalTransition {
		if (this.current === 'stopping' && this.stopCause !== 'run-deadline-expired') {
			this.current = 'forced-signal-exit'
			return { action: 'force-exit', exitCode: this.stopCause === 'SIGINT' ? 130 : 143 }
		}
		if (this.current !== 'running' && this.current !== 'cleaning') return { action: 'none' }
		this.stopCause = signal
		this.current = 'stopping'
		return { action: 'abort', signal }
	}

	terminalAccepted(reason?: RunReason): boolean {
		if (!this.acceptsTerminal() || !this.resultEligible(reason)) return false
		this.current = 'terminal-accepted'
		return true
	}

	resultEligible(reason?: RunReason): boolean {
		if (!this.acceptsTerminal()) return false
		if (!this.stopCause) return true
		return reason !== undefined && STOP_RESULT_ELIGIBILITY[this.stopCause].includes(reason)
	}

	cutoff(): { phase: 'run' | 'cleanup'; trigger: 'run-deadline-expired' | 'cleanup-deadline-expired' } | undefined {
		if (this.current === 'running') {
			this.current = 'contained'
			return { phase: 'run', trigger: 'run-deadline-expired' }
		}
		if (this.current === 'cleaning') {
			this.current = 'contained'
			return { phase: 'cleanup', trigger: 'cleanup-deadline-expired' }
		}
		if (this.current === 'stopping') {
			this.current = 'contained'
			return this.stopCause === 'run-deadline-expired'
				? { phase: 'run', trigger: 'run-deadline-expired' }
				: { phase: 'cleanup', trigger: 'cleanup-deadline-expired' }
		}
		return undefined
	}

	contain(): void {
		if (this.acceptsTerminal() || this.current === 'starting') this.current = 'contained'
	}

	settled(): void {
		this.current = 'settled'
	}

	acceptsTerminal(): boolean {
		return this.current === 'running' || this.current === 'cleaning' || this.current === 'stopping'
	}
}
import type { RunReason } from '../contracts/types.js'
