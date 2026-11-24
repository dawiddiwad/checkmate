import type { Gap, Plan, Result } from './types.ts'
import type { Store } from './store.ts'
import { all, canonical, completed, digest, execute, one, removeTemporaryDirectory, ulid, write } from './store.ts'
import type { AssertionResult, ResultTest, Test } from './contracts.ts'
import type { RetestDefect } from './plans.ts'
import {
	Refusal,
	approvalPolicy,
	expectDigest,
	refusalReasons,
	requireChoice,
	requireCondition,
	requireIdentifier,
	requireText,
	requireWellFormed,
	resultCoverage,
	revisionReference,
	testOutcome,
	testReference,
	unusedId,
	validate,
	withoutEmptyMetadata,
} from './contracts.ts'
import {
	approvalState,
	dependencyBlock,
	expectDecision,
	gate,
	latestPlans,
	openRunGapReasons,
	planRevision,
	planRunGaps,
	recordApproval,
} from './plans.ts'
import {
	correctedEntryText,
	findInstance,
	instanceForBuildHint,
	readinessHint,
	runInstance,
	targetRevision,
} from './targets.ts'
import { changesData, markerFor, owe, runPrepare, settleCleanups } from './resets.ts'
import { addPlanBuild } from './journal.ts'
import { permanentSelection } from './permanent.ts'
import { mkdirSync, readFileSync, realpathSync, rmSync, statSync } from 'node:fs'
import { basename, extname, isAbsolute, join, resolve, sep } from 'node:path'
import { randomUUID } from 'node:crypto'
import {
	expectationMatches,
	expectsBareValue,
	isBareValue,
	unitNotObserved,
	looksShellExpanded,
	looksTruncatedMoney,
	repeatsExpectation,
	wrappedValue,
} from './expectation.ts'
import { checkRequest, requestMatches } from './routes.ts'

export type RunRow = {
	run_id: string
	plan_id: string
	plan_revision: number
	plan_sha256: string
	target_id: string
	target_revision: number
	instance_id: string
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
	retestDefects?: RetestDefect[]
	permanent?: { reference: string; sourceRevision: number; resultSha256: string }
	facts?: string
	marker?: string
}
export type RunState = { row: RunRow; request: RunRequest; plan: Plan; finished: boolean }
export type OutcomeRow = {
	test_id: string
	attempt: number
	outcome: ResultTest['outcome']
	reason: string | null
	cause: string | null
}
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
	instance?: string
	partial?: string
	onNewBlocker?: string
	timeoutSeconds?: number
	retestOf?: string | null
}
export type EvidenceInput = { file: string; kind?: string } | { text: string; kind?: string }
type Assertion = Test['assertions'][number]
// The observed value of a check whose text or element was not on the page after the action.
export const absentObservation = '(absent)'

export type CheckInput = {
	runId: string
	testId: string
	assertionId: string
	result?: string
	observed?: string
	// The text or element the check names is not on the page after the action, and the page was read.
	absent?: boolean
	request?: string
	reason?: string
	evidence?: EvidenceInput[]
}
export type CloseInput = {
	runId: string
	testId: string
	outcome?: string
	cause?: string
	reason?: string
	evidence?: EvidenceInput[]
}
export type FinishInput = {
	runId: string
	completion: string
	cause?: string
	reason?: string
	cleanup: string
	cleanupReason: string
}
export type ResumeInput = { runId: string; error?: string[]; reason?: string }
export type ResultVerdict = { runId: string; rationale: string; expectSha256?: string; expectDecision?: string }

export const maxEvidenceBytes = 32 * 1024 * 1024
export const assertionResults = ['passed', 'failed', 'inconclusive', 'not_checked'] as const
export const closeOutcomes = ['blocked', 'not_run', 'error'] as const
export const completions = ['completed', 'interrupted', 'operational_error'] as const
export const cleanupStatuses = ['completed', 'failed', 'not_applicable'] as const
export const newBlockerPolicies = ['continue_independent', 'return_to_oracle'] as const
export const stoppedReason = 'Run stopped before the test closed. Actions may have occurred.'
export const closeCauses = ['deadline'] as const
export const interruptCauses = ['deadline', 'host_stopped', 'tool_unavailable'] as const
export const deadlineShare = 0.9
const kindByExtension: Record<string, EvidenceRow['kind']> = {
	'.png': 'screenshot',
	'.jpg': 'screenshot',
	'.jpeg': 'screenshot',
	'.webp': 'screenshot',
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
	'.xml': 'application/xml',
	'.csv': 'text/csv',
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
	const content = JSON.parse(plan.body) as Plan
	const correct = correctedEntryText(store, row.target_id, row.instance_id)
	for (const test of content.tests) {
		test.action = correct(test.action)
		test.preconditions = test.preconditions.map(correct)
		for (const assertion of test.assertions) {
			if (assertion.request) assertion.request = correct(assertion.request)
		}
	}
	return {
		row,
		request: JSON.parse(row.request),
		plan: content,
		finished: Boolean(one(store, 'SELECT 1 FROM results WHERE run_id = ?', runId)),
	}
}

export function requirePermanentSelection(store: Store, runId: string) {
	const run = runState(store, runId)
	const saved = run.request.permanent
	if (!saved) return
	const selected = permanentSelection(store, run.row.plan_id, saved.reference)
	requireCondition(
		selected.revision === run.row.plan_revision &&
			selected.snapshotSha256 === run.row.plan_sha256 &&
			selected.sourceRevision === saved.sourceRevision &&
			selected.resultSha256 === saved.resultSha256 &&
			JSON.stringify(selected.tests) === JSON.stringify(run.request.selectedTestIds),
		`Run ${runId} no longer matches its permanent promotion.`
	)
}

