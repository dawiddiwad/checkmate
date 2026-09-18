import { createRequire } from 'node:module'
import { resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import type { DriverDescriptorV1 } from '../contracts/types.js'
import type { CheckmateDriverV1, DriverSession, DriverTool } from '../driver.js'
import { StepResultTool } from '../tools/step/result-tool.js'

export const RESERVED_TOOL_NAMES = new Set<string>([
	StepResultTool.TOOL_FAIL_TEST_STEP,
	StepResultTool.TOOL_PASS_TEST_STEP,
])

export class DriverContractError extends Error {
	constructor(message: string) {
		super(message)
		this.name = 'DriverContractError'
	}
}

export class DriverLoadError extends Error {
	constructor(message: string, options?: ErrorOptions) {
		super(message, options)
		this.name = 'DriverLoadError'
	}
}

export type DriverModuleImporter = (specifier: string) => Promise<unknown>

export async function loadValidatedDriver(input: {
	invocationRoot: string
	packageName: string
	descriptor: DriverDescriptorV1
	importModule?: DriverModuleImporter
}): Promise<CheckmateDriverV1> {
	let module: unknown
	try {
		const specifier = resolveDriverModule(input.invocationRoot, input.packageName)
		module = await (input.importModule ?? importDriverModule)(specifier)
	} catch (error) {
		throw new DriverLoadError(`Could not load registered driver package '${input.packageName}'`, { cause: error })
	}

	const driver = readDriverExport(module)
	if (!driver) {
		throw new DriverLoadError(
			`Registered driver package '${input.packageName}' must export a 'checkmateDriver' object`
		)
	}
	if (driver.id !== input.descriptor.id) {
		throw new DriverLoadError(
			`Runtime driver id '${driver.id}' does not match descriptor id '${input.descriptor.id}'`
		)
	}
	if (driver.driverContractVersion !== 1) {
		throw new DriverLoadError('Unsupported runtime driver contract version')
	}
	if (driver.driverContractVersion !== input.descriptor.driverContractVersion) {
		throw new DriverLoadError(
			`Runtime driver contract version '${driver.driverContractVersion}' does not match descriptor version '${input.descriptor.driverContractVersion}'`
		)
	}
	return driver as CheckmateDriverV1
}

export function validateDriverSession(
	session: DriverSession,
	descriptor: DriverDescriptorV1,
	allowedTools: '*' | readonly string[]
): readonly DriverTool[] {
	if (!session || !Array.isArray(session.tools))
		throw new DriverContractError('Driver session must provide a tools array')

	const runtimeNames = session.tools.map((tool) => tool.definition?.name)
	if (runtimeNames.some((name) => typeof name !== 'string' || name.length === 0)) {
		throw new DriverContractError('Every runtime driver tool must have a non-empty name')
	}
	const duplicate = runtimeNames.find((name, index) => runtimeNames.indexOf(name) !== index)
	if (duplicate) throw new DriverContractError(`Duplicate runtime driver tool '${duplicate}'`)

	const reserved = runtimeNames.find((name) => RESERVED_TOOL_NAMES.has(name))
	if (reserved) throw new DriverContractError(`Driver tool '${reserved}' collides with a reserved harness tool`)

	const descriptorNames = descriptor.tools.map((tool) => tool.name)
	const declaredDuplicates = descriptorNames.find((name, index) => descriptorNames.indexOf(name) !== index)
	if (declaredDuplicates) {
		throw new DriverContractError(`Descriptor declares duplicate driver tool '${declaredDuplicates}'`)
	}

	const missing = descriptorNames.filter((name) => !runtimeNames.includes(name))
	const additional = runtimeNames.filter((name) => !descriptorNames.includes(name))
	if (missing.length > 0 || additional.length > 0) {
		throw new DriverContractError(
			[
				missing.length > 0 ? `missing runtime tools: ${missing.join(', ')}` : '',
				additional.length > 0 ? `undeclared runtime tools: ${additional.join(', ')}` : '',
			]
				.filter(Boolean)
				.join('\n')
		)
	}

	if (allowedTools === '*') return [...session.tools]
	const allowed = new Set(allowedTools)
	const unknown = allowedTools.filter((name) => !descriptorNames.includes(name))
	if (unknown.length > 0) throw new DriverContractError(`Policy allows undeclared tools: ${unknown.join(', ')}`)
	return session.tools.filter((tool) => allowed.has(tool.definition.name))
}

function resolveDriverModule(invocationRoot: string, packageName: string): string {
	const require = createRequire(resolve(invocationRoot, 'package.json'))
	return pathToFileURL(require.resolve(packageName)).href
}

function importDriverModule(specifier: string): Promise<unknown> {
	return import(specifier)
}

function readDriverExport(
	module: unknown
): { id: string; driverContractVersion: unknown; start: CheckmateDriverV1['start'] } | undefined {
	if (!module || typeof module !== 'object' || !('checkmateDriver' in module)) return undefined
	const driver = (module as { checkmateDriver?: unknown }).checkmateDriver
	if (!driver || typeof driver !== 'object') return undefined
	const candidate = driver as { id?: unknown; driverContractVersion?: unknown; start?: unknown }
	if (typeof candidate.id !== 'string' || typeof candidate.start !== 'function') {
		return undefined
	}
	return candidate as { id: string; driverContractVersion: unknown; start: CheckmateDriverV1['start'] }
}
