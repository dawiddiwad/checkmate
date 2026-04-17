import { expect as baseExpect } from '@playwright/test'
import { describe, expect, it } from 'vitest'
import { CheckmateRunner } from '../index'
import { expect as playwrightExpect, test } from '../playwright'

describe('public api', () => {
	it('exports the runtime entry point', () => {
		expect(CheckmateRunner).toBeTypeOf('function')
	})

	it('exports playwright test and expect', () => {
		expect(test).toBeTypeOf('function')
		expect(playwrightExpect).toBe(baseExpect)
	})
})
