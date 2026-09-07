import { describe, expect, it } from 'vitest'
import { ContainmentState } from '../../cli/signals.js'

describe('CLI containment state', () => {
	it('moves normal cleanup to one independent cleanup cutoff', () => {
		const state = new ContainmentState()
		state.forked()

		expect(state.cleanupStarted()).toEqual({ action: 'arm-cleanup' })
		expect(state.cleanupStarted()).toEqual({ action: 'none' })
		expect(state.cutoff()).toEqual({ phase: 'cleanup', trigger: 'cleanup-deadline-expired' })
		expect(state.terminalAccepted()).toBe(false)
	})

	it('latches run timeout and ignores late cleanup before containment', () => {
		const state = new ContainmentState()
		state.forked()

		expect(state.runDeadlineExpired()).toEqual({ action: 'abort', signal: 'SIGTERM' })
		expect(state.cleanupStarted()).toEqual({ action: 'none' })
		expect(state.cutoff()).toEqual({ phase: 'run', trigger: 'run-deadline-expired' })
		expect(state.terminalAccepted()).toBe(false)
	})

	it('accepts a reconciled terminal before the authoritative cutoff only', () => {
		const state = new ContainmentState()
		state.forked()
		expect(state.terminalAccepted()).toBe(true)
		expect(state.cutoff()).toBeUndefined()
		expect(state.terminalAccepted()).toBe(false)
	})

	it('latches the first external signal and forces its native exit on the second', () => {
		const state = new ContainmentState()
		state.forked()

		expect(state.signal('SIGINT')).toEqual({ action: 'abort', signal: 'SIGINT' })
		expect(state.signal('SIGTERM')).toEqual({ action: 'force-exit', exitCode: 130 })
		expect(state.acceptsTerminal()).toBe(false)
	})

	it('does not treat a signal after a run timeout as a second external signal', () => {
		const state = new ContainmentState()
		state.forked()
		state.runDeadlineExpired()
		expect(state.signal('SIGINT')).toEqual({ action: 'none' })
		expect(state.phase).toBe('stopping')
	})

	it('accepts only stop-cause-compatible terminal results after a stop latch', () => {
		const interrupted = new ContainmentState()
		interrupted.forked()
		interrupted.signal('SIGINT')
		expect(interrupted.resultEligible('interrupted')).toBe(true)
		expect(interrupted.resultEligible('driver-teardown-failed')).toBe(true)
		expect(interrupted.resultEligible('result-write-failed')).toBe(true)
		expect(interrupted.resultEligible('scenario-complete')).toBe(false)

		const timedOut = new ContainmentState()
		timedOut.forked()
		timedOut.runDeadlineExpired()
		expect(timedOut.resultEligible('scenario-timeout')).toBe(true)
		expect(timedOut.resultEligible('driver-teardown-failed')).toBe(true)
		expect(timedOut.resultEligible('result-write-failed')).toBe(true)
		expect(timedOut.resultEligible('failed-expectation')).toBe(false)
	})
})
