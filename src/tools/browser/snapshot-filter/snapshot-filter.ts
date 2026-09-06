import { filterSnapshot as filterDriverSnapshot } from '../../../drivers/web/tools/snapshot-filter/snapshot-filter.js'
import type { JsonValue } from '../../../drivers/web/tools/snapshot-filter/semantic-scorer.js'
import { logger } from '../../../logging/index.js'
import type { Step } from '../../../runtime/types.js'

export function filterSnapshot(json: JsonValue, step?: Step, defaultTopPercent?: number): Promise<JsonValue> {
	return filterDriverSnapshot(json, logger, step, defaultTopPercent)
}
