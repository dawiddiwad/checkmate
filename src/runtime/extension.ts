import { ResolvedConfig } from '../config/resolved-config.js'
import { ToolRegistry } from '../tools/registry.js'
import { AgentTool, ToolExecution } from '../tools/types.js'
import { ContextMessage, Step } from './types.js'

export type { ToolExecution } from '../tools/types.js'

/**
 * Builds additional initial messages for a step.
 *
 * Use this to inject snapshots, screenshots, or custom context before the first model request.
 *
 * @example
 * ```ts
 * const buildInitialMessages: ExtensionInitialMessagesBuilder = async ({ step }) => [
 *   { message: { role: 'user', content: `Current business area: checkout for ${step.action}` } },
 * ]
 * ```
 */
export type ExtensionInitialMessagesBuilder = (context: {
	/**
	 * Step being executed.
	 */
	step: Step
}) => Promise<ContextMessage[]> | ContextMessage[]

/**
 * Runs after one or more tools finish.
 *
 * Return fresh snapshots, screenshots, or any other follow-up context. Mark page state
 * as `ephemeral` so it is replaced before the next turn instead of accumulating.
 *
 * @example
 * ```ts
 * const handleToolResponses: ExtensionToolResponsesHook = async ({ toolResponses }) => {
 *   const snapshot = toolResponses.at(-1)?.toolResponse.snapshot
 *   if (!snapshot) {
 *     return []
 *   }
 *
 *   return [{ message: { role: 'user', content: snapshot }, ephemeral: true }]
 * }
 * ```
 */
export type ExtensionToolResponsesHook = (context: {
	/**
	 * Step being executed.
	 */
	step: Step

	/**
	 * Model turn that just finished, starting at `1`.
	 */
	turn: number

	/**
	 * Tool executions that just completed.
	 */
	toolResponses: ToolExecution[]
}) => Promise<ContextMessage[]> | ContextMessage[]

/**
 * Cleans up resources created by an extension.
 *
 * @example
 * ```ts
 * const teardown: ExtensionTeardown = async () => {
 *   await browser.close()
 * }
 * ```
 */
export type ExtensionTeardown = () => Promise<void> | void

/**
 * API exposed to an extension during setup.
 *
 * @example
 * ```ts
 * const extension = defineExtension({
 *   name: 'custom',
 *   setup(api) {
 *     api.addInstruction('Prefer visible labels over generated ids.')
 *   },
 * })
 * ```
 */
export type ExtensionSetupApi = {
	/**
	 * Resolved `checkmate*` configuration for the current runner.
	 */
	config: ResolvedConfig

	/**
	 * Registers one or more tools.
	 */
	addTool: (tool: AgentTool | AgentTool[]) => void

	/**
	 * Appends a system-level instruction for the model.
	 */
	addInstruction: (instruction: string) => void

	/**
	 * Adds a builder for extra initial messages.
	 */
	addInitialMessages: (builder: ExtensionInitialMessagesBuilder) => void

	/**
	 * Adds a hook that runs after tool execution.
	 */
	addToolResponsesHook: (hook: ExtensionToolResponsesHook) => void

	/**
	 * Publishes a capability for other extensions to consume.
	 */
	setCapability: (name: string, value: unknown) => void

	/**
	 * Reads a capability published by another extension.
	 */
	getCapability: <T>(name: string) => T

	/**
	 * Registers teardown work for the runner lifecycle.
	 */
	onTeardown: (teardown: ExtensionTeardown) => void
}

/**
 * Shape used to define a Checkmate extension.
 *
 * @example
 * ```ts
 * const extension = defineExtension({
 *   name: 'api-health',
 *   instructions: ['Check API health before asserting UI state.'],
 *   tools: [apiHealthTool],
 * })
 * ```
 */
export type ExtensionDefinition = {
	/**
	 * Stable extension name.
	 */
	name: string

	/**
	 * Tools contributed by this extension.
	 */
	tools?: AgentTool | AgentTool[]

	/**
	 * Additional system instructions for the model.
	 */
	instructions?: string[]

	/**
	 * Setup hook used to register capabilities, tools, and hooks.
	 */
	setup?: (api: ExtensionSetupApi) => void

	/**
	 * Optional builder for initial step messages.
	 */
	buildInitialMessages?: ExtensionInitialMessagesBuilder

	/**
	 * Optional hook that runs after tool execution.
	 */
	handleToolResponses?: ExtensionToolResponsesHook

	/**
	 * Optional teardown hook.
	 */
	teardown?: ExtensionTeardown
}

/**
 * Additional behavior layered on top of an existing extension.
 *
 * @example
 * ```ts
 * const customWeb = web({ page }).extend({
 *   instructions: ['Prefer visible labels over generated ids.'],
 * })
 * ```
 */
export type ExtensionOverride = Omit<ExtensionDefinition, 'name'> & {
	/**
	 * Optional replacement name for the derived extension.
	 */
	name?: string
}

/**
 * A composable Checkmate extension.
 *
 * Use `defineExtension()` to create one, then pass it to `createRunner()`.
 *
 * @example
 * ```ts
 * const extension = defineExtension({
 *   name: 'custom',
 *   instructions: ['Prefer visible labels over generated ids.'],
 * })
 * ```
 */
export type CheckmateExtension = {
	/**
	 * Stable extension name.
	 */
	name: string

	/**
	 * Applies the extension to the runner host.
	 */
	apply: (api: ExtensionSetupApi) => void

	/**
	 * Derives a new extension by layering more behavior on top.
	 *
	 * @example
	 * ```ts
	 * const customWeb = web({ page }).extend({
	 *   instructions: ['Use customer-specific naming where available.'],
	 * })
	 * ```
	 */
	extend: (override: ExtensionOverride) => CheckmateExtension
}

