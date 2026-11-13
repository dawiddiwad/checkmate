import type { Gap, Plan, Result } from './types.ts'
import type { Store } from './store.ts'
import { all, canonical, completed, digest, execute, one, removeTemporaryDirectory, ulid, write } from './store.ts'
import type { AssertionResult, ResultTest, Test } from './contracts.ts'
import {
	approvalPolicy,
	expectDigest,
	requireChoice,
	requireCondition,
	requireIdentifier,
	requireText,
	resultCoverage,
	testOutcome,
	testReference,
	validate,
} from './contracts.ts'
import { approvalState, dependencyBlock, gate, latestPlans, recordApproval } from './plans.ts'
import { targetRevision } from './targets.ts'
import { mkdirSync, readFileSync, realpathSync, rmSync, statSync } from 'node:fs'
import { basename, extname, isAbsolute, join, resolve, sep } from 'node:path'
import { randomUUID } from 'node:crypto'

export type RunRow = {
	run_id: string
	plan_id: string
	plan_revision: number
	plan_sha256: string
	target_id: string
	target_revision: number
	application_build: string
	request: string
	started_at: string
	browser_session: string
	deadline_seconds: number
}
export type RunRequest = {
	selectedTestIds: string[]
	partialExecution: string
	onNewBlocker: string
	timeoutSeconds: number
	retestOf: string | null
}
export type RunState = { row: RunRow; request: RunRequest; plan: Plan; finished: boolean }
export type OutcomeRow = { test_id: string; attempt: number; outcome: ResultTest['outcome']; reason: string | null }
export type AssertionRow = {
	test_id: string
	assertion_id: string
	attempt: number
	result: AssertionResult
	observed: string | null
	reason: string | null
}
export type EvidenceRow = {
	id: string
	test_id: string
	assertion_id: string | null
	kind: Result['evidence'][number]['kind']
	name: string
	media_type: string
	sha256: string
	size: number
}
export type BeginInput = {
	runId: string
	reference: string
	tests?: string[]
	build: string
	partial?: string
	onNewBlocker?: string
	timeoutSeconds?: number
	retestOf?: string | null
}
export type EvidenceInput = string | { text: string; kind?: string }
export type CheckInput = {
	runId: string
	testId: string
	assertionId: string
	result: string
	observed?: string
	reason?: string
	evidence?: EvidenceInput[]
}
export type CloseInput = {
	runId: string
	testId: string
	outcome?: string
	reason?: string
	evidence?: EvidenceInput[]
}
export type FinishInput = { runId: string; completion: string; cleanup: string; cleanupReason: string }
export type ResumeInput = { runId: string; error?: string[]; reason?: string }
export type ResultVerdict = { runId: string; rationale: string; expectSha256?: string }

export const maxEvidenceBytes = 32 * 1024 * 1024
export const stoppedReason = 'Run stopped before the test closed. Actions may have occurred.'
const kindByExtension: Record<string, EvidenceRow['kind']> = {
	'.png': 'screenshot',
	'.jpg': 'screenshot',
	'.jpeg': 'screenshot',
	'.webp': 'screenshot',
	'.json': 'http_exchange',
	'.zip': 'trace',
	'.trace': 'trace',
}
const mediaTypes: Record<string, string> = {
	'.png': 'image/png',
	'.jpg': 'image/jpeg',
	'.jpeg': 'image/jpeg',
	'.webp': 'image/webp',
	'.gif': 'image/gif',
	'.json': 'application/json',
	'.txt': 'text/plain',
	'.log': 'text/plain',
	'.md': 'text/markdown',
	'.html': 'text/html',
	'.zip': 'application/zip',
}

export function evidenceDirectory(runId: string) {
	return `.checkmate/tmp/${runId}/`
}

