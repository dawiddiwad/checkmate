import { describe, expect, it, vi } from 'vitest'
import { z } from 'zod/v4'
import type { DriverDescriptorV1 } from '../../contracts/types'
import { defineDriverTool, type DriverSession, type DriverToolContext } from '../../driver'
import { DriverContractError, validateDriverSession } from '../../drivers/loader'

const descriptor = {
	schemaVersion: 1,
	id: 'fixture',
	driverContractVersion: 1,
	targetSchema: { type: 'object' },
	settingsSchema: { type: 'object' },
	requiredSecretSlots: [],
	tools: [{ name: 'fixture_read' }, { name: 'fixture_write' }],
	evidenceKinds: [],
} as const satisfies DriverDescriptorV1

function tool(name: string) {
	return defineDriverTool({
		name,
		description: name,
		schema: z.object({}).strict(),
		handler: vi.fn(() => 'ok'),
	})
}

function session(names: string[]): DriverSession {
	return {
		tools: names.map(tool),
		instructions: [],
		buildInitialContext: async () => [],
		handleToolResponses: async () => [],
		close: async () => undefined,
	}
}

describe('driver contract validation', () => {
	it('exposes structured generation through the tool helper and preserves exact parity', async () => {
		const generateStructured = vi.fn().mockResolvedValue({ value: 'ready' })
		const generationTool = defineDriverTool({
			name: 'fixture_read',
			description: 'read',
			schema: z.object({}).strict(),
			handler: async (_args, context) => {
				const typed: DriverToolContext = context
				return JSON.stringify(await typed.generateStructured({ messages: [], schemaName: 'fact', schema: {} }))
			},
		})
		const context: DriverToolContext = {
			step: { id: 'step', action: 'read', expect: 'ready' },
			turn: 1,
			signal: new AbortController().signal,
			generateStructured,
		}
		await generationTool.execute({}, context)
		expect(generateStructured).toHaveBeenCalledOnce()
		const generationSession = { ...session([]), tools: [generationTool, tool('fixture_write')] }
		expect(validateDriverSession(generationSession, descriptor, ['fixture_read'])).toEqual([generationTool])
		expect(() =>
			validateDriverSession({ ...generationSession, tools: [generationTool] }, descriptor, ['fixture_read'])
		).toThrow('missing runtime tools')
	})

	it('requires exact descriptor parity before applying the policy allowlist', () => {
		const selected = validateDriverSession(session(['fixture_read', 'fixture_write']), descriptor, ['fixture_read'])
		expect(selected.map((entry) => entry.definition.name)).toEqual(['fixture_read'])
	})

	it.each([
		[['fixture_read'], /missing runtime tools/],
		[['fixture_read', 'fixture_write', 'fixture_extra'], /undeclared runtime tools/],
		[['fixture_read', 'fixture_read'], /Duplicate runtime driver tool/],
		[['fixture_read', 'pass_test_step'], /reserved harness tool/],
	] as const)('rejects invalid runtime tool sets', (names, message) => {
		expect(() => validateDriverSession(session([...names]), descriptor, '*')).toThrow(message)
	})

	it('rejects policy names that the descriptor does not declare', () => {
		expect(() =>
			validateDriverSession(session(['fixture_read', 'fixture_write']), descriptor, ['fixture_unknown'])
		).toThrow(DriverContractError)
	})

	it('rejects duplicate names in the static descriptor even when runtime names are unique', () => {
		const duplicateDescriptor: DriverDescriptorV1 = {
			...descriptor,
			tools: [{ name: 'fixture_read' }, { name: 'fixture_read' }],
		}
		expect(() => validateDriverSession(session(['fixture_read']), duplicateDescriptor, '*')).toThrow(
			/Descriptor declares duplicate driver tool/
		)
	})

	it('keeps assertion fields out of the public driver result type', async () => {
		const driverTool = tool('fixture_read')
		const result = await driverTool.execute(
			{},
			{
				step: { id: 'step', action: 'read', expect: 'value' },
				turn: 1,
				signal: new AbortController().signal,
				generateStructured: vi.fn(),
			}
		)
		expect(result).toBe('ok')
	})
})
