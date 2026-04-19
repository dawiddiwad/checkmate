import { logger } from '../../../logging'
import { getBrowserStepHints, Step } from '../../../runtime/types'
import { filterByThreshold, filterTopPercent, JsonValue, scoreSnapshotElements } from './semantic-scorer'
import { reconstructTree } from './tree-reconstructor'

const DEFAULT_SCORE_THRESHOLD = 0.3
const DEFAULT_TOP_PERCENT = 10

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

	const scoredElements = await scoreSnapshotElements(json, searchQuery)
	logger.debug(`filterSnapshot: Scored ${scoredElements.length} elements`)

	if (scoredElements.length === 0) {
		logger.debug('filterSnapshot: No scored elements, returning original snapshot')
		return json
	}

	const topPercent = resolveTopPercent(step)
	const selectedByPrimaryRule = filterTopPercent(scoredElements, topPercent / 100)
	logger.debug(`filterSnapshot: Filtered to ${selectedByPrimaryRule.length} elements from top ${topPercent}%`)

	const selectedElements =
		selectedByPrimaryRule.length > 0
			? selectedByPrimaryRule
			: filterByThreshold(scoredElements, DEFAULT_SCORE_THRESHOLD)

	if (selectedElements !== selectedByPrimaryRule) {
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

function resolveTopPercent(step: Step): number {
	const candidate = getBrowserStepHints(step).topPercent
	if (typeof candidate === 'number' && candidate > 0 && candidate <= 100) {
		return candidate
	}

	return DEFAULT_TOP_PERCENT
}

function resolveSearchQuery(step: Step): string {
	const hints = getBrowserStepHints(step)
	if (hints.search && hints.search.length > 0) {
		logger.info(`filterSnapshot: using search keywords: ${JSON.stringify(hints.search)}`)
		return hints.search.join(' ')
	}

	const semanticQuery = `${step.action} ${step.expect}`.trim()
	if (semanticQuery) {
		logger.info(`filterSnapshot: using step semantics`)
		return semanticQuery
	}

	return ''
}
