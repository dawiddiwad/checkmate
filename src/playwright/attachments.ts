import { TestInfo } from '@playwright/test'
import { EvidenceLevel } from '../config/resolved-config.js'
import { Step, StepReport } from '../runtime/types.js'

const SLUG_LIMIT = 60
const ACTION_SLUG_SOURCE_LIMIT = 80

/**
 * Options for {@link attachStepEvidence}.
 */
export type AttachStepEvidenceOptions = {
	/**
	 * The Playwright test the step ran inside.
	 */
	testInfo: TestInfo

	/**
	 * The step that was executed.
	 */
	step: Step

	/**
	 * The report the step resolved.
	 */
	report: StepReport

	/**
	 * The step's position within the test, starting at `1`. Used so a flat, per-test attachment
	 * array stays distinguishable without opening every file.
	 */
	ordinal: number

	/**
	 * How much evidence to retain, from `checkmateEvidence`.
	 */
	evidence: EvidenceLevel
}

/**
 * Writes a step's evidence to the enclosing test as named, tiered attachments.
 *
 * The summary (`ai-step-<ordinal>-<slug>.json`) always attaches, on a pass as much as a
 * failure, because a false pass is invisible unless the assertion, tool calls, and cost are
 * retained to check against. The heavy tier — a markdown transcript and one ARIA snapshot per
 * turn — is tiered behind `evidence` and the step's own outcome, and is never folded into the
 * summary attachment: `checkmate-step.json` stays roughly a kilobyte at every tier.
 *
 * @example
 * ```ts
 * await attachStepEvidence({ testInfo: test.info(), step, report, ordinal: 2, evidence: 'retain-on-failure' })
 * ```
 */
export async function attachStepEvidence({
	testInfo,
	step,
	report,
	ordinal,
	evidence,
}: AttachStepEvidenceOptions): Promise<void> {
	const prefix = attachmentPrefix(ordinal, step)
	const { snapshots, ...summary } = report

	await testInfo.attach(`${prefix}.json`, {
		body: JSON.stringify(summary, null, 2),
		contentType: 'application/json',
	})

	if (!retainsHeavyEvidence(evidence, report.outcome)) {
		return
	}

	if (report.transcript.length > 0) {
		await testInfo.attach(`${prefix}-transcript.md`, {
			body: renderTranscript(report),
			contentType: 'text/markdown',
		})
	}

	for (const snapshot of snapshots ?? []) {
		await testInfo.attach(`${prefix}/turn-${String(snapshot.turn).padStart(2, '0')}.yml`, {
			body: snapshot.content,
			contentType: 'application/yaml',
		})
	}
}

/**
 * The shared name prefix a step's attachments carry, so the tree and the flat programmatic
 * attachment array agree on which step produced them.
 *
 * @example
 * ```ts
 * attachmentPrefix(2, { name: 'apply promo code', action: '…', expect: '…' })
 * // 'ai-step-2-apply-promo-code'
 * ```
 */
export function attachmentPrefix(ordinal: number, step: Step): string {
	return `ai-step-${ordinal}-${slugify(step)}`
}

/**
 * Whether the heavy evidence tier is retained for a step, given its outcome.
 *
 * `'on'` always retains it, `'off'` never does, and `'retain-on-failure'` — the default — keeps
 * it only for a step that failed, so a green suite does not pay to store transcripts nobody
 * will read.
 */
export function retainsHeavyEvidence(evidence: EvidenceLevel, outcome: StepReport['outcome']): boolean {
	if (evidence === 'off') {
		return false
	}

	if (evidence === 'on') {
		return true
	}

	return outcome === 'failed'
}

function slugify(step: Step): string {
	const label = step.name ?? truncateAction(step.action)
	const slug = label
		.toLowerCase()
		.replace(/[^a-z0-9]+/g, '-')
		.replace(/^-+|-+$/g, '')
		.slice(0, SLUG_LIMIT)

	return slug || 'step'
}

function truncateAction(action: string): string {
	const collapsed = action.replace(/\s+/g, ' ').trim()
	return collapsed.length <= ACTION_SLUG_SOURCE_LIMIT ? collapsed : collapsed.slice(0, ACTION_SLUG_SOURCE_LIMIT)
}

function renderTranscript(report: StepReport): string {
	const lines = [
		`# ${report.name ?? report.action}`,
		'',
		`**Outcome:** ${report.outcome} — ${report.category} / ${report.reason}`,
		'',
	]

	for (const entry of report.transcript) {
		lines.push(`### Turn ${entry.turn} · ${entry.role}`, '', entry.content, '')
	}

	return lines.join('\n')
}
