import { ChatCompletion } from 'openai/resources/chat/completions'
import { RuntimeConfig } from '../config/runtime-config'
import { logger } from '../logging'
import { TokenPricing } from './token-pricing'

export class TokenTracker {
	private _inputTokensUsedForTest = 0
	private _inputTokensUsedForStep = 0
	private _cachedInputTokensUsedForTest = 0
	private _cachedInputTokensUsedForStep = 0
	private _cacheMetricsUnavailableForTest = false
	private _cacheMetricsUnavailableForStep = false
	private _outputTokensUsedForTest = 0
	private _outputTokensUsedForStep = 0

	constructor(private config = new RuntimeConfig()) {}

	private get inputTokensUsedForTest(): number {
		return this._inputTokensUsedForTest
	}

	private set inputTokensUsedForTest(value: number) {
		this._inputTokensUsedForTest = value
		this.checkBudget()
	}

	private get inputTokensUsedForStep(): number {
		return this._inputTokensUsedForStep
	}

	private set inputTokensUsedForStep(value: number) {
		this._inputTokensUsedForStep = value
		this.checkBudget()
	}

	private get cachedInputTokensUsedForTest(): number {
		return this._cachedInputTokensUsedForTest
	}

	private set cachedInputTokensUsedForTest(value: number) {
		this._cachedInputTokensUsedForTest = value
		this.checkBudget()
	}

	private get cachedInputTokensUsedForStep(): number {
		return this._cachedInputTokensUsedForStep
	}

	private set cachedInputTokensUsedForStep(value: number) {
		this._cachedInputTokensUsedForStep = value
		this.checkBudget()
	}

	private get outputTokensUsedForTest(): number {
		return this._outputTokensUsedForTest
	}

	private set outputTokensUsedForTest(value: number) {
		this._outputTokensUsedForTest = value
		this.checkBudget()
	}

	private get outputTokensUsedForStep(): number {
		return this._outputTokensUsedForStep
	}

	private set outputTokensUsedForStep(value: number) {
		this._outputTokensUsedForStep = value
		this.checkBudget()
	}

	private checkBudget() {
		const budgetUSD = this.config.getTokenBudgetUSD()
		const budgetTokens = this.config.getTokenBudgetCount()

		if (budgetUSD) {
			const totalCostUSD = TokenPricing.totalPriceUSD(
				this.config.getModel(),
				this.inputTokensUsedForTest,
				this.outputTokensUsedForTest,
				this.cachedInputTokensUsedForTest
			)

			if (totalCostUSD > budgetUSD) {
				throw new Error(
					`OpenAI API budget of ${budgetUSD}$ per test exceeded. Total cost was: ${totalCostUSD}$`
				)
			}
		}

		if (budgetTokens) {
			const totalTokens = this.inputTokensUsedForTest + this.outputTokensUsedForTest
			if (totalTokens > budgetTokens) {
				throw new Error(
					`OpenAI API budget of ${budgetTokens} tokens per test exceeded. Total tokens used: ${totalTokens}`
				)
			}
		}
	}

	resetStep(): void {
		this.inputTokensUsedForStep = 0
		this.cachedInputTokensUsedForStep = 0
		this._cacheMetricsUnavailableForStep = false
		this.outputTokensUsedForStep = 0
	}

	log(response: ChatCompletion, historyTokenCount: number, model: string): void {
		if (!response.usage) {
			logger.info(
				`token usage:\n${JSON.stringify({ 'usage data': 'not available', 'history (estimated)': historyTokenCount }, null, 2)}`
			)
			return
		}

		const inputTokens = response.usage.prompt_tokens ?? 0
		const cachedTokensReported = response.usage.prompt_tokens_details?.cached_tokens !== undefined
		const cachedInputTokens = Math.min(response.usage.prompt_tokens_details?.cached_tokens ?? 0, inputTokens)
		const uncachedInputTokens = Math.max(inputTokens - cachedInputTokens, 0)
		const outputTokens = response.usage.completion_tokens ?? 0

		if (!cachedTokensReported) {
			this._cacheMetricsUnavailableForTest = true
			this._cacheMetricsUnavailableForStep = true
		}

		this.cachedInputTokensUsedForTest += cachedInputTokens
		this.cachedInputTokensUsedForStep += cachedInputTokens
		this.inputTokensUsedForTest += inputTokens
		this.inputTokensUsedForStep += inputTokens
		this.outputTokensUsedForTest += outputTokens
		this.outputTokensUsedForStep += outputTokens

		const responseInputCostUSD = this.inputCostUSD(model, inputTokens, cachedInputTokens)
		const stepInputCostUSD = this.inputCostUSD(
			model,
			this.inputTokensUsedForStep,
			this.cachedInputTokensUsedForStep
		)
		const testInputCostUSD = this.inputCostUSD(
			model,
			this.inputTokensUsedForTest,
			this.cachedInputTokensUsedForTest
		)
		const responseCacheHitRate = cachedTokensReported
			? inputTokens > 0
				? `${Math.round((cachedInputTokens / inputTokens) * 100)}%`
				: '0%'
			: 'n/a'

		const currentUsage = {
			'response input': `${inputTokens} @ ${this.formatUSD(responseInputCostUSD)}$`,
			'response uncached input': `${uncachedInputTokens} @ ${this.formatUSD(TokenPricing.inputPriceUSD(model, uncachedInputTokens))}$`,
			'response cached input': cachedTokensReported
				? `${cachedInputTokens} @ ${this.formatUSD(TokenPricing.cachedInputPriceUSD(model, cachedInputTokens))}$`
				: 'n/a (provider did not report cached_tokens)',
			'response cache hit rate': responseCacheHitRate,
			'response output': `${outputTokens} @ ${this.formatUSD(TokenPricing.outputPriceUSD(model, outputTokens))}$`,
			'history (estimated)': historyTokenCount,
			'step input': `${this.inputTokensUsedForStep} @ ${this.formatUSD(stepInputCostUSD)}$`,
			'step cached input': this.formatCachedUsage(
				this.cachedInputTokensUsedForStep,
				model,
				this._cacheMetricsUnavailableForStep
			),
			'step output': `${this.outputTokensUsedForStep} @ ${this.formatUSD(TokenPricing.outputPriceUSD(model, this.outputTokensUsedForStep))}$`,
			'test input': `${this.inputTokensUsedForTest} @ ${this.formatUSD(testInputCostUSD)}$`,
			'test cached input': this.formatCachedUsage(
				this.cachedInputTokensUsedForTest,
				model,
				this._cacheMetricsUnavailableForTest
			),
			'test output': `${this.outputTokensUsedForTest} @ ${this.formatUSD(TokenPricing.outputPriceUSD(model, this.outputTokensUsedForTest))}$`,
		}

		logger.info(`token usage:\n${JSON.stringify(currentUsage, null, 2)}`)
	}

	private inputCostUSD(model: string, inputTokens: number, cachedInputTokens: number): number {
		return TokenPricing.totalPriceUSD(model, inputTokens, 0, cachedInputTokens)
	}

	private formatCachedUsage(tokens: number, model: string, unavailable: boolean): string {
		const knownUsage = `${tokens} @ ${this.formatUSD(TokenPricing.cachedInputPriceUSD(model, tokens))}$`
		return unavailable ? `${knownUsage} (partial, provider omitted cached_tokens on some responses)` : knownUsage
	}

	private formatUSD(value: number): string {
		return value.toFixed(3)
	}
}
