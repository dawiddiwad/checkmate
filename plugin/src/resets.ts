import type { Profile } from './types.ts'
import type { Store } from './store.ts'
import { spawnSync } from 'node:child_process'
import { existsSync, readFileSync } from 'node:fs'
import { isAbsolute, join } from 'node:path'
import { requireCondition } from './contracts.ts'
import { execute, one } from './store.ts'

export type Reset = NonNullable<Profile['reset']>

const readPrefixes = ['read_', 'list_', 'get_', 'view_']
const defaultHookSeconds = 120
const hookOutputBytes = 8192

export function changesData(operation: string) {
	return !readPrefixes.some((prefix) => operation.startsWith(prefix))
}

// The marker tags the records of one run or exploration. Hooks receive it as CHECKMATE_MARKER.
// A nonce kept with the workspace makes it unique across workspaces that share a target.
export function markerFor(store: Store, id: string) {
	const row = one<{ value: string }>(store, 'SELECT value FROM meta WHERE key = ?', 'markerNonce')
	const nonce = row?.value ?? ''
	if (row) return `qa-${nonce}-${id}`
	const created = Math.random().toString(36).slice(2, 8)
	execute(store, 'INSERT OR REPLACE INTO meta (key, value) VALUES (?, ?)', 'markerNonce', created)
	return `qa-${created}-${id}`
}

export function requireDataFor(profile: Profile, operations: string[], subject: string, flags: string) {
	const changing = operations.filter(changesData)
	requireCondition(
		!changing.length || profile.reset,
		`${subject} can change data (${changing.join(', ')}), and target ${profile.targetId} has no data policy.`,
		`Ask the person for the reset command that restores the seed data, or for the data policy: checkmate setup ${flags} --reset "<command>", or --data environment|isolation --policy "<text>". Do not write a command, a policy, or a hook yourself.`
	)
}

export function dataKindText(reset: Reset | null | undefined) {
	if (!reset) return 'none recorded'
	if (reset.owner === 'checkmate') return 'reset command (Checkmate runs it before each run and exploration)'
	if (reset.owner === 'environment') return 'reset by the environment (Checkmate resets nothing)'
	return 'isolation (the target cannot be reset; testers work by isolation)'
}

export function policyText(workspace: string, reset: Reset | null | undefined) {
	const policy = reset?.policy
	if (!policy) return null
	if ('text' in policy) return policy.text
	const path = isAbsolute(policy.path) ? policy.path : join(workspace, policy.path)
	requireCondition(
		existsSync(path),
		`The data policy file ${policy.path} does not exist.`,
		'Give the file that holds the policy, or record the policy text with --policy.'
	)
	return readFileSync(path, 'utf8').trim()
}

function hookSeconds(reset: Reset) {
	return reset.timeoutSeconds ?? defaultHookSeconds
}

function runHook(workspace: string, command: string[], marker: string, reset: Reset, phase: string) {
	const result = spawnSync(command[0], command.slice(1), {
		cwd: workspace,
		encoding: 'utf8',
		timeout: hookSeconds(reset) * 1000,
		maxBuffer: 1024 * 1024,
		env: { ...process.env, CHECKMATE_MARKER: marker },
	})
	if (result.status === 0)
		return { ok: true as const, stdout: (result.stdout ?? '').slice(0, hookOutputBytes).trim() }
	const why =
		result.error?.message.includes('ETIMEDOUT') || result.signal === 'SIGTERM'
			? `timed out after ${hookSeconds(reset)} seconds`
			: result.status === null
				? 'did not start'
				: `exited with code ${result.status}`
	return { ok: false as const, reason: `The ${phase} command ${command.join(' ')} ${why}.` }
}

// Prepare runs before a run begins and before an exploration starts. Its output becomes facts for that run.
export function runPrepare(workspace: string, reset: Reset | null | undefined, marker: string) {
	if (!reset?.command) return ''
	const result = runHook(workspace, reset.command, marker, reset, 'prepare')
	requireCondition(
		result.ok,
		result.ok ? '' : result.reason,
		'Checkmate started no test. Run the prepare command by hand, read its output, and fix it. Then start again.'
	)
	return result.stdout
}