export function runState(store: Store, runId: string): RunState {
	const row = one<RunRow>(store, 'SELECT * FROM runs WHERE run_id = ?', runId)
	requireCondition(row, `Unknown run: ${runId}`)
	const plan = one<{ body: string }>(
		store,
		'SELECT body FROM plan_revisions WHERE plan_id = ? AND revision = ?',
		row.plan_id,
		row.plan_revision
	)!
	return {
		row,
		request: JSON.parse(row.request),
		plan: JSON.parse(plan.body),
		finished: Boolean(one(store, 'SELECT 1 FROM results WHERE run_id = ?', runId)),
	}
}

function startedRun(store: Store, runId: string) {
	const run = runState(store, runId)
	requireCondition(!run.finished, `Run ${runId} is finished. A finished run does not change.`)
	return run
}

function selectedTest(run: RunState, testId: string): Test {
	requireCondition(
		run.request.selectedTestIds.includes(testId),
		`Test ${testId} is not selected in run ${run.row.run_id}`
	)
	return run.plan.tests.find((test) => test.id === testId)!
}

export function currentAttempt(store: Store, runId: string) {
	return one<{ attempt: number }>(store, 'SELECT max(attempt) AS attempt FROM run_attempts WHERE run_id = ?', runId)!
		.attempt
}

export function runOutcomes(store: Store, runId: string) {
	const rows = all<OutcomeRow>(store, 'SELECT * FROM outcomes WHERE run_id = ? ORDER BY rowid', runId)
	return new Map(rows.map((row) => [row.test_id, row]))
}

export function runAssertions(store: Store, runId: string) {
	const rows = all<AssertionRow>(store, 'SELECT * FROM assertion_results WHERE run_id = ? ORDER BY rowid', runId)
	return new Map(rows.map((row) => [`${row.test_id}.${row.assertion_id}`, row]))
}

export function runEvidence(store: Store, runId: string) {
	return all<EvidenceRow>(
		store,
		'SELECT e.id, e.test_id, e.assertion_id, e.kind, e.name, e.media_type, e.sha256, b.size FROM evidence e JOIN blobs b ON b.sha256 = e.sha256 WHERE e.run_id = ? ORDER BY e.rowid',
		runId
	)
}

export function runFindings(store: Store, runId: string): Result['findings'] {
	return all<{ body: string }>(store, 'SELECT body FROM findings WHERE run_id = ? ORDER BY rowid', runId).map((row) =>
		JSON.parse(row.body)
	)
}

export function runGaps(store: Store, runId: string): Gap[] {
	return all<{ body: string }>(store, 'SELECT body FROM run_gaps WHERE run_id = ? ORDER BY rowid', runId).map((row) =>
		JSON.parse(row.body)
	)
}

export function beginRun(store: Store, actor: string | undefined, input: BeginInput) {
	const reply = write(
		store,
		{ actor, command: 'run begin', subject: input.runId, input },
		(operationId, at, actor) => {
			const runId = requireIdentifier(input.runId, 'run ID')
			requireCondition(
				!one(store, 'SELECT 1 FROM runs WHERE run_id = ?', runId),
				`Run ${runId} exists. Use a new run ID.`
			)
			const onNewBlocker = requireChoice(
				input.onNewBlocker ?? 'return_to_oracle',
				['return_to_oracle', 'continue_independent'],
				'new blocker policy (--on-new-blocker)'
			)
			const timeoutSeconds = input.timeoutSeconds ?? 600
			requireCondition(
				Number.isInteger(timeoutSeconds) && timeoutSeconds > 0 && timeoutSeconds <= 3600,
				`Invalid timeout: ${timeoutSeconds}. Use 1 to 3600 seconds.`
			)
			const checked = gate(store, input)
			if (checked.reply.status !== 'completed')
				return { reply: { ...checked.reply, subject: runId }, subjects: [] }
			const { plan, sha256 } = checked.revision
			const request: RunRequest = {
				selectedTestIds: checked.tests,
				partialExecution: checked.partial,
				onNewBlocker,
				timeoutSeconds,
				retestOf: input.retestOf ?? null,
			}
			const browserSession = `cm-${randomUUID()}`
			execute(
				store,
				'INSERT INTO runs (run_id, plan_id, plan_revision, plan_sha256, target_id, target_revision, application_build, request, started_at, browser_session, deadline_seconds, operation_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
				runId,
				plan.planId,
				plan.revision,
				sha256,
				plan.target.targetId,
				plan.target.revision,
				checked.build,
				canonical(request),
				at,
				browserSession,
				timeoutSeconds,
				operationId
			)
			execute(
				store,
				'INSERT INTO run_attempts (run_id, attempt, started_at, actor) VALUES (?, 1, ?, ?)',
				runId,
				at,
				actor
			)
			return {
				reply: completed(runId, {
					runId,
					plan: `${plan.planId}@${plan.revision}`,
					tests: checked.tests,
					leftOut: checked.reply.data.leftOut,
					startedAt: at,
					browserSession,
					deadlineSeconds: timeoutSeconds,
					evidenceDirectory: evidenceDirectory(runId),
				}),
				subjects: [`run:${runId}`, `plan:${plan.planId}`],
			}
		}
	)
	if (reply.status === 'completed')
		mkdirSync(join(store.workspace, evidenceDirectory(input.runId)), { recursive: true })
	return reply
}

