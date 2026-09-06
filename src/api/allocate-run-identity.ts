import { allocateRunIdentity as allocateEvidenceIdentity, type RunIdentity } from '../evidence/layout.js'
import type { PreparedRun } from './prepare-run.js'

export type AllocatePreparedRunIdentityOptions = Readonly<{
	now?: () => Date
	random?: () => Uint8Array
}>

export function allocateRunIdentity(
	prepared: PreparedRun,
	options: AllocatePreparedRunIdentityOptions = {}
): Promise<RunIdentity> {
	return allocateEvidenceIdentity({
		invocationRoot: prepared.invocationRoot,
		outputDirectory: prepared.outputDirectory,
		scenarioId: prepared.request.scenario.id,
		...options,
	})
}