export function dataRules(workspace: string, reset: Reset | null | undefined, marker: string, facts = '') {
	if (!reset) return ['Data: no data policy is recorded for this target. Do not change data.']
	const lines: string[] = []
	if (reset.owner === 'checkmate')
		lines.push('Data: Checkmate resets the test data before the run. Do not reset it yourself.')
	if (reset.owner === 'environment')
		lines.push('Data: the environment gives this run fresh data. Checkmate does not reset it.')
	if (reset.owner === 'isolation')
		lines.push(
			`Data: this target cannot be reset. Create your own records with the marker ${marker} in their names, use only the test users and records that the data policy names, and never modify or delete a record that you did not create.`
		)
	const policy = policyText(workspace, reset)
	if (policy) lines.push(`Data policy: ${policy}`)
	if (facts) lines.push(`Facts for this run (from the prepare command, not secrets): ${facts}`)
	return lines
}

const owedKey = 'cleanupOwed'

export type OwedCleanup = { id: string; marker: string; command: string[]; workspace: string; timeoutSeconds: number }

export function owedCleanups(store: Store): OwedCleanup[] {
	const row = one<{ value: string }>(store, 'SELECT value FROM meta WHERE key = ?', owedKey)
	return row ? (JSON.parse(row.value) as OwedCleanup[]) : []
}

function saveOwed(store: Store, items: OwedCleanup[]) {
	execute(store, 'INSERT OR REPLACE INTO meta (key, value) VALUES (?, ?)', owedKey, JSON.stringify(items))
}

// A cleanup is owed from the start of a run or exploration until it has run. A dead process keeps the debt.
export function owe(store: Store, id: string, reset: Reset | null | undefined) {
	if (!reset?.cleanup) return
	saveOwed(store, [
		...owedCleanups(store).filter((item) => item.id !== id),
		{
			id,
			marker: markerFor(store, id),
			command: reset.cleanup,
			workspace: store.workspace,
			timeoutSeconds: hookSeconds(reset),
		},
	])
}

// Runs the owed cleanups of the given runs or explorations. A failed cleanup stays owed and is reported.
// It never changes a test verdict.
export function settleCleanups(store: Store, ids: string[]) {
	const failures: string[] = []
	const kept: OwedCleanup[] = []
	const owed = owedCleanups(store)
	for (const item of owed.filter((entry) => !ids.includes(entry.id))) kept.push(item)
	for (const item of owed.filter((entry) => ids.includes(entry.id))) {
		const result = spawnSync(item.command[0], item.command.slice(1), {
			cwd: item.workspace,
			encoding: 'utf8',
			timeout: item.timeoutSeconds * 1000,
			env: { ...process.env, CHECKMATE_MARKER: item.marker },
		})
		if (result.status !== 0) {
			failures.push(`${item.id}: cleanup ${item.command.join(' ')} exited ${result.status}`)
			kept.push(item)
		}
	}
	saveOwed(store, kept)
	return failures
}

export function resetCommand(text: string) {
	const words = text.trim().split(/\s+/).filter(Boolean)
	requireCondition(words.length, 'The command is empty. Give the command that the person or the project gives.')
	return words
}

// What a status, run, plan, or report shows about the data kind of a target.
export function dataSummary(workspace: string, reset: Reset | null | undefined) {
	if (!reset) return { kind: dataKindText(null), owner: null, policy: null, prepare: null, cleanup: null }
	let policy: string | null
	try {
		policy = policyText(workspace, reset)
	} catch (error) {
		policy = `unavailable: ${error instanceof Error ? error.message : String(error)}`
	}
	return {
		kind: dataKindText(reset),
		owner: reset.owner,
		policy,
		prepare: reset.command,
		cleanup: reset.cleanup ?? null,
	}
}
