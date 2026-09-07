export type RuntimeConfig = Readonly<{
	model: string
	baseUrl?: string
	reasoningEffort?: 'low' | 'medium' | 'high'
	temperature: number
	turnCap: number
	requestTimeout: number
	maxRetries: number
	loopMaxRepetitions: number
	redact: boolean
	toolChoice: 'required' | 'auto'
	rateLimitDelay: number
	logLevel: 'debug' | 'info' | 'warn' | 'error' | 'off'
}>
