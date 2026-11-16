import type { Reply, Store } from './store.ts'
import type { Env } from './sessions.ts'
import type { StartInput } from './explorers.ts'
import { all, one } from './store.ts'
import { Refusal, requireWellFormed, unusedId } from './contracts.ts'
import { openPlan } from './plans.ts'
import { beginRun } from './runs.ts'
import { startExploration } from './explorers.ts'
import { targetRevision } from './targets.ts'
import { spawnSync } from 'node:child_process'

export const testModes = ['exploratory', 'regression', 'auto'] as const
export type TestInput = Omit<StartInput, 'mode' | 'scope'> & {
	mode?: string
	objective?: string
	target?: string
	sources?: string[]
	since?: string
	scope?: string[]
}

function hasRequest(store: Store, planId: string) {
	return Boolean(one(store, 'SELECT 1 FROM plan_requests WHERE plan_id = ?', planId))
}

export function autoMode(store: Store, planId: string) {
	const explored = one(store, 'SELECT 1 FROM explorations WHERE plan_id = ?', planId)
	const checked = one(store, 'SELECT 1 FROM runs r JOIN results s ON s.run_id = r.run_id WHERE r.plan_id = ?', planId)
	return explored || checked ? 'regression' : 'exploratory'
}

export function changedFiles(workspace: string, since: string) {
	const diff = spawnSync('git', ['diff', '--name-only', since, '--'], { cwd: workspace, encoding: 'utf8' })
	if (diff.status !== 0)
		throw new Refusal(
			'malformed',
			`git diff --name-only ${since} failed${diff.stderr ? `: ${diff.stderr.trim().split('\n')[0]}` : ''}`,
			'Give --since a commit, a branch, or a tag of the workspace repository. Or give the changed files with --scope.'
		)
	return diff.stdout.split('\n').filter(Boolean)
}

function nextRunId(store: Store) {
	return unusedId(
		'run-',
		all<{ run_id: string }>(store, 'SELECT run_id FROM runs').map((row) => row.run_id)
	)
}

function openRequest(store: Store, actor: string | undefined, input: TestInput) {
	requireWellFormed(
		input.objective && input.target,
		`Unknown plan: ${input.planId}. Give --objective, --target, and --source to record its request.`,
		`checkmate test ${input.planId} --build ${input.build} --objective "<goal>" --target <targetId> --source <file or ticket>`
	)
	const revision = targetRevision(store, input.target!).revision
	const opened = openPlan(store, actor, {
		planId: input.planId,
		target: `${input.target}@${revision}`,
		request: { objective: input.objective, context: { sources: input.sources ?? [] } },
	})
	if (opened.status !== 'completed') throw new Refusal('malformed', opened.reasons.join(' '))
}

function checkRun(store: Store, actor: string | undefined, input: TestInput) {
	const latest = one<{ revision: number }>(store, 'SELECT revision FROM latest_plans WHERE plan_id = ?', input.planId)
	if (!latest) return { run: null, skipped: [`Plan ${input.planId} has no stored tests.`] }
	const runId = nextRunId(store)
	const begun = beginRun(store, actor, {
		runId,
		reference: `${input.planId}@${latest.revision}`,
		build: input.build,
		instance: input.instance,
		partial: 'ready_only',
	})
	if (begun.status !== 'completed')
		return { run: null, skipped: begun.reasons.filter((reason) => !/^Refused/.test(reason)) }
	return { run: { runId, tests: begun.data.tests as string[] }, skipped: [] }
}

export function runTest(store: Store, actor: string | undefined, input: TestInput, env: Env): Reply {
	if (!hasRequest(store, input.planId)) openRequest(store, actor, input)
	const mode = input.mode && input.mode !== 'auto' ? input.mode : autoMode(store, input.planId)
	const scope = input.scope ?? (input.since ? changedFiles(store.workspace, input.since) : [])
	const explored = startExploration(store, actor, { ...input, mode, scope }, env)
	const check = mode === 'regression' ? checkRun(store, actor, input) : { run: null, skipped: [] }
	return {
		...explored,
		data: {
			...explored.data,
			mode,
			chosenBy: input.mode && input.mode !== 'auto' ? 'flag' : 'auto',
			scope,
			run: check.run,
			checkSkipped: check.skipped,
			next: [
				...(check.run
					? [
							`Execute the stored tests of ${check.run.runId}: /checkmate:execute ${check.run.runId}, or checkmate delegate execute ${check.run.runId}`,
						]
					: []),
				`checkmate explore wait ${explored.subject}`,
			],
		},
	}
}
