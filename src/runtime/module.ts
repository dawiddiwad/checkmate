import type { Page } from '@playwright/test'
import type { AgentTool } from '../tools/types'
import type { Step, StepResult } from './types'

/**
 * Text or image context sent to the model alongside a step.
 *
 * Context items are the generic replacement for browser-only snapshots.
 * Modules can contribute the current browser snapshot, a screenshot,
 * an API response summary, or any other execution context in this format.
 */
export type CheckmateContextItem =
	| {
			/** Stable item kind used to serialize the payload. */
			kind: 'text'
			/** Human-readable name shown to the model. */
			name: string
			/** Context body content. */
			content: string
	  }
	| {
			/** Stable item kind used to serialize the payload. */
			kind: 'image'
			/** Human-readable name shown to the model. */
			name: string
			/** MIME type of the image payload. */
			mimeType: string
			/** Base64-encoded image data. */
			data: string
	  }

/**
 * Browser input element used by the built-in browser service.
 */
export interface CheckmateBrowserInputElement {
	/** `aria-ref` identifier from the current snapshot. */
	ref: string
	/** Visible element name from the snapshot. */
	name: string
	/** Text value to type or select. */
	text: string
	/** Clear the existing field value before typing. */
	clear: boolean
	/** Select an option instead of typing text. */
	select: boolean
}

/**
 * Single named service value stored in the runtime service bag.
 */
export type CheckmateService = unknown

/**
 * Browser automation service consumed by the built-in web extension.
 */
export interface CheckmateBrowserService {
	/** Underlying Playwright page used by the service. */
	readonly page: Page

	/**
	 * Navigate to a URL.
	 *
	 * @param url - Absolute URL to open.
	 * @param step - Current natural-language step.
	 * @returns Tool response payload for the model loop.
	 */
	navigateToUrl(url: string, step: Step): Promise<string | { response: string; context?: CheckmateContextItem[] }>

	/**
	 * Click or hover an element from the current browser snapshot.
	 *
	 * @param ref - `aria-ref` identifier of the element.
	 * @param hover - Whether to hover instead of click.
	 * @param step - Current natural-language step.
	 * @returns Tool response payload for the model loop.
	 */
	clickElement(
		ref: string,
		hover: boolean,
		step: Step
	): Promise<string | { response: string; context?: CheckmateContextItem[] }>

	/**
	 * Type or select values in one or more browser elements.
	 *
	 * @param elements - Elements to update.
	 * @param step - Current natural-language step.
	 * @returns Tool response payload for the model loop.
	 */
	typeOrSelectInElement(
		elements: CheckmateBrowserInputElement[],
		step: Step
	): Promise<string | { response: string; context?: CheckmateContextItem[] }>

	/**
	 * Press a browser keyboard key.
	 *
	 * @param key - Playwright-compatible key name.
	 * @param step - Current natural-language step.
	 * @returns Tool response payload for the model loop.
	 */
	pressKey(key: string, step: Step): Promise<string | { response: string; context?: CheckmateContextItem[] }>

	/**
	 * Capture a fresh browser snapshot.
	 *
	 * @param step - Current natural-language step.
	 * @param options - Snapshot capture options.
	 * @returns Serialized browser snapshot.
	 */
	captureCurrentSnapshot(step: Step, options?: { skipFilter?: boolean }): Promise<string>

	/**
	 * Wait for a number of seconds.
	 *
	 * @param seconds - Delay duration in seconds.
	 * @param step - Current natural-language step.
	 * @returns Tool response payload for the model loop.
	 */
	wait(seconds: number, step: Step): Promise<string | { response: string; context?: CheckmateContextItem[] }>

	/**
	 * Build the initial browser context for a step.
	 *
	 * @param step - Current natural-language step.
	 * @returns Context items that should be sent before the first model request.
	 */
	getInitialContext(step: Step): Promise<CheckmateContextItem[]>

	/**
	 * Capture a screenshot context item for the current page.
	 *
	 * @returns Image context item for the model loop.
	 */
	getScreenshotContextItem(): Promise<CheckmateContextItem>
}

/**
 * Salesforce service used by the built-in Salesforce extension.
 */
export interface CheckmateSalesforceService {
	/**
	 * Resolve a Salesforce front-door URL for the authenticated org.
	 *
	 * @returns Salesforce front-door URL.
	 */
	getFrontDoorUrl(): Promise<string>
}

