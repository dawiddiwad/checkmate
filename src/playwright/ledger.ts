import { createHash } from 'node:crypto'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { StepCategory } from '../runtime/types.js'

const LEDGER_DIR = '.checkmate'

/**
 * One step's recorded assertion within a single attempt.
 *
 * @example
 * ```ts
 * const entry: LedgerStepEntry = { id: '2:a91f3c', outcome: 'failed', category: 'app' }
 * ```
 */
export type LedgerStepEntry = {
	/**
	 * The step's identity within the test, from {@link stepIdentity}.
	 */
	id: string

	/**
	 * Whether the step passed on this attempt.
	 */
	outcome: 'passed' | 'failed'

	/**
	 * Which layer produced the outcome on this attempt.
	 */
	category: StepCategory
}

/**
 * Every step assertion recorded during one attempt of a test.
 *
 * @example
 * ```ts
 * const attempt: LedgerAttempt = { retry: 0, steps: [{ id: '2:a91f3c', outcome: 'failed', category: 'app' }] }
 * ```
 */
export type LedgerAttempt = {
	/**
	 * `testInfo.retry` for this attempt: `0` for the first run, `1` for the first retry, and so on.
	 */
	retry: number

	/**
	 * Step assertions recorded during this attempt, in the order the steps ran.
	 */
	steps: LedgerStepEntry[]
}

/**
 * A test's assertion history across every attempt Playwright has run so far.
 *
 * @example
 * ```ts
 * const ledger: Ledger = { attempts: [{ retry: 0, steps: [] }] }
 * ```
 */
export type Ledger = {
	/**
	 * One entry per attempt, oldest first.
	 */
	attempts: LedgerAttempt[]
}

/**
 * A step's identity across retries, so an assertion recorded on one attempt can be matched
 * against the same step on another.
 *
 * Neither half works alone: the ordinal alone drifts when a run takes a different path between
 * attempts, and the action hash alone collides when a test legitimately repeats the same step.
 *
 * @example
 * ```ts
 * stepIdentity(2, 'apply the seasonal promo code SPRING25 at checkout')
 * // '2:a91f3c'
 * ```
 */
export function stepIdentity(ordinal: number, action: string): string {
	const hash = createHash('sha1').update(action).digest('hex').slice(0, 6)
	return `${ordinal}:${hash}`
}

/**
 * Reads a test's ledger, resolving an empty one when nothing has been recorded yet or the file
 * cannot be parsed.
 *
 * @example
 * ```ts
 * const ledger = await readLedger(testInfo.project.outputDir, testInfo.testId)
 * ```
 */
export async function readLedger(projectOutputDir: string, testId: string): Promise<Ledger> {
	try {
		const raw = await readFile(ledgerPath(projectOutputDir, testId), 'utf8')
		const parsed: unknown = JSON.parse(raw)
		return isLedger(parsed) ? parsed : { attempts: [] }
	} catch {
		return { attempts: [] }
	}
}

/**
 * Appends one step's assertion to a test's ledger, keyed by `retry`.
 *
 * Steps recorded for a `retry` that already has an entry are appended to that attempt in call
 * order; a new `retry` opens a new attempt. This is called once per `ai.step`, so within one
 * attempt it is always sequential — there is nothing to lock.
 *
 * @example
 * ```ts
 * await appendLedgerStep(testInfo.project.outputDir, testInfo.testId, testInfo.retry, {
 *   id: stepIdentity(1, step.action),
 *   outcome: report.outcome,
 *   category: report.category,
 * })
 * ```
 */
export async function appendLedgerStep(
	projectOutputDir: string,
	testId: string,
	retry: number,
	entry: LedgerStepEntry
): Promise<void> {
	const ledger = await readLedger(projectOutputDir, testId)
	const attempt = ledger.attempts.find((candidate) => candidate.retry === retry)

	if (attempt) {
		attempt.steps.push(entry)
	} else {
		ledger.attempts.push({ retry, steps: [entry] })
	}

	const filePath = ledgerPath(projectOutputDir, testId)
	await mkdir(path.dirname(filePath), { recursive: true })
	await writeFile(filePath, JSON.stringify(ledger, null, 2))
}

/**
 * Whether any prior attempt in the ledger recorded an `app` failure for the given step id.
 *
 * @example
 * ```ts
 * hasPriorAppFailure(ledger, '2:a91f3c') // true after an earlier attempt failed app / failed-expectation
 * ```
 */
export function hasPriorAppFailure(ledger: Ledger, id: string): boolean {
	return ledger.attempts.some((attempt) =>
		attempt.steps.some((step) => step.id === id && step.category === 'app' && step.outcome === 'failed')
	)
}

function ledgerPath(projectOutputDir: string, testId: string): string {
	return path.join(projectOutputDir, LEDGER_DIR, `${testId}.json`)
}

function isLedger(value: unknown): value is Ledger {
	return typeof value === 'object' && value !== null && Array.isArray((value as Ledger).attempts)
}
