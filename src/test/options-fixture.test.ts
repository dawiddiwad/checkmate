import { describe, expect, it } from 'vitest'
import { CHECKMATE_DEFAULTS, CheckmateOptions, ResolvedConfig } from '../config/resolved-config'
import { checkmateOptionFixtures, checkmateOptions } from '../playwright/options'

type OptionDeclaration = [unknown, { option: true }]
type ConfigFixture = (options: CheckmateOptions, use: (config: ResolvedConfig) => Promise<void>) => Promise<void>

const optionNames = Object.keys(CHECKMATE_DEFAULTS) as (keyof CheckmateOptions)[]

function declaration(name: keyof CheckmateOptions): OptionDeclaration {
	return checkmateOptionFixtures[name] as unknown as OptionDeclaration
}

function declaredDefaults(): CheckmateOptions {
	return Object.fromEntries(optionNames.map((name) => [name, declaration(name)[0]])) as CheckmateOptions
}

async function throughFixture(options: CheckmateOptions): Promise<ResolvedConfig> {
	const fixture = checkmateOptionFixtures.checkmateConfig as unknown as ConfigFixture
	let resolved: ResolvedConfig | undefined

	await fixture(options, async (config) => {
		resolved = config
	})

	if (!resolved) {
		expect.fail('the checkmateConfig fixture never called use()')
	}

	return resolved
}

describe('checkmate option fixtures', () => {
	it('is a Playwright test object', () => {
		expect(checkmateOptions.extend).toBeTypeOf('function')
		expect(checkmateOptions.use).toBeTypeOf('function')
	})

	it('declares every option as its own independently overridable key', () => {
		for (const name of optionNames) {
			const declared = declaration(name)
			expect(Array.isArray(declared), name).toBe(true)
			expect(declared[1], name).toEqual({ option: true })
		}
	})

	it('declares no option as a nested object, so a per-test use() cannot discard a sibling', () => {
		expect(checkmateOptionFixtures).not.toHaveProperty('checkmate')
		for (const name of optionNames) {
			expect(name.startsWith('checkmate'), name).toBe(true)
		}
	})

	it('declares the package defaults', () => {
		expect(declaredDefaults()).toEqual(CHECKMATE_DEFAULTS)
	})

	it('feeds every declared option into the derived config fixture', () => {
		const source = String(checkmateOptionFixtures.checkmateConfig)

		for (const name of optionNames) {
			expect(source, name).toContain(name)
		}
	})

	it('collapses the option values into one resolved config', async () => {
		const config = await throughFixture(declaredDefaults())

		expect(config.model).toBe(CHECKMATE_DEFAULTS.checkmateModel)
		expect(config.turnCap).toBe(CHECKMATE_DEFAULTS.checkmateTurnCap)
		expect(config.temperature).toBe(0)
	})

	it('applies a project override over the package default', async () => {
		const project: CheckmateOptions = {
			...declaredDefaults(),
			checkmateModel: 'gpt-5-mini',
			checkmateTurnCap: 15,
			checkmateStepTimeout: 60_000,
		}

		const config = await throughFixture(project)

		expect(config.model).toBe('gpt-5-mini')
		expect(config.turnCap).toBe(15)
		expect(config.stepTimeout).toBe(60_000)
	})

	it('applies a per-test override per key, leaving the project value for the others', async () => {
		const project: CheckmateOptions = {
			...declaredDefaults(),
			checkmateModel: 'gpt-5-mini',
			checkmateTurnCap: 15,
			checkmateBudgetUsd: 1,
		}
		const perTest: CheckmateOptions = { ...project, checkmateModel: 'gpt-5' }

		const config = await throughFixture(perTest)

		expect(config.model).toBe('gpt-5')
		expect(config.turnCap).toBe(15)
		expect(config.budgetUsd).toBe(1)
	})

	it('fails the test that misconfigured an option rather than running with a silent fallback', async () => {
		await expect(throughFixture({ ...declaredDefaults(), checkmateTurnCap: 0 })).rejects.toThrow(/checkmateTurnCap/)
	})
})
