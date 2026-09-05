import type { ModelEgressPolicyV1 } from '../contracts/types.js'
import type { ManifestPolicy } from './policy.js'
import { deepFreeze } from './policy.js'

export function resolveModelEgress(policy: ManifestPolicy): ModelEgressPolicyV1 {
	return deepFreeze({
		provider: { ...policy.modelEgress.provider },
		textRedaction: policy.modelEgress.textRedaction,
		allowOpaque: policy.modelEgress.allowOpaque,
		maxStepBytes: policy.modelEgress.maxStepBytes,
		maxMessageBytes: policy.modelEgress.maxMessageBytes,
	})
}
