import { execFileSync } from 'node:child_process'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import process from 'node:process'
import { runInNewContext } from 'node:vm'
import { parse } from 'yaml'
import { describe, expect, it, vi } from 'vitest'

const workflow = parse(readFileSync(new URL('../../.github/workflows/ci.yml', import.meta.url), 'utf8'))
const versionScript = workflow.jobs.publish.steps.find((step: { id?: string }) => step.id === 'version').run
const registryScript = workflow.jobs.publish.steps.find((step: { id?: string }) => step.id === 'registry').run

describe('Publish triggers', () => {
	it.each([
		{ event: 'push', branch: 'main', release: true },
		{ event: 'push', branch: 'develop', release: false },
		{ event: 'pull_request_target', branch: 'main', release: false },
		{ event: 'pull_request', branch: 'main', release: false },
		{ event: 'workflow_dispatch', branch: 'main', release: true },
		{ event: 'workflow_dispatch', branch: 'develop', release: false },
	])('identifies releases=$release for $event on $branch', ({ event, branch, release }) => {
		const github = {
			event_name: event,
			ref: `refs/heads/${branch}`,
			event: { repository: { default_branch: 'main' } },
		}
		expect(
			runInNewContext(workflow.jobs['release-source'].if, {
				github,
				format: (pattern: string, value: string) => pattern.replace('{0}', value),
			})
		).toBe(release)
	})

	it('checks out the default branch and does not register pull_request_target', () => {
		expect(workflow.on.pull_request_target).toBeUndefined()
		expect(workflow.on.push.branches).toEqual(['main'])
		expect(workflow.jobs.publish.steps[0].with.ref).toBe('${{ env.RELEASE_BRANCH }}')
		expect(workflow.jobs.publish.env.RELEASE_BRANCH).toBe('${{ github.event.repository.default_branch }}')
	})
})

function releaseSourceFixture() {
	const pull = {
		number: 60,
		merged: true,
		merged_at: '2026-10-07T17:40:00Z',
		merge_commit_sha: 'merged-commit',
		base: { ref: 'main' },
	}
	const context = {
		eventName: 'push',
		sha: 'merged-commit',
		runId: 123,
		repo: { owner: 'owner', repo: 'checkmate' },
		payload: { repository: { default_branch: 'main' }, inputs: { pull_request: '' } },
	}
	const paginate = vi.fn(async () => [pull])
	const get = vi.fn(async () => ({ data: pull }))
	const setOutput = vi.fn()
	const run = () =>
		runInNewContext(`(async () => { ${workflow.jobs['release-source'].steps[0].with.script} })()`, {
			context,
			github: { paginate, rest: { repos: { listPullRequestsAssociatedWithCommit: vi.fn() }, pulls: { get } } },
			core: { setOutput },
		})
	return { pull, context, paginate, get, setOutput, run }
}

describe('Release source', () => {
	it('identifies the PR introduced by the pushed merge commit', async () => {
		const fixture = releaseSourceFixture()
		await fixture.run()
		expect(fixture.paginate).toHaveBeenCalledWith(expect.any(Function), {
			owner: 'owner',
			repo: 'checkmate',
			commit_sha: 'merged-commit',
		})
		expect(fixture.setOutput).toHaveBeenCalledWith('source', 'pull-request-60')
	})

	it.each(['direct-push', 'unmerged', 'other-branch', 'different-commit'])(
		'does not release a %s',
		async (reason) => {
			const fixture = releaseSourceFixture()
			if (reason === 'direct-push') fixture.paginate.mockResolvedValue([])
			if (reason === 'unmerged') fixture.pull.merged_at = ''
			if (reason === 'other-branch') fixture.pull.base.ref = 'develop'
			if (reason === 'different-commit') fixture.pull.merge_commit_sha = 'older-merge'
			await fixture.run()
			expect(fixture.setOutput).not.toHaveBeenCalled()
		}
	)

	it('identifies a fresh manual release', async () => {
		const fixture = releaseSourceFixture()
		fixture.context.eventName = 'workflow_dispatch'
		await fixture.run()
		expect(fixture.setOutput).toHaveBeenCalledWith('source', 'workflow-dispatch-123')
		expect(fixture.paginate).not.toHaveBeenCalled()
	})

	it('resumes a manually selected merged PR using the original release marker', async () => {
		const fixture = releaseSourceFixture()
		fixture.context.eventName = 'workflow_dispatch'
		fixture.context.payload.inputs.pull_request = ' 60 '
		await fixture.run()
		expect(fixture.get).toHaveBeenCalledWith({ owner: 'owner', repo: 'checkmate', pull_number: 60 })
		expect(fixture.setOutput).toHaveBeenCalledWith('source', 'pull-request-60')
	})

	it.each(['invalid-number', 'unmerged', 'other-branch'])('rejects manual recovery for %s', async (reason) => {
		const fixture = releaseSourceFixture()
		fixture.context.eventName = 'workflow_dispatch'
		fixture.context.payload.inputs.pull_request = reason === 'invalid-number' ? '60; echo bad' : '60'
		if (reason === 'unmerged') fixture.pull.merged = false
		if (reason === 'other-branch') fixture.pull.base.ref = 'develop'
		await expect(fixture.run()).rejects.toThrow()
		expect(fixture.setOutput).not.toHaveBeenCalled()
	})
})

