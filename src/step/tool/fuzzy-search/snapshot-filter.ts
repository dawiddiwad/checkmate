import { Step } from '../../types'
import { extractKeywordsFromLLM } from './keyword-extractor'
import { scoreElements, selectTopElements, JsonValue } from './scorer'
import { reconstructTree } from './tree-reconstructor'
import { logger } from '../../openai/openai-test-manager'

const DEFAULT_TOP_ELEMENTS_COUNT = 10

export async function filterSnapshot(json: JsonValue, step?: Step): Promise<JsonValue> {
	if (!step) {
		logger.debug('filterSnapshot: No step provided, returning original JSON')
		return json
	}

	const searchTerms = await resolveSearchTerms(step)
	logger.debug(`filterSnapshot: Resolved search terms: ${JSON.stringify(searchTerms)}`)

	if (searchTerms.length === 0) {
		logger.debug('filterSnapshot: No search terms found, returning original JSON')
		return json
	}

	const scoredElements = scoreElements(json, searchTerms)
	logger.debug(`filterSnapshot: Scored ${scoredElements.length} elements`)

	if (scoredElements.length === 0) {
		logger.debug('filterSnapshot: No scored elements, returning original JSON')
		return json
	}

	const topElements = selectTopElements(scoredElements, DEFAULT_TOP_ELEMENTS_COUNT)
	logger.debug(`filterSnapshot: Selected top ${topElements.length} elements`)

	const filtered = reconstructTree(json, topElements)
	const originalSize = JSON.stringify(json).length
	const filteredSize = JSON.stringify(filtered).length
	logger.info(
		`filterSnapshot: Reduced snapshot from ${originalSize} to ${filteredSize} chars (${Math.round((1 - filteredSize / originalSize) * 100)}% reduction)`
	)

	return filtered
}

async function resolveSearchTerms(step: Step): Promise<string[]> {
	if (step.elements && step.elements.length > 0) {
		logger.debug(`filterSnapshot: Using provided elements: ${JSON.stringify(step.elements)}`)
		return step.elements.map((el) => el.toLowerCase())
	}

	logger.debug('filterSnapshot: No elements provided, extracting via LLM...')
	const llmKeywords = await extractKeywordsFromLLM(step.action, step.expect)
	logger.debug(`filterSnapshot: LLM extracted keywords: ${JSON.stringify(llmKeywords)}`)
	return llmKeywords.map((kw) => kw.toLowerCase())
}
