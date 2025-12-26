/**
 * OpenAITokenPricing
 *
 * Utility for estimating USD costs for token usage across a wide set of LLM models.
 * It maps model identifiers to input/output prices per 1,000,000 tokens (USD) and
 * exposes helpers to compute the USD cost of a given number of tokens. All returned
 * prices are rounded to the nearest cent.
 *
 * Pricing sources:
 * - https://ai.google.dev/gemini-api/docs/pricing
 * - https://openai.com/api/pricing/
 * - https://claude.com/pricing#api
 * - https://docs.x.ai/docs/models#model-pricing
 * - https://console.groq.com/docs/models
 *
 * Private helpers:
 * @private
 * - roundToCents(price: number): number
 *   Rounds a numeric USD value to two decimal places (cents).
 *
 * @private
 * - inputPricePerMillionUSD(model: string): number
 *   Returns the input-token price (USD) per 1,000,000 tokens for the given model.
 *   If the model is not recognized, a sensible default is returned.
 *
 * @private
 * - outputPricePerMillionUSD(model: string): number
 *   Returns the output-token price (USD) per 1,000,000 tokens for the given model.
 *   If the model is not recognized, a sensible default is returned.
 *
 * Public API:
 * - inputPriceUSD(model: string, tokens: number): number
 *   Computes the USD cost for the provided number of input tokens (rounded to cents).
 *
 * - outputPriceUSD(model: string, tokens: number): number
 *   Computes the USD cost for the provided number of output tokens (rounded to cents).
 *
 * - totalPriceUSD(model: string, inputTokens: number, outputTokens: number): number
 *   Computes the total USD cost (input + output) for the given model and token counts,
 *   rounded to cents.
 *
 * @example
 * Estimate cost of 1k input tokens and 2k output tokens for 'gpt-4o'
 * const inCost = OpenAITokenPricing.inputPriceUSD('gpt-4o', 1000)
 * const outCost = OpenAITokenPricing.outputPriceUSD('gpt-4o', 2000)
 * const total = OpenAITokenPricing.totalPriceUSD('gpt-4o', 1000, 2000)
 *
 * @note
 * Token counts are integer counts of tokens. Model pricing and mappings may change
 * keep the price table updated with provider pricing announcements.
 * use coding agent with browser/fetch tool to update )
 */
export class OpenAITokenPricing {
	private static roundToCents(price: number): number {
		return Math.round(price * 100) / 100
	}

