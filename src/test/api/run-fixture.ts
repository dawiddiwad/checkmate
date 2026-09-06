import type { CheckmateDriverV1, DriverSession, StepIntent } from '../../driver.js'
import type { InternalTerminationReason, InternalStepReport, StepCategory } from '../../runtime/types.js'
import type { ScenarioRunnerFactory } from '../../runtime/scenario-runner.js'

export const readFixtureEnvironment = (name: string): string | undefined => {
	if (name === 'CHECKMATE_TEST_PROVIDER_KEY') return 'provider-secret'
	if (name === 'CHECKMATE_TEST_DRIVER_SESSION') return 'driver-secret'
	return undefined
}

export function fixtureDriver(close: DriverSession['close'], onStart?: () => void): CheckmateDriverV1 {
	return {
		id: 'fixture',
		driverContractVersion: 1,
		async start(input) {
			onStart?.()
			const sessionSecret = input.secrets.read('session')
			await input.evidence.capture({
				kind: 'fixture-log',
				mediaType: 'text/plain',
				content: `fixture started with ${sessionSecret}`,
			})
			return {
				tools: [
					{
						definition: {
							name: 'fixture_read',
							description: 'Read the fixture',
							parameters: { type: 'object' },
							strict: true,
						},
						execute: async () => 'read',
					},
				],
				instructions: [],
				buildInitialContext: async () => [],
				handleToolResponses: async () => [],
				close,
			}
		},
	}
}

export function outcomeRunner(
	reasons: readonly InternalTerminationReason[],
	onRun?: (step: StepIntent) => void
): ScenarioRunnerFactory {
	return (options) => {
		let index = 0
		return {
			async run(step) {
				onRun?.(step)
				const reason = reasons[index++] ?? reasons.at(-1) ?? 'met-expectation'
				const checkpoint = options.usageTracker!.beginStep()
				options.usageTracker!.record({
					prompt_tokens: 2,
					completion_tokens: 1,
					total_tokens: 3,
				} as never)
				return report(step, reason, options.usageTracker!.stepUsage(checkpoint))
			},
			teardown: async () => undefined,
		}
	}
}

function report(
	step: StepIntent,
	reason: InternalTerminationReason,
	usage: InternalStepReport['usage']
): InternalStepReport {
	return {
		step,
		outcome: reason === 'met-expectation' ? 'passed' : 'failed',
		category: category(reason),
		reason,
		actual: `observed ${step.id}`,
		turns: 1,
		durationMs: 10,
		usage,
		toolCalls: [{ turn: 1, driverId: 'fixture', name: 'fixture_read', arguments: { step: step.id }, status: 'ok' }],
		transcript: [{ turn: 1, role: 'assistant', content: `checked ${step.id}` }],
		diagnostics: [],
	}
}

function category(reason: InternalTerminationReason): StepCategory {
	if (reason === 'met-expectation' || reason === 'failed-expectation') return 'app'
	if (reason === 'loop-detected' || reason === 'turn-cap-exceeded' || reason === 'step-timeout') return 'model'
	return 'infra'
}
