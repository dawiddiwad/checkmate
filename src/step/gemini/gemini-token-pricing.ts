export class GeminiTokenPricing {
    private static roundToCents(price: number): number {
        return Math.round(price * 100) / 100
    }

    private static inputPricePerMillionUSD(model: string): number {
        switch (model) {
            case 'gemini-2.5-pro':
                return this.roundToCents(1.25)
            case 'gemini-2.5-flash':
            case 'gemini-2.5-flash-preview-09-2025':
                return this.roundToCents(0.30)
            case 'gemini-2.5-flash-lite':
                return this.roundToCents(0.10)
            case 'gemini-live-2.5-flash-preview':
                return this.roundToCents(0.50)
            default:
                return this.roundToCents(0.30)
        }
    }

    static inputPriceUSD(model: string, tokens: number): number {
        return this.roundToCents(this.inputPricePerMillionUSD(model) * tokens / 1_000_000)
    }
}