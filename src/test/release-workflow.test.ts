import { execFileSync } from 'node:child_process'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import process from 'node:process'
import { runInNewContext } from 'node:vm'
import { parse } from 'yaml'
import { describe, expect, it } from 'vitest'

const workflow = parse(readFileSync(new URL('../../.github/workflows/ci.yml', import.meta.url), 'utf8'))
const versionScript = workflow.jobs.publish.steps.find((step: { id?: string }) => step.id === 'version').run
const registryScript = workflow.jobs.publish.steps.find((step: { id?: string }) => step.id === 'registry').run

describe('Publish triggers', () => {
	it.each([
		{ event: 'pull_request_target', merged: true, branch: 'main', publish: true },
		{ event: 'pull_request_target', merged: false, branch: 'main', publish: false },
		{ event: 'pull_request_target', merged: true, branch: 'develop', publish: false },
		{ event: 'pull_request', merged: true, branch: 'main', publish: false },
		{ event: 'workflow_dispatch', merged: false, branch: 'main', publish: true },
		{ event: 'workflow_dispatch', merged: false, branch: 'develop', publish: false },
	])('publishes=$publish for $event on $branch with merged=$merged', ({ event, merged, branch, publish }) => {
		const github = {
			event_name: event,
			ref: `refs/heads/${branch}`,
			event: {
				repository: { default_branch: 'main' },
				pull_request: { merged, base: { ref: branch } },
			},
		}
		expect(
			runInNewContext(workflow.jobs.publish.if, {
				github,
				format: (pattern: string, value: string) => pattern.replace('{0}', value),
			})
		).toBe(publish)
	})

	it('handles only closed PRs with the privileged trigger and checks out the default branch', () => {
		expect(workflow.on.pull_request_target.types).toEqual(['closed'])
		expect(workflow.jobs.publish.steps[0].with.ref).toBe('${{ env.RELEASE_BRANCH }}')
		expect(workflow.jobs.publish.env.RELEASE_BRANCH).toBe('${{ github.event.repository.default_branch }}')
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
