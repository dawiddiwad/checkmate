import { Step } from '../../types'
import { scoreElements, filterByThreshold, JsonValue } from './scorer'
import { reconstructTree } from './tree-reconstructor'
import { logger } from '../../openai/openai-test-manager'

const DEFAULT_SCORE_THRESHOLD = 0.3

export async function filterSnapshot(json: JsonValue, step?: Step): Promise<JsonValue> {
	if (!step) {
		logger.debug('filterSnapshot: No step provided, returning original snapshot')
		return json
	}

	const searchKeywords = await resolveSearchKeywords(step)
	logger.debug(`filterSnapshot: Resolved search keywords: ${JSON.stringify(searchKeywords)}`)

	if (searchKeywords.length === 0) {
		logger.debug('filterSnapshot: No search keywords found, returning original snapshot')
		return json
	}

	const scoredElements = scoreElements(json, searchKeywords)
	logger.debug(`filterSnapshot: Scored ${scoredElements.length} elements`)

	if (scoredElements.length === 0) {
		logger.debug('filterSnapshot: No scored elements, returning original snapshot')
		return json
	}

	const topElements = filterByThreshold(scoredElements, step.threshold ?? DEFAULT_SCORE_THRESHOLD)
	logger.debug(
		`filterSnapshot: Filtered to ${topElements.length} elements above threshold ${step.threshold ?? DEFAULT_SCORE_THRESHOLD}`
	)

	const filtered = reconstructTree(json, topElements)
	const originalSize = JSON.stringify(json).length
	const filteredSize = JSON.stringify(filtered).length
	logger.info(
		`filterSnapshot: Reduced snapshot from ${originalSize} to ${filteredSize} chars (${Math.round((1 - filteredSize / originalSize) * 100)}% reduction)`
	)

	return filtered
}

async function resolveSearchKeywords(step: Step): Promise<string[]> {
	if (step.search && step.search.length > 0) {
		logger.debug(`filterSnapshot: Using provided elements: ${JSON.stringify(step.search)}`)
		return step.search.map((el) => el.toLowerCase())
	} else {
		return []
	}
}
