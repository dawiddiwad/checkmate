import { expect as baseExpect } from '@playwright/test'
import { describe, expect, it } from 'vitest'
import { CheckmateRunner, createRunner, defineExtension, defineTool } from '../core'
import { expect as playwrightExpect, test, web } from '../playwright'
import { createSalesforceRunner, expect as salesforceExpect, salesforce, test as salesforceTest } from '../salesforce'

describe('public api', () => {
	it('exports the core runtime entry points', () => {
		expect(CheckmateRunner).toBeTypeOf('function')
		expect(createRunner).toBeTypeOf('function')
		expect(defineExtension).toBeTypeOf('function')
		expect(defineTool).toBeTypeOf('function')
	})

	it('exports playwright and salesforce helpers', () => {
		expect(test).toBeTypeOf('function')
		expect(playwrightExpect).toBe(baseExpect)
		expect(web).toBeTypeOf('function')
		expect(salesforceTest).toBeTypeOf('function')
		expect(salesforceExpect).toBe(baseExpect)
		expect(salesforce).toBeTypeOf('function')
		expect(createSalesforceRunner).toBeTypeOf('function')
	})
})
