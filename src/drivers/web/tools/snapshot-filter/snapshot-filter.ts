import type { RuntimeLogger } from '../../../../logging/types.js'
import type { BrowserStepIntent } from '../types.js'
import { filterByThreshold, filterTopPercent, JsonValue, scoreSnapshotElements } from './semantic-scorer.js'
import { reconstructTree } from './tree-reconstructor.js'

const DEFAULT_SCORE_THRESHOLD = 0.3
const DEFAULT_TOP_PERCENT = 10

export async function filterSnapshot(
	json: JsonValue,
	runtimeLogger: RuntimeLogger,
	step?: BrowserStepIntent,
	defaultTopPercent: number = DEFAULT_TOP_PERCENT
): Promise<JsonValue> {
	if (!step) {
		runtimeLogger.debug('filterSnapshot: No step provided, returning original snapshot')
		return json
	}

	const searchQuery = resolveSearchQuery(step, runtimeLogger)
	runtimeLogger.debug(`filterSnapshot: Resolved search query: ${JSON.stringify(searchQuery)}`)

	if (!searchQuery) {
		runtimeLogger.debug('filterSnapshot: No search query found, returning original snapshot')
		return json
	}

	const scoredElements = await scoreSnapshotElements(json, searchQuery)
	runtimeLogger.debug(`filterSnapshot: Scored ${scoredElements.length} elements`)

	if (scoredElements.length === 0) {
		runtimeLogger.debug('filterSnapshot: No scored elements, returning original snapshot')
		return json
	}

	const topPercent = resolveTopPercent(step, defaultTopPercent)
	const selectedByPrimaryRule = filterTopPercent(scoredElements, topPercent / 100)
	runtimeLogger.debug(`filterSnapshot: Filtered to ${selectedByPrimaryRule.length} elements from top ${topPercent}%`)

	const selectedElements =
		selectedByPrimaryRule.length > 0
			? selectedByPrimaryRule
			: filterByThreshold(scoredElements, DEFAULT_SCORE_THRESHOLD)

	if (selectedElements !== selectedByPrimaryRule) {
		runtimeLogger.debug(
			`filterSnapshot: Top-percent selection was empty, falling back to threshold ${DEFAULT_SCORE_THRESHOLD}`
		)
	}

	const filtered = reconstructTree(json, selectedElements)
	const originalSize = JSON.stringify(json).length
	const filteredSize = JSON.stringify(filtered).length
	runtimeLogger.info(
		`filterSnapshot: Reduced snapshot from ${originalSize} to ${filteredSize} chars (${Math.round((1 - filteredSize / originalSize) * 100)}% reduction)`
	)

	return filtered
}

function resolveTopPercent(step: BrowserStepIntent, defaultTopPercent: number): number {
	const candidate = step.topPercent
	if (typeof candidate === 'number' && candidate > 0 && candidate <= 100) {
		return candidate
	}

	return defaultTopPercent
}

function resolveSearchQuery(step: BrowserStepIntent, runtimeLogger: RuntimeLogger): string {
	if (step.search && step.search.length > 0) {
		runtimeLogger.info(`filterSnapshot: using search keywords: ${JSON.stringify(step.search)}`)
		return step.search.join(' ')
	}

	const semanticQuery = `${step.action} ${step.expect}`.trim()
	if (semanticQuery) {
		runtimeLogger.info(`filterSnapshot: using step semantics`)
		return semanticQuery
	}

	return ''
}