describe('Publishing environment', () => {
	it.each(['ACTIONS_ID_TOKEN_REQUEST_URL', 'ACTIONS_ID_TOKEN_REQUEST_TOKEN'])(
		'fails before preparing a version when %s is unavailable',
		(missing) => {
			const step = workflow.jobs.publish.steps.find(
				(step: { name?: string }) => step.name === 'Check publishing environment'
			)
			const script = step.run.split("node --input-type=module <<'NODE'\n")[1].split('\nNODE')[0]
			const env = {
				...process.env,
				ACTIONS_ID_TOKEN_REQUEST_URL: 'https://example.com/oidc',
				ACTIONS_ID_TOKEN_REQUEST_TOKEN: 'test-token',
				[missing]: '',
			}
			expect(() => execFileSync('node', ['--input-type=module', '-e', script], { env, stdio: 'pipe' })).toThrow(
				`GitHub OIDC is unavailable: ${missing} is missing.`
			)
		}
	)
})

function githubReleaseFixture() {
	const script = workflow.jobs.publish.steps.find(
		(step: { name?: string }) => step.name === 'Create the GitHub release'
	).with.script
	const getRef = vi.fn(async () => ({ data: { ref: 'refs/tags/v0.6.1' } }))
	const getReleaseByTag = vi.fn().mockRejectedValue({ status: 404 })
	const createRelease = vi.fn().mockResolvedValue({ data: { id: 1 } })
	const run = () =>
		runInNewContext(`(async () => { ${script} })()`, {
			context: { repo: { owner: 'owner', repo: 'checkmate' } },
			process: { env: { RELEASE_VERSION: '0.6.1', RELEASE_PACKAGE: '@xoxoai/checkmate' } },
			github: { rest: { git: { getRef }, repos: { getReleaseByTag, createRelease } } },
			core: { info: vi.fn() },
		})
	return { getRef, getReleaseByTag, createRelease, run }
}

describe('GitHub releases', () => {
	it('creates a release for the existing version tag with generated notes and an npm link', async () => {
		const fixture = githubReleaseFixture()
		await fixture.run()
		expect(fixture.getRef).toHaveBeenCalledWith({ owner: 'owner', repo: 'checkmate', ref: 'tags/v0.6.1' })
		expect(fixture.createRelease).toHaveBeenCalledWith({
			owner: 'owner',
			repo: 'checkmate',
			tag_name: 'v0.6.1',
			name: 'v0.6.1',
			body: 'Published to npm: [@xoxoai/checkmate@0.6.1](https://www.npmjs.com/package/@xoxoai/checkmate/v/0.6.1)',
			generate_release_notes: true,
			make_latest: 'legacy',
		})
	})

	it('preserves an existing release when retried', async () => {
		const fixture = githubReleaseFixture()
		fixture.getReleaseByTag.mockResolvedValue({ data: { id: 1 } })
		await fixture.run()
		expect(fixture.createRelease).not.toHaveBeenCalled()
	})

	it('propagates lookup errors instead of treating them as missing releases', async () => {
		const fixture = githubReleaseFixture()
		const error = { status: 403 }
		fixture.getReleaseByTag.mockRejectedValue(error)
		await expect(fixture.run()).rejects.toBe(error)
		expect(fixture.createRelease).not.toHaveBeenCalled()
	})

	it('refuses to create a release if the version tag is missing', async () => {
		const fixture = githubReleaseFixture()
		fixture.getRef.mockRejectedValue(new Error('Missing tag'))
		await expect(fixture.run()).rejects.toThrow('Missing tag')
		expect(fixture.createRelease).not.toHaveBeenCalled()
	})

	it('reports creation failures so a rerun can retry after npm has published', async () => {
		const fixture = githubReleaseFixture()
		fixture.createRelease.mockRejectedValue(new Error('GitHub unavailable'))
		await expect(fixture.run()).rejects.toThrow('GitHub unavailable')
	})
})

