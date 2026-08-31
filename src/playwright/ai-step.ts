import { test } from '@playwright/test'
import { attachStepEvidence } from './attachments.js'
import { CHECKMATE_DEFAULTS } from '../config/resolved-config.js'
import type { EvidenceLevel } from '../config/resolved-config.js'
import { CheckmateRunner } from '../runtime/runner.js'
import { Step, StepReport } from '../runtime/types.js'

const STEP_LABEL_LIMIT = 80

/**
 * A step whose report says it failed.
 *
 * This is thrown rather than asserted through `expect()` on purpose. `expect(value, message)`
 * turns its message into a step of its own, so the whole failure text would appear twice in the
 * HTML report — once as a step title and once in the error — and Playwright would append
 * `expect(received).toBeTruthy()` / `Received: false`, which says nothing about the step. The
 * report already states what was asserted and which layer answered for it.
 */
export class CheckmateStepError extends Error {
	readonly report: StepReport

	constructor(report: StepReport) {
		super(assertionMessage(report))
		this.name = 'CheckmateStepError'
		this.report = report
		Error.captureStackTrace(this, runAiStep)
	}
}

/**
 * Options for {@link runAiStep} carried by the `ai` fixture, not authored by step callers.
 */
export type RunAiStepOptions = {
	/**
	 * The step's position within the test, starting at `1`, used to name its attachments.
	 */
	ordinal?: number

	/**
	 * How much evidence to retain, from `checkmateEvidence`.
	 */
	evidence?: EvidenceLevel
}

export async function runAiStep(runner: CheckmateRunner, step: Step, options: RunAiStepOptions = {}): Promise<void> {
	const ordinal = options.ordinal ?? 1
	const evidence = options.evidence ?? CHECKMATE_DEFAULTS.checkmateEvidence

	await test.step(stepLabel(step), async () => {
		const report = await runner.run(step, { testTimeoutRemaining: testTimeoutRemaining() })
		await attachStepEvidence({ testInfo: test.info(), step, report, ordinal, evidence })

		if (report.outcome !== 'passed') {
			throw new CheckmateStepError(report)
		}
	})
}

export function testTimeoutRemaining(): number | undefined {
	const testInfo = test.info()
	if (testInfo.timeout === 0) {
		return undefined
	}

	return Math.max(0, testInfo.timeout - testInfo.duration)
}

export function stepLabel(step: Step): string {
	return `ai: ${step.name ?? truncate(collapseWhitespace(step.action))}`
}

export function assertionMessage(report: StepReport): string {
	return [
		`Checkmate step failed: ${report.category} / ${report.reason}`,
		'',
		...block('Action', report.action),
		...block('Expected', report.expect),
		...block('Actual', report.actual ?? '(not reported)'),
		stats(report),
	].join('\n')
}

function block(label: string, value: string): string[] {
	return [`${label}:`, ...value.split('\n').map((line) => `  ${line}`), '']
}

function stats(report: StepReport): string {
	return `${report.turns} ${report.turns === 1 ? 'turn' : 'turns'} · ${(report.durationMs / 1_000).toFixed(1)}s · $${report.usage.costUsd.toFixed(4)}`
}

function collapseWhitespace(value: string): string {
	return value.replace(/\s+/g, ' ').trim()
}

function truncate(value: string): string {
	if (value.length <= STEP_LABEL_LIMIT) {
		return value
	}

	return `${value.slice(0, STEP_LABEL_LIMIT - 3)}...`
}
