import { Buffer } from 'node:buffer'
import { describe, expect, it, vi } from 'vitest'
import { createLevelLogger } from '../../logging/level-logger.js'

function sink() {
	return { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() }
}

describe('level logger', () => {
	it('forwards messages at or above the configured level', () => {
		const target = sink()
		const output = createLevelLogger(target, 'warn').logger

		output.debug('debug')
		output.info('info')
		output.warn('warn')
		output.error('error')

		expect(target.debug).not.toHaveBeenCalled()
		expect(target.info).not.toHaveBeenCalled()
		expect(target.warn).toHaveBeenCalledWith('warn')
		expect(target.error).toHaveBeenCalledWith('error')
	})

	it('suppresses every message when logging is off', () => {
		const target = sink()
		const output = createLevelLogger(target, 'off').logger

		output.error('hidden')

		expect(target.error).not.toHaveBeenCalled()
	})

	it('collects only forwarded messages', () => {
		const target = sink()
		const output = createLevelLogger(target, 'info', { collect: true })

		output.logger.debug('hidden')
		output.logger.info('started')
		output.logger.warn('warning')

		expect(output.transcript()).toBe('[info] started\n[warn] warning\n')
	})

	it('bounds collected UTF-8 text and marks truncation', () => {
		const target = sink()
		const output = createLevelLogger(target, 'debug', { collect: true, maxTranscriptBytes: 40 })

		output.logger.debug('12345678901234567890')
		output.logger.debug('🧪'.repeat(20))

		const transcript = output.transcript()!
		expect(Buffer.byteLength(transcript)).toBeLessThanOrEqual(40)
		expect(transcript).toContain('[log truncated]\n')
	})
})