function inReleaseRepository(run: (directory: string, output: string) => void) {
	const directory = mkdtempSync(join(tmpdir(), 'checkmate-release-'))
	const output = join(directory, 'github-output')
	try {
		writeFileSync(join(directory, 'package.json'), JSON.stringify({ name: 'release-fixture', version: '0.6.1' }))
		writeFileSync(
			join(directory, 'package-lock.json'),
			JSON.stringify({
				name: 'release-fixture',
				version: '0.6.1',
				lockfileVersion: 3,
				packages: { '': { name: 'release-fixture', version: '0.6.1' } },
			})
		)
		for (const args of [
			['init'],
			['config', 'user.name', 'Release test'],
			['config', 'user.email', 'release@example.com'],
			['add', 'package.json', 'package-lock.json'],
			['commit', '-m', 'Initial version'],
		]) {
			execFileSync('git', args, { cwd: directory, stdio: 'pipe' })
		}
		run(directory, output)
	} finally {
		rmSync(directory, { recursive: true, force: true })
	}
}

function prepareVersion(directory: string, output: string) {
	writeFileSync(output, '')
	return execFileSync('bash', ['-e', '-o', 'pipefail', '-c', versionScript], {
		cwd: directory,
		env: { ...process.env, GITHUB_OUTPUT: output, RELEASE_SOURCE: 'pull-request-12' },
		stdio: 'pipe',
	})
}

describe('Patch release preparation', () => {
	it('bumps both package manifests once and resumes the committed version', () => {
		inReleaseRepository((directory, output) => {
			prepareVersion(directory, output)
			execFileSync('npm', ['install', '--ignore-scripts', '--no-audit', '--no-fund'], {
				cwd: directory,
				stdio: 'pipe',
			})
			const packageJson = JSON.parse(readFileSync(join(directory, 'package.json'), 'utf8'))
			const lock = JSON.parse(readFileSync(join(directory, 'package-lock.json'), 'utf8'))
			expect(packageJson.version).toBe('0.6.2')
			expect(lock.version).toBe('0.6.2')
			expect(lock.packages[''].version).toBe('0.6.2')
			expect(readFileSync(output, 'utf8')).toContain('resume=false')
			execFileSync('git', ['add', 'package.json', 'package-lock.json'], { cwd: directory })
			execFileSync('git', ['commit', '-m', 'Release', '-m', 'Release-Source: pull-request-12'], {
				cwd: directory,
				stdio: 'pipe',
			})
			prepareVersion(directory, output)
			expect(readFileSync(output, 'utf8')).toContain('resume=true\nversion=0.6.2')
		})
	})

	it('does not confuse release markers for PR 12 and PR 123', () => {
		inReleaseRepository((directory, output) => {
			execFileSync('git', ['commit', '--allow-empty', '-m', 'Release-Source: pull-request-123'], {
				cwd: directory,
				stdio: 'pipe',
			})
			prepareVersion(directory, output)
			expect(readFileSync(output, 'utf8')).toContain('resume=false\nversion=0.6.2')
		})
	})

	it.each([
		{ resume: 'true', version: '0.6.2', published: 'true' },
		{ resume: 'false', version: '0.6.3', published: 'false' },
	])('detects registry state for version $version on resume=$resume', ({ resume, version, published }) => {
		inReleaseRepository((directory, output) => {
			writeFileSync(output, '')
			writeFileSync(join(directory, 'npm-versions.json'), JSON.stringify(['0.6.1', '0.6.2']))
			const nodeScript = registryScript.split("node --input-type=module <<'NODE'\n")[1].split('\nNODE')[0]
			execFileSync('node', ['--input-type=module', '-e', nodeScript], {
				env: {
					...process.env,
					RUNNER_TEMP: directory,
					GITHUB_OUTPUT: output,
					RELEASE_RESUME: resume,
					RELEASE_VERSION: version,
				},
			})
			expect(readFileSync(output, 'utf8')).toBe(`published=${published}\n`)
		})
	})

	it('rejects an occupied version when starting a new release', () => {
		inReleaseRepository((directory, output) => {
			writeFileSync(output, '')
			writeFileSync(join(directory, 'npm-versions.json'), JSON.stringify(['0.6.1', '0.6.2']))
			const nodeScript = registryScript.split("node --input-type=module <<'NODE'\n")[1].split('\nNODE')[0]
			expect(() =>
				execFileSync('node', ['--input-type=module', '-e', nodeScript], {
					stdio: 'pipe',
					env: {
						...process.env,
						RUNNER_TEMP: directory,
						GITHUB_OUTPUT: output,
						RELEASE_RESUME: 'false',
						RELEASE_VERSION: '0.6.2',
					},
				})
			).toThrow('The next patch is already on npm')
			expect(readFileSync(output, 'utf8')).toBe('')
		})
	})
})
