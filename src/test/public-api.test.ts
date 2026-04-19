import { expect as baseExpect } from '@playwright/test'
import { describe, expect, it } from 'vitest'
import { CheckmateRunner, extensions, profiles } from '../index'
import { createCheckmateTest, expect as playwrightExpect, test } from '../playwright'
import { createSalesforceTest, expect as salesforceExpect, test as salesforceTest } from '../salesforce'

describe('public api', () => {
	it('exports the runtime entry point', () => {
		expect(CheckmateRunner).toBeTypeOf('function')
	})

	it('exports built-in extensions and profiles', () => {
		expect(extensions.browser).toBeTypeOf('function')
		expect(extensions.salesforce).toBeTypeOf('function')
		expect(profiles.web().name).toBe('web')
		expect(profiles.salesforce().name).toBe('salesforce')
	})

	it('exports playwright test and expect', () => {
		expect(test).toBeTypeOf('function')
		expect(createCheckmateTest).toBeTypeOf('function')
		expect(playwrightExpect).toBe(baseExpect)
	})

	it('exports salesforce test factory and expect', () => {
		expect(salesforceTest).toBeTypeOf('function')
		expect(createSalesforceTest).toBeTypeOf('function')
		expect(salesforceExpect).toBe(baseExpect)
	})
})