type EvidenceFile = { path: string | null; name: string; kind: string; mediaType: string; bytes: Buffer }

const evidenceKinds = ['observation', 'http_exchange', 'screenshot', 'trace'] as const

function textEvidence(input: { text: string; kind?: string }, name: string): EvidenceFile {
	requireCondition(
		typeof input.text === 'string' && input.text.trim().length > 0,
		'Missing evidence text on standard input'
	)
	const bytes = Buffer.from(input.text, 'utf8')
	requireCondition(bytes.length <= maxEvidenceBytes, 'Evidence text exceeds 32 MiB')
	let json = true
	try {
		JSON.parse(input.text)
	} catch {
		json = false
	}
	return {
		path: null,
		name: `${name}.${json ? 'json' : 'txt'}`,
		kind: requireChoice(input.kind ?? 'observation', evidenceKinds, 'evidence kind'),
		mediaType: json ? 'application/json' : 'text/plain',
		bytes,
	}
}

function readEvidence(store: Store, runId: string, spec: string): EvidenceFile {
	const match = /^(.*):(observation|http_exchange|screenshot|trace)$/.exec(spec)
	const name = match ? match[1] : spec
	requireCondition(name && !isAbsolute(name), `Evidence path must be relative to the workspace: ${name}`)
	const directory = evidenceDirectory(runId)
	let root: string
	let real: string
	try {
		root = realpathSync(join(store.workspace, directory))
	} catch {
		throw new Error(`Evidence directory ${directory} does not exist`)
	}
	const path = resolve(store.workspace, name)
	try {
		real = realpathSync(path)
	} catch {
		throw new Error(`Evidence file not found: ${name}`)
	}
	requireCondition(real.startsWith(root + sep), `Evidence file must be inside ${directory}: ${name}`)
	const stats = statSync(real)
	requireCondition(stats.isFile(), `Evidence must be a file: ${name}`)
	requireCondition(stats.size <= maxEvidenceBytes, `Evidence file exceeds 32 MiB: ${name}`)
	const extension = extname(name).toLowerCase()
	return {
		path,
		name: basename(name),
		kind: match ? match[2] : (kindByExtension[extension] ?? 'observation'),
		mediaType: mediaTypes[extension] ?? 'application/octet-stream',
		bytes: readFileSync(real),
	}
}

function storeEvidence(
	store: Store,
	runId: string,
	testId: string,
	assertionId: string | null,
	files: EvidenceFile[],
	operationId: string
) {
	return files.map((file) => {
		const sha256 = digest(file.bytes)
		execute(
			store,
			'INSERT OR IGNORE INTO blobs (sha256, size, bytes) VALUES (?, ?, ?)',
			sha256,
			file.bytes.length,
			file.bytes
		)
		const id = ulid()
		execute(
			store,
			'INSERT INTO evidence (id, run_id, test_id, assertion_id, kind, name, media_type, sha256, operation_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)',
			id,
			runId,
			testId,
			assertionId,
			file.kind,
			file.name,
			file.mediaType,
			sha256,
			operationId
		)
		return id
	})
}