	private static inputPricePerMillionUSD(model: string): number {
		switch (model) {
			case 'gpt-5.2':
				return this.roundToCents(1.75)
			case 'gpt-5.2-pro':
				return this.roundToCents(21.0)
			case 'gpt-5-mini':
				return this.roundToCents(0.25)
			case 'gpt-5.1':
				return this.roundToCents(1.25)
			case 'gpt-5-nano':
				return this.roundToCents(0.05)
			case 'gpt-5-pro':
				return this.roundToCents(15.0)
			case 'gpt-4.1':
				return this.roundToCents(3.0)
			case 'gpt-4.1-mini':
				return this.roundToCents(0.8)
			case 'gpt-4.1-nano':
				return this.roundToCents(0.2)
			case 'gpt-4o':
			case 'gpt-4o-2024-11-20':
				return this.roundToCents(2.5)
			case 'gpt-4o-mini':
			case 'gpt-4o-mini-2024-07-18':
				return this.roundToCents(0.15)
			case 'gpt-4-turbo':
			case 'gpt-4-turbo-preview':
				return this.roundToCents(10.0)
			case 'gpt-4':
				return this.roundToCents(30.0)
			case 'gpt-3.5-turbo':
				return this.roundToCents(0.5)
			case 'o4-mini':
				return this.roundToCents(4.0)
			case 'o3-mini':
				return this.roundToCents(1.1)
			case 'o1':
			case 'o1-2024-12-17':
				return this.roundToCents(15.0)
			case 'o1-mini':
			case 'o1-mini-2024-09-12':
				return this.roundToCents(3.0)
			case 'claude-3-5-sonnet-20241022':
			case 'claude-3-5-sonnet-latest':
				return this.roundToCents(3.0)
			case 'claude-3-5-haiku-20241022':
			case 'claude-3-5-haiku-latest':
				return this.roundToCents(0.8)
			case 'claude-3-opus-20240229':
			case 'claude-3-opus-latest':
				return this.roundToCents(15.0)
			case 'claude-opus-4.5':
			case 'claude-opus-4-5':
				return this.roundToCents(5.0)
			case 'claude-opus-4.1':
			case 'claude-opus-4-1':
			case 'claude-opus-4':
				return this.roundToCents(15.0)
			case 'claude-sonnet-4.5':
			case 'claude-sonnet-4-5':
			case 'claude-sonnet-4':
			case 'claude-sonnet-3.7':
				return this.roundToCents(3.0)
			case 'claude-haiku-4.5':
			case 'claude-haiku-4-5':
				return this.roundToCents(1.0)
			case 'claude-haiku-3.5':
				return this.roundToCents(0.8)
			case 'claude-haiku-3':
				return this.roundToCents(0.25)
			case 'gemini-3-pro-preview':
				return this.roundToCents(2.0)
			case 'gemini-2.5-pro':
				return this.roundToCents(1.25)
			case 'gemini-2.5-flash':
			case 'gemini-2.5-flash-preview-09-2025':
				return this.roundToCents(0.3)
			case 'gemini-2.5-flash-lite':
			case 'gemini-2.5-flash-lite-preview-09-2025':
				return this.roundToCents(0.1)

			case 'gemini-3-flash-preview':
			case 'gemini-3-flash':
				return this.roundToCents(0.5)

			case 'gemini-3-pro-image-preview':
			case 'gemini-3-pro-image':
				return this.roundToCents(2.0)
			case 'gemini-2.0-flash':
				return this.roundToCents(0.1)
			case 'gemini-2.0-flash-lite':
				return this.roundToCents(0.075)
			case 'grok-4':
			case 'grok-4-0709':
			case 'grok-4-latest':
				return this.roundToCents(3.0)
			case 'grok-4-1-fast':
			case 'grok-4-1-fast-reasoning':
			case 'grok-4-1-fast-reasoning-latest':
			case 'grok-4-1-fast-non-reasoning':
			case 'grok-4-fast-reasoning':
			case 'grok-4-fast-non-reasoning':
				return this.roundToCents(0.2)
			case 'grok-code-fast-1':
				return this.roundToCents(0.2)
			case 'grok-2-vision-1212':
				return this.roundToCents(2.0)
			case 'grok-3':
			case 'grok-3-latest':
			case 'grok-3-beta':
			case 'grok-3-fast':
			case 'grok-3-fast-latest':
			case 'grok-3-fast-beta':
				return this.roundToCents(3.0)
			case 'grok-3-mini':
			case 'grok-3-mini-latest':
			case 'grok-3-mini-beta':
			case 'grok-3-mini-fast':
			case 'grok-3-mini-fast-latest':
			case 'grok-3-mini-fast-beta':
				return this.roundToCents(0.3)

			case 'openai/gpt-oss-20b':
				return this.roundToCents(0.075)
			case 'openai/gpt-oss-safeguard-20b':
				return this.roundToCents(0.075)
			case 'openai/gpt-oss-120b':
				return this.roundToCents(0.15)
			case 'moonshotai/kimi-k2-instruct-0905':
				return this.roundToCents(1.0)
			case 'meta-llama/llama-4-scout-17b-16e-instruct':
				return this.roundToCents(0.11)
			case 'meta-llama/llama-4-maverick-17b-128e-instruct':
				return this.roundToCents(0.2)
			case 'meta-llama/llama-guard-4-12b':
				return this.roundToCents(0.2)
			case 'qwen/qwen3-32b':
				return this.roundToCents(0.29)
			case 'llama-3.3-70b-versatile':
				return this.roundToCents(0.59)
			case 'llama-3.1-8b-instant':
				return this.roundToCents(0.05)
			default:
				return this.roundToCents(0.15)
		}
	}

