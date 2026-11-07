import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { root } from './support.js'
const directory = await mkdtemp(join(tmpdir(), 'checkmate-package-'))
try {
	const output = execFileSync('npm', ['pack', '--ignore-scripts', '--json', '--pack-destination', directory], {
		cwd: root,
		encoding: 'utf8',
	})
	const parsed = JSON.parse(output)
	const packed = Array.isArray(parsed) ? parsed[0] : Object.values(parsed)[0]
	assert(packed.files.some((file) => file.path === '.claude-plugin/plugin.json'))
	assert(packed.files.some((file) => file.path === 'skills/execute/SKILL.md'))
	assert(
		packed.files.every(
			(file) =>
				!file.path.startsWith('test/') && !file.path.startsWith('src/ai/') && !file.path.startsWith('dist/')
		)
	)
	await writeFile(join(directory, 'package.json'), JSON.stringify({ private: true, type: 'module' }))
	execFileSync(
		'npm',
		['install', '--ignore-scripts', '--no-audit', '--no-fund', '--omit=dev', join(directory, packed.filename)],
		{ cwd: directory, stdio: 'pipe' }
	)
	const installed = join(directory, 'node_modules/@xoxoai/checkmate')
	const version = execFileSync(process.execPath, [join(installed, 'bin/checkmate.js'), '--version'], {
		encoding: 'utf8',
	}).trim()
	assert.equal(version, '0.7.0')
	assert.equal(JSON.parse(await readFile(join(installed, '.claude-plugin/plugin.json'))).version, version)
	execFileSync(
		process.execPath,
		[
			'--input-type=module',
			'-e',
			"import {schema, planCheck} from '@xoxoai/checkmate'; if(!schema('plan').properties || typeof planCheck !== 'function') process.exit(1)",
		],
		{ cwd: directory }
	)
	for (const name of ['setup', 'plan', 'revise', 'execute', 'report'])
		await readFile(join(installed, `skills/${name}/SKILL.md`))
	console.log('Installed package exports, CLI, schemas, and plugin assets passed.')
} finally {
	await rm(directory, { recursive: true, force: true })
}
