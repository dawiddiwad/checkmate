import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { cp, mkdtemp, readdir, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { root } from './support.ts'

// Claude Code copies the marketplace source directory into its plugin cache.
// It does not run npm install. This check copies the same directory outside the
// repository, so no development node_modules can resolve.
const directory = await mkdtemp(join(tmpdir(), 'checkmate-plugin-'))
try {
	const marketplace = JSON.parse(await readFile(join(root, '.claude-plugin/marketplace.json'), 'utf8'))
	const entry = marketplace.plugins.find((plugin: { name: string }) => plugin.name === 'checkmate')
	assert.equal(entry.source, './plugin')
	const source = join(directory, 'checkmate')
	await cp(join(root, entry.source), source, { recursive: true })

	assert.deepEqual((await readdir(source)).sort(), [
		'.claude-plugin',
		'bin',
		'contracts',
		'package.json',
		'references',
		'skills',
		'src',
	])
	const pkg = JSON.parse(await readFile(join(source, 'package.json'), 'utf8'))
	assert.deepEqual(pkg, { private: true, type: 'module' })

	const manifest = JSON.parse(await readFile(join(source, '.claude-plugin/plugin.json'), 'utf8'))
	const project = JSON.parse(await readFile(join(root, 'package.json'), 'utf8'))
	assert.equal(manifest.version, project.version)
	assert.equal(entry.version, project.version)
	assert.equal(
		execFileSync(process.execPath, [join(source, 'bin/checkmate.ts'), '--version'], { encoding: 'utf8' }).trim(),
		manifest.version
	)
	const validated = execFileSync(
		process.execPath,
		[join(source, 'bin/checkmate.ts'), 'validate', 'plan-request.json'],
		{ cwd: join(root, 'docs/examples'), encoding: 'utf8' }
	)
	assert.equal(JSON.parse(validated).valid, true)
	for (const name of ['setup', 'plan', 'revise', 'execute', 'report'])
		await readFile(join(source, `skills/${name}/SKILL.md`))
	console.log('The copied plugin runs without npm install, a build step, or development dependencies.')
} finally {
	await rm(directory, { recursive: true, force: true })
}
