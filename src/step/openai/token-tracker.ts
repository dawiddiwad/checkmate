import { ChatCompletion } from "openai/resources/chat/completions"
import { OpenAITokenPricing } from "./openai-token-pricing"

export class TokenTracker {
    private inputTokensUsedForTest = 0
    private inputTokensUsedForStep = 0
    private outputTokensUsedForTest = 0
    private outputTokensUsedForStep = 0

    log(response: ChatCompletion, historyTokenCount: number, model: string): void {
        if (response.usage) {
            const inputTokens = response.usage.prompt_tokens ?? 0
            const outputTokens = response.usage.completion_tokens ?? 0
            this.inputTokensUsedForTest += inputTokens
            this.inputTokensUsedForStep += inputTokens
            this.outputTokensUsedForTest += outputTokens
            this.outputTokensUsedForStep += outputTokens
            console.log(
                `\n| token usage` +
                `\n| response input: ${inputTokens} @ ${OpenAITokenPricing.inputPriceUSD(model, inputTokens)}$` +
                `\n| response output: ${outputTokens} @ ${OpenAITokenPricing.outputPriceUSD(model, outputTokens)}$` +
                `\n| history (estimated): ${historyTokenCount}` +
                `\n| step input: ${this.inputTokensUsedForStep} @ ${OpenAITokenPricing.inputPriceUSD(model, this.inputTokensUsedForStep)}$` +
                `\n| step output: ${this.outputTokensUsedForStep} @ ${OpenAITokenPricing.outputPriceUSD(model, this.outputTokensUsedForStep)}$` +
                `\n| test input: ${this.inputTokensUsedForTest} @ ${OpenAITokenPricing.inputPriceUSD(model, this.inputTokensUsedForTest)}$` +
                `\n| test output: ${this.outputTokensUsedForTest} @ ${OpenAITokenPricing.outputPriceUSD(model, this.outputTokensUsedForTest)}$`
            )
        } else {
            console.log(
                `\n| token usage` +
                `\n| (usage data not available)` +
                `\n| history (estimated): ${historyTokenCount}`
            )
        }
    }
}