function startedRun(store: Store, runId: string) {
	const run = runState(store, runId)
	requireCondition(
		!run.finished,
		`Run ${runId} is finished. A finished run does not change.`,
		`Run checkmate status ${run.plan.planId} to see the next step.`
	)
	return run
}

function selectedTest(run: RunState, testId: string): Test {
	requireWellFormed(
		run.request.selectedTestIds.includes(testId),
		`Test ${testId} is not selected in run ${run.row.run_id}`,
		`Use one of: ${run.request.selectedTestIds.join(', ')}.`
	)
	return run.plan.tests.find((test) => test.id === testId)!
}

export function runClock(
	store: Store,
	row: Pick<RunRow, 'run_id' | 'deadline_seconds'>,
	at = new Date().toISOString()
) {
	const attempt = one<{ attempt: number; started_at: string }>(
		store,
		'SELECT attempt, started_at FROM run_attempts WHERE run_id = ? ORDER BY attempt DESC LIMIT 1',
		row.run_id
	)!
	const start = Date.parse(attempt.started_at)
	const elapsedSeconds = Math.max(0, Math.floor((Date.parse(at) - start) / 1000))
	return {
		attempt: attempt.attempt,
		attemptStartedAt: attempt.started_at,
		deadline: new Date(start + row.deadline_seconds * 1000).toISOString(),
		deadlineSeconds: row.deadline_seconds,
		elapsedSeconds,
		remainingSeconds: Math.max(0, row.deadline_seconds - elapsedSeconds),
	}
}

function refuseEarlyDeadline(store: Store, row: RunRow, at: string) {
	const clock = runClock(store, row, at)
	const used = clock.elapsedSeconds / clock.deadlineSeconds
	requireCondition(
		used >= deadlineShare,
		`Only ${Math.floor(used * 100)}% of the deadline is used: ${clock.elapsedSeconds} of ${clock.deadlineSeconds} seconds, ${clock.remainingSeconds} remain until ${clock.deadline}. Continue the remaining tests.`
	)
}

export function currentAttempt(store: Store, runId: string) {
	return one<{ attempt: number }>(store, 'SELECT max(attempt) AS attempt FROM run_attempts WHERE run_id = ?', runId)!
		.attempt
}

export function runOutcomes(store: Store, runId: string) {
	const rows = all<OutcomeRow>(
		store,
		`SELECT o.*, CASE p.command WHEN 'run close' THEN json_extract(p.arguments, '$.cause') END AS cause
		FROM outcomes o LEFT JOIN operations p ON p.id = o.operation_id WHERE o.run_id = ? ORDER BY o.rowid`,
		runId
	)
	return new Map(rows.map((row) => [row.test_id, row]))
}

