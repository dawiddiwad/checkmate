import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { mkdtemp, rm, readFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { root } from './support.js'
const directory = await mkdtemp(join(tmpdir(), 'checkmate-plugin-'))
try {
	const source = join(directory, 'plugin')
	await import('node:fs/promises').then(async (fs) => {
		await fs.mkdir(source)
		for (const path of [
			'src',
			'bin',
			'contracts',
			'skills',
			'references',
			'.claude-plugin',
			'package.json',
			'package-lock.json',
		]) {
			await fs.cp(join(root, path), join(source, path), { recursive: true })
		}
	})
	execFileSync('npm', ['ci', '--omit=dev', '--no-audit', '--no-fund'], { cwd: source, stdio: 'pipe' })
	const pkg = JSON.parse(await readFile(join(source, 'package.json'), 'utf8'))
	assert.equal(pkg.private, true)
	for (const field of ['bin', 'exports', 'files', 'publishConfig']) assert.equal(pkg[field], undefined)
	assert.equal(
		execFileSync(process.execPath, [join(source, 'bin/checkmate.ts'), '--version'], { encoding: 'utf8' }).trim(),
		pkg.version
	)
	execFileSync(
		process.execPath,
		[
			'--input-type=module',
			'-e',
			"import {schema} from './src/index.ts'; if(!schema('plan').properties) process.exit(1)",
		],
		{ cwd: source }
	)
	const manifest = JSON.parse(await readFile(join(source, '.claude-plugin/plugin.json'), 'utf8'))
	const marketplace = JSON.parse(await readFile(join(source, '.claude-plugin/marketplace.json'), 'utf8'))
	assert.equal(manifest.version, pkg.version)
	assert.equal(marketplace.plugins[0].version, pkg.version)
	for (const name of ['setup', 'plan', 'revise', 'execute', 'report'])
		await readFile(join(source, `skills/${name}/SKILL.md`))
	console.log('Clean plugin install and native TypeScript execution passed. No build or npm package was used.')
} finally {
	await rm(directory, { recursive: true, force: true })
}
