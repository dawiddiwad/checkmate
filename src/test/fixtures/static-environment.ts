import { mkdir, symlink, writeFile } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import type { CheckmateManifestV1, RunRequestV1 } from '../../contracts/types.js'

export const fixtureManifest: CheckmateManifestV1 = {
	schemaVersion: 1,
	outputDirectory: '.checkmate/runs',
	defaultPolicy: 'ci',
	secretBindings: {
		'provider-key': { source: 'environment', name: 'CHECKMATE_TEST_PROVIDER_KEY' },
		'fixture-session': { source: 'environment', name: 'CHECKMATE_TEST_DRIVER_SESSION' },
	},
	policies: {
		ci: {
			modelEgress: {
				provider: { id: 'openai', model: 'fixture-model', apiKeyBinding: 'provider-key', temperature: 0 },
				textRedaction: 'on',
				allowOpaque: false,
				maxStepBytes: 1_048_576,
				maxMessageBytes: 262_144,
			},
			bounds: {
				scenarioTimeoutMs: 180_000,
				stepTimeoutMs: 120_000,
				turnsPerStep: 20,
				requestTimeoutMs: 60_000,
				maxRetries: 3,
				loopMaxRepetitions: 5,
				cleanupTimeoutMs: 10_000,
				budgetTokens: 200_000,
			},
			evidence: { retention: 'retain-on-failure', redaction: 'on', allowOpaque: false },
			drivers: {
				fixture: { settings: { readOnly: true }, tools: { allowed: ['*'] } },
			},
		},
	},
	drivers: {
		fixture: {
			package: '@checkmate-test/throwing-driver',
			secrets: { session: 'fixture-session' },
		},
	},
}

export const fixtureRequest: RunRequestV1 = {
	schemaVersion: 1,
	scenario: {
		id: 'fixture-scenario',
		driver: { id: 'fixture', target: { endpoint: 'https://example.test' } },
		policy: 'ci',
		steps: [{ id: 'inspect', action: 'Inspect the fixture', expect: 'The fixture is readable' }],
	},
}

export async function writeStaticEnvironment(root: string, configPath = 'checkmate.config.json'): Promise<void> {
	const manifestPath = resolve(root, configPath)
	await mkdir(dirname(manifestPath), { recursive: true })
	await writeFile(manifestPath, `${JSON.stringify(fixtureManifest, null, 2)}\n`)
	await writeFile(resolve(root, 'request.json'), `${JSON.stringify(fixtureRequest, null, 2)}\n`)

	const packageDirectory = resolve(root, 'node_modules/@checkmate-test')
	await mkdir(packageDirectory, { recursive: true })
	await symlink(
		new URL('./drivers/throwing-driver', import.meta.url),
		resolve(packageDirectory, 'throwing-driver'),
		'dir'
	)
}
