import { Refusal, requireWellFormed } from './contracts.ts'
import { spawnSync } from 'node:child_process'
import { relative, resolve } from 'node:path'

export type Change = { since: string; until: string; repo: string; range: string[]; checkedOut: boolean }

const refHint =
	'Give --since a commit, a branch, or a tag of the repository. Give --repo <dir> when the code is in a subfolder. Or give the changed files with --scope.'

function git(cwd: string, args: string[]) {
	const out = spawnSync('git', args, { cwd, encoding: 'utf8' })
	return out.status === 0 ? out.stdout.trim() : undefined
}

function commit(cwd: string, ref: string) {
	return git(cwd, ['rev-parse', '--verify', '--quiet', `${ref}^{commit}`])
}

function rangeArgs(since: string, until: string | undefined) {
	return until ? [`${since}...${until}`] : ['--merge-base', since]
}

export function changeOf(workspace: string, input: { since?: string; until?: string; repo?: string }) {
	requireWellFormed(
		!input.until || input.since,
		'--until needs --since.',
		'Give the base of the change with --since.'
	)
	if (!input.since) return null
	const repository = resolve(workspace, input.repo ?? '.')
	const head = commit(repository, 'HEAD')
	const until = input.until ?? git(repository, ['rev-parse', '--short', 'HEAD'])
	const range = rangeArgs(input.since, input.until)
	if (!head || !until || !commit(repository, input.since) || (input.until && !commit(repository, input.until)))
		throw new Refusal('malformed', `git diff --name-only ${range.join(' ')} failed: unknown revision.`, refHint)
	return {
		since: input.since,
		until,
		repo: relative(workspace, repository) || '.',
		range,
		checkedOut: commit(repository, until) === head,
	}
}

export function changedFiles(workspace: string, change: Change) {
	const diff = spawnSync('git', ['diff', '--name-only', ...change.range, '--'], {
		cwd: resolve(workspace, change.repo),
		encoding: 'utf8',
	})
	if (diff.status !== 0)
		throw new Refusal(
			'malformed',
			`git diff --name-only ${change.range.join(' ')} failed${diff.stderr ? `: ${diff.stderr.trim().split('\n')[0]}` : ''}`,
			refHint
		)
	return diff.stdout.split('\n').filter(Boolean)
}

export function upstreamBase(repository: string) {
	const branch = git(repository, ['symbolic-ref', '--quiet', '--short', 'refs/remotes/origin/HEAD'])
	const head = commit(repository, 'HEAD')
	if (!branch || !head || commit(repository, branch) === head) return undefined
	const ancestor = spawnSync('git', ['merge-base', '--is-ancestor', branch, 'HEAD'], { cwd: repository })
	return ancestor.status === 0 ? branch : undefined
}
