export class GeminiTokenPricing {
    private static roundToCents(price: number): number {
        return Math.round(price * 100) / 100
    }

    private static inputPricePerMillionUSD(model: string): number {
        switch (model) {
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
            case 'gemini-2.5-computer-use-preview-10-2025':
                return this.roundToCents(1.25)
            case 'gemini-2.0-flash':
                return this.roundToCents(0.10)
            case 'gemini-2.0-flash-lite':
                return this.roundToCents(0.075)
            case 'gemini-2.5-flash-native-audio-preview-09-2025':
            case 'gemini-live-2.5-flash-preview':
                return this.roundToCents(0.50)
            case 'gemini-2.0-flash-live-001':
                return this.roundToCents(0.35)
            default:
                return this.roundToCents(0.30)
        }
    }

    private static outputPricePerMillionUSD(model: string): number {
        switch (model) {
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
            case 'gemini-2.5-computer-use-preview-10-2025':
                return this.roundToCents(10.00)
            case 'gemini-2.0-flash':
                return this.roundToCents(0.40)
            case 'gemini-2.0-flash-lite':
                return this.roundToCents(0.30)
            case 'gemini-2.5-flash-native-audio-preview-09-2025':
            case 'gemini-live-2.5-flash-preview':
                return this.roundToCents(2.00)
            case 'gemini-2.0-flash-live-001':
                return this.roundToCents(1.50)
            default:
                return this.roundToCents(2.50)
        }
    }

    static inputPriceUSD(model: string, tokens: number): number {
        return this.roundToCents(this.inputPricePerMillionUSD(model) * tokens / 1_000_000)
    }

    static outputPriceUSD(model: string, tokens: number): number {
        return this.roundToCents(this.outputPricePerMillionUSD(model) * tokens / 1_000_000)
    }
}
