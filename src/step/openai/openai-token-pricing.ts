export class OpenAITokenPricing {
    private static roundToCents(price: number): number {
        return Math.round(price * 100) / 100
    }

    private static inputPricePerMillionUSD(model: string): number {
        switch (model) {
            case 'gpt-5.1':
                return this.roundToCents(1.25)
            case 'gpt-5-mini':
                return this.roundToCents(0.25)
            case 'gpt-5-nano':
                return this.roundToCents(0.05)
            case 'gpt-5-pro':
                return this.roundToCents(15.00)
            case 'gpt-4.1':
                return this.roundToCents(3.00)
            case 'gpt-4.1-mini':
                return this.roundToCents(0.80)
            case 'gpt-4.1-nano':
                return this.roundToCents(0.20)
            case 'gpt-4o':
            case 'gpt-4o-2024-11-20':
                return this.roundToCents(2.50)
            case 'gpt-4o-mini':
            case 'gpt-4o-mini-2024-07-18':
                return this.roundToCents(0.15)
            case 'gpt-4-turbo':
            case 'gpt-4-turbo-preview':
                return this.roundToCents(10.00)
            case 'gpt-4':
                return this.roundToCents(30.00)
            case 'gpt-3.5-turbo':
                return this.roundToCents(0.50)
            case 'o4-mini':
                return this.roundToCents(4.00)
            case 'o3-mini':
                return this.roundToCents(1.10)
            case 'o1':
            case 'o1-2024-12-17':
                return this.roundToCents(15.00)
            case 'o1-mini':
            case 'o1-mini-2024-09-12':
                return this.roundToCents(3.00)
            case 'claude-3-5-sonnet-20241022':
            case 'claude-3-5-sonnet-latest':
                return this.roundToCents(3.00)
            case 'claude-3-5-haiku-20241022':
            case 'claude-3-5-haiku-latest':
                return this.roundToCents(0.80)
            case 'claude-3-opus-20240229':
            case 'claude-3-opus-latest':
                return this.roundToCents(15.00)
            case 'gemini-3-pro-preview':
                return this.roundToCents(2.00)
            case 'gemini-2.5-pro':
                return this.roundToCents(1.25)
            case 'gemini-2.5-flash':
            case 'gemini-2.5-flash-preview-09-2025':
                return this.roundToCents(0.30)
            case 'gemini-2.5-flash-lite':
            case 'gemini-2.5-flash-lite-preview-09-2025':
                return this.roundToCents(0.10)
            case 'gemini-2.0-flash':
                return this.roundToCents(0.10)
            case 'gemini-2.0-flash-lite':
                return this.roundToCents(0.075)
            case 'grok-4':
            case 'grok-4-0709':
            case 'grok-4-latest':
                return this.roundToCents(3.00)
            case 'grok-4-1-fast':
            case 'grok-4-1-fast-reasoning':
            case 'grok-4-1-fast-reasoning-latest':
            case 'grok-4-1-fast-non-reasoning':
            case 'grok-4-fast-reasoning':
            case 'grok-4-fast-non-reasoning':
                return this.roundToCents(0.20)
            case 'grok-code-fast-1':
                return this.roundToCents(0.20)
            case 'grok-2-vision-1212':
                return this.roundToCents(2.00)
            case 'grok-3':
            case 'grok-3-latest':
            case 'grok-3-beta':
            case 'grok-3-fast':
            case 'grok-3-fast-latest':
            case 'grok-3-fast-beta':
                return this.roundToCents(3.00)
            case 'grok-3-mini':
            case 'grok-3-mini-latest':
            case 'grok-3-mini-beta':
            case 'grok-3-mini-fast':
            case 'grok-3-mini-fast-latest':
            case 'grok-3-mini-fast-beta':
                return this.roundToCents(0.30)
            default:
                return this.roundToCents(0.15)
        }
    }

    private static outputPricePerMillionUSD(model: string): number {
        switch (model) {
            case 'gpt-5.1':
                return this.roundToCents(10.00)
            case 'gpt-5-mini':
                return this.roundToCents(2.00)
            case 'gpt-5-nano':
                return this.roundToCents(0.40)
            case 'gpt-5-pro':
                return this.roundToCents(120.00)
            case 'gpt-4.1':
                return this.roundToCents(12.00)
            case 'gpt-4.1-mini':
                return this.roundToCents(3.20)
            case 'gpt-4.1-nano':
                return this.roundToCents(0.80)
            case 'gpt-4o':
            case 'gpt-4o-2024-11-20':
                return this.roundToCents(10.00)
            case 'gpt-4o-mini':
            case 'gpt-4o-mini-2024-07-18':
                return this.roundToCents(0.60)
            case 'gpt-4-turbo':
            case 'gpt-4-turbo-preview':
                return this.roundToCents(30.00)
            case 'gpt-4':
                return this.roundToCents(60.00)
            case 'gpt-3.5-turbo':
                return this.roundToCents(1.50)
            case 'o4-mini':
                return this.roundToCents(16.00)
            case 'o3-mini':
                return this.roundToCents(4.40)
            case 'o1':
            case 'o1-2024-12-17':
                return this.roundToCents(60.00)
            case 'o1-mini':
            case 'o1-mini-2024-09-12':
                return this.roundToCents(12.00)
            case 'claude-3-5-sonnet-20241022':
            case 'claude-3-5-sonnet-latest':
                return this.roundToCents(15.00)
            case 'claude-3-5-haiku-20241022':
            case 'claude-3-5-haiku-latest':
                return this.roundToCents(4.00)
            case 'claude-3-opus-20240229':
            case 'claude-3-opus-latest':
                return this.roundToCents(75.00)
            case 'gemini-3-pro-preview':
                return this.roundToCents(12.00)
            case 'gemini-2.5-pro':
                return this.roundToCents(10.00)
            case 'gemini-2.5-flash':
            case 'gemini-2.5-flash-preview-09-2025':
                return this.roundToCents(2.50)
            case 'gemini-2.5-flash-lite':
            case 'gemini-2.5-flash-lite-preview-09-2025':
                return this.roundToCents(0.40)
            case 'gemini-2.0-flash':
                return this.roundToCents(0.40)
            case 'gemini-2.0-flash-lite':
                return this.roundToCents(0.30)
            case 'grok-4':
            case 'grok-4-0709':
            case 'grok-4-latest':
                return this.roundToCents(15.00)
            case 'grok-4-1-fast':
            case 'grok-4-1-fast-reasoning':
            case 'grok-4-1-fast-reasoning-latest':
            case 'grok-4-1-fast-non-reasoning':
            case 'grok-4-fast-reasoning':
            case 'grok-4-fast-non-reasoning':
                return this.roundToCents(0.50)
            case 'grok-code-fast-1':
                return this.roundToCents(1.50)
            case 'grok-2-vision-1212':
                return this.roundToCents(10.00)
            case 'grok-3':
            case 'grok-3-latest':
            case 'grok-3-beta':
            case 'grok-3-fast':
            case 'grok-3-fast-latest':
            case 'grok-3-fast-beta':
                return this.roundToCents(15.00)
            case 'grok-3-mini':
            case 'grok-3-mini-latest':
            case 'grok-3-mini-beta':
            case 'grok-3-mini-fast':
            case 'grok-3-mini-fast-latest':
            case 'grok-3-mini-fast-beta':
                return this.roundToCents(0.50)
            default:
                return this.roundToCents(0.60)
        }
    }

    static inputPriceUSD(model: string, tokens: number): number {
        return this.roundToCents(this.inputPricePerMillionUSD(model) * tokens / 1_000_000)
    }

    static outputPriceUSD(model: string, tokens: number): number {
        return this.roundToCents(this.outputPricePerMillionUSD(model) * tokens / 1_000_000)
    }
}
