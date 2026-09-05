import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, resolve } from 'node:path'
import process from 'node:process'
import { fileURLToPath } from 'node:url'

const tarballArgument = process.argv[2]
assert(tarballArgument, 'usage: npm run test:package:active -- <candidate.tgz>')

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../..')
const tarball = resolve(process.cwd(), tarballArgument)
const fixtureDirectory = resolve(repositoryRoot, 'src/test/fixtures/contracts')
const installation = await mkdtemp(resolve(tmpdir(), 'checkmate-package-'))

const schemaFixtures = {
	'checkmate-config.v1.json': 'checkmate-config.valid.json',
	'run-request.v1.json': 'run-request.valid.json',
	'run-result.v1.json': 'run-result.valid.json',
	'validation-result.v1.json': 'validation-result.valid.json',
	'describe-result.v1.json': 'describe-result.valid.json',
	'driver-descriptor.v1.json': 'driver-descriptor.valid.json',
}

const probeSource = `
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { createRequire } from 'node:module'
import Ajv2020 from 'ajv/dist/2020.js'
import addFormats from 'ajv-formats'

const core = await import('@xoxoai/checkmate')
const coreSubpath = await import('@xoxoai/checkmate/core')
const playwright = await import('@xoxoai/checkmate/playwright')
const salesforce = await import('@xoxoai/checkmate/salesforce')

assert.equal(typeof core.createRunner, 'function')
assert.equal(core.createRunner, coreSubpath.createRunner)
assert.equal(typeof playwright.createAi, 'function')
assert.equal(typeof salesforce.createSalesforceRunner, 'function')

const require = createRequire(import.meta.url)
const samples = JSON.parse(await readFile(new URL('./samples.json', import.meta.url), 'utf8'))
const ajv = new Ajv2020({ allErrors: true, strict: true })
addFormats(ajv)

for (const [fileName, sample] of Object.entries(samples)) {
	const path = require.resolve('@xoxoai/checkmate/schemas/' + fileName)
	const schema = JSON.parse(await readFile(path, 'utf8'))
	const validate = ajv.compile(schema)
	assert.equal(validate(sample), true, fileName + ': ' + JSON.stringify(validate.errors))
}

const descriptorPath = require.resolve('@xoxoai/checkmate/driver-web/checkmate-driver.json')
const descriptor = JSON.parse(await readFile(descriptorPath, 'utf8'))
const descriptorSchema = JSON.parse(
  await readFile(require.resolve('@xoxoai/checkmate/schemas/driver-descriptor.v1.json'), 'utf8')
)
const descriptorAjv = new Ajv2020({ allErrors: true, strict: true })
addFormats(descriptorAjv)
const validateDescriptor = descriptorAjv.compile(descriptorSchema)
assert.equal(validateDescriptor(descriptor), true, JSON.stringify(validateDescriptor.errors))
assert.equal(descriptor.id, 'web')
assert.equal(descriptor.tools.length, 14)
`