function evidenceFiles(store: Store, runId: string, name: string, specs: EvidenceInput[] = []) {
	const files = specs.map((spec) =>
		typeof spec === 'string' ? readEvidence(store, runId, spec) : textEvidence(spec, name)
	)
	const paths = files.flatMap((file) => file.path ?? [])
	requireCondition(new Set(paths).size === paths.length, 'An evidence file is listed twice')
	requireCondition(files.length - paths.length <= 1, 'Give one evidence text on standard input')
	return files
}

function removeFiles(files: EvidenceFile[]) {
	for (const file of files) if (file.path) rmSync(file.path, { force: true })
}

function optionalText(value: string | undefined, name: string) {
	return value === undefined ? null : requireText(value, name)
}

function requireOpen(store: Store, runId: string, testId: string) {
	const closed = runOutcomes(store, runId).get(testId)
	requireCondition(!closed, `Test ${testId} is closed as ${closed?.outcome}. A test outcome is final.`)
}

export function checkAssertion(store: Store, actor: string | undefined, input: CheckInput) {
	let files: EvidenceFile[] = []
	const reply = write(store, { actor, command: 'run check', subject: input.runId, input }, (operationId, at) => {
		const run = startedRun(store, input.runId)
		const test = selectedTest(run, input.testId)
		const assertion = test.assertions.find((assertion) => assertion.id === input.assertionId)
		requireCondition(assertion, `Unknown assertion ${test.id}.${input.assertionId}`)
		requireOpen(store, input.runId, test.id)
		requireCondition(
			!runAssertions(store, input.runId).has(`${test.id}.${assertion.id}`),
			`Assertion ${test.id}.${assertion.id} has a result. An assertion result is final.`
		)
		const outcomes = runOutcomes(store, input.runId)
		for (const dependency of test.dependsOn.filter((id) => !id.includes(':')))
			requireCondition(
				outcomes.get(dependency)?.outcome === 'passed',
				`Prerequisite ${dependency} has not passed. Close ${dependency} as passed before you check ${test.id}.`
			)
		const result = requireChoice(
			input.result,
			['passed', 'failed', 'inconclusive', 'not_checked'] as const,
			'result (--result)'
		)
		const observed = optionalText(input.observed, 'observation (--observed)')
		const reason = optionalText(input.reason, 'reason (--reason)')
		files = evidenceFiles(store, input.runId, `${test.id}-${assertion.id}`, input.evidence)
		if (result !== 'not_checked')
			requireCondition(
				observed && files.length > 0,
				`${result === 'inconclusive' ? 'An' : 'A'} ${result} result needs an observation (--observed) and one or more evidence items (--evidence)`
			)
		if (result === 'inconclusive')
			requireCondition(
				reason,
				'An inconclusive result needs a reason (--reason) that says what the evidence cannot show'
			)
		if (result === 'not_checked')
			requireCondition(reason, 'A not_checked result needs a reason (--reason) that says why it was not checked')
		execute(
			store,
			'INSERT INTO assertion_results (run_id, test_id, assertion_id, attempt, result, observed, reason, recorded_at, operation_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)',
			input.runId,
			test.id,
			assertion.id,
			currentAttempt(store, input.runId),
			result,
			observed,
			reason,
			at,
			operationId
		)
		const evidenceIds = storeEvidence(store, input.runId, test.id, assertion.id, files, operationId)
		return {
			reply: completed(input.runId, {
				runId: input.runId,
				testId: test.id,
				assertionId: assertion.id,
				result,
				evidenceIds,
			}),
			subjects: [`run:${input.runId}`],
		}
	})
	removeFiles(files)
	return reply
}

