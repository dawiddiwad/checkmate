import { ChatCompletion } from "openai/resources/chat/completions"
import { OpenAITokenPricing } from "./openai-token-pricing"
import { ConfigurationManager } from "../configuration-manager"

export class TokenTracker {
    private _inputTokensUsedForTest = 0
    private _inputTokensUsedForStep = 0
    private _outputTokensUsedForTest = 0
    private _outputTokensUsedForStep = 0

    constructor(private config = new ConfigurationManager()) {}

    private get inputTokensUsedForTest(): number { return this._inputTokensUsedForTest }
    private set inputTokensUsedForTest(value: number) {
        this._inputTokensUsedForTest = value
        this.checkBudget()
    }

    private get inputTokensUsedForStep(): number { return this._inputTokensUsedForStep }
    private set inputTokensUsedForStep(value: number) {
        this._inputTokensUsedForStep = value
        this.checkBudget()
    }

    private get outputTokensUsedForTest(): number { return this._outputTokensUsedForTest }
    private set outputTokensUsedForTest(value: number) {
        this._outputTokensUsedForTest = value
        this.checkBudget()
    }

    private get outputTokensUsedForStep(): number { return this._outputTokensUsedForStep }
    private set outputTokensUsedForStep(value: number) {
        this._outputTokensUsedForStep = value
        this.checkBudget()
    }

    private checkBudget() {
        const budgetUSD = this.config.getTokenBudgetUSD()
        const budgetTokens = this.config.getTokenBudgetCount()
        if (budgetUSD) {
            const totalCostUSD = OpenAITokenPricing.totalPriceUSD(this.config.getModel(), this.inputTokensUsedForTest, this.outputTokensUsedForTest)
            if (totalCostUSD > budgetUSD) {
                throw new Error(`OpenAI API budget of ${budgetUSD}$ per test exceeded. Total cost was: ${totalCostUSD}$`)
            }
        }
        if (budgetTokens) {
            const budgetCount = budgetTokens
            const totalTokens = this.inputTokensUsedForTest + this.outputTokensUsedForTest
            if (totalTokens > budgetCount) {
                throw new Error(`OpenAI API budget of ${budgetCount} tokens per test exceeded. Total tokens used: ${totalTokens}`)
            }
        }
    }

    resetStep(): void {
        this.inputTokensUsedForStep = 0
        this.outputTokensUsedForStep = 0
    }

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
