import { cos_sim, pipeline } from '@huggingface/transformers'

export type JsonValue = string | number | boolean | null | JsonObject | JsonArray
export type JsonObject = { [key: string]: JsonValue }
export type JsonArray = JsonValue[]

export interface ScoredElement {
	score: number
	path: (string | number)[]
	element: JsonValue
	key: string
}

interface CandidateElement {
	path: (string | number)[]
	element: JsonValue
	key: string
	text: string
}

const EMBEDDING_MODEL = 'snowflake/snowflake-arctic-embed-xs'
const SNAPSHOT_METADATA_REGEX = /\s*\[[^\]]*\]/g

type EmbeddingExtractor = (
	input: string,
	options: { pooling: 'mean'; normalize: true }
) => Promise<{ data: Float32Array | number[] }>

let featureExtractionPipelinePromise: Promise<EmbeddingExtractor> | undefined
const embeddingCache = new Map<string, Promise<number[]>>()

export async function scoreSnapshotElements(json: JsonValue, query: string): Promise<ScoredElement[]> {
	const normalizedQuery = normalizeText(query)
	if (!normalizedQuery) {
		return []
	}

	const candidates: CandidateElement[] = []
	collectCandidates(json, [], candidates)
	if (candidates.length === 0) {
		return []
	}

	const queryEmbedding = await getEmbedding(normalizedQuery)
	const scoredElements = await Promise.all(
		candidates.map(async (candidate) => {
			const normalizedText = normalizeText(candidate.text)
			if (!normalizedText) {
				return undefined
			}

			const elementEmbedding = await getEmbedding(normalizedText)
			const score = Math.max(0, cos_sim(queryEmbedding, elementEmbedding))
			if (score <= 0) {
				return undefined
			}

			return {
				score,
				path: candidate.path,
				element: candidate.element,
				key: candidate.key,
			}
		})
	)

	return scoredElements.filter((candidate): candidate is ScoredElement => candidate !== undefined)
}

function collectCandidates(value: JsonValue, currentPath: (string | number)[], results: CandidateElement[]): void {
	if (value === null || value === undefined) {
		return
	}

	if (typeof value === 'string') {
		results.push({ path: [...currentPath], element: value, key: value, text: value })
		return
	}

	if (Array.isArray(value)) {
		value.forEach((item, index) => {
			collectCandidates(item, [...currentPath, index], results)
		})
		return
	}

	const objectValue = value as JsonObject
	for (const key of Object.keys(objectValue)) {
		results.push({ path: [...currentPath, key], element: objectValue[key], key, text: key })
		collectCandidates(objectValue[key], [...currentPath, key], results)
	}
}

function normalizeText(text: string): string {
	return text.replaceAll(SNAPSHOT_METADATA_REGEX, ' ').replaceAll(/\s+/g, ' ').trim().toLowerCase()
}

async function getFeatureExtractionPipeline(): Promise<EmbeddingExtractor> {
	featureExtractionPipelinePromise ??= pipeline('feature-extraction', EMBEDDING_MODEL, {
		dtype: 'int8',
	}) as Promise<EmbeddingExtractor>
	return featureExtractionPipelinePromise
}

async function getEmbedding(text: string): Promise<number[]> {
	const normalizedText = normalizeText(text)
	if (!normalizedText) {
		return []
	}

	const cachedEmbedding = embeddingCache.get(normalizedText)
	if (cachedEmbedding) {
		return cachedEmbedding
	}

	const embeddingPromise = (async () => {
		const extractor = await getFeatureExtractionPipeline()
		const output = await extractor(normalizedText, { pooling: 'mean', normalize: true })
		return Array.from(output.data as number[] | Float32Array)
	})()

	embeddingCache.set(normalizedText, embeddingPromise)

	try {
		return await embeddingPromise
	} catch (error) {
		embeddingCache.delete(normalizedText)
		throw error
	}
}

export function filterByThreshold(scoredElements: ScoredElement[], threshold: number): ScoredElement[] {
	return scoredElements.filter((element) => element.score >= threshold)
}

export function filterTopPercent(scoredElements: ScoredElement[], topPercent: number): ScoredElement[] {
	if (scoredElements.length === 0 || topPercent <= 0 || topPercent > 1) {
		return []
	}

	const sortedElements = [...scoredElements].sort((a, b) => b.score - a.score)
	const selectedCount = Math.max(1, Math.ceil(sortedElements.length * topPercent))
	return sortedElements.slice(0, selectedCount)
}
