import { compareTwoStrings } from 'string-similarity'

export type JsonValue = string | number | boolean | null | JsonObject | JsonArray
export type JsonObject = { [key: string]: JsonValue }
export type JsonArray = JsonValue[]

export interface ScoredElement {
	score: number
	path: (string | number)[]
	element: JsonValue
	key: string
}

export function scoreElements(json: JsonValue, tokens: string[]): ScoredElement[] {
	const scoredElements: ScoredElement[] = []
	traverseAndScore(json, tokens, [], scoredElements)
	return scoredElements
}

function traverseAndScore(
	value: JsonValue,
	tokens: string[],
	currentPath: (string | number)[],
	results: ScoredElement[]
): void {
	if (value === null || value === undefined) {
		return
	}

	if (typeof value === 'string') {
		const score = calculateMaxScore(value, tokens)
		if (score > 0) {
			results.push({ score, path: [...currentPath], element: value, key: value })
		}
		return
	}

	if (Array.isArray(value)) {
		value.forEach((item, index) => {
			traverseAndScore(item, tokens, [...currentPath, index], results)
		})
		return
	}

	if (typeof value === 'object') {
		for (const key of Object.keys(value)) {
			const keyScore = calculateMaxScore(key, tokens)
			if (keyScore > 0) {
				results.push({
					score: keyScore,
					path: [...currentPath, key],
					element: value[key],
					key,
				})
			}
			traverseAndScore(value[key], tokens, [...currentPath, key], results)
		}
	}
}

function calculateMaxScore(text: string, tokens: string[]): number {
	if (tokens.length === 0) {
		return 0
	}

	const normalizedText = text.toLowerCase()

	return Math.max(...tokens.map((token) => compareTwoStrings(normalizedText, token)))
}

export function filterByThreshold(scoredElements: ScoredElement[], threshold: number): ScoredElement[] {
	return scoredElements.filter((element) => element.score >= threshold)
}