export function closeTest(store: Store, actor: string | undefined, input: CloseInput) {
	let files: EvidenceFile[] = []
	const reply = write(store, { actor, command: 'run close', subject: input.runId, input }, (operationId, at) => {
		const run = startedRun(store, input.runId)
		const test = selectedTest(run, input.testId)
		requireOpen(store, input.runId, test.id)
		const results = runAssertions(store, input.runId)
		const recorded = test.assertions.flatMap((assertion) => results.get(`${test.id}.${assertion.id}`) ?? [])
		let outcome: ResultTest['outcome']
		let reason: string | null
		if (input.outcome === undefined) {
			requireCondition(input.reason === undefined, '--reason applies only with --outcome')
			requireCondition(!input.evidence?.length, '--evidence applies only with --outcome error')
			const missing = test.assertions.filter((assertion) => !results.has(`${test.id}.${assertion.id}`))
			requireCondition(
				!missing.length,
				`Assertions without a result: ${missing.map((assertion) => `${test.id}.${assertion.id}`).join(', ')}`
			)
			outcome = testOutcome(recorded.map((row) => row.result))
			const unchecked = recorded.filter((row) => row.result === 'not_checked')
			reason =
				outcome === 'error'
					? `Assertions not checked: ${unchecked.map((row) => `${test.id}.${row.assertion_id}`).join(', ')}`
					: null
		} else {
			outcome = requireChoice(input.outcome, ['blocked', 'not_run', 'error'] as const, 'outcome (--outcome)')
			reason = requireText(input.reason, `reason (--reason) for outcome ${outcome}`)
			requireCondition(
				outcome === 'error' || !recorded.length,
				`Test ${test.id} has assertion results. Record the remaining assertions, or close it as error.`
			)
			requireCondition(
				outcome === 'error' || !input.evidence?.length,
				'--evidence applies only with --outcome error'
			)
			files = evidenceFiles(store, input.runId, test.id, input.evidence)
		}
		execute(
			store,
			'INSERT INTO outcomes (run_id, test_id, attempt, outcome, reason, recorded_at, operation_id) VALUES (?, ?, ?, ?, ?, ?, ?)',
			input.runId,
			test.id,
			currentAttempt(store, input.runId),
			outcome,
			reason,
			at,
			operationId
		)
		const evidenceIds = storeEvidence(store, input.runId, test.id, null, files, operationId)
		return {
			reply: completed(input.runId, { runId: input.runId, testId: test.id, outcome, reason, evidenceIds }),
			subjects: [`run:${input.runId}`],
		}
	})
	removeFiles(files)
	return reply
}

export function recordFinding(store: Store, actor: string | undefined, input: { runId: string; finding: unknown }) {
	return write(store, { actor, command: 'run finding', subject: input.runId, input }, (operationId) => {
		const run = startedRun(store, input.runId)
		const finding = validate('finding', input.finding)
		requireCondition(
			!one(store, 'SELECT 1 FROM findings WHERE run_id = ? AND id = ?', input.runId, finding.id),
			`Finding ${finding.id} exists in run ${input.runId}`
		)
		const results = runAssertions(store, input.runId)
		const named = finding.assertionIds.map((reference) => {
			const [testId, assertionId] = reference.split('.')
			const test = selectedTest(run, testId)
			requireCondition(
				test.assertions.some((assertion) => assertion.id === assertionId),
				`Unknown assertion in finding ${finding.id}: ${reference}`
			)
			if (finding.type === 'defect')
				requireCondition(
					results.get(reference)?.result === 'failed',
					`Defect ${finding.id} names ${reference}, which is not failed. A defect names only failed assertions.`
				)
			return { test, assertionId }
		})
		const testIds = run.plan.tests
			.filter((test) => named.some((item) => item.test.id === test.id))
			.map((test) => test.id)
		for (const requirementId of finding.requirementIds)
			for (const { test } of named)
				requireCondition(
					test.requirementIds.includes(requirementId),
					`Finding ${finding.id} names requirement ${requirementId}, which test ${test.id} does not cover`
				)
		const evidence = new Map(runEvidence(store, input.runId).map((row) => [row.id, row]))
		for (const id of finding.evidenceIds) {
			const row = evidence.get(id)
			requireCondition(row, `Unknown evidence in finding ${finding.id}: ${id}`)
			requireCondition(
				testIds.includes(row.test_id) &&
					(row.assertion_id === null || finding.assertionIds.includes(`${row.test_id}.${row.assertion_id}`)),
				`Evidence ${id} does not belong to the assertions or tests of finding ${finding.id}`
			)
		}
		execute(
			store,
			'INSERT INTO findings (id, run_id, body, operation_id) VALUES (?, ?, ?, ?)',
			finding.id,
			input.runId,
			canonical({ ...finding, testIds }),
			operationId
		)
		return {
			reply: completed(input.runId, { runId: input.runId, findingId: finding.id, testIds }),
			subjects: [`run:${input.runId}`],
		}
	})
}