export function runAssertions(store: Store, runId: string) {
	const rows = all<AssertionRow>(store, 'SELECT * FROM assertion_results WHERE run_id = ? ORDER BY rowid', runId)
	// A correction comes after the result it corrects, so the last row for an assertion is its current result.
	const corrections = all<AssertionRow>(
		store,
		'SELECT * FROM assertion_corrections WHERE run_id = ? ORDER BY rowid',
		runId
	)
	return new Map([...rows, ...corrections].map((row) => [`${row.test_id}.${row.assertion_id}`, row]))
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

// A test closed as error observed nothing. A defect that names only such tests is not a verdict; it stays stored.
export function isVerdict(finding: Result['findings'][number], outcomes: ReturnType<typeof runOutcomes>) {
	return finding.type !== 'defect' || !finding.testIds.every((id) => outcomes.get(id)?.outcome === 'error')
}

export function verdictFindings(store: Store, runId: string): Result['findings'] {
	const outcomes = runOutcomes(store, runId)
	return runFindings(store, runId).filter((finding) => isVerdict(finding, outcomes))
}

export function runGaps(store: Store, runId: string): Gap[] {
	return all<{ body: string }>(store, 'SELECT body FROM run_gaps WHERE run_id = ? ORDER BY rowid', runId).map((row) =>
		JSON.parse(row.body)
	)
}

export function runOverlapWarnings(store: Store, runId: string) {
	return all<{ run_id: string; target_id: string; instance_id: string; tests: string }>(
		store,
		`SELECT other.run_id, other.target_id, other.instance_id,
			group_concat(test.value, ', ' ORDER BY test.key) AS tests
		FROM runs r JOIN runs other ON other.plan_id = r.plan_id
			AND other.target_id = r.target_id AND other.instance_id = r.instance_id
		JOIN json_each(r.request, '$.selectedTestIds') test
		WHERE r.run_id = ? AND other.run_id <> r.run_id
			AND NOT EXISTS (SELECT 1 FROM results WHERE run_id = other.run_id)
			AND EXISTS (SELECT 1 FROM json_each(other.request, '$.selectedTestIds') WHERE value = test.value)
			AND NOT EXISTS (
				SELECT 1 FROM outcomes WHERE run_id IN (r.run_id, other.run_id) AND test_id = test.value
			)
		GROUP BY other.run_id ORDER BY other.rowid`,
		runId
	).map((row) => `Run ${row.run_id} also has open tests on ${row.target_id}/${row.instance_id}: ${row.tests}.`)
}

export function beginRun(store: Store, actor: string | undefined, input: BeginInput) {
	return begin(store, actor, input)
}

export function beginPermanentRun(
	store: Store,
	actor: string | undefined,
	input: {
		runId: string
		planId: string
		build: string
		instance?: string
		promotion?: string
		timeoutSeconds?: number
	}
) {
	return begin(
		store,
		actor,
		{
			runId: input.runId,
			reference: input.planId,
			build: input.build,
			instance: input.instance,
			timeoutSeconds: input.timeoutSeconds,
		},
		input
	)
}

function begin(
	store: Store,
	actor: string | undefined,
	input: BeginInput,
	permanent?: { planId: string; promotion?: string }
) {
	const reply = write(
		store,
		{
			actor,
			command: permanent ? 'run permanent' : 'run begin',
			subject: input.runId,
			input: permanent ? { ...input, ...permanent } : input,
		},
		(operationId, at, actor) => {
			const runId = requireIdentifier(input.runId, 'run ID')
			requireCondition(
				!one(store, 'SELECT 1 FROM runs WHERE run_id = ?', runId),
				`Run ${runId} exists. Use a new run ID.`
			)
			const onNewBlocker = requireChoice(
				input.onNewBlocker ?? 'continue_independent',
				newBlockerPolicies,
				'new blocker policy (--on-new-blocker)'
			)
			const timeoutSeconds = input.timeoutSeconds ?? 600
			requireWellFormed(
				Number.isInteger(timeoutSeconds) && timeoutSeconds > 0 && timeoutSeconds <= 3600,
				`Invalid timeout: ${timeoutSeconds}. Use 1 to 3600 seconds.`
			)
			const selection = permanent ? permanentSelection(store, permanent.planId, permanent.promotion) : null
			const requested = selection
				? {
						...input,
						reference: selection.reference,
						tests: selection.tests,
						partial: 'wait_for_resolution',
						permanent: selection.reference,
					}
				: input
			const instance = runInstance(store, plannedTarget(store, requested.reference), input.instance)
			requireCondition(
				!instance.build || instance.build === input.build,
				`Instance ${instance.targetId}/${instance.instanceId} serves build ${instance.build}, not ${input.build}. A run names the build its instance serves.`,
				instanceForBuildHint(store, instance.targetId, input.build)
			)
			const checked = gate(store, { ...requested, instance: instance.instanceId })
			if (checked.reply.status !== 'completed') {
				const reasons = [refusalReasons.prohibited, ...checked.reply.reasons]
				return {
					reply: { ...checked.reply, subject: runId, reasons, refusal: 'prohibited' as const },
					subjects: [],
				}
			}
			const { plan, sha256 } = checked.revision
			const dataProfile = targetRevision(store, plan.target.targetId).profile
			const marker = markerFor(store, runId)
			const facts = runPrepare(store.workspace, dataProfile.reset, marker)
			owe(store, runId, dataProfile.reset)
			const request: RunRequest = {
				selectedTestIds: checked.tests,
				partialExecution: checked.partial,
				onNewBlocker,
				...(facts ? { facts } : {}),
				marker,
				timeoutSeconds,
				retestOf: input.retestOf ?? null,
				...(input.retestOf ? { retestDefects: checked.retestDefects } : {}),
				...(selection
					? {
							permanent: {
								reference: selection.reference,
								sourceRevision: selection.sourceRevision,
								resultSha256: selection.resultSha256,
							},
						}
					: {}),
			}
			const browserSession = `cm-${randomUUID()}`
			execute(
				store,
				'INSERT INTO runs (run_id, plan_id, plan_revision, plan_sha256, target_id, target_revision, instance_id, application_build, request, started_at, browser_session, deadline_seconds, operation_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
				runId,
				plan.planId,
				plan.revision,
				sha256,
				plan.target.targetId,
				checked.target.revision,
				instance.instanceId,
				checked.build,
				canonical(request),
				at,
				browserSession,
				timeoutSeconds,
				operationId
			)
			addPlanBuild(store, plan.planId, checked.build, at, operationId)
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
					instanceId: instance.instanceId,
					tests: checked.tests,
					leftOut: checked.reply.data.leftOut,
					startedAt: at,
					browserSession,
					deadlineSeconds: timeoutSeconds,
					deadline: new Date(Date.parse(at) + timeoutSeconds * 1000).toISOString(),
					evidenceDirectory: evidenceDirectory(runId),
					warnings: runOverlapWarnings(store, runId),
					...(selection ? { permanent: request.permanent, build: checked.build } : {}),
				}),
				subjects: [`run:${runId}`, `plan:${plan.planId}`],
			}
		}
	)
	if (reply.status === 'completed')
		mkdirSync(join(store.workspace, evidenceDirectory(input.runId)), { recursive: true })
	return reply
}

function plannedTarget(store: Store, text: string) {
	const reference = revisionReference(requireText(text, 'plan reference'), 'plan reference')
	return planRevision(store, reference.id, reference.revision).plan.target.targetId
}

type EvidenceFile = { path: string | null; name: string; kind: string; mediaType: string; bytes: Buffer }

const evidenceKinds = ['observation', 'http_exchange', 'screenshot', 'trace'] as const

