import { GenerateContentResponse } from "@google/genai"
import { GeminiTokenPricing } from "./gemini-token-pricing"

export class TokenTracker {
    private inputTokensUsedForTest = 0
    private inputTokensUsedForStep = 0

    log(response: GenerateContentResponse, historyTokenCount: number, model: string): void {
        if (response.usageMetadata) {
            const inputTokens = response.usageMetadata.promptTokenCount ?? 0
            const cachedTokens = response.usageMetadata.cachedContentTokenCount ?? 0
            this.inputTokensUsedForTest += inputTokens
            this.inputTokensUsedForStep += inputTokens
            console.log(
                `\n| input tokens usage` +
                `\n| response: ${inputTokens} @ ${GeminiTokenPricing.inputPriceUSD(model, inputTokens)}$` +
                `\n| history: ${historyTokenCount}` +
                `\n| cached: ${cachedTokens}` +
                `\n| step: ${this.inputTokensUsedForStep} @ ${GeminiTokenPricing.inputPriceUSD(model, this.inputTokensUsedForStep)}$` +
                `\n| test: ${this.inputTokensUsedForTest} @ ${GeminiTokenPricing.inputPriceUSD(model, this.inputTokensUsedForTest)}$`
            )
        } else {
            console.log(
                `\n| input tokens usage` +
                `\n| (usageMetadata not available)` +
                `\n| history: ${historyTokenCount} @ ${GeminiTokenPricing.inputPriceUSD(model, historyTokenCount)}$`
            )
        }
    }
}