/**
 * Future API service contract.
 */
export interface CheckmateApiService {
	/**
	 * Send an HTTP request.
	 *
	 * @param request - Request definition.
	 * @returns Structured API response.
	 */
	request(request: {
		method: string
		url: string
		headers?: Record<string, string>
		body?: unknown
	}): Promise<{ status: number; headers: Record<string, string>; body: unknown }>
}

/**
 * Future database service contract.
 */
export interface CheckmateDbService {
	/**
	 * Execute a SQL query.
	 *
	 * @param input - Query text and parameters.
	 * @returns Query result.
	 */
	query(input: { sql: string; params?: unknown[] }): Promise<{ rows: unknown[]; rowCount: number }>
}

/**
 * Dynamic service bag shared by extensions and tools.
 *
 * The bag is keyed by service name so extensions can publish and consume custom
 * runtime surfaces without extending a fixed built-in interface.
 */
export type CheckmateServices = Record<string, CheckmateService>

/**
 * Context provider that can contribute initial state for a step.
 */
export type CheckmateContextProvider<TServices extends CheckmateServices = CheckmateServices> = (
	step: Step,
	context: { services: TServices }
) => Promise<CheckmateContextItem[] | void> | CheckmateContextItem[] | void

/**
 * Data returned by an extension during runner setup.
 */
export interface CheckmateExtensionRegistration<TServices extends CheckmateServices = CheckmateServices> {
	/** Additional named services exposed by the extension. */
	services?: CheckmateServices
	/** Tools contributed by the extension. */
	tools?: AgentTool<TServices>[]
	/** Prompt fragments appended to the core system prompt. */
	prompt?: string[]
	/** Initial context providers executed before each step. */
	initialContext?: CheckmateContextProvider<TServices>[]
	/** Extension teardown callbacks executed during runner teardown. */
	teardown?: Array<() => void | Promise<void>>
}

/**
 * Setup context passed to each extension.
 */
export interface CheckmateExtensionSetupContext<TServices extends CheckmateServices = CheckmateServices> {
	/** Optional Playwright page available to built-in browser extensions. */
	page?: Page
	/** Current service bag accumulated from earlier extensions. */
	services: CheckmateServices & Partial<TServices>
	/**
	 * Mark the current step as passed.
	 *
	 * @param actual - Actual result text reported back to the user.
	 * @returns Completed step result.
	 */
	pass(actual: string): StepResult
	/**
	 * Mark the current step as failed.
	 *
	 * @param actual - Actual result text reported back to the user.
	 * @returns Completed step result.
	 */
	fail(actual: string): StepResult
}

/**
 * Composable runtime extension.
 *
 * Extensions contribute tools, prompt fragments, services, and per-step context.
 */
export interface CheckmateExtension<TServices extends CheckmateServices = CheckmateServices> {
	/** Unique extension name. */
	name: string
	/** Service keys that must already exist before setup runs. */
	requires?: Array<keyof TServices & string>
	/**
	 * Configure the extension for the current runner.
	 *
	 * @param context - Runner setup context.
	 * @returns Extension registration describing what the extension contributes.
	 *
	 * @example
	 * ```ts
	 * const extension: CheckmateExtension<MyServices> = {
	 *   name: 'my-api',
	 *   setup: () => ({ tools: [] }),
	 * }
	 * ```
	 */
	setup(
		context: CheckmateExtensionSetupContext<TServices>
	): Promise<CheckmateExtensionRegistration<TServices>> | CheckmateExtensionRegistration<TServices>
}

/**
 * Ordered collection of extensions that define a runner profile.
 */
export interface CheckmateProfile<TServices extends CheckmateServices = CheckmateServices> {
	/** Profile name for diagnostics and docs. */
	name: string
	/** Extensions applied in order. */
	extensions: CheckmateExtension<TServices>[]
}

/**
 * Runner options for composing custom profiles, extensions, and services.
 */
export interface CheckmateRunnerOptions<TServices extends CheckmateServices = CheckmateServices> {
	/** Optional Playwright page used by browser-based profiles. */
	page?: Page
	/** Optional profile. Defaults to the built-in web profile. */
	profile?: CheckmateProfile<TServices>
	/** Additional extensions appended after the profile extensions. */
	extensions?: CheckmateExtension<TServices>[]
	/** Prebuilt named services available to extension setup and tools. */
	services?: Partial<TServices>
}
