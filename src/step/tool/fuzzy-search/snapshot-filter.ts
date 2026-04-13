import { Step } from '../../types'
import { scoreElements, filterByThreshold, filterTopPercent, JsonValue } from './scorer'
import { reconstructTree } from './tree-reconstructor'
import { logger } from '../../openai/openai-test-manager'

const DEFAULT_SCORE_THRESHOLD = 0.3
const DEFAULT_TOP_PERCENT = 0.5

export async function filterSnapshot(json: JsonValue, step?: Step): Promise<JsonValue> {
	if (!step) {
		logger.debug('filterSnapshot: No step provided, returning original snapshot')
		return json
	}

	const searchQuery = resolveSearchQuery(step)
	logger.debug(`filterSnapshot: Resolved search query: ${JSON.stringify(searchQuery)}`)

	if (!searchQuery) {
		logger.debug('filterSnapshot: No search query found, returning original snapshot')
		return json
	}

	const scoredElements = await scoreElements(json, searchQuery)
	logger.debug(`filterSnapshot: Scored ${scoredElements.length} elements`)

	if (scoredElements.length === 0) {
		logger.debug('filterSnapshot: No scored elements, returning original snapshot')
		return json
	}

	const topElements =
		typeof step.threshold === 'number'
			? filterByThreshold(scoredElements, step.threshold)
			: filterTopPercent(scoredElements, DEFAULT_TOP_PERCENT)

	if (typeof step.threshold === 'number') {
		logger.debug(`filterSnapshot: Filtered to ${topElements.length} elements above threshold ${step.threshold}`)
	} else {
		logger.debug(
			`filterSnapshot: Filtered to ${topElements.length} elements from top ${DEFAULT_TOP_PERCENT * 100}%`
		)
	}

	const selectedElements =
		topElements.length > 0 || typeof step.threshold === 'number'
			? topElements
			: filterByThreshold(scoredElements, DEFAULT_SCORE_THRESHOLD)

	if (selectedElements !== topElements) {
		logger.debug(
			`filterSnapshot: Top-percent selection was empty, falling back to threshold ${DEFAULT_SCORE_THRESHOLD}`
		)
	}

	const filtered = reconstructTree(json, selectedElements)
	const originalSize = JSON.stringify(json).length
	const filteredSize = JSON.stringify(filtered).length
	logger.info(
		`filterSnapshot: Reduced snapshot from ${originalSize} to ${filteredSize} chars (${Math.round((1 - filteredSize / originalSize) * 100)}% reduction)`
	)

	return filtered
}

function resolveSearchQuery(step: Step): string {
	const semanticQuery = `${step.action} ${step.expect}`.trim()
	if (semanticQuery) {
		return semanticQuery
	}

	if (step.search && step.search.length > 0) {
		logger.debug(`filterSnapshot: Falling back to provided elements: ${JSON.stringify(step.search)}`)
		return step.search.join(' ')
	}

	return ''
}