/**
 * Creates a composable Checkmate extension.
 *
 * @example
 * ```ts
 * import { createRunner, defineExtension } from '@xoxoai/checkmate/core'
 * import { web } from '@xoxoai/checkmate/playwright'
 *
 * const extension = defineExtension({
 *   name: 'checkout-policy',
 *   instructions: ['Prefer visible checkout totals over inferred values.'],
 * })
 *
 * const ai = createRunner({
 *   extensions: [web({ page }), extension],
 * })
 * ```
 */
export function defineExtension(definition: ExtensionDefinition): CheckmateExtension {
	return {
		name: definition.name,
		apply(api: ExtensionSetupApi) {
			registerExtension(api, definition)
		},
		extend(override: ExtensionOverride) {
			return defineExtension(mergeExtensionDefinition(definition, override))
		},
	}
}

export class ExtensionHost {
	private readonly instructions: string[] = []
	private readonly initialMessagesBuilders: ExtensionInitialMessagesBuilder[] = []
	private readonly toolResponsesHooks: ExtensionToolResponsesHook[] = []
	private readonly teardowns: ExtensionTeardown[] = []
	private readonly capabilities = new Map<string, unknown>()

	constructor(
		private readonly config: ResolvedConfig,
		private readonly toolRegistry: ToolRegistry,
		extensions: CheckmateExtension[]
	) {
		const api: ExtensionSetupApi = {
			config,
			addTool: (tool) => this.toolRegistry.register(tool),
			addInstruction: (instruction) => {
				if (instruction.trim().length > 0) {
					this.instructions.push(instruction)
				}
			},
			addInitialMessages: (builder) => {
				this.initialMessagesBuilders.push(builder)
			},
			addToolResponsesHook: (hook) => {
				this.toolResponsesHooks.push(hook)
			},
			setCapability: (name, value) => {
				this.capabilities.set(name, value)
			},
			getCapability: <T>(name: string): T => {
				if (!this.capabilities.has(name)) {
					throw new Error(`Extension capability '${name}' is not available`)
				}

				return this.capabilities.get(name) as T
			},
			onTeardown: (teardown) => {
				this.teardowns.push(teardown)
			},
		}

		for (const extension of extensions) {
			extension.apply(api)
		}
	}

	getInstructions(): string[] {
		return [...this.instructions]
	}

	async buildInitialMessages(step: Step): Promise<ContextMessage[]> {
		const messages: ContextMessage[] = []

		for (const buildInitialMessages of this.initialMessagesBuilders) {
			messages.push(...(await buildInitialMessages({ step })))
		}

		return messages
	}

	async handleToolResponses(context: {
		step: Step
		turn: number
		toolResponses: ToolExecution[]
	}): Promise<ContextMessage[]> {
		const messages: ContextMessage[] = []

		for (const handleToolResponses of this.toolResponsesHooks) {
			messages.push(...(await handleToolResponses(context)))
		}

		return messages
	}

	async teardown(): Promise<void> {
		for (const teardown of [...this.teardowns].reverse()) {
			await teardown()
		}
	}
}

function registerExtension(api: ExtensionSetupApi, definition: ExtensionDefinition): void {
	for (const tool of asArray(definition.tools)) {
		api.addTool(tool)
	}

	for (const instruction of definition.instructions ?? []) {
		api.addInstruction(instruction)
	}

	if (definition.buildInitialMessages) {
		api.addInitialMessages(definition.buildInitialMessages)
	}

	if (definition.handleToolResponses) {
		api.addToolResponsesHook(definition.handleToolResponses)
	}

	if (definition.teardown) {
		api.onTeardown(definition.teardown)
	}

	definition.setup?.(api)
}

function mergeExtensionDefinition(base: ExtensionDefinition, override: ExtensionOverride): ExtensionDefinition {
	return {
		name: override.name ?? base.name,
		tools: [...asArray(base.tools), ...asArray(override.tools)],
		instructions: [...(base.instructions ?? []), ...(override.instructions ?? [])],
		setup: chainSync(base.setup, override.setup),
		buildInitialMessages: combineContext(base.buildInitialMessages, override.buildInitialMessages),
		handleToolResponses: combineContext(base.handleToolResponses, override.handleToolResponses),
		teardown: chainAsync(base.teardown, override.teardown),
	}
}

function chainSync<T extends (...args: never[]) => unknown>(
	first?: T,
	second?: T
): ((...args: Parameters<T>) => void) | undefined {
	if (!first) {
		return second
	}

	if (!second) {
		return (...args: Parameters<T>) => {
			first(...args)
		}
	}

	return (...args: Parameters<T>) => {
		first(...args)
		second(...args)
	}
}

function chainAsync<T extends (...args: never[]) => unknown>(
	first?: T,
	second?: T
): ((...args: Parameters<T>) => Promise<void>) | undefined {
	if (!first) {
		return second
			? async (...args: Parameters<T>) => {
					await second(...args)
				}
			: undefined
	}

	if (!second) {
		return async (...args: Parameters<T>) => {
			await first(...args)
		}
	}

	return async (...args: Parameters<T>) => {
		await first(...args)
		await second(...args)
	}
}

function combineContext<TContext>(
	first?: (context: TContext) => Promise<ContextMessage[]> | ContextMessage[],
	second?: (context: TContext) => Promise<ContextMessage[]> | ContextMessage[]
): ((context: TContext) => Promise<ContextMessage[]> | ContextMessage[]) | undefined {
	if (!first) {
		return second
	}

	if (!second) {
		return first
	}

	return async (context) => {
		return [...(await first(context)), ...(await second(context))]
	}
}

function asArray<T>(value?: T | T[]): T[] {
	if (!value) {
		return []
	}

	return Array.isArray(value) ? value : [value]
}
