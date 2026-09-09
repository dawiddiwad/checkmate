import { createDriverRunner, type DriverCheckmateRunnerOptions } from '../../runtime/runner'
import type { DriverSession } from '../../driver'

export function runnerFixture(session: DriverSession, overrides: Partial<DriverCheckmateRunnerOptions> = {}) {
	return createDriverRunner({
		driverId: 'fixture',
		descriptor: {
			schemaVersion: 1,
			id: 'fixture',
			driverContractVersion: 1,
			targetSchema: { type: 'object' },
			settingsSchema: { type: 'object' },
			requiredSecretSlots: [],
			tools: session.tools.map((tool) => ({ name: tool.definition.name })),
			evidenceKinds: [],
		},
		session,
		allowedTools: '*',
		modelEgress: {
			provider: { id: 'openai', model: 'fixture-model', apiKeyBinding: 'provider' },
			textRedaction: 'on',
			allowOpaque: false,
			maxStepBytes: 1048576,
			maxMessageBytes: 262144,
		},
		limits: { turnsPerStep: 20, stepTimeoutMs: 5000, requestTimeoutMs: 5000, maxRetries: 0, loopMaxRepetitions: 2 },
		apiKey: 'fixture-key',
		...overrides,
	})
}

export function emptySession(): { -readonly [K in keyof DriverSession]: DriverSession[K] } {
	return {
		tools: [],
		instructions: [],
		buildInitialContext: async () => [],
		handleToolResponses: async () => [],
		close: async () => undefined,
	}
}
