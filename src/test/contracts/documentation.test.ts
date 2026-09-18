import { readFile } from 'node:fs/promises'
import { describe, expect, it } from 'vitest'
import { validateManifest, validateRequest, validateRunResult } from '../../contracts/validator.js'
import { validateDriverValue } from '../../drivers/descriptor.js'

describe('documented inspection workflow', () => {
	it('keeps README JSON examples aligned with schemas and the web descriptor', async () => {
		const readme = await readFile(new URL('../../../README.md', import.meta.url), 'utf8')
		const examples = [...readme.matchAll(/```json\n([\s\S]*?)\n```/g)].map((match) => JSON.parse(match[1]))
		expect(examples).toHaveLength(3)
		const [request, result, manifest] = examples
		expect(validateRequest(request).ok).toBe(true)
		expect(validateRunResult(result).ok).toBe(true)
		expect(validateManifest(manifest).ok).toBe(true)
		const descriptor = JSON.parse(
			await readFile(new URL('../../drivers/web/checkmate-driver.json', import.meta.url), 'utf8')
		)
		expect(validateDriverValue(descriptor.targetSchema, request.scenario.driver.target, '/target')).toEqual([])
		expect(
			validateDriverValue(descriptor.settingsSchema, manifest.policies.ci.drivers.web.settings, '/settings')
		).toEqual([])
		expect(result.driver.contractVersion).toBe(descriptor.driverContractVersion)
		for (const step of result.steps) {
			for (const call of step.toolCalls) expect(descriptor.tools).toContainEqual({ name: call.name })
		}
		for (const setting of ['snapshotFilter', 'snapshotTopPercent', 'screenshotsInModelContext']) {
			expect(
				validateDriverValue(descriptor.settingsSchema, { [setting]: false }, '/settings').length
			).toBeGreaterThan(0)
		}
	})
})
