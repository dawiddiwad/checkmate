import { ToolCall } from "./openai-tool"

export type LoopDetectionResult = {
    loopDetected: boolean
    patternLength: number
    repetitions: number
    pattern: string[]
}

export class LoopDetectedError extends Error {
    static readonly STATUS = 'TOOL_CALL_LOOP'
    readonly status: string
    constructor(public readonly loopResult: LoopDetectionResult) {
        super(`detected tool call loop pattern [${loopResult.pattern.join(' -> ')}] repeated ${loopResult.repetitions} times`)
        this.name = 'LoopDetectedError'
        this.status = LoopDetectedError.STATUS
    }
}

export class LoopDetector {
    private toolCallHistory: string[] = []
    private readonly maxRepetitions: number

    constructor(maxRepetitions: number) {
        this.maxRepetitions = maxRepetitions
    }

    reset(): void {
        this.toolCallHistory = []
    }

    recordToolCall(toolCall: ToolCall): void {
        const signature = this.createToolSignature(toolCall)
        this.toolCallHistory.push(signature)
        this.detectLoop()
    }

    detectLoop() {
        const history = this.toolCallHistory
        for (let patternLength = 1; patternLength <= Math.floor(history.length / 2); patternLength++) {
            const result = this.checkPatternRepetition(patternLength)
            if (result.loopDetected) {
                this.reset()
                throw new LoopDetectedError(result)
            }
        }
    }

    private checkPatternRepetition(patternLength: number): LoopDetectionResult {
        const history = this.toolCallHistory

        if (history.length < patternLength * this.maxRepetitions) {
            return { loopDetected: false, patternLength: 0, repetitions: 0, pattern: [] }
        }

        const pattern = history.slice(-patternLength)
        let repetitions = 1

        for (let i = history.length - patternLength * 2; i >= 0; i -= patternLength) {
            const slice = history.slice(i, i + patternLength)
            if (this.patternsMatch(pattern, slice)) {
                repetitions++
            } else {
                break
            }
        }

        if (repetitions >= this.maxRepetitions) {
            return {
                loopDetected: true,
                patternLength,
                repetitions,
                pattern
            }
        }

        return { loopDetected: false, patternLength: 0, repetitions: 0, pattern: [] }
    }

    private patternsMatch(pattern1: string[], pattern2: string[]): boolean {
        if (pattern1.length !== pattern2.length) return false
        return pattern1.every((item, index) => item === pattern2[index])
    }

    private createToolSignature(toolCall: ToolCall): string {
        const args = toolCall.arguments || {}
        const sortedArgs = Object.keys(args)
            .sort()
            .map(key => `${key}:${JSON.stringify(args[key])}`)
            .join(',')
        return `${toolCall.name}(${sortedArgs})`
    }

    getHistory(): string[] {
        return [...this.toolCallHistory]
    }

    getHistoryLength(): number {
        return this.toolCallHistory.length
    }
}
