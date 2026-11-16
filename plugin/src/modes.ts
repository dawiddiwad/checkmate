import type { Reply, Store } from './store.ts'
import type { Env } from './sessions.ts'
import type { StartInput } from './explorers.ts'
import type { Charter } from './explorations.ts'
import { all, one } from './store.ts'
import { Refusal, requireWellFormed, unusedId } from './contracts.ts'
import { upstreamBase } from './change.ts'
import { openPlan } from './plans.ts'
import { beginRun } from './runs.ts'
import { startExploration } from './explorers.ts'
import { setupTarget, targetRevision } from './targets.ts'
import { spawnSync } from 'node:child_process'
import { resolve } from 'node:path'

export const testModes = ['exploratory', 'regression', 'auto'] as const
export type TestInput = Omit<StartInput, 'mode' | 'scope' | 'build'> & {
	build?: string
	url?: string
	mode?: string
	objective?: string
	target?: string
	sources?: string[]
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

function nextRunId(store: Store) {
	return unusedId(
		'run-',
		all<{ run_id: string }>(store, 'SELECT run_id FROM runs').map((row) => row.run_id)
	)
}

function gitBuild(workspace: string) {
	const head = spawnSync('git', ['rev-parse', '--short', 'HEAD'], { cwd: workspace, encoding: 'utf8' })
	return head.status === 0 ? head.stdout.trim() || undefined : undefined
}

export function dateBuild(now = new Date()) {
	return `local-${now.toISOString().slice(0, 16).replace(/[-:]/g, '').replace('T', '-')}`
}

function chosenTarget(store: Store, actor: string | undefined, input: TestInput, env: Env, assumed: string[]) {
	if (input.target) return input.target
	const targets = all<{ target_id: string }>(store, 'SELECT target_id FROM profiles GROUP BY target_id').map(
		(row) => row.target_id
	)
	if (targets.length === 1) {
		assumed.push(`target=${targets[0]} (the only target)`)
		return targets[0]
	}
	requireWellFormed(
		!targets.length,
		`The store has ${targets.length} targets: ${targets.join(', ')}. Name one with --target.`
	)
	requireWellFormed(
		input.url,
		'The store has no target. Give the URL of the application with --url.',
		`checkmate test ${input.planId} --url <url> --source <ticket file>`
	)
	const set = setupTarget(store, actor, { url: input.url!, instanceId: input.instance, env })
	assumed.push(...((set.data.assumed ?? []) as string[]))
	return set.data.targetId as string
}

function openRequest(store: Store, actor: string | undefined, input: TestInput, env: Env, assumed: string[]) {
	const sources = input.sources ?? []
	requireWellFormed(
		input.objective || sources.length,
		`Unknown plan: ${input.planId}. Give the ticket or the criteria file with --source.`,
		`checkmate test ${input.planId} --source <ticket file>`
	)
	const targetId = chosenTarget(store, actor, input, env, assumed)
	const objective = input.objective ?? `Test the change that ${sources.join(', ')} describes.`
	if (!input.objective) assumed.push(`objective=${objective}`)
	const revision = targetRevision(store, targetId).revision
	const opened = openPlan(store, actor, {
		planId: input.planId,
		target: `${targetId}@${revision}`,
		request: { objective, context: { sources } },
	})
	if (opened.status !== 'completed') throw new Refusal('malformed', opened.reasons.join(' '))
}

function checkRun(store: Store, actor: string | undefined, input: TestInput & { build: string }) {
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

export function runTest(store: Store, actor: string | undefined, given: TestInput, env: Env): Reply {
	const assumed: string[] = []
	const build = given.build ?? gitBuild(store.workspace) ?? dateBuild()
	if (!given.build) assumed.push(`build=${build}`)
	const input = { ...given, build }
	if (!hasRequest(store, input.planId)) openRequest(store, actor, input, env, assumed)
	const mode = input.mode && input.mode !== 'auto' ? input.mode : autoMode(store, input.planId)
	const base = input.since ? undefined : upstreamBase(resolve(store.workspace, input.repo ?? '.'))
	if (!input.since)
		assumed.push(
			base
				? `since=${base} (the default branch of origin, behind the checked-out commit)`
				: 'since=none (no diff is given: no --since, and no default branch of origin behind the checked-out commit)'
		)
	const explored = startExploration(store, actor, { ...input, since: input.since ?? base, mode }, env)
	const charter = explored.data.charter as Charter
	const check = mode === 'regression' ? checkRun(store, actor, input) : { run: null, skipped: [] }
	return {
		...explored,
		data: {
			...explored.data,
			mode,
			chosenBy: input.mode && input.mode !== 'auto' ? 'flag' : 'auto',
			scope: charter.scope,
			run: check.run,
			checkSkipped: check.skipped,
			assumed,
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
