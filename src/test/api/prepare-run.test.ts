import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { resolve } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { describeEnvironment, prepareRun, prepareRunSource } from '../../api/prepare-run.js'
import { validateDescribeResult } from '../../contracts/validator.js'
import { fixtureManifest, fixtureRequest, writeStaticEnvironment } from '../fixtures/static-environment.js'

const directories: string[] = []

afterEach(async () => {
	await Promise.all(directories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })))
})

describe('static environment preparation', () => {
	it('prepares an immutable non-secret plan without importing executable driver code', async () => {
		const root = await environment()
		const result = await prepareRun(fixtureRequest, {
			cwd: root,
			readEnvironment: () => 'provider-secret',
		})

		expect(result.ok).toBe(true)
		if (result.ok === false) return
		expect(result.prepared.driver.packageName).toBe('@checkmate-test/throwing-driver')
		expect(result.prepared.driver.allowedTools).toBe('*')
		expect(result.prepared.outputDirectory).toBe(resolve(root, '.checkmate/runs'))
		expect(JSON.stringify(result.prepared)).not.toContain('provider-secret')
		expect(Object.isFrozen(result.prepared)).toBe(true)
		expect(Object.isFrozen(result.prepared.request.scenario.steps)).toBe(true)
	})

	it('anchors package and output lookup to cwd when config is elsewhere', async () => {
		const root = await environment('environments/ci.checkmate.json')
		const result = await prepareRun(fixtureRequest, {
			cwd: root,
			configPath: 'environments/ci.checkmate.json',
			readEnvironment: () => 'available',
		})

		expect(result).toMatchObject({
			ok: true,
			prepared: { invocationRoot: root, outputDirectory: resolve(root, '.checkmate/runs') },
		})
	})

	it('reports all duplicate, limit, target, and secret defects without allocating output', async () => {
		const root = await environment()
		const request = structuredClone(fixtureRequest)
		request.scenario.steps.push({ ...request.scenario.steps[0], action: 'again' })
		request.scenario.limits = { timeoutMs: 180_001 }
		request.scenario.driver.target = { endpoint: 'not-a-url' }

		const result = await prepareRun(request, { cwd: root, readEnvironment: () => undefined })
		expect(result.ok).toBe(false)
		if (result.ok === true) return
		expect(result.diagnostics.map((diagnostic) => diagnostic.code)).toEqual([
			'request.duplicate-step-id',
			'schema.format',
			'policy.limit-increase',
			'secret.unavailable',
			'secret.unavailable',
		])
		await expect(readFile(resolve(root, '.checkmate/runs'))).rejects.toThrow()
	})

	it('describes static metadata without probing secrets', async () => {
		const root = await environment()
		const readEnvironment = vi.fn(() => {
			throw new Error('describe must not probe secrets')
		})
		const result = await describeEnvironment({ cwd: root, readEnvironment })

		expect(result.status).toBe('available')
		expect(validateDescribeResult(result).ok).toBe(true)
		expect(readEnvironment).not.toHaveBeenCalled()
		if (result.status !== 'available') return
		expect(result.environment.policies[0].requiredSecretBindings).toEqual(['fixture-session', 'provider-key'])
		expect(result.environment.drivers[0].tools).toEqual([{ name: 'fixture_read' }])
	})

	it('does not silently clamp excessive request bounds', async () => {
		const root = await environment()
		const request = structuredClone(fixtureRequest)
		request.scenario.limits = { budgetTokens: 200_001 }
		const result = await prepareRun(request, { cwd: root, readEnvironment: () => 'available' })
		expect(result).toMatchObject({
			ok: false,
			diagnostics: [{ code: 'policy.limit-increase', path: '/scenario/limits/budgetTokens' }],
		})
	})

	it('rejects incomplete descriptor secret mappings', async () => {
		const root = await environment()
		const manifest = structuredClone(fixtureManifest)
		manifest.drivers.fixture.secrets = {}
		await writeFile(resolve(root, 'checkmate.config.json'), JSON.stringify(manifest))
		const result = await prepareRun(fixtureRequest, { cwd: root, readEnvironment: () => 'available' })
		expect(result).toMatchObject({ ok: false, diagnostics: [{ code: 'driver.missing-secret-slot' }] })
	})

	it('rejects duplicate static descriptor tool names before executable loading', async () => {
		const root = await environment()
		const descriptor = JSON.parse(
			await readFile(
				new URL('../fixtures/drivers/throwing-driver/checkmate-driver.json', import.meta.url),
				'utf8'
			)
		)
		descriptor.tools.push({ ...descriptor.tools[0] })
		const descriptorPath = resolve(root, 'duplicate-descriptor.json')
		await writeFile(descriptorPath, JSON.stringify(descriptor))

		const result = await prepareRun(fixtureRequest, {
			cwd: root,
			readEnvironment: () => 'available',
			resolveDescriptorPath: () => ({ ok: true, value: descriptorPath }),
		})

		expect(result).toMatchObject({
			ok: false,
			diagnostics: [{ code: 'schema.uniqueItems', path: '/drivers/fixture/tools' }],
		})
	})

	it('accepts hostile names only when every referenced record owns them', async () => {
		const root = await environment()
		const policy = structuredClone(fixtureManifest.policies.ci)
		policy.modelEgress.provider.apiKeyBinding = 'toString'
		policy.drivers = JSON.parse(
			`{"__proto__":${JSON.stringify({ settings: { readOnly: true }, tools: { allowed: ['*'] } })}}`
		)
		const manifest: typeof fixtureManifest = {
			...structuredClone(fixtureManifest),
			defaultPolicy: 'constructor',
			secretBindings: JSON.parse(
				'{"toString":{"source":"environment","name":"PROVIDER"},"hasOwnProperty":{"source":"environment","name":"SESSION"}}'
			),
			policies: JSON.parse(`{"constructor":${JSON.stringify(policy)}}`),
			drivers: JSON.parse(
				'{"__proto__":{"package":"@checkmate-test/throwing-driver","secrets":{"constructor":"hasOwnProperty"}}}'
			),
		}
		const descriptor = {
			...JSON.parse(
				await readFile(
					new URL('../fixtures/drivers/throwing-driver/checkmate-driver.json', import.meta.url),
					'utf8'
				)
			),
			id: '__proto__',
			requiredSecretSlots: ['constructor'],
		}
		const descriptorPath = resolve(root, 'hostile-descriptor.json')
		await writeFile(resolve(root, 'checkmate.config.json'), JSON.stringify(manifest))
		await writeFile(descriptorPath, JSON.stringify(descriptor))
		const request = structuredClone(fixtureRequest)
		request.scenario.policy = 'constructor'
		request.scenario.driver.id = '__proto__'

		const result = await prepareRun(request, {
			cwd: root,
			readEnvironment: () => 'available',
			resolveDescriptorPath: () => ({ ok: true, value: descriptorPath }),
		})

		expect(result).toMatchObject({
			ok: true,
			prepared: { policy: { id: 'constructor' }, driver: { id: '__proto__' } },
		})
	})

	it('rejects hostile lookup names that exist only on Object.prototype', async () => {
		const root = await environment()
		const request = structuredClone(fixtureRequest)
		request.scenario.policy = 'constructor'

		const result = await prepareRun(request, { cwd: root, readEnvironment: () => 'available' })

		expect(result).toMatchObject({ ok: false, diagnostics: [{ code: 'policy.unavailable' }] })
	})

	it('accumulates manifest and request acquisition diagnostics in phase order', async () => {
		const root = await mkdtemp(resolve(tmpdir(), 'checkmate-static-invalid-'))
		directories.push(root)
		await writeFile(resolve(root, 'checkmate.config.json'), '{ invalid manifest')
		await writeFile(resolve(root, 'request.json'), '{ invalid request')

		const result = await prepareRunSource({ kind: 'file', path: resolve(root, 'request.json') }, { cwd: root })

		expect(result).toMatchObject({
			ok: false,
			status: 'invalid',
			diagnostics: [
				{ code: 'input.invalid-json', path: '' },
				{ code: 'input.invalid-json', path: '/request' },
			],
		})
	})
})

async function environment(configPath?: string): Promise<string> {
	const root = await mkdtemp(resolve(tmpdir(), 'checkmate-static-'))
	directories.push(root)
	await writeStaticEnvironment(root, configPath)
	return root
}
