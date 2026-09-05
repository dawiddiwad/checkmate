import { isAbsolute, relative, resolve, sep } from 'node:path'
import { validateManifest } from '../contracts/validator.js'
import type { CheckmateManifestV1, Diagnostic } from '../contracts/types.js'
import { readJsonDocument, type InputResult } from './ingestion.js'
import { compareUtf16, ownValue } from './record.js'

export type EnvironmentLocation = Readonly<{
	invocationRoot: string
	manifestPath: string
}>

export type LoadedManifest = EnvironmentLocation & Readonly<{ manifest: CheckmateManifestV1 }>

export function resolveEnvironmentLocation(options: { cwd?: string; configPath?: string } = {}): EnvironmentLocation {
	const invocationRoot = resolve(options.cwd ?? process.cwd())
	const manifestPath = resolve(invocationRoot, options.configPath ?? 'checkmate.config.json')
	return { invocationRoot, manifestPath }
}

export async function loadManifest(
	options: { cwd?: string; configPath?: string } = {}
): Promise<InputResult<LoadedManifest>> {
	const location = resolveEnvironmentLocation(options)
	const document = await readJsonDocument(location.manifestPath)
	if (document.ok === false) return { ok: false, status: document.status, diagnostics: document.diagnostics }

	const validation = validateManifest(document.value)
	if (validation.ok === false) return { ok: false, status: 'invalid', diagnostics: asTuple(validation.diagnostics) }
	const containment = outputDirectoryDiagnostics(location.invocationRoot, validation.value.outputDirectory)
	if (containment.length > 0) return { ok: false, status: 'invalid', diagnostics: asTuple(containment) }

	return { ok: true, value: { ...location, manifest: validation.value } }
}

export function manifestReferenceDiagnostics(manifest: CheckmateManifestV1): Diagnostic[] {
	const diagnostics: Diagnostic[] = []
	if (!ownValue(manifest.policies, manifest.defaultPolicy)) {
		diagnostics.push({
			code: 'manifest.unknown-default-policy',
			path: '/defaultPolicy',
			message: `references unknown policy '${manifest.defaultPolicy}'`,
		})
	}

	for (const [policyId, policy] of sortedEntries(manifest.policies)) {
		const binding = policy.modelEgress.provider.apiKeyBinding
		if (!ownValue(manifest.secretBindings, binding)) {
			diagnostics.push({
				code: 'manifest.unknown-secret-binding',
				path: pointer('policies', policyId, 'modelEgress', 'provider', 'apiKeyBinding'),
				message: `references unknown secret binding '${binding}'`,
			})
		}

		for (const driverId of Object.keys(policy.drivers).sort(compareUtf16)) {
			if (!ownValue(manifest.drivers, driverId)) {
				diagnostics.push({
					code: 'manifest.unknown-driver',
					path: pointer('policies', policyId, 'drivers', driverId),
					message: `references unregistered driver '${driverId}'`,
				})
			}
		}
	}

	for (const [driverId, registration] of sortedEntries(manifest.drivers)) {
		for (const [slot, binding] of sortedEntries(registration.secrets)) {
			if (!ownValue(manifest.secretBindings, binding)) {
				diagnostics.push({
					code: 'manifest.unknown-secret-binding',
					path: pointer('drivers', driverId, 'secrets', slot),
					message: `references unknown secret binding '${binding}'`,
				})
			}
		}
	}

	return diagnostics
}

function sortedEntries<T>(record: Record<string, T>): Array<[string, T]> {
	return Object.entries(record).sort(([left], [right]) => compareUtf16(left, right))
}

export function outputDirectoryDiagnostics(invocationRoot: string, outputDirectory = '.checkmate/runs'): Diagnostic[] {
	const outputPath = resolve(invocationRoot, outputDirectory)
	const relativePath = relative(invocationRoot, outputPath)
	if (
		isAbsolute(outputDirectory) ||
		relativePath === '' ||
		relativePath === '..' ||
		relativePath.startsWith(`..${sep}`) ||
		isAbsolute(relativePath)
	) {
		return [
			{
				code: 'manifest.output-outside-root',
				path: '/outputDirectory',
				message: 'must resolve to a child directory inside the invocation root',
			},
		]
	}
	return []
}

function asTuple(diagnostics: Diagnostic[]): [Diagnostic, ...Diagnostic[]] {
	return diagnostics as [Diagnostic, ...Diagnostic[]]
}

function pointer(...members: string[]): string {
	return `/${members.map((member) => member.replaceAll('~', '~0').replaceAll('/', '~1')).join('/')}`
}
