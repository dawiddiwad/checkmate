/**
 * TokenPricing estimates provider token costs in USD.
 */
export class TokenPricing {
	private static roundToCents(price: number): number {
		return Math.round(price * 1000) / 1000
	}

	private static inputPricePerMillionUSD(model: string): number {
		switch (model) {
			case 'gpt-5.4':
				return this.roundToCents(2.5)
			case 'gpt-5.3-instant':
			case 'gpt-5.3-codex':
				return this.roundToCents(1.5)
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
			case 'claude-4-sonnet':
			case 'claude-4.5-sonnet':
			case 'claude-4.6-sonnet':
				return this.roundToCents(3.0)
			case 'claude-3-5-haiku-20241022':
			case 'claude-3-5-haiku-latest':
				return this.roundToCents(0.25)
			case 'claude-4.5-haiku':
				return this.roundToCents(1.0)
			case 'claude-3-opus-20240229':
			case 'claude-3-opus-latest':
				return this.roundToCents(15.0)
			case 'claude-4.6-opus':
				return this.roundToCents(5.0)
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
			case 'gemini-3.1-pro-preview':
				return this.roundToCents(2.0)
			case 'gemini-3.1-flash-lite-preview':
				return this.roundToCents(0.25)
			case 'gemini-3.1-flash-image-preview':
				return this.roundToCents(0.5)
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
			case 'grok-4.20':
			case 'grok-4.20-latest':
				return this.roundToCents(3.0)
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
				return this.roundToCents(1.0)
		}
	}

	private static outputPricePerMillionUSD(model: string): number {
		switch (model) {
			case 'gpt-5.4':
				return this.roundToCents(10.0)
			case 'gpt-5.3-instant':
			case 'gpt-5.3-codex':
				return this.roundToCents(6.0)
			case 'gpt-5.2':
				return this.roundToCents(7.0)
			case 'gpt-5.2-pro':
				return this.roundToCents(84.0)
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
			case 'claude-4-sonnet':
			case 'claude-4.5-sonnet':
			case 'claude-4.6-sonnet':
			case 'claude-sonnet-4.5':
			case 'claude-sonnet-4-5':
			case 'claude-sonnet-4':
			case 'claude-sonnet-3.7':
				return this.roundToCents(15.0)
			case 'claude-3-5-haiku-20241022':
			case 'claude-3-5-haiku-latest':
				return this.roundToCents(1.25)
			case 'claude-4.5-haiku':
			case 'claude-haiku-4.5':
			case 'claude-haiku-4-5':
				return this.roundToCents(5.0)
			case 'claude-haiku-3.5':
				return this.roundToCents(4.0)
			case 'claude-haiku-3':
				return this.roundToCents(1.25)
			case 'claude-3-opus-20240229':
			case 'claude-3-opus-latest':
				return this.roundToCents(75.0)
			case 'claude-4.6-opus':
			case 'claude-opus-4.5':
			case 'claude-opus-4-5':
				return this.roundToCents(25.0)
			case 'claude-opus-4.1':
			case 'claude-opus-4-1':
			case 'claude-opus-4':
				return this.roundToCents(75.0)
			case 'gemini-3.1-pro-preview':
				return this.roundToCents(10.0)
			case 'gemini-3.1-flash-lite-preview':
				return this.roundToCents(1.0)
			case 'gemini-3.1-flash-image-preview':
				return this.roundToCents(2.0)
			case 'gemini-3-pro-preview':
				return this.roundToCents(10.0)
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
				return this.roundToCents(2.0)
			case 'gemini-3-pro-image-preview':
			case 'gemini-3-pro-image':
				return this.roundToCents(10.0)
			case 'gemini-2.0-flash':
				return this.roundToCents(0.4)
			case 'gemini-2.0-flash-lite':
				return this.roundToCents(0.3)
			case 'grok-4.20':
			case 'grok-4.20-latest':
				return this.roundToCents(15.0)
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
			case 'grok-code-fast-1':
				return this.roundToCents(0.5)
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
				return this.roundToCents(0.6)
			case 'qwen/qwen3-32b':
				return this.roundToCents(0.59)
			case 'llama-3.3-70b-versatile':
				return this.roundToCents(0.79)
			case 'llama-3.1-8b-instant':
				return this.roundToCents(0.08)
			default:
				return this.roundToCents(2.0)
		}
	}

	static inputPriceUSD(model: string, tokens: number): number {
		return this.roundToCents((this.inputPricePerMillionUSD(model) * tokens) / 1_000_000)
	}

	static cachedInputPriceUSD(model: string, tokens: number): number {
		return this.roundToCents(this.inputPriceUSD(model, tokens) / 10)
	}

	static outputPriceUSD(model: string, tokens: number): number {
		return this.roundToCents((this.outputPricePerMillionUSD(model) * tokens) / 1_000_000)
	}

	static totalPriceUSD(
		model: string,
		inputTokens: number,
		outputTokens: number,
		cachedInputTokens: number = 0
	): number {
		const uncachedInputTokens = Math.max(inputTokens - cachedInputTokens, 0)
		return this.roundToCents(
			this.inputPriceUSD(model, uncachedInputTokens) +
				this.cachedInputPriceUSD(model, cachedInputTokens) +
				this.outputPriceUSD(model, outputTokens)
		)
	}
}
