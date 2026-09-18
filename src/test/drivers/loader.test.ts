import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { resolve } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { DriverDescriptorV1 } from '../../contracts/types'
import { DriverLoadError, loadValidatedDriver, validateDriverSession } from '../../drivers/loader'
import { silentLogger } from '../../logging/types'

const descriptor: DriverDescriptorV1 = {
	schemaVersion: 1,
	id: 'fixture',
	driverContractVersion: 1,
	targetSchema: { type: 'object' },
	settingsSchema: { type: 'object' },
	requiredSecretSlots: [],
	tools: [],
	evidenceKinds: [],
}

const directories: string[] = []

afterEach(async () => {
	await Promise.all(directories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })))
})

describe('runtime driver loading', () => {
	it('accepts the named version 1 export matching static descriptor identity', async () => {
		const start = vi.fn()
		const importModule = vi.fn(async () => ({
			checkmateDriver: { id: 'fixture', driverContractVersion: 1, start },
		}))

		const driver = await loadValidatedDriver({
			invocationRoot: process.cwd(),
			packageName: 'openai',
			descriptor,
			importModule,
		})

		expect(driver.start).toBe(start)
		expect(importModule).toHaveBeenCalledWith(expect.stringMatching(/^file:/))
	})

	it.each([
		[{}, /must export a 'checkmateDriver'/],
		[{ checkmateDriver: { id: 'other', driverContractVersion: 1, start: vi.fn() } }, /does not match descriptor/],
		[{ checkmateDriver: { id: 'fixture', driverContractVersion: 2, start: vi.fn() } }, /Unsupported/],
		[{ checkmateDriver: { id: 'fixture', driverContractVersion: 3, start: vi.fn() } }, /Unsupported/],
		[{ checkmateDriver: { id: 'fixture', driverContractVersion: '1', start: vi.fn() } }, /Unsupported/],
	] as const)('rejects executable modules that disagree with static metadata', async (module, message) => {
		await expect(
			loadValidatedDriver({
				invocationRoot: process.cwd(),
				packageName: 'openai',
				descriptor,
				importModule: async () => module,
			})
		).rejects.toThrow(message)
	})

	it('wraps module resolution and import failures', async () => {
		await expect(
			loadValidatedDriver({
				invocationRoot: process.cwd(),
				packageName: '@missing/checkmate-driver',
				descriptor,
			})
		).rejects.toBeInstanceOf(DriverLoadError)
	})

	it('loads an installed package and validates its runtime tool parity', async () => {
		const root = await mkdtemp(resolve(tmpdir(), 'checkmate-driver-loader-'))
		directories.push(root)
		const packageDirectory = resolve(root, 'node_modules/@fixture/driver')
		await mkdir(packageDirectory, { recursive: true })
		await writeFile(resolve(root, 'package.json'), JSON.stringify({ private: true, type: 'module' }))
		await writeFile(
			resolve(packageDirectory, 'package.json'),
			JSON.stringify({ name: '@fixture/driver', version: '1.0.0', type: 'module', exports: './index.js' })
		)
		await writeFile(
			resolve(packageDirectory, 'index.js'),
			`export const checkmateDriver = {
			  id: 'fixture',
			  driverContractVersion: 1,
			  async start() {
			    return {
			      tools: [{
			        definition: { name: 'fixture_action', description: 'act', parameters: { type: 'object' }, strict: true },
			        execute() { return 'ok' }
			      }],
			      instructions: [],
			      async buildInitialContext() { return [] },
			      async handleToolResponses() { return [] },
			      async close() {}
			    }
			  }
			}
			`
		)
		const installedDescriptor: DriverDescriptorV1 = {
			...descriptor,
			tools: [{ name: 'fixture_action' }],
		}

		const driver = await loadValidatedDriver({
			invocationRoot: root,
			packageName: '@fixture/driver',
			descriptor: installedDescriptor,
		})
		expect(driver.driverContractVersion).toBe(1)
		const session = await driver.start({
			target: {},
			settings: {},
			secrets: { read: () => '' },
			evidence: { capture: async () => ({ status: 'discarded' }) },
			logger: silentLogger,
			signal: new AbortController().signal,
			allowlistedTools: ['fixture_action'],
			diagnostics: { sanitizeText: (value) => value },
		})

		expect(validateDriverSession(session, installedDescriptor, '*').map((tool) => tool.definition.name)).toEqual([
			'fixture_action',
		])
	})
})