export function recordGap(store: Store, actor: string | undefined, input: { runId: string; gap: unknown }) {
	return write(store, { actor, command: 'run gap', subject: input.runId, input }, (operationId) => {
		const run = startedRun(store, input.runId)
		const gap = validate('gap', input.gap)
		requireCondition(
			gap.status === 'open' && gap.decisionId === null,
			`Runtime gap ${gap.id} must be open and have no decision`
		)
		requireCondition(
			!run.plan.gaps.some((old) => old.id === gap.id),
			`Gap ${gap.id} exists in ${run.plan.planId}@${run.plan.revision}. Use a new gap ID.`
		)
		requireCondition(
			!one(store, 'SELECT 1 FROM run_gaps WHERE run_id = ? AND id = ?', input.runId, gap.id),
			`Gap ${gap.id} exists in run ${input.runId}. Use a new gap ID.`
		)
		for (const id of gap.requirementIds)
			requireCondition(
				run.plan.requirements.some((requirement) => requirement.id === id),
				`Unknown requirement in gap ${gap.id}: ${id}`
			)
		const plans = latestPlans(store)
		for (const reference of gap.testIds) {
			const { planId, testId } = testReference(reference)
			const plan = planId === null ? run.plan : plans.get(planId)
			requireCondition(
				plan?.tests.some((test) => test.id === testId),
				`Unknown test in gap ${gap.id}: ${reference}`
			)
		}
		execute(
			store,
			'INSERT INTO run_gaps (id, run_id, body, operation_id) VALUES (?, ?, ?, ?)',
			gap.id,
			input.runId,
			canonical(gap),
			operationId
		)
		return {
			reply: completed(input.runId, { runId: input.runId, gapId: gap.id }),
			subjects: [`run:${input.runId}`],
		}
	})
}

export function finishRun(store: Store, actor: string | undefined, input: FinishInput) {
	const reply = finish(store, actor, input)
	removeTemporaryDirectory(store, input.runId)
	return reply
}

