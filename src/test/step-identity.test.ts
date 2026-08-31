import { describe, expect, it } from 'vitest'
import { stepIdentity } from '../playwright/ledger'

describe('stepIdentity', () => {
	it('is deterministic for the same ordinal and action', () => {
		expect(stepIdentity(2, 'apply the seasonal promo code SPRING25')).toBe(
			stepIdentity(2, 'apply the seasonal promo code SPRING25')
		)
	})

	it('differs when the ordinal differs, even for the same action', () => {
		const first = stepIdentity(1, 'apply the seasonal promo code SPRING25')
		const second = stepIdentity(2, 'apply the seasonal promo code SPRING25')

		expect(first).not.toBe(second)
	})

	it('differs when the action differs, even at the same ordinal', () => {
		const first = stepIdentity(1, 'apply SPRING25')
		const second = stepIdentity(1, 'apply SUMMER10')

		expect(first).not.toBe(second)
	})

	it('carries the ordinal as a readable prefix', () => {
		expect(stepIdentity(3, 'apply SPRING25')).toMatch(/^3:[0-9a-f]{6}$/)
	})

	describe('why neither half works alone', () => {
		it('the ordinal alone would collide when a run legitimately repeats the same step', () => {
			// Two "apply promo code" steps at the same position across two different tests would be
			// indistinguishable by ordinal alone; the action hash is what tells them apart.
			const inTestA = stepIdentity(2, 'apply promo code SPRING25')
			const inTestB = stepIdentity(2, 'apply promo code SUMMER10')

			expect(inTestA).not.toBe(inTestB)
		})

		it('the action hash alone would collide when a test repeats the identical step twice', () => {
			// Two calls to the same action at different positions in the same test must stay
			// distinguishable; the ordinal is what tells them apart when the hash can't.
			const firstOccurrence = stepIdentity(1, 'refresh the page')
			const secondOccurrence = stepIdentity(4, 'refresh the page')

			expect(firstOccurrence).not.toBe(secondOccurrence)
		})

		it('drifts when an earlier step is inserted, shifting every later ordinal', () => {
			// A step's identity is positional, not content-addressed against the whole test, so a run
			// that takes a different path (an extra step inserted earlier) changes a later step's
			// identity even though its own action never changed.
			const beforeInsertion = stepIdentity(2, 'apply SPRING25')
			const afterInsertion = stepIdentity(3, 'apply SPRING25')

			expect(beforeInsertion).not.toBe(afterInsertion)
		})
	})
})
