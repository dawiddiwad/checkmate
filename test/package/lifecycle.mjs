import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { chmod, cp, mkdir, mkdtemp, readFile, readdir, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, extname, relative, resolve } from 'node:path'
import process from 'node:process'
import { fileURLToPath } from 'node:url'

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../..')
assert(
	process.argv.length <= 3 && (!process.argv[2] || process.argv[2] === '--live'),
	'usage: npm run phase:verify -- [--live]'
)
const live = process.argv[2] === '--live'
const packageJson = JSON.parse(await readFile(resolve(repositoryRoot, 'package.json'), 'utf8'))
const schemaFiles = [
	'checkmate-config.v1.json',
	'run-request.v1.json',
	'run-result.v1.json',
	'validation-result.v1.json',
	'describe-result.v1.json',
	'driver-descriptor.v1.json',
]

assert.equal(packageJson.scripts.prepack, 'npm run build:package')
assert(!packageJson.scripts['build:package'].includes('npm pack'))
assert(!packageJson.scripts['build:package'].includes('phase:verify'))
assert(!packageJson.scripts['build:package'].includes('test:'))

await verifyNormalPrepack()

for (const script of ['compile:check', 'lint:check', 'format:check', 'test:unit:run', 'build:package']) {
	run('npm', ['run', script])
}

await verifyCopiedAssets(repositoryRoot)

const packDirectory = await mkdtemp(resolve(tmpdir(), 'checkmate-pack-'))
try {
	const packOutput = run('npm', ['pack', '--ignore-scripts', '--json', '--pack-destination', packDirectory])
	const packResult = JSON.parse(packOutput)[0]
	const actualFiles = packResult.files.map((file) => file.path).sort()
	const expectedFiles = await expectedPackageFiles()
	assert(!actualFiles.includes('docs/img/onboarding.gif'))
	assert.deepEqual(actualFiles, expectedFiles)

	const tarball = resolve(packDirectory, packResult.filename)
	run('npm', ['run', 'test:package:final', '--', tarball, ...(live ? ['--live'] : [])], { stdio: 'inherit' })
} finally {
	await rm(packDirectory, { recursive: true, force: true })
}

function run(command, args, options = {}) {
	return execFileSync(command, args, {
		cwd: repositoryRoot,
		encoding: 'utf8',
		stdio: options.stdio ?? ['ignore', 'pipe', 'inherit'],
	})
}

async function expectedPackageFiles() {
	const files = [
		'LICENSE',
		'README.md',
		'bin/checkmate.js',
		'docs/CLI.md',
		'docs/CONFIGURATION.md',
		'docs/DRIVERS.md',
		'docs/EVIDENCE.md',
		'package.json',
		'schemas/checkmate-config.v1.json',
		'schemas/describe-result.v1.json',
		'schemas/driver-descriptor.v1.json',
		'schemas/run-request.v1.json',
		'schemas/run-result.v1.json',
		'schemas/validation-result.v1.json',
		'dist/drivers/web/checkmate-driver.json',
	]

	for (const source of await typescriptSources(resolve(repositoryRoot, 'src'))) {
		const sourceRelative = relative(resolve(repositoryRoot, 'src'), source)
		if (sourceRelative.startsWith(`test/`)) continue

		const base = `dist/${sourceRelative.slice(0, -extname(sourceRelative).length)}`
		files.push(`${base}.d.ts`, `${base}.d.ts.map`, `${base}.js`, `${base}.js.map`)
	}

	return files.sort()
}

