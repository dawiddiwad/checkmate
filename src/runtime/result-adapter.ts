import type { ExecutedStepResult, JsonValue, StepReason } from '../contracts/types.js'
import { serializeJson } from '../contracts/serialize.js'
import type { HarnessEvidenceCandidate } from '../evidence/store.js'
import type { InternalStepReport, InternalTerminationReason, StepCategory } from './types.js'

const PUBLIC_REASON_BY_INTERNAL: Record<InternalTerminationReason, StepReason> = {
	'met-expectation': 'met-expectation',
	'failed-expectation': 'failed-expectation',
	'loop-detected': 'loop-detected',
	'turn-cap-exceeded': 'turn-cap-exceeded',
	'step-timeout': 'step-timeout',
	'scenario-timeout': 'scenario-timeout',
	'tool-error': 'tool-error',
	'provider-error': 'provider-error',
	'token-budget-exceeded': 'token-budget-exceeded',
	interrupted: 'interrupted',
	'internal-error': 'internal-error',
}

const CATEGORY_BY_INTERNAL: Record<InternalTerminationReason, StepCategory> = {
	'met-expectation': 'app',
	'failed-expectation': 'app',
	'loop-detected': 'model',
	'turn-cap-exceeded': 'model',
	'step-timeout': 'model',
	'scenario-timeout': 'infra',
	'tool-error': 'infra',
	'provider-error': 'infra',
	'token-budget-exceeded': 'infra',
	interrupted: 'infra',
	'internal-error': 'infra',
}

export type AdaptedStepResult = Readonly<{
	result: ExecutedStepResult
	evidence: readonly HarnessEvidenceCandidate[]
}>

export function adaptStepResult(report: InternalStepReport): AdaptedStepResult {
	const reason = PUBLIC_REASON_BY_INTERNAL[report.reason]
	const status = report.reason === 'met-expectation' ? 'passed' : 'failed'
	if (report.outcome !== status) {
		throw new Error(`Internal step '${report.step.id}' has inconsistent outcome and reason`)
	}

	const result: ExecutedStepResult = {
		id: report.step.id,
		status,
		category: CATEGORY_BY_INTERNAL[report.reason],
		reason,
		...(report.actual === undefined ? {} : { actual: report.actual }),
		turns: report.turns,
		durationMs: report.durationMs,
		usage: { ...report.usage },
		toolCalls: report.toolCalls.map((call) => ({
			turn: call.turn,
			driverId: call.driverId,
			name: call.name,
			arguments: copyJson(call.arguments),
			status: call.status,
		})),
	}
	const evidence: HarnessEvidenceCandidate[] = []
	if (report.transcript.length > 0) {
		evidence.push({
			stepId: report.step.id,
			kind: 'transcript',
			mediaType: 'text/markdown',
			content: renderTranscript(report),
		})
	}
	return { result, evidence }
}

function copyJson(value: unknown): JsonValue {
	serializeJson(value)
	return structuredClone(value) as JsonValue
}

function renderTranscript(report: InternalStepReport): string {
	const lines = [
		`# ${report.step.action}`,
		'',
		`**Outcome:** ${report.outcome} - ${CATEGORY_BY_INTERNAL[report.reason]} / ${PUBLIC_REASON_BY_INTERNAL[report.reason]}`,
		'',
	]
	for (const entry of report.transcript) lines.push(`### Turn ${entry.turn} - ${entry.role}`, '', entry.content, '')
	return lines.join('\n')
}
