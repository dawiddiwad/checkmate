import type { CheckmateManifestV1, Diagnostic } from '../contracts/types.js'
import { ownValue } from './record.js'

export type EnvironmentReader = (name: string) => string | undefined

export class SecretResolver {
	constructor(
		private readonly manifest: CheckmateManifestV1,
		private readonly readEnvironment: EnvironmentReader = (name) => ownValue(process.env, name)
	) {}

	probe(binding: string): boolean {
		const definition = ownValue(this.manifest.secretBindings, binding)
		if (!definition) return false
		const value = this.readEnvironment(definition.name)
		return typeof value === 'string' && value.trim().length > 0
	}

	read(binding: string): string {
		const definition = ownValue(this.manifest.secretBindings, binding)
		if (!definition) throw new Error(`Unknown secret binding '${binding}'`)
		const value = this.readEnvironment(definition.name)
		if (typeof value !== 'string' || value.trim().length === 0) {
			throw new Error(`Secret binding '${binding}' is unavailable`)
		}
		return value
	}
}

export function secretAvailabilityDiagnostics(
	manifest: CheckmateManifestV1,
	bindings: readonly string[],
	readEnvironment?: EnvironmentReader
): Diagnostic[] {
	const resolver = new SecretResolver(manifest, readEnvironment)
	return bindings.flatMap((binding) =>
		resolver.probe(binding)
			? []
			: [
					{
						code: 'secret.unavailable',
						path: `/secretBindings/${escapePointer(binding)}`,
						message: `required logical secret binding '${binding}' is unavailable`,
					},
				]
	)
}

function escapePointer(value: string): string {
	return value.replaceAll('~', '~0').replaceAll('/', '~1')
}
