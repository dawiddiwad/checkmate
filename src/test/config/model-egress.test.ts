import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { resolve } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { prepareRun } from '../../api/prepare-run.js'
import { resolveModelEgress } from '../../config/model-egress.js'
import { validateRequest } from '../../contracts/validator.js'
import { fixtureManifest, fixtureRequest, writeStaticEnvironment } from '../fixtures/static-environment.js'

const directories: string[] = []

afterEach(async () => {
	await Promise.all(directories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })))
})

describe('model egress policy', () => {
	it('copies the operator policy without a secret value and freezes the result', () => {
		const egress = resolveModelEgress(fixtureManifest.policies.ci)

		expect(egress).toEqual(fixtureManifest.policies.ci.modelEgress)
		expect(JSON.stringify(egress)).not.toContain('provider-secret')
		expect(Object.isFrozen(egress)).toBe(true)
		expect(Object.isFrozen(egress.provider)).toBe(true)
	})

	it('keeps prepared model egress invariant across every request-owned field', async () => {
		const root = await environment()
		const baseline = await prepareRun(fixtureRequest, { cwd: root, readEnvironment: () => 'available' })
		const changedRequest = structuredClone(fixtureRequest)
		changedRequest.scenario.id = 'different-scenario'
		changedRequest.scenario.name = 'Different scenario name'
		changedRequest.scenario.driver.target = { endpoint: 'https://different.example.test' }
		changedRequest.scenario.limits = { timeoutMs: 90_000, budgetTokens: 100_000 }
		changedRequest.scenario.steps = [
			{ id: 'different-step', action: 'Perform a different action', expect: 'Observe a different result' },
		]
		const changed = await prepareRun(changedRequest, { cwd: root, readEnvironment: () => 'available' })

		expect(baseline.ok).toBe(true)
		expect(changed.ok).toBe(true)
		if (baseline.ok === false || changed.ok === false) return
		expect(changed.prepared.modelEgress).toEqual(baseline.prepared.modelEgress)
		expect(changed.prepared.effectiveLimits).not.toEqual(baseline.prepared.effectiveLimits)
	})

	it.each([
		'provider',
		'model',
		'baseUrl',
		'apiKeyBinding',
		'temperature',
		'reasoningEffort',
		'textRedaction',
		'allowOpaque',
		'maxStepBytes',
		'maxMessageBytes',
		'budgetUsd',
		'costUsd',
	])('rejects request-level egress or monetary override %s', (field) => {
		const request = structuredClone(fixtureRequest) as unknown as { scenario: Record<string, unknown> }
		request.scenario[field] = field === 'allowOpaque' ? true : 'override'
		expect(validateRequest(request).ok).toBe(false)
	})
})

async function environment(): Promise<string> {
	const root = await mkdtemp(resolve(tmpdir(), 'checkmate-egress-'))
	directories.push(root)
	await writeStaticEnvironment(root)
	return root
}
