export class OpenAITokenPricing {
    private static roundToCents(price: number): number {
        return Math.round(price * 100) / 100
    }

    private static inputPricePerMillionUSD(model: string): number {
        // Pricing as of late 2024 - update as needed
        switch (model) {
            // OpenAI models
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
            case 'o1':
            case 'o1-2024-12-17':
                return this.roundToCents(15.00)
            case 'o1-mini':
            case 'o1-mini-2024-09-12':
                return this.roundToCents(3.00)
            case 'o3-mini':
                return this.roundToCents(1.10)
            // Claude models (via OpenAI-compatible API)
            case 'claude-3-5-sonnet-20241022':
            case 'claude-3-5-sonnet-latest':
                return this.roundToCents(3.00)
            case 'claude-3-5-haiku-20241022':
            case 'claude-3-5-haiku-latest':
                return this.roundToCents(0.80)
            case 'claude-3-opus-20240229':
            case 'claude-3-opus-latest':
                return this.roundToCents(15.00)
            // Gemini models (via OpenAI-compatible API)
            case 'gemini-2.5-pro':
                return this.roundToCents(1.25)
            case 'gemini-2.5-flash':
                return this.roundToCents(0.30)
            case 'gemini-2.0-flash':
                return this.roundToCents(0.10)
            default:
                // Default to gpt-4o-mini pricing for unknown models
                return this.roundToCents(0.15)
        }
    }

    private static outputPricePerMillionUSD(model: string): number {
        switch (model) {
            // OpenAI models
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
            case 'o1':
            case 'o1-2024-12-17':
                return this.roundToCents(60.00)
            case 'o1-mini':
            case 'o1-mini-2024-09-12':
                return this.roundToCents(12.00)
            case 'o3-mini':
                return this.roundToCents(4.40)
            // Claude models (via OpenAI-compatible API)
            case 'claude-3-5-sonnet-20241022':
            case 'claude-3-5-sonnet-latest':
                return this.roundToCents(15.00)
            case 'claude-3-5-haiku-20241022':
            case 'claude-3-5-haiku-latest':
                return this.roundToCents(4.00)
            case 'claude-3-opus-20240229':
            case 'claude-3-opus-latest':
                return this.roundToCents(75.00)
            // Gemini models (via OpenAI-compatible API)
            case 'gemini-2.5-pro':
                return this.roundToCents(10.00)
            case 'gemini-2.5-flash':
                return this.roundToCents(1.25)
            case 'gemini-2.0-flash':
                return this.roundToCents(0.40)
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