async function verifyNormalPrepack() {
	const candidate = await mkdtemp(resolve(tmpdir(), 'checkmate-prepack-'))
	try {
		for (const entry of ['package.json', 'tsconfig.json', 'tsconfig.build.json', 'src', 'scripts']) {
			await cp(resolve(repositoryRoot, entry), resolve(candidate, entry), { recursive: true })
		}
		await symlink(resolve(repositoryRoot, 'node_modules'), resolve(candidate, 'node_modules'), 'dir')
		await mkdir(resolve(candidate, 'dist'), { recursive: true })
		await mkdir(resolve(candidate, 'schemas'), { recursive: true })
		await writeFile(resolve(candidate, 'dist/stale.txt'), 'stale')
		await writeFile(resolve(candidate, 'schemas/stale.json'), '{}')

		const instrumentationDirectory = resolve(candidate, '.lifecycle-bin')
		const lifecycleLog = resolve(candidate, 'lifecycle.log')
		await mkdir(instrumentationDirectory)
		await writeFile(
			resolve(instrumentationDirectory, 'npm-wrapper.mjs'),
			`import { appendFileSync } from 'node:fs'\n` +
				`import { spawnSync } from 'node:child_process'\n` +
				`import process from 'node:process'\n` +
				`appendFileSync(process.env.CHECKMATE_LIFECYCLE_LOG, process.argv.slice(2).join(' ') + '\\n')\n` +
				`const prefix = JSON.parse(process.env.CHECKMATE_NPM_PREFIX)\n` +
				`const child = spawnSync(process.env.CHECKMATE_NPM_COMMAND, [...prefix, ...process.argv.slice(2)], { stdio: 'inherit', env: process.env })\n` +
				`process.exit(child.status ?? 1)\n`
		)
		await writeFile(
			resolve(instrumentationDirectory, 'npm'),
			`#!/bin/sh\nexec ${shellQuote(process.execPath)} ${shellQuote(resolve(instrumentationDirectory, 'npm-wrapper.mjs'))} "$@"\n`
		)
		await chmod(resolve(instrumentationDirectory, 'npm'), 0o755)

		const npmInvocation = resolveNpmInvocation()
		execFileSync(npmInvocation.command, [...npmInvocation.prefix, 'run', 'prepack'], {
			cwd: candidate,
			stdio: 'pipe',
			env: {
				...process.env,
				PATH: `${instrumentationDirectory}:${process.env.PATH ?? ''}`,
				CHECKMATE_LIFECYCLE_LOG: lifecycleLog,
				CHECKMATE_NPM_COMMAND: npmInvocation.command,
				CHECKMATE_NPM_PREFIX: JSON.stringify(npmInvocation.prefix),
			},
		})

		const invocations = (await readFile(lifecycleLog, 'utf8')).trim().split('\n')
		assert.deepEqual(invocations, ['run build:package', 'run clean', 'run build:dist'])
		await assert.rejects(readFile(resolve(candidate, 'dist/stale.txt')))
		await assert.rejects(readFile(resolve(candidate, 'schemas/stale.json')))
		await verifyCopiedAssets(candidate)
	} finally {
		await rm(candidate, { recursive: true, force: true })
	}
}

function resolveNpmInvocation() {
	if (process.env.npm_execpath) {
		return { command: process.execPath, prefix: [process.env.npm_execpath] }
	}

	return { command: execFileSync('which', ['npm'], { encoding: 'utf8' }).trim(), prefix: [] }
}

async function verifyCopiedAssets(root) {
	for (const fileName of schemaFiles) {
		const source = await readFile(resolve(root, 'src/contracts/schemas', fileName))
		const destination = await readFile(resolve(root, 'schemas', fileName))
		assert.deepEqual(destination, source, `${fileName} was not copied byte-for-byte`)
	}
	const descriptorSource = await readFile(resolve(root, 'src/drivers/web/checkmate-driver.json'))
	const descriptorDestination = await readFile(resolve(root, 'dist/drivers/web/checkmate-driver.json'))
	assert.deepEqual(descriptorDestination, descriptorSource, 'web descriptor was not copied byte-for-byte')
}

function shellQuote(value) {
	return `'${value.replaceAll("'", `'\\''`)}'`
}

async function typescriptSources(directory) {
	const files = []
	for (const entry of await readdir(directory, { withFileTypes: true })) {
		const path = resolve(directory, entry.name)
		if (entry.isDirectory()) files.push(...(await typescriptSources(path)))
		else if (entry.isFile() && entry.name.endsWith('.ts')) files.push(path)
	}
	return files
}
