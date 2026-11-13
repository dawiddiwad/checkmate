import test from 'node:test'
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { releaseVersion, prepareVersion } from '../scripts/release-version.ts'
import { sandbox, root } from './support.ts'

test('first plugin release keeps 0.7.0; later merges get one patch', () => {
	assert.equal(releaseVersion('0.7.0', ['v0.6.6']), '0.7.0')
	assert.equal(releaseVersion('0.7.0', ['v0.7.0']), '0.7.1')
	assert.equal(releaseVersion('0.7.9', ['v0.7.9']), '0.7.10')
	assert.throws(() => releaseVersion('0.7.0', ['v0.7.1']), /behind/)
	assert.throws(() => releaseVersion('invalid', []), /three-part/)
})

test('the plugin, marketplace, root package, and CLI package have one version', async () => {
	const read = async (path: string) => JSON.parse(await readFile(join(root, path), 'utf8'))
	const version = (await read('package.json')).version
	assert.equal((await read('cli/package.json')).version, version)
	assert.equal((await read('plugin/.claude-plugin/plugin.json')).version, version)
	assert.equal((await read('.claude-plugin/marketplace.json')).plugins[0].version, version)
})

test('release preparation updates all version files without touching npm', async (t) => {
	const workspace = await sandbox(t)
	execFileSync('git', ['init', '-q', workspace])
	await mkdir(join(workspace, 'plugin/.claude-plugin'), { recursive: true })
	await mkdir(join(workspace, '.claude-plugin'))
	await mkdir(join(workspace, 'cli'))
	const paths = [
		'package.json',
		'package-lock.json',
		'cli/package.json',
		'plugin/.claude-plugin/plugin.json',
		'.claude-plugin/marketplace.json',
	]
	for (const path of paths) await writeFile(join(workspace, path), await readFile(join(root, path)))
	execFileSync('git', ['add', '.'], { cwd: workspace })
	execFileSync('git', ['-c', 'user.name=Test', '-c', 'user.email=test@example.test', 'commit', '-qm', 'base'], {
		cwd: workspace,
	})
	const current = JSON.parse(await readFile(join(workspace, 'package.json'), 'utf8')).version
	const expected = releaseVersion(current, [`v${current}`])
	execFileSync('git', ['tag', `v${current}`], { cwd: workspace })
	assert.equal(await prepareVersion(workspace), expected)
	assert.equal(await prepareVersion(workspace), expected)
	for (const path of paths) {
		const data = JSON.parse(await readFile(join(workspace, path), 'utf8'))
		assert.equal(path.includes('marketplace') ? data.plugins[0].version : data.version, expected)
	}
	const pkg = JSON.parse(await readFile(join(workspace, 'package.json'), 'utf8'))
	assert.equal(pkg.private, true)
	assert.equal(pkg.publishConfig, undefined)
})