	private static outputPricePerMillionUSD(model: string): number {
		switch (model) {
			case 'gpt-5.2':
				return this.roundToCents(14.0)
			case 'gpt-5.2-pro':
				return this.roundToCents(168.0)
			case 'gpt-5-mini':
				return this.roundToCents(2.0)
			case 'gpt-5.1':
				return this.roundToCents(10.0)
			case 'gpt-5-nano':
				return this.roundToCents(0.4)
			case 'gpt-5-pro':
				return this.roundToCents(120.0)
			case 'gpt-4.1':
				return this.roundToCents(12.0)
			case 'gpt-4.1-mini':
				return this.roundToCents(3.2)
			case 'gpt-4.1-nano':
				return this.roundToCents(0.8)
			case 'gpt-4o':
			case 'gpt-4o-2024-11-20':
				return this.roundToCents(10.0)
			case 'gpt-4o-mini':
			case 'gpt-4o-mini-2024-07-18':
				return this.roundToCents(0.6)
			case 'gpt-4-turbo':
			case 'gpt-4-turbo-preview':
				return this.roundToCents(30.0)
			case 'gpt-4':
				return this.roundToCents(60.0)
			case 'gpt-3.5-turbo':
				return this.roundToCents(1.5)
			case 'o4-mini':
				return this.roundToCents(16.0)
			case 'o3-mini':
				return this.roundToCents(4.4)
			case 'o1':
			case 'o1-2024-12-17':
				return this.roundToCents(60.0)
			case 'o1-mini':
			case 'o1-mini-2024-09-12':
				return this.roundToCents(12.0)
			case 'claude-3-5-sonnet-20241022':
			case 'claude-3-5-sonnet-latest':
				return this.roundToCents(15.0)
			case 'claude-3-5-haiku-20241022':
			case 'claude-3-5-haiku-latest':
				return this.roundToCents(4.0)
			case 'claude-3-opus-20240229':
			case 'claude-3-opus-latest':
				return this.roundToCents(75.0)
			case 'claude-opus-4.5':
			case 'claude-opus-4-5':
				return this.roundToCents(25.0)
			case 'claude-opus-4.1':
			case 'claude-opus-4-1':
			case 'claude-opus-4':
				return this.roundToCents(75.0)
			case 'claude-sonnet-4.5':
			case 'claude-sonnet-4-5':
			case 'claude-sonnet-4':
			case 'claude-sonnet-3.7':
				return this.roundToCents(15.0)
			case 'claude-haiku-4.5':
			case 'claude-haiku-4-5':
				return this.roundToCents(5.0)
			case 'claude-haiku-3.5':
				return this.roundToCents(4.0)
			case 'claude-haiku-3':
				return this.roundToCents(1.25)
			case 'gemini-3-pro-preview':
				return this.roundToCents(12.0)
			case 'gemini-2.5-pro':
				return this.roundToCents(10.0)
			case 'gemini-2.5-flash':
			case 'gemini-2.5-flash-preview-09-2025':
				return this.roundToCents(2.5)
			case 'gemini-2.5-flash-lite':
			case 'gemini-2.5-flash-lite-preview-09-2025':
				return this.roundToCents(0.4)

			case 'gemini-3-flash-preview':
			case 'gemini-3-flash':
				return this.roundToCents(3.0)

			case 'gemini-3-pro-image-preview':
			case 'gemini-3-pro-image':
				return this.roundToCents(12.0)
			case 'gemini-2.0-flash':
				return this.roundToCents(0.4)
			case 'gemini-2.0-flash-lite':
				return this.roundToCents(0.3)
			case 'grok-4':
			case 'grok-4-0709':
			case 'grok-4-latest':
				return this.roundToCents(15.0)
			case 'grok-4-1-fast':
			case 'grok-4-1-fast-reasoning':
			case 'grok-4-1-fast-reasoning-latest':
			case 'grok-4-1-fast-non-reasoning':
			case 'grok-4-fast-reasoning':
			case 'grok-4-fast-non-reasoning':
				return this.roundToCents(0.5)
			case 'grok-code-fast-1':
				return this.roundToCents(1.5)
			case 'grok-2-vision-1212':
				return this.roundToCents(10.0)
			case 'grok-3':
			case 'grok-3-latest':
			case 'grok-3-beta':
			case 'grok-3-fast':
			case 'grok-3-fast-latest':
			case 'grok-3-fast-beta':
				return this.roundToCents(15.0)
			case 'grok-3-mini':
			case 'grok-3-mini-latest':
			case 'grok-3-mini-beta':
			case 'grok-3-mini-fast':
			case 'grok-3-mini-fast-latest':
			case 'grok-3-mini-fast-beta':
				return this.roundToCents(0.5)

			case 'openai/gpt-oss-20b':
				return this.roundToCents(0.3)
			case 'openai/gpt-oss-safeguard-20b':
				return this.roundToCents(0.3)
			case 'openai/gpt-oss-120b':
				return this.roundToCents(0.6)
			case 'moonshotai/kimi-k2-instruct-0905':
				return this.roundToCents(3.0)
			case 'meta-llama/llama-4-scout-17b-16e-instruct':
				return this.roundToCents(0.34)
			case 'meta-llama/llama-4-maverick-17b-128e-instruct':
				return this.roundToCents(0.6)
			case 'meta-llama/llama-guard-4-12b':
				return this.roundToCents(0.2)
			case 'qwen/qwen3-32b':
				return this.roundToCents(0.59)
			case 'llama-3.3-70b-versatile':
				return this.roundToCents(0.79)
			case 'llama-3.1-8b-instant':
				return this.roundToCents(0.08)
			default:
				return this.roundToCents(0.6)
		}
	}

	static inputPriceUSD(model: string, tokens: number): number {
		return this.roundToCents((this.inputPricePerMillionUSD(model) * tokens) / 1_000_000)
	}

	static outputPriceUSD(model: string, tokens: number): number {
		return this.roundToCents((this.outputPricePerMillionUSD(model) * tokens) / 1_000_000)
	}

	static totalPriceUSD(model: string, inputTokens: number, outputTokens: number): number {
		return this.roundToCents(this.inputPriceUSD(model, inputTokens) + this.outputPriceUSD(model, outputTokens))
	}
}
