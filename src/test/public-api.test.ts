import { expect as baseExpect } from '@playwright/test'
import { describe, expect, it } from 'vitest'
import { CHECKMATE_DEFAULTS, CheckmateRunner, createRunner, defineExtension, defineTool, resolveConfig } from '../core'
import { checkmate, checkmateOptions, createAi, expect as playwrightExpect, test, web } from '../playwright'
import {
	checkmate as salesforceCheckmate,
	createSalesforceAi,
	createSalesforceRunner,
	expect as salesforceExpect,
	salesforce,
	test as salesforceTest,
} from '../salesforce'

describe('public api', () => {
	it('exports the core runtime entry points', () => {
		expect(CheckmateRunner).toBeTypeOf('function')
		expect(createRunner).toBeTypeOf('function')
		expect(defineExtension).toBeTypeOf('function')
		expect(defineTool).toBeTypeOf('function')
		expect(resolveConfig).toBeTypeOf('function')
		expect(CHECKMATE_DEFAULTS.checkmateModel).toBe('gpt-5-mini')
	})

	it('declares the checkmate* options on the mergeable test object', () => {
		expect(checkmateOptions).toBeTypeOf('function')
		expect(checkmate.use).toBeTypeOf('function')
		expect(salesforceCheckmate.use).toBeTypeOf('function')
	})

	it('exports mergeable test objects and their bundled aliases', () => {
		expect(checkmate).toBeTypeOf('function')
		expect(test).toBe(checkmate)
		expect(salesforceCheckmate).toBeTypeOf('function')
		expect(salesforceTest).toBe(salesforceCheckmate)
	})

	it('exports playwright and salesforce helpers', () => {
		expect(playwrightExpect).toBe(baseExpect)
		expect(web).toBeTypeOf('function')
		expect(createAi).toBeTypeOf('function')
		expect(salesforceExpect).toBe(baseExpect)
		expect(salesforce).toBeTypeOf('function')
		expect(createSalesforceRunner).toBeTypeOf('function')
		expect(createSalesforceAi).toBeTypeOf('function')
	})

	it('exposes step and teardown on the ai fixture, and nothing named run', () => {
		const ai = createAi(fakePage())

		expect(ai.step).toBeTypeOf('function')
		expect(ai.teardown).toBeTypeOf('function')
		expect(Object.keys(ai)).toEqual(['step', 'teardown'])
	})
})

function fakePage(): never {
	const pages: unknown[] = []
	const context: Record<string, unknown> = {
		pages: (): unknown[] => pages,
		on: (): Record<string, unknown> => context,
	}

	return {
		context: () => context,
		isClosed: () => false,
		bringToFront: async (): Promise<void> => undefined,
		url: () => 'https://example.com',
		title: async (): Promise<string> => 'Example',
	} as never
}
