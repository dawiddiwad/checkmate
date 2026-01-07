import { Step } from '../../types'
import { extractSearchTerms } from './tokenizer'
import { scoreElements, selectTopElements, JsonValue } from './scorer'
import { reconstructTree } from './tree-reconstructor'

const DEFAULT_TOP_ELEMENTS_COUNT = 10

export function filterSnapshot(json: JsonValue, step?: Step): JsonValue {
	if (!step) {
		return json
	}

	const searchTerms = extractSearchTerms(step.action, step.expect)

	if (searchTerms.length === 0) {
		return json
	}

	const scoredElements = scoreElements(json, searchTerms)

	if (scoredElements.length === 0) {
		return json
	}

	const topElements = selectTopElements(scoredElements, DEFAULT_TOP_ELEMENTS_COUNT)
	return reconstructTree(json, topElements)
}