function finish(store: Store, actor: string | undefined, input: FinishInput) {
	return write(store, { actor, command: 'run finish', subject: input.runId, input }, (operationId, at) => {
		const run = startedRun(store, input.runId)
		const completion = requireChoice(
			input.completion,
			['completed', 'interrupted', 'operational_error'] as const,
			'completion (--completion)'
		)
		const cleanup = {
			status: requireChoice(
				input.cleanup,
				['completed', 'failed', 'not_applicable'] as const,
				'cleanup (--cleanup)'
			),
			reason: requireText(input.cleanupReason, 'cleanup reason (--cleanup-reason)'),
		}
		const selected = run.request.selectedTestIds
		const attempt = currentAttempt(store, input.runId)
		const unclosed = selected.filter((id) => !runOutcomes(store, input.runId).has(id))
		if (completion === 'completed')
			requireCondition(
				!unclosed.length,
				`Selected tests are not closed: ${unclosed.join(', ')}. Close them, or finish as interrupted.`
			)
		for (const testId of unclosed)
			execute(
				store,
				'INSERT INTO outcomes (run_id, test_id, attempt, outcome, reason, recorded_at, operation_id) VALUES (?, ?, ?, ?, ?, ?, ?)',
				input.runId,
				testId,
				attempt,
				'error',
				stoppedReason,
				at,
				operationId
			)
		const outcomes = runOutcomes(store, input.runId)
		const results = runAssertions(store, input.runId)
		const findings = runFindings(store, input.runId)
		const newGaps = runGaps(store, input.runId)
		for (const row of results.values())
			if (row.result === 'failed')
				requireCondition(
					findings.some(
						(finding) =>
							finding.type === 'defect' &&
							finding.assertionIds.includes(`${row.test_id}.${row.assertion_id}`)
					),
					`Failed assertion ${row.test_id}.${row.assertion_id} needs a defect finding. Record it with run finding.`
				)
		if (completion === 'completed') {
			const failures = selected.filter((id) => outcomes.get(id)!.outcome === 'error')
			requireCondition(
				!failures.length,
				`Operational failure cannot be completed: ${failures.join(', ')} closed as error`
			)
			requireCondition(cleanup.status !== 'failed', 'Cleanup failed, so the run cannot be completed')
			for (const test of run.plan.tests.filter((test) => selected.includes(test.id))) {
				const outcome = outcomes.get(test.id)!.outcome
				if (outcome !== 'not_run' && outcome !== 'blocked') continue
				const cause =
					test.dependsOn.some((id) =>
						id.includes(':')
							? dependencyBlock(store, id, run.row.application_build) !== null
							: outcomes.get(id)?.outcome !== 'passed'
					) || newGaps.some((gap) => gap.severity === 'blocking')
				requireCondition(
					cause,
					`Selected test ${test.id} is ${outcome} without a cause. A completed run needs a failed prerequisite or a new blocking gap.`
				)
			}
		}
		const evidence = runEvidence(store, input.runId)
		const tests: ResultTest[] = run.plan.tests.map((test) => {
			const closed = outcomes.get(test.id)
			if (!closed)
				return { testId: test.id, outcome: 'not_run', reason: 'Test was not selected.', assertions: [] }
			return {
				testId: test.id,
				outcome: closed.outcome,
				reason: closed.reason,
				assertions: test.assertions.flatMap((assertion) => {
					const row = results.get(`${test.id}.${assertion.id}`)
					if (!row) return []
					return {
						assertionId: assertion.id,
						check: assertion.check,
						checkKind: assertion.checkKind,
						result: row.result,
						observed: row.observed,
						reason: row.reason,
						evidenceIds: evidence
							.filter((item) => item.test_id === test.id && item.assertion_id === assertion.id)
							.map((item) => item.id),
					}
				}),
			}
		})
		const coverage = resultCoverage(run.plan, tests, newGaps)
		const result: Result = validate('result', {
			contractVersion: 'toolkit-2',
			runId: input.runId,
			plan: { planId: run.plan.planId, revision: run.plan.revision, sha256: run.row.plan_sha256 },
			target: run.plan.target,
			applicationBuild: run.row.application_build,
			selectedTestIds: selected,
			retestOf: run.request.retestOf,
			startedAt: run.row.started_at,
			finishedAt: at,
			attempts: attempt,
			completion,
			tests,
			findings,
			newGaps,
			evidence: evidence.map((row) => ({
				id: row.id,
				testId: row.test_id,
				assertionId: row.assertion_id,
				kind: row.kind,
				name: row.name,
				mediaType: row.media_type,
				sha256: row.sha256,
				size: row.size,
			})),
			cleanup,
			coverage,
		})
		const body = canonical(result)
		const sha256 = digest(body)
		execute(
			store,
			'INSERT INTO results (run_id, completion, coverage, finished_at, sha256, body, operation_id) VALUES (?, ?, ?, ?, ?, ?, ?)',
			input.runId,
			completion,
			coverage.status,
			at,
			sha256,
			body,
			operationId
		)
		return {
			reply: {
				status: completion,
				subject: input.runId,
				reasons: [],
				data: {
					runId: input.runId,
					completion,
					coverage: coverage.status,
					sha256,
					counts: outcomeCounts(tests.filter((test) => selected.includes(test.testId))),
				},
			},
			subjects: [`run:${input.runId}`, `plan:${run.plan.planId}`, 'inbox'],
		}
	})
}

