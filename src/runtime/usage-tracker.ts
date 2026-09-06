import type { ChatCompletion } from 'openai/resources/chat/completions'
import type { Usage } from '../contracts/types.js'

export type UsageCheckpoint = Readonly<{
	promptTokens: number
	cachedPromptTokens: number
	completionTokens: number
	reportedResponses: number
	missingResponses: number
}>

export class TokenBudgetExceededError extends Error {
	constructor(
		readonly budgetTokens: number,
		readonly totalTokens: number
	) {
		super(`Scenario token budget of ${budgetTokens} was exceeded by response total ${totalTokens}`)
		this.name = 'TokenBudgetExceededError'
	}
}

export class ProviderUsageUnavailableError extends Error {
	constructor() {
		super('Provider response omitted usage while a scenario token budget is active')
		this.name = 'ProviderUsageUnavailableError'
	}
}

export class ProviderUsageInvalidError extends Error {
	constructor(message: string) {
		super(`Provider response contained invalid usage: ${message}`)
		this.name = 'ProviderUsageInvalidError'
	}
}

export class ScenarioUsageTracker {
	private promptTokens = 0
	private cachedPromptTokens = 0
	private completionTokens = 0
	private reportedResponses = 0
	private missingResponses = 0

	constructor(private readonly budgetTokens?: number) {
		if (budgetTokens !== undefined && (!Number.isSafeInteger(budgetTokens) || budgetTokens < 1)) {
			throw new Error('Scenario token budget must be a positive integer')
		}
	}

	beginStep(): UsageCheckpoint {
		return this.checkpoint()
	}

	record(usage: ChatCompletion['usage']): void {
		if (!usage) {
			this.missingResponses++
			if (this.budgetTokens !== undefined) throw new ProviderUsageUnavailableError()
			return
		}

		const promptTokens = requiredTokenCount(usage.prompt_tokens, 'prompt_tokens')
		const completionTokens = requiredTokenCount(usage.completion_tokens, 'completion_tokens')
		const totalTokens = requiredTokenCount(usage.total_tokens, 'total_tokens')
		if (totalTokens !== promptTokens + completionTokens) {
			throw new ProviderUsageInvalidError('total_tokens must equal prompt_tokens plus completion_tokens')
		}

		const cachedPromptTokens = optionalTokenCount(
			usage.prompt_tokens_details?.cached_tokens,
			'prompt_tokens_details.cached_tokens'
		)
		if (cachedPromptTokens > promptTokens) {
			throw new ProviderUsageInvalidError('cached_tokens cannot exceed prompt_tokens')
		}
		this.promptTokens += promptTokens
		this.cachedPromptTokens += cachedPromptTokens
		this.completionTokens += completionTokens
		this.reportedResponses++

		const scenarioTotalTokens = this.promptTokens + this.completionTokens
		if (this.budgetTokens !== undefined && scenarioTotalTokens > this.budgetTokens) {
			throw new TokenBudgetExceededError(this.budgetTokens, scenarioTotalTokens)
		}
	}

	stepUsage(checkpoint: UsageCheckpoint): Usage {
		return usageFrom({
			promptTokens: this.promptTokens - checkpoint.promptTokens,
			cachedPromptTokens: this.cachedPromptTokens - checkpoint.cachedPromptTokens,
			completionTokens: this.completionTokens - checkpoint.completionTokens,
		})
	}

	usage(): Usage & { state: 'complete' | 'partial' | 'unavailable' } {
		const state = this.reportedResponses === 0 ? 'unavailable' : this.missingResponses > 0 ? 'partial' : 'complete'
		return {
			...usageFrom({
				promptTokens: this.promptTokens,
				cachedPromptTokens: this.cachedPromptTokens,
				completionTokens: this.completionTokens,
			}),
			state,
		}
	}

	private checkpoint(): UsageCheckpoint {
		return {
			promptTokens: this.promptTokens,
			cachedPromptTokens: this.cachedPromptTokens,
			completionTokens: this.completionTokens,
			reportedResponses: this.reportedResponses,
			missingResponses: this.missingResponses,
		}
	}
}

function requiredTokenCount(value: unknown, field: string): number {
	if (!Number.isSafeInteger(value) || (value as number) < 0) {
		throw new ProviderUsageInvalidError(`${field} must be a non-negative safe integer`)
	}
	return value as number
}

function optionalTokenCount(value: unknown, field: string): number {
	return value === undefined ? 0 : requiredTokenCount(value, field)
}

function usageFrom(input: { promptTokens: number; cachedPromptTokens: number; completionTokens: number }): Usage {
	return {
		promptTokens: input.promptTokens,
		cachedPromptTokens: Math.min(input.cachedPromptTokens, input.promptTokens),
		completionTokens: input.completionTokens,
		totalTokens: input.promptTokens + input.completionTokens,
	}
}