try {
	await writeFile(resolve(installation, 'package.json'), '{"private":true,"type":"module"}\n')
	execFileSync('npm', ['install', '--ignore-scripts', '--no-package-lock', '--no-audit', '--no-fund', tarball], {
		cwd: installation,
		stdio: 'pipe',
		env: { ...process.env, npm_config_cache: resolve(installation, '.npm-cache') },
	})

	const samples = {}
	for (const [schema, fixture] of Object.entries(schemaFixtures)) {
		samples[schema] = JSON.parse(await readFile(resolve(fixtureDirectory, fixture), 'utf8'))
	}
	await writeFile(resolve(installation, 'samples.json'), JSON.stringify(samples))
	await writeFile(resolve(installation, 'probe.mjs'), probeSource)
	execFileSync(process.execPath, ['probe.mjs'], { cwd: installation, stdio: 'inherit' })

	await writeFile(resolve(installation, 'checkmate.config.json'), JSON.stringify(samples['checkmate-config.v1.json']))
	await writeFile(resolve(installation, 'request.json'), JSON.stringify(samples['run-request.v1.json']))
	const binary = resolve(installation, 'node_modules/@xoxoai/checkmate/bin/checkmate.js')
	const describe = JSON.parse(
		execFileSync(process.execPath, [binary, 'describe'], { cwd: installation, encoding: 'utf8' })
	)
	assert.equal(describe.status, 'available')
	assert.equal(describe.environment.drivers[0].id, 'web')
	const validation = JSON.parse(
		execFileSync(process.execPath, [binary, 'validate', 'request.json'], {
			cwd: installation,
			encoding: 'utf8',
			env: { ...process.env, CHECKMATE_OPENAI_API_KEY: 'package-probe-key' },
		})
	)
	assert.equal(validation.status, 'valid')

	const throwingPackage = resolve(installation, 'node_modules/@checkmate-test/throwing-driver')
	await mkdir(throwingPackage, { recursive: true })
	await writeFile(
		resolve(throwingPackage, 'package.json'),
		JSON.stringify({
			name: '@checkmate-test/throwing-driver',
			version: '1.0.0',
			type: 'module',
			exports: { '.': './index.js', './checkmate-driver.json': './checkmate-driver.json' },
		})
	)
	await writeFile(resolve(throwingPackage, 'index.js'), "throw new Error('executable driver was imported')\n")
	await writeFile(
		resolve(throwingPackage, 'checkmate-driver.json'),
		JSON.stringify({
			schemaVersion: 1,
			id: 'fixture',
			driverContractVersion: 1,
			targetSchema: {
				type: 'object',
				additionalProperties: false,
				required: ['endpoint'],
				properties: { endpoint: { type: 'string', format: 'uri' } },
			},
			settingsSchema: {
				type: 'object',
				additionalProperties: false,
				required: ['readOnly'],
				properties: { readOnly: { type: 'boolean' } },
			},
			requiredSecretSlots: [],
			tools: [{ name: 'fixture_read' }],
			evidenceKinds: [],
		})
	)
	const throwingManifest = {
		schemaVersion: 1,
		defaultPolicy: 'ci',
		secretBindings: {
			'provider-key': { source: 'environment', name: 'CHECKMATE_PACKAGE_PROBE_KEY' },
		},
		policies: {
			ci: {
				modelEgress: {
					provider: { id: 'openai', model: 'fixture-model', apiKeyBinding: 'provider-key' },
					textRedaction: 'on',
					allowOpaque: false,
					maxStepBytes: 1048576,
					maxMessageBytes: 262144,
				},
				bounds: {
					scenarioTimeoutMs: 180000,
					stepTimeoutMs: 120000,
					turnsPerStep: 20,
					requestTimeoutMs: 60000,
					maxRetries: 3,
					loopMaxRepetitions: 5,
					cleanupTimeoutMs: 10000,
				},
				evidence: { retention: 'retain-on-failure', redaction: 'on', allowOpaque: false },
				drivers: { fixture: { settings: { readOnly: true }, tools: { allowed: ['*'] } } },
			},
		},
		drivers: { fixture: { package: '@checkmate-test/throwing-driver', secrets: {} } },
	}
	const throwingRequest = {
		schemaVersion: 1,
		scenario: {
			id: 'installed-static-probe',
			driver: { id: 'fixture', target: { endpoint: 'https://example.test' } },
			steps: [{ id: 'probe', action: 'Inspect the fixture', expect: 'The fixture is available' }],
		},
	}
	await writeFile(resolve(installation, 'checkmate.config.json'), JSON.stringify(throwingManifest))
	await writeFile(resolve(installation, 'request.json'), JSON.stringify(throwingRequest))
	const staticEnvironment = JSON.parse(
		execFileSync(process.execPath, [binary, 'describe'], { cwd: installation, encoding: 'utf8' })
	)
	assert.equal(staticEnvironment.status, 'available')
	assert.equal(staticEnvironment.environment.drivers[0].id, 'fixture')
	const staticValidation = JSON.parse(
		execFileSync(process.execPath, [binary, 'validate', 'request.json'], {
			cwd: installation,
			encoding: 'utf8',
			env: { ...process.env, CHECKMATE_PACKAGE_PROBE_KEY: 'package-probe-key' },
		})
	)
	assert.equal(staticValidation.status, 'valid')
} finally {
	await rm(installation, { recursive: true, force: true })
}