export function outcomeCounts(tests: ResultTest[]) {
	const counts: Record<string, number> = {}
	for (const test of tests) counts[test.outcome] = (counts[test.outcome] ?? 0) + 1
	return counts
}

export function resumeRun(store: Store, actor: string | undefined, input: ResumeInput) {
	return write(store, { actor, command: 'run resume', subject: input.runId, input }, (operationId, at, actor) => {
		const run = startedRun(store, input.runId)
		const stalled = input.error ?? []
		requireCondition(stalled.length > 0 || input.reason === undefined, '--reason applies only with --error')
		const reason = stalled.length ? requireText(input.reason, 'reason (--reason) for --error') : null
		const attempt = currentAttempt(store, input.runId) + 1
		execute(
			store,
			'INSERT INTO run_attempts (run_id, attempt, started_at, actor) VALUES (?, ?, ?, ?)',
			input.runId,
			attempt,
			at,
			actor
		)
		for (const testId of stalled) {
			selectedTest(run, testId)
			requireOpen(store, input.runId, testId)
			execute(
				store,
				'INSERT INTO outcomes (run_id, test_id, attempt, outcome, reason, recorded_at, operation_id) VALUES (?, ?, ?, ?, ?, ?, ?)',
				input.runId,
				testId,
				attempt,
				'error',
				reason,
				at,
				operationId
			)
		}
		const outcomes = runOutcomes(store, input.runId)
		const results = runAssertions(store, input.runId)
		const tests = run.plan.tests
			.filter((test) => run.request.selectedTestIds.includes(test.id) && !outcomes.has(test.id))
			.map((test) => ({
				testId: test.id,
				warning: 'Actions may have occurred',
				recorded: test.assertions.filter((assertion) => results.has(`${test.id}.${assertion.id}`)).length,
				assertions: test.assertions.filter((assertion) => !results.has(`${test.id}.${assertion.id}`)),
			}))
		return {
			reply: completed(input.runId, {
				runId: input.runId,
				attempt,
				browserSession: run.row.browser_session,
				deadlineSeconds: run.row.deadline_seconds,
				evidenceDirectory: evidenceDirectory(input.runId),
				closed: stalled,
				tests,
			}),
			subjects: [`run:${input.runId}`],
		}
	})
}

export function acceptResult(store: Store, actor: string | undefined, input: ResultVerdict) {
	return decideResult(store, actor, input, 'approved')
}

export function rejectResult(store: Store, actor: string | undefined, input: ResultVerdict) {
	return decideResult(store, actor, input, 'rejected')
}

function decideResult(store: Store, actor: string | undefined, input: ResultVerdict, verdict: 'approved' | 'rejected') {
	const command = verdict === 'approved' ? 'result accept' : 'result reject'
	return write(store, { actor, command, subject: input.runId, input }, (operationId, at, actor) => {
		const run = runState(store, input.runId)
		const result = runResult(store, input.runId)
		requireCondition(result, `Run ${input.runId} is not finished. Finish it before you decide on its result.`)
		expectDigest(result.sha256, input.expectSha256, input.runId)
		return {
			reply: recordApproval(store, actor, operationId, {
				kind: 'result',
				subject: input.runId,
				sha256: result.sha256,
				verdict,
				rationale: input.rationale,
			}),
			subjects: [`run:${input.runId}`, `plan:${run.plan.planId}`, 'inbox'],
		}
	})
}

export function runResult(store: Store, runId: string) {
	const row = one<{ sha256: string; body: string }>(store, 'SELECT sha256, body FROM results WHERE run_id = ?', runId)
	return row ? { sha256: row.sha256, result: JSON.parse(row.body) as Result } : null
}

export function resultAcceptance(store: Store, run: RunRow, sha256: string) {
	const policy = approvalPolicy(targetRevision(store, run.target_id, run.target_revision).profile).result
	return approvalState(store, 'result', run.run_id, sha256, policy)
}