function textEvidence(input: { text: string; kind?: string }, name: string): EvidenceFile {
	requireWellFormed(typeof input.text === 'string' && input.text.trim().length > 0, 'Missing evidence text')
	const bytes = Buffer.from(input.text, 'utf8')
	requireWellFormed(bytes.length <= maxEvidenceBytes, 'Evidence text exceeds 32 MiB')
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

function readEvidence(
	store: Store,
	runId: string,
	{ file: name, kind }: { file: string; kind?: string }
): EvidenceFile {
	requireWellFormed(name && !isAbsolute(name), `Evidence path must be relative to the workspace: ${name}`)
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
		throw new Refusal(
			'malformed',
			`Evidence file not found: ${name}`,
			`Give inline evidence ({text, kind}), or capture a fresh file in ${directory}. A file is consumed on success.`
		)
	}
	requireWellFormed(real.startsWith(root + sep), `Evidence file must be inside ${directory}: ${name}`)
	const stats = statSync(real)
	requireWellFormed(stats.isFile(), `Evidence must be a file: ${name}`)
	requireWellFormed(stats.size <= maxEvidenceBytes, `Evidence file exceeds 32 MiB: ${name}`)
	const extension = extname(name).toLowerCase()
	return {
		path,
		name: basename(name),
		kind: requireChoice(kind ?? kindByExtension[extension] ?? 'observation', evidenceKinds, 'evidence kind'),
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
	const files = specs.map((spec) => ('file' in spec ? readEvidence(store, runId, spec) : textEvidence(spec, name)))
	const paths = files.flatMap((file) => file.path ?? [])
	requireWellFormed(new Set(paths).size === paths.length, 'An evidence file is listed twice')
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

// A legacy assertion (no expected value) keeps the child's result and the number guard.
function checkedResult(given: string | undefined, assertion: Assertion, observed: string | null) {
	const result = requireChoice(given, assertionResults, 'result (--result)')
	const unseen = (assertion.check.match(/\d+(\.\d+)?/g) ?? []).filter((value) => !observed?.includes(value))
	requireCondition(
		result !== 'passed' || !unseen.length,
		`The observed value does not show ${unseen.join(', ')}, which the check names.`,
		'Record failed when the observed value differs from the check. Record passed only when the observed value shows each value of the check.'
	)
	return result
}

// A structured assertion names the observed item and the expected value. The code compares the observed value with the
// expected value, and the child gives only the observed value. Every problem with the call is refused at once, with one
// corrected command, so the child fixes the call in one retry.
function structuredResult(
	input: CheckInput,
	test: Test,
	assertion: Assertion,
	observed: string | null,
	marker: string
) {
	const planned = checkRequest(test.action, assertion.request)
	const reasons: string[] = []
	if (input.result === 'not_checked' && observed !== null)
		reasons.push(
			'The call gives an observed value. Omit result to let Checkmate compare it. Use not_checked only when you did not observe a value.'
		)
	if (input.result !== undefined && input.result !== 'not_checked')
		reasons.push(
			`${assertion.id} takes its result from --observed. Give --observed with the value of "${assertion.observe}", and no --result.`
		)
	if (planned && !input.request)
		reasons.push(`Give --request with the request you sent: ${planned.method} ${planned.path}.`)
	else if (planned && !requestMatches(planned, input.request!))
		reasons.push(
			`The request ${input.request} does not match the planned request ${planned.method} ${planned.path}. A request that misses the route is not an observation of the value.`
		)
	const bare = observed === null ? undefined : wrappedValue(observed, assertion.expected)
	if (input.result !== 'not_checked') {
		if (observed === null) reasons.push(`Give --observed with the value of "${assertion.observe}".`)
		else if (repeatsExpectation(observed))
			reasons.push(
				`The observed value "${observed}" repeats the rule of the expected value, not a value that was observed. Give the value you see for "${assertion.observe}" on the page or in the response, not the rule.`
			)
		// A number wrapped in words, such as HTTP 200, is refused: the value is sent bare. Text with no number is compared as given.
		else if (expectsBareValue(assertion.expected) && !isBareValue(observed) && /\d/.test(observed))
			reasons.push(
				bare
					? `The observed value "${observed}" holds ${bare} inside other words. Give only the value.`
					: `The observed value "${observed}" is not a bare value. Give only the value of "${assertion.observe}".`
			)
	}
	if (reasons.length) {
		const command = [
			`checkmate run check ${input.runId} ${test.id} ${assertion.id}`,
			`--observed '${bare ?? observed ?? '<the value you saw>'}'`,
			planned ? `--request '${planned.method} ${planned.path}'` : '',
			'--evidence -',
		]
			.filter(Boolean)
			.join(' ')
		requireWellFormed(false, reasons.join(' '), `Send one corrected call: ${command}`)
	}
	if (input.result === 'not_checked') return 'not_checked'
	return expectationMatches(observed!.trim(), assertion.expected!, marker) ? 'passed' : 'failed'
}

export function checkAssertion(store: Store, actor: string | undefined, input: CheckInput) {
	let files: EvidenceFile[] = []
	const reply = write(store, { actor, command: 'run check', subject: input.runId, input }, (operationId, at) => {
		const run = startedRun(store, input.runId)
		if (run.request.permanent) requirePermanentSelection(store, input.runId)
		const test = selectedTest(run, input.testId)
		const assertion = test.assertions.find((assertion) => assertion.id === input.assertionId)
		requireWellFormed(
			assertion,
			`Unknown assertion ${test.id}.${input.assertionId}`,
			`Use one of: ${test.assertions.map((item) => item.id).join(', ')}.`
		)
		requireOpen(store, input.runId, test.id)
		// A check can be corrected while the test is open. The earlier result stays in the record; the last one counts.
		const prior = runAssertions(store, input.runId).get(`${test.id}.${assertion.id}`)
		requireWellFormed(
			!prior || input.reason !== undefined,
			`Assertion ${test.id}.${assertion.id} has a result (${prior?.result}). Record the correction with --reason "<why the earlier result was wrong>". The earlier result stays in the record.`
		)
		const outcomes = runOutcomes(store, input.runId)
		for (const dependency of test.dependsOn.filter((id) => !id.includes(':'))) {
			const outcome = outcomes.get(dependency)?.outcome
			requireCondition(
				outcome === 'passed',
				outcome
					? `Prerequisite ${dependency} is ${outcome}, not passed. Do not check ${test.id}.`
					: `Prerequisite ${dependency} is not closed. Check and close ${dependency} before you check ${test.id}.`,
				outcome
					? `Close ${test.id} as blocked: checkmate run close ${input.runId} ${test.id} --outcome blocked --reason "Prerequisite ${dependency} is ${outcome}"`
					: undefined
			)
		}
		requireWellFormed(
			!input.absent || input.observed === undefined,
			'--absent and --observed do not go together',
			'Use --absent when the page was read and the text or element is not on it. Use --observed with the value when it is there.'
		)
		requireWellFormed(
			!input.absent || assertion.expected !== undefined,
			`--absent applies to a structured check. ${test.id}.${assertion.id} has no expected value.`,
			'Record the result with --result and --observed.'
		)
		// The page was read and the value is not on it: the observed value is absent, and the code compares it.
		const observed = input.absent ? absentObservation : optionalText(input.observed, 'observation (--observed)')
		const evidenceText = (input.evidence ?? []).map((item) => ('text' in item ? item.text : item.file)).join('\n')
		requireWellFormed(
			observed === null || !looksTruncatedMoney(observed, assertion.expected, evidenceText),
			`The observed value "${observed}" looks like a money amount whose currency sign the shell removed.`,
			"Record --observed in single quotes, for example --observed '$5.00', so the shell passes the value unchanged. Or write the value to a file and pass --observed-file."
		)
		requireWellFormed(
			observed === null || !looksShellExpanded(observed),
			`The observed value "${observed}" looks like a shell path, not the value. The shell expanded it before Checkmate got it.`,
			"Record --observed in single quotes, for example --observed '$0', so the shell passes the value unchanged."
		)
		const reason = optionalText(input.reason, 'reason (--reason)')
		const result =
			assertion.expected === undefined
				? checkedResult(input.result, assertion, observed)
				: structuredResult(input, test, assertion, observed, run.request.marker ?? '')
		files = evidenceFiles(store, input.runId, `${test.id}-${assertion.id}`, input.evidence)
		if (result !== 'not_checked')
			requireWellFormed(
				observed && files.length > 0,
				`${result === 'inconclusive' ? 'An' : 'A'} ${result} result needs an observation (--observed) and one or more evidence items (--evidence)`,
				`Add --observed "<what you saw>" and --evidence <file in ${evidenceDirectory(input.runId)}>, or --evidence - with the text on standard input.`
			)
		if (result === 'inconclusive')
			requireWellFormed(
				reason,
				'An inconclusive result needs a reason (--reason) that says what the evidence cannot show'
			)
		if (result === 'not_checked')
			requireWellFormed(reason, 'A not_checked result needs a reason (--reason) that says why it was not checked')
		// The amounts match, but the observed value has no unit the expected value names. The record says so.
		const unit =
			result === 'passed' && observed !== null && assertion.expected !== undefined
				? unitNotObserved(observed, assertion.expected)
				: undefined
		const recorded = reason ?? (unit ? `The unit ${unit} was not observed; the amounts match.` : null)
		// The first result goes to assertion_results, which keeps it. A correction goes to assertion_corrections.
		const table = prior ? 'assertion_corrections' : 'assertion_results'
		execute(
			store,
			`INSERT INTO ${table} (run_id, test_id, assertion_id, attempt, result, observed, reason, recorded_at, operation_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
			input.runId,
			test.id,
			assertion.id,
			currentAttempt(store, input.runId),
			result,
			observed,
			recorded,
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
		if (run.request.permanent && input.outcome === undefined) requirePermanentSelection(store, input.runId)
		const test = selectedTest(run, input.testId)
		requireOpen(store, input.runId, test.id)
		const results = runAssertions(store, input.runId)
		const recorded = test.assertions.flatMap((assertion) => results.get(`${test.id}.${assertion.id}`) ?? [])
		let outcome: ResultTest['outcome']
		let reason: string | null
		if (input.outcome === undefined) {
			requireWellFormed(input.reason === undefined, '--reason applies only with --outcome')
			requireWellFormed(input.cause === undefined, '--cause applies only with --outcome not_run or blocked')
			requireWellFormed(!input.evidence?.length, '--evidence applies only with --outcome error')
			const missing = test.assertions.filter((assertion) => !results.has(`${test.id}.${assertion.id}`))
			requireCondition(
				!missing.length,
				`Assertions without a result: ${missing.map((assertion) => `${test.id}.${assertion.id}`).join(', ')}`,
				`Record each one with checkmate run check ${input.runId} ${test.id} <assertionId> --result <passed|failed|inconclusive|not_checked>. Or close ${test.id} with --outcome error --reason "<why>".`
			)
			outcome = testOutcome(recorded.map((row) => row.result))
			const unchecked = recorded.filter((row) => row.result === 'not_checked')
			reason =
				outcome === 'error'
					? `Assertions not checked: ${unchecked.map((row) => `${test.id}.${row.assertion_id}`).join(', ')}`
					: null
		} else {
			outcome = requireChoice(input.outcome, closeOutcomes, 'outcome (--outcome)')
			reason = requireText(input.reason, `reason (--reason) for outcome ${outcome}`)
			if (input.cause !== undefined) {
				requireWellFormed(outcome !== 'error', '--cause applies only with --outcome not_run or blocked')
				requireChoice(input.cause, closeCauses, 'cause (--cause)')
				refuseEarlyDeadline(store, run.row, at)
			}
			requireCondition(
				outcome === 'error' || !recorded.length,
				`Test ${test.id} has assertion results. Record the remaining assertions, or close it as error.`
			)
			requireWellFormed(
				outcome === 'error' || !input.evidence?.length,
				'--evidence applies only with --outcome error'
			)
			requireCondition(
				outcome !== 'error' || input.evidence?.length || recorded.length,
				'An error close needs the output of the failed tool.',
				`Run the failed tool once. Then close with --outcome error --reason "<cause>" --evidence - and send the tool output on standard input.`
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
			subjects: [`run:${input.runId}`, `plan:${run.plan.planId}`],
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
			!run.request.permanent || finding.type === 'defect',
			'A permanent run records only defects of its selected tests.'
		)
		const findingIds = runFindings(store, input.runId).map((item) => item.id)
		requireCondition(
			!findingIds.includes(finding.id),
			`Finding ${finding.id} exists in run ${input.runId}`,
			`Use a new finding ID, for example ${unusedId('F', findingIds)}.`
		)
		if (finding.type === 'defect')
			requireWellFormed(
				finding.assertionIds.length && finding.evidenceIds.length,
				`Defect ${finding.id} needs one or more failed assertions in assertionIds and their evidence in evidenceIds`,
				'Name the failed assertions and their evidence IDs. For a suspicion beyond the plan, record the finding with "type": "potential_issue" and empty assertionIds.'
			)
		const results = runAssertions(store, input.runId)
		const named = finding.assertionIds.map((reference) => {
			const [testId, assertionId] = reference.split('.')
			const test = selectedTest(run, testId)
			requireWellFormed(
				test.assertions.some((assertion) => assertion.id === assertionId),
				`Unknown assertion in finding ${finding.id}: ${reference}`
			)
			if (finding.type === 'defect')
				requireCondition(
					results.get(reference)?.result === 'failed',
					`Defect ${finding.id} names ${reference}, which is ${results.get(reference)?.result ?? 'unchecked'}. A defect names only failed assertions.`,
					'Remove the assertion from assertionIds, or record the finding with "type": "potential_issue".'
				)
			return { test, assertionId }
		})
		const testIds = run.plan.tests
			.filter((test) => named.some((item) => item.test.id === test.id))
			.map((test) => test.id)
		for (const requirementId of finding.requirementIds)
			for (const { test } of named)
				requireWellFormed(
					test.requirementIds.includes(requirementId),
					`Finding ${finding.id} names requirement ${requirementId}, which test ${test.id} does not cover`
				)
		const evidence = new Map(runEvidence(store, input.runId).map((row) => [row.id, row]))
		for (const id of finding.evidenceIds) {
			const row = evidence.get(id)
			requireWellFormed(row, `Unknown evidence in finding ${finding.id}: ${id}`)
			requireWellFormed(
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
			canonical({ ...withoutEmptyMetadata(finding), testIds }),
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
		requireCondition(
			!run.request.permanent,
			'A permanent run does not discover gaps. Close the affected test as blocked with its reason.'
		)
		const gap = validate('gap', input.gap)
		requireWellFormed(
			gap.status === 'open' && gap.decisionId === null,
			`Runtime gap ${gap.id} must be open and have no decision`
		)
		const planId = run.plan.planId
		requireCondition(
			!one(store, 'SELECT 1 FROM plan_gaps WHERE plan_id = ? AND gap_id = ?', planId, gap.id) &&
				!planRunGaps(store, planId).some((item) => item.gap.id === gap.id),
			`Gap ID ${gap.id} is in use. Use a new ID.`
		)
		for (const id of gap.requirementIds)
			requireWellFormed(
				run.plan.requirements.some((requirement) => requirement.id === id),
				`Unknown requirement in gap ${gap.id}: ${id}`
			)
		const plans = latestPlans(store)
		for (const reference of gap.testIds) {
			const { planId, testId } = testReference(reference)
			const plan = planId === null ? run.plan : plans.get(planId)
			requireWellFormed(
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
	const cleanupFailures = settleCleanups(store, [input.runId])
	return cleanupFailures.length ? { ...reply, data: { ...reply.data, cleanupFailures } } : reply
}

function finish(store: Store, actor: string | undefined, input: FinishInput) {
	return write(store, { actor, command: 'run finish', subject: input.runId, input }, (operationId, at) => {
		const run = startedRun(store, input.runId)
		const completion = requireChoice(input.completion, completions, 'completion (--completion)')
		const reason =
			completion === 'interrupted'
				? requireText(input.reason, 'reason (--reason) for completion interrupted')
				: optionalText(input.reason, 'reason (--reason)')
		let cause: string | null = null
		if (completion === 'interrupted') {
			cause = requireChoice(
				requireText(input.cause, 'cause (--cause) for completion interrupted'),
				interruptCauses,
				'cause (--cause)'
			)
			if (cause === 'deadline') refuseEarlyDeadline(store, run.row, at)
		} else requireWellFormed(input.cause === undefined, '--cause applies only with --completion interrupted')
		const cleanup = {
			status: requireChoice(input.cleanup, cleanupStatuses, 'cleanup (--cleanup)'),
			reason: requireText(input.cleanupReason, 'cleanup reason (--cleanup-reason)'),
		}
		const selected = run.request.selectedTestIds
		const attempt = currentAttempt(store, input.runId)
		const unclosed = selected.filter((id) => !runOutcomes(store, input.runId).has(id))
		requireCondition(
			completion !== 'operational_error' || !unclosed.length,
			`Selected tests are not closed: ${unclosed.join(', ')}. Finish with operational_error only after every test is closed.`,
			'Run each open test. Close it with its result, or with --outcome error --reason "<cause>" --evidence - and the output of the failed tool. For a deadline or a stopped host, finish as interrupted with --cause.'
		)
		if (completion === 'completed')
			requireCondition(
				!unclosed.length,
				`Selected tests are not closed: ${unclosed.join(', ')}. Close them, or finish as interrupted.`,
				`Close each test with checkmate run close ${input.runId} <testId>. Or finish with --completion interrupted --cause <deadline|host_stopped|tool_unavailable> --reason "<why>".`
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
		if (
			run.request.permanent &&
			completion === 'completed' &&
			[...outcomes.values()].some((item) => item.outcome === 'passed')
		)
			requirePermanentSelection(store, input.runId)
		const results = runAssertions(store, input.runId)
		const findings = runFindings(store, input.runId)
		const newGaps = runGaps(store, input.runId)
		// A partial observation in a test closed as error does not establish a test verdict.
		for (const row of results.values())
			if (row.result === 'failed' && outcomes.get(row.test_id)?.outcome !== 'error')
				requireCondition(
					findings.some(
						(finding) =>
							finding.type === 'defect' &&
							finding.assertionIds.includes(`${row.test_id}.${row.assertion_id}`)
					),
					`Failed assertion ${row.test_id}.${row.assertion_id} needs a defect finding. Record it with run finding.`,
					defectHint(store, run, row, findings)
				)
		if (completion === 'completed') {
			const failures = selected.filter((id) => outcomes.get(id)!.outcome === 'error')
			requireCondition(
				!failures.length,
				`Operational failure cannot be completed: ${failures.join(', ')} closed as error`,
				'Finish with --completion operational_error.'
			)
			requireCondition(
				cleanup.status !== 'failed',
				'Cleanup failed, so the run cannot be completed',
				'Finish with --completion operational_error.'
			)
			for (const verdict of retestVerdicts(run, outcomes, runAssertions(store, input.runId)))
				for (const testId of verdict.testIds.filter((id) => selected.includes(id)))
					requireCondition(
						outcomes.get(testId)!.outcome !== 'not_run',
						`Retest ${input.runId} did not run ${testId} of defect ${verdict.findingId} of ${verdict.runId}. Run ${testId}, or finish as interrupted with a cause and a reason.`
					)
			for (const test of run.plan.tests.filter((test) => selected.includes(test.id))) {
				const outcome = outcomes.get(test.id)!.outcome
				if (outcome !== 'not_run' && outcome !== 'blocked') continue
				const cause =
					test.dependsOn.some((id) =>
						id.includes(':')
							? dependencyBlock(store, id, run.row.application_build) !== null
							: outcomes.get(id)?.outcome !== 'passed'
					) ||
					newGaps.some((gap) => gap.severity === 'blocking') ||
					(Boolean(run.request.permanent) && outcome === 'blocked' && Boolean(outcomes.get(test.id)?.reason))
				requireCondition(
					cause,
					`Selected test ${test.id} is ${outcome} without a cause. A completed run needs a prerequisite that did not pass, or a new blocking gap.`,
					`Record the blocking gap with checkmate run gap ${input.runId}. Send the gap JSON on standard input in a quoted heredoc. Or finish with --completion interrupted --cause <deadline|host_stopped|tool_unavailable> --reason "<why>".`
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
				...(closed.cause ? { cause: closed.cause as 'deadline' } : {}),
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
			instanceId: run.row.instance_id,
			applicationBuild: run.row.application_build,
			selectedTestIds: selected,
			retestOf: run.request.retestOf,
			startedAt: run.row.started_at,
			finishedAt: at,
			attempts: attempt,
			completion,
			completionCause: cause,
			completionReason: reason,
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

function defectHint(store: Store, run: RunState, row: AssertionRow, findings: Result['findings']) {
	const reference = `${row.test_id}.${row.assertion_id}`
	const test = run.plan.tests.find((item) => item.id === row.test_id)!
	const evidenceIds = runEvidence(store, run.row.run_id)
		.filter((item) => item.test_id === row.test_id && item.assertion_id === row.assertion_id)
		.map((item) => item.id)
	const finding = {
		id: unusedId(
			'F',
			findings.map((item) => item.id)
		),
		type: 'defect',
		severity: '<low|medium|high|critical>',
		assertionIds: [reference],
		requirementIds: test.requirementIds,
		title: '<short title>',
		expected: '<expected result>',
		observed: row.observed ?? '<observed result>',
		reproduction: ['<step>'],
		evidenceIds,
	}
	return `Record the defect with checkmate run finding ${run.row.run_id}. Send this JSON on standard input in a quoted heredoc, with your values: ${JSON.stringify(finding)}. Then run run finish again. Record only a defect supported by evidence. If an invalid observation was recorded, report the recording error to the operator. Do not invent a defect.`
}

export type RetestVerdict = 'fixed' | 'not_fixed' | 'not_retested'

// A defect is judged by the assertions it was recorded against, so a failing sibling assertion on the same test does not count.
export function retestVerdicts(
	run: RunState,
	outcomes: Map<string, OutcomeRow>,
	assertions: Map<string, AssertionRow>
) {
	return (run.request.retestDefects ?? []).map((defect) => {
		const verdict = defect.assertionIds?.length
			? assertionVerdict(defect.assertionIds.map((id) => assertions.get(id)?.result))
			: testVerdict(defect.testIds.map((id) => outcomes.get(id)?.outcome))
		return { ...defect, runId: defect.runId ?? run.request.retestOf!, verdict }
	})
}

function assertionVerdict(results: Array<AssertionRow['result'] | undefined>): RetestVerdict {
	if (results.includes('failed')) return 'not_fixed'
	return results.every((result) => result === 'passed') ? 'fixed' : 'not_retested'
}

// A defect recorded before assertions were named has only its tests to judge by.
function testVerdict(outcomes: Array<string | undefined>): RetestVerdict {
	if (outcomes.includes('failed')) return 'not_fixed'
	return outcomes.every((outcome) => outcome === 'passed') ? 'fixed' : 'not_retested'
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
		requireWellFormed(stalled.length > 0 || input.reason === undefined, '--reason applies only with --error')
		const reason = stalled.length ? requireText(input.reason, 'reason (--reason) for --error') : null
		const instance = findInstance(store, run.row.target_id, run.row.instance_id)
		requireCondition(
			!instance.retired,
			`Instance ${instance.targetId}/${instance.instanceId} is retired. Run ${input.runId} cannot resume on it.`,
			`Finish ${input.runId} to keep its recorded results. Start a new run on an active instance.`
		)
		const target = targetRevision(store, run.row.target_id)
		requireCondition(
			target.profile.readyForLiveExecution,
			`Target prerequisites are not ready: ${run.row.target_id}@${target.revision}`,
			readinessHint(store, run.row.target_id)
		)
		const checked = gate(store, {
			reference: `${run.plan.planId}@${run.plan.revision}`,
			tests: run.request.selectedTestIds,
			build: run.row.application_build,
			instance: run.row.instance_id,
			partial: run.request.partialExecution,
			retestOf: run.request.retestOf,
			...(run.request.permanent ? { permanent: run.request.permanent.reference } : {}),
		})
		const outcomes = runOutcomes(store, input.runId)
		const openTests = run.plan.tests.filter(
			(test) => run.request.selectedTestIds.includes(test.id) && !outcomes.has(test.id)
		)
		const runGapReasons =
			checked.partial === 'ready_only' ? openRunGapReasons(store, run.plan.planId, openTests) : []
		if (checked.reply.status !== 'completed' || runGapReasons.length)
			return {
				reply: {
					status: 'rejected',
					subject: input.runId,
					reasons: [refusalReasons.prohibited, ...checked.reply.reasons, ...runGapReasons],
					refusal: 'prohibited',
					hint: runGapReasons.length
						? `Close each affected test with checkmate run close ${input.runId} <testId> --outcome <blocked|error> --reason "<why>" before you resume. Use error if it has an assertion result.`
						: `Run checkmate status ${run.plan.planId} to see the next step.`,
					data: {},
				},
				subjects: [],
			}
		const changing = openTests.filter((test) => !stalled.includes(test.id) && test.operations.some(changesData))
		const reset = target.profile.reset
		if (changing.length && reset?.owner === 'environment')
			return {
				reply: {
					status: 'needs_decision',
					subject: input.runId,
					reasons: [
						`Actions may have occurred in ${changing.map((test) => test.id).join(', ')}, and Checkmate cannot reset the data of ${run.row.target_id} (${reset ? `data kind ${reset.owner}` : 'no data policy recorded'}).`,
					],
					hint: `Decide for each test. Close it as error with a reason: checkmate run resume ${input.runId} --error ${changing.map((test) => test.id).join(',')} --reason "<why>". Or restore the data outside Checkmate, then run checkmate run resume ${input.runId} again.`,
					data: {},
				},
				subjects: [],
			}
		if (changing.length && reset?.owner === 'checkmate')
			runPrepare(store.workspace, reset, run.request.marker ?? markerFor(store, input.runId))
		if (changing.length) owe(store, input.runId, reset)
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
		const results = runAssertions(store, input.runId)
		const tests = openTests
			.filter((test) => !stalled.includes(test.id))
			.map((test) => ({
				testId: test.id,
				...(changing.includes(test) ? { reset: 'ran before this attempt' } : {}),
				recorded: test.assertions.filter((assertion) => results.has(`${test.id}.${assertion.id}`)).length,
				assertions: test.assertions.filter((assertion) => !results.has(`${test.id}.${assertion.id}`)),
			}))
		return {
			reply: completed(input.runId, {
				runId: input.runId,
				attempt,
				browserSession: run.row.browser_session,
				deadlineSeconds: run.row.deadline_seconds,
				deadline: new Date(Date.parse(at) + run.row.deadline_seconds * 1000).toISOString(),
				evidenceDirectory: evidenceDirectory(input.runId),
				closed: stalled,
				tests,
				warnings: runOverlapWarnings(store, input.runId),
			}),
			subjects: stalled.length ? [`run:${input.runId}`, `plan:${run.plan.planId}`] : [`run:${input.runId}`],
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
		expectDecision(store, 'result', input.runId, input.expectDecision)
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
