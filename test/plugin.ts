import assert from 'node:assert/strict'
import { execFileSync, spawn } from 'node:child_process'
import { once } from 'node:events'
import { cp, mkdir, mkdtemp, readdir, readFile, rm } from 'node:fs/promises'
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
		'dist',
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
	const bundle = join(source, 'dist/checkmate.js')
	const checkmate = (args: string[], cwd = directory) =>
		execFileSync(process.execPath, [bundle, ...args], { cwd, encoding: 'utf8' }).trim()
	assert.equal(checkmate(['--version']), manifest.version)
	const workspace = join(directory, 'workspace')
	await mkdir(workspace)
	assert.equal(checkmate(['init'], workspace), 'completed .checkmate/checkmate.db')
	assert.equal(checkmate(['plan', 'list'], workspace), 'completed plans count=0')
	for (const name of ['setup', 'plan', 'revise', 'execute', 'report', 'ui'])
		await readFile(join(source, `skills/${name}/SKILL.md`))
	const ui = spawn(process.execPath, [bundle, 'ui', '--workspace', workspace], { cwd: directory })
	try {
		const [first] = (await once(ui.stdout, 'data')) as [Buffer]
		const url = /^completed ui url=(\S+)$/m.exec(first.toString())?.[1]
		assert(url, first.toString())
		for (const path of ['/', '/assets/style.css', '/assets/client.js', '/assets/fonts/inter.woff2'])
			assert.equal((await fetch(new URL(path, url))).status, 200, path)
	} finally {
		ui.kill('SIGTERM')
	}
	console.log('The copied plugin bundle runs without npm install, a build step, or development dependencies.')
} finally {
	await rm(directory, { recursive: true, force: true })
}
