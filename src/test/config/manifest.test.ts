import { describe, expect, it } from 'vitest'
import { manifestReferenceDiagnostics, outputDirectoryDiagnostics } from '../../config/manifest.js'
import type { CheckmateManifestV1 } from '../../contracts/types.js'
import { validateManifest } from '../../contracts/validator.js'
import { fixtureManifest } from '../fixtures/static-environment.js'

describe('manifest safety', () => {
	it.each(['/tmp/checkmate', '../runs', 'runs/../../outside', '.', 'runs//nested'])(
		'rejects non-contained outputDirectory %s in the schema',
		(outputDirectory) => {
			expect(validateManifest({ ...fixtureManifest, outputDirectory }).ok).toBe(false)
		}
	)

	it('enforces containment again at the lexical path boundary', () => {
		expect(outputDirectoryDiagnostics('/workspace/project', '../outside')).toEqual([
			expect.objectContaining({ code: 'manifest.output-outside-root', path: '/outputDirectory' }),
		])
		expect(outputDirectoryDiagnostics('/workspace/project', '.checkmate/runs')).toEqual([])
	})

	it('does not resolve inherited policy, driver, or binding names', () => {
		const manifest = structuredClone(fixtureManifest)
		manifest.defaultPolicy = 'constructor'
		manifest.policies.ci.modelEgress.provider.apiKeyBinding = 'toString'
		manifest.policies.ci.drivers = JSON.parse('{"hasOwnProperty":{"settings":{},"tools":{"allowed":["*"]}}}')

		expect(manifestReferenceDiagnostics(manifest).map((diagnostic) => diagnostic.code)).toEqual([
			'manifest.unknown-default-policy',
			'manifest.unknown-secret-binding',
			'manifest.unknown-driver',
		])
	})

	it('orders manifest diagnostics by UTF-16 code units rather than locale', () => {
		const manifest = structuredClone(fixtureManifest)
		manifest.policies = JSON.parse(
			JSON.stringify({
				'\uE000': policyWithMissingBinding('private-use'),
				'😀': policyWithMissingBinding('emoji'),
			})
		)
		manifest.defaultPolicy = '😀'

		const paths = manifestReferenceDiagnostics(manifest)
			.filter((diagnostic) => diagnostic.code === 'manifest.unknown-secret-binding')
			.map((diagnostic) => diagnostic.path)
		expect(paths).toEqual([
			'/policies/😀/modelEgress/provider/apiKeyBinding',
			'/policies//modelEgress/provider/apiKeyBinding',
		])
	})
})

function policyWithMissingBinding(binding: string): CheckmateManifestV1['policies'][string] {
	const policy = structuredClone(fixtureManifest.policies.ci)
	policy.modelEgress.provider.apiKeyBinding = binding
	return policy
}
