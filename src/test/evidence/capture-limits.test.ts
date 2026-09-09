import { describe, expect, it, vi } from 'vitest'
import { EVIDENCE_CAPTURE_LIMITS, type EvidenceStore } from '../../evidence/store.js'
import { createStore, request, temporaryRoot } from './helpers.js'

describe('evidence capture limits', () => {
	it('accepts the candidate edge and rejects one byte above it', async () => {
		const temporary = await temporaryRoot()
		try {
			const store = await createStore(temporary.root, {
				policy: { retention: 'off', redaction: 'off', allowOpaque: true },
			})
			await store.writeInvocation(request)
			store.captureDriver({
				stepId: 'open-cart',
				kind: 'screenshot',
				mediaType: 'image/png',
				content: Buffer.alloc(EVIDENCE_CAPTURE_LIMITS.maxCandidateBytes),
			})
			expect(() =>
				store.captureDriver({
					stepId: 'open-cart',
					kind: 'screenshot',
					mediaType: 'image/png',
					content: Buffer.alloc(EVIDENCE_CAPTURE_LIMITS.maxCandidateBytes + 1),
				})
			).toThrow(expect.objectContaining({ code: 'evidence.candidate-too-large' }))
			store.dispose()
			expect(store.acceptedBufferBytes).toBe(0)
		} finally {
			await temporary.cleanup()
		}
	})

	it('rejects an oversized view before copying candidate bytes', async () => {
		const temporary = await temporaryRoot()
		try {
			const store = await createStore(temporary.root, {
				policy: { retention: 'off', redaction: 'off', allowOpaque: true },
			})
			await store.writeInvocation(request)
			const candidate = new Uint8Array(EVIDENCE_CAPTURE_LIMITS.maxCandidateBytes + 1)
			const from = vi.spyOn(Buffer, 'from')

			expect(() =>
				store.captureDriver({
					stepId: 'open-cart',
					kind: 'screenshot',
					mediaType: 'image/png',
					content: candidate,
				})
			).toThrow(expect.objectContaining({ code: 'evidence.candidate-too-large' }))
			expect(from.mock.calls.some(([value]) => value === candidate)).toBe(false)
			from.mockRestore()
		} finally {
			await temporary.cleanup()
		}
	})

	it('caps accepted buffers at 64 MiB and releases them after finalization', async () => {
		const temporary = await temporaryRoot()
		try {
			const store = await createStore(temporary.root, {
				policy: { retention: 'off', redaction: 'off', allowOpaque: true },
			})
			await store.writeInvocation(request)
			for (let index = 0; index < 6; index++) captureOpaque(store, 10 * 1024 * 1024)
			captureOpaque(store, 4 * 1024 * 1024)
			expect(store.acceptedBufferBytes).toBe(EVIDENCE_CAPTURE_LIMITS.maxInvocationBytes)

			expect(() => captureOpaque(store, 1)).toThrow(
				expect.objectContaining({ code: 'evidence.invocation-buffer-too-large' })
			)
			await store.finalizeStep('open-cart', 'failed')
			expect(store.acceptedBufferBytes).toBe(0)
		} finally {
			await temporary.cleanup()
		}
	})

	it('rechecks candidate size after exact-secret redaction', async () => {
		const temporary = await temporaryRoot()
		try {
			const store = await createStore(temporary.root, {
				policy: { retention: 'on', redaction: 'on', allowOpaque: false },
				exactSecrets: ['x'],
			})
			await store.writeInvocation(request)
			expect(() =>
				store.captureHarnessStep({
					stepId: 'open-cart',
					kind: 'transcript',
					mediaType: 'text/markdown',
					content: 'x'.repeat(1024 * 1024),
				})
			).toThrow(expect.objectContaining({ code: 'evidence.candidate-too-large' }))
			expect(store.acceptedBufferBytes).toBe(0)
		} finally {
			await temporary.cleanup()
		}
	})

	it('keeps invocation counters isolated', async () => {
		const temporary = await temporaryRoot()
		try {
			const [first, second] = await Promise.all([createStore(temporary.root), createStore(temporary.root)])
			await Promise.all([first.writeInvocation(request), second.writeInvocation(request)])
			captureOpaque(first, 10)
			captureOpaque(second, 20)
			expect(first.acceptedBufferBytes).toBe(10)
			expect(second.acceptedBufferBytes).toBe(20)
			first.dispose()
			expect(first.acceptedBufferBytes).toBe(0)
			expect(second.acceptedBufferBytes).toBe(20)
			second.dispose()
		} finally {
			await temporary.cleanup()
		}
	})

	it('rejects undeclared kinds, media mismatches, unknown steps, and invalid lifecycle use', async () => {
		const temporary = await temporaryRoot()
		try {
			const store = await createStore(temporary.root)
			expect(() => captureOpaque(store, 1)).toThrow('not accepting evidence')
			await store.writeInvocation(request)
			expect(() =>
				store.captureDriver({ stepId: 'open-cart', kind: 'unknown', mediaType: 'image/png', content: 'x' })
			).toThrow(expect.objectContaining({ code: 'evidence.undeclared-kind' }))
			expect(() =>
				store.captureDriver({
					stepId: 'open-cart',
					kind: 'screenshot',
					mediaType: 'text/plain',
					content: 'x',
				})
			).toThrow(expect.objectContaining({ code: 'evidence.media-type-mismatch' }))
			expect(() =>
				store.captureDriver({ stepId: 'missing', kind: 'screenshot', mediaType: 'image/png', content: 'x' })
			).toThrow(expect.objectContaining({ code: 'evidence.unknown-step' }))
		} finally {
			await temporary.cleanup()
		}
	})
})

function captureOpaque(store: EvidenceStore, bytes: number): void {
	store.captureDriver({
		stepId: 'open-cart',
		kind: 'screenshot',
		mediaType: 'image/png',
		content: Buffer.alloc(bytes),
	})
}
