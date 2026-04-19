import { Page } from '@playwright/test'
import { RuntimeConfig } from '../config/runtime-config'
import { AiClient } from '../ai/client'
import { profiles } from '../modules'
import { createStepResultTools } from '../tools/step/result-tool'
import { ToolRegistry } from '../tools/registry'
import { CheckmateContextProvider, CheckmateExtension, CheckmateRunnerOptions, CheckmateServices } from './module'
import { Step } from './types'
import { StepExecution } from './step-execution'

type RunnerRuntime = {
	aiClient: AiClient
	services: CheckmateServices
	promptFragments: string[]
	initialContextProviders: CheckmateContextProvider<CheckmateServices>[]
	teardownTasks: Array<() => void | Promise<void>>
}

/**
 * Public runtime entry point for executing natural-language steps with Checkmate.
 *
 * The runner can be created either from a Playwright page or from an explicit
 * object that composes profiles, extensions, and prebuilt services.
 *
 * @example
 * ```ts
 * const runner = new CheckmateRunner({ page })
 * await runner.run({
 *   action: 'Open the pricing page',
 *   expect: 'Pricing details are visible',
 * })
 * ```
 */
export class CheckmateRunner<TServices extends CheckmateServices = CheckmateServices> {
	private readonly runtimePromise: Promise<RunnerRuntime>

	/**
	 * Creates a runner from a Playwright page using the default web profile.
	 *
	 * @param page - Playwright page used by the browser service.
	 */
	constructor(page: Page)

	/**
	 * Creates a runner from explicit profiles, extensions, and services.
	 *
	 * When `profile` is omitted, the built-in web profile is used.
	 *
	 * @param options - Runner composition options.
	 */
	constructor(options: CheckmateRunnerOptions<TServices>)

	constructor(pageOrOptions: Page | CheckmateRunnerOptions<TServices>) {
		this.runtimePromise = this.createRuntime(normalizeRunnerOptions(pageOrOptions))
	}

	/**
	 * Releases any runner-owned resources.
	 *
	 * @returns Promise resolved after all extension teardown hooks finish.
	 */
	async teardown(): Promise<void> {
		const runtime = await this.runtimePromise
		for (const teardown of [...runtime.teardownTasks].reverse()) {
			await teardown()
		}
	}

	/**
	 * Executes one natural-language test step.
	 *
	 * @param step - Step definition to execute.
	 * @returns Promise resolved when the step succeeds.
	 * @throws Error when the step fails or the runtime cannot complete it.
	 *
	 * @example
	 * ```ts
	 * await runner.run({
	 *   action: 'Search for qwen3-vl',
	 *   expect: 'The qwen3-vl model page is displayed',
	 *   hints: {
	 *     browser: {
	 *       topPercent: 10,
	 *     },
	 *   },
	 * })
	 * ```
	 */
	async run(step: Step): Promise<void> {
		const runtime = await this.runtimePromise
		await new StepExecution(runtime.aiClient, {
			services: runtime.services,
			promptFragments: runtime.promptFragments,
			initialContextProviders: runtime.initialContextProviders,
		}).run(step)
	}

	private async createRuntime(options: CheckmateRunnerOptions<TServices>): Promise<RunnerRuntime> {
		const runtimeConfig = new RuntimeConfig()
		const toolRegistry = new ToolRegistry(runtimeConfig)
		toolRegistry.register(createStepResultTools())

		const services: CheckmateServices = { ...(options.services ?? {}) }
		const promptFragments: string[] = []
		const initialContextProviders: CheckmateContextProvider<CheckmateServices>[] = []
		const teardownTasks: Array<() => void | Promise<void>> = []
		const activeExtensions = resolveActiveExtensions(options)

		for (const extension of activeExtensions) {
			assertExtensionRequirements(extension, services)
			const registration = await extension.setup({
				page: options.page,
				services: services as CheckmateServices & Partial<TServices>,
				pass: (actual) => ({ passed: true, actual }),
				fail: (actual) => ({ passed: false, actual }),
			})

			if (registration.services) {
				Object.assign(services, registration.services)
			}

			if (registration.tools && registration.tools.length > 0) {
				toolRegistry.register(registration.tools)
			}

			if (registration.prompt && registration.prompt.length > 0) {
				promptFragments.push(...registration.prompt)
			}

			if (registration.initialContext && registration.initialContext.length > 0) {
				initialContextProviders.push(...registration.initialContext)
			}

			if (registration.teardown && registration.teardown.length > 0) {
				teardownTasks.push(...registration.teardown)
			}
		}

		return {
			services,
			promptFragments,
			initialContextProviders,
			teardownTasks,
			aiClient: new AiClient({ runtimeConfig, toolRegistry, services }),
		}
	}
}

function normalizeRunnerOptions<TServices extends CheckmateServices>(
	pageOrOptions: Page | CheckmateRunnerOptions<TServices>
): CheckmateRunnerOptions<TServices> {
	if (isRunnerOptions(pageOrOptions)) {
		return pageOrOptions
	}

	return { page: pageOrOptions }
}

function isRunnerOptions<TServices extends CheckmateServices>(
	value: Page | CheckmateRunnerOptions<TServices>
): value is CheckmateRunnerOptions<TServices> {
	return 'page' in value || 'profile' in value || 'extensions' in value || 'services' in value
}

function resolveActiveExtensions<TServices extends CheckmateServices>(
	options: CheckmateRunnerOptions<TServices>
): CheckmateExtension<TServices>[] {
	const profile = options.profile ?? profiles.web<TServices>()
	return [...profile.extensions, ...(options.extensions ?? [])]
}

function assertExtensionRequirements(
	extension: CheckmateExtension<CheckmateServices>,
	services: CheckmateServices
): void {
	for (const requirement of extension.requires ?? []) {
		if (services[requirement] === undefined) {
			throw new Error(`Extension '${extension.name}' requires service '${requirement}'`)
		}
	}
}
