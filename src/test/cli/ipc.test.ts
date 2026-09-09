import { describe, expect, it } from 'vitest'
import {
	MAX_IPC_FRAME_BYTES,
	assertIpcFrameSize,
	diagnosticFrame,
	digestMatches,
	ipcFrameBytes,
	parseWorkerMessage,
	terminalDigest,
} from '../../cli/protocol.js'

describe('CLI IPC protocol', () => {
	it('bounds each complete serialized frame at one MiB', () => {
		const fitting = diagnosticFrame('0123456789abcdef', {
			code: 'fixture',
			path: '',
			message: 'x'.repeat(MAX_IPC_FRAME_BYTES),
		})
		expect(fitting).toMatchObject({ diagnostic: { code: 'diagnostic.frame-too-large' } })
		expect(ipcFrameBytes(fitting)).toBeLessThanOrEqual(MAX_IPC_FRAME_BYTES)
		expect(() =>
			assertIpcFrameSize({
				type: 'terminal-inline',
				runId: '0123456789abcdef',
				committed: false,
				resultJson: 'x'.repeat(MAX_IPC_FRAME_BYTES),
			})
		).toThrow(/exceeds/)
	})

	it('validates correlation fields and terminal variants', () => {
		const bytes = '{"ok":true}\n'
		const message = {
			type: 'terminal-inline',
			runId: '0123456789abcdef',
			committed: true,
			resultJson: bytes,
			digest: terminalDigest(bytes),
		} as const

		expect(parseWorkerMessage(message)).toEqual(message)
		expect(digestMatches(bytes, message.digest)).toBe(true)
		expect(digestMatches(`${bytes} `, message.digest)).toBe(false)
		expect(() => parseWorkerMessage({ ...message, runId: '../sibling' })).toThrow(/protocol/)
		expect(() => parseWorkerMessage({ ...message, digest: { byteLength: 1, sha256: 'bad' } })).toThrow(/protocol/)
	})
})
