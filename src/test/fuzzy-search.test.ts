import { describe, it, expect, vi, beforeEach } from 'vitest'
import {
	scoreSnapshotElements,
	filterByThreshold,
	filterTopPercent,
	JsonValue,
} from '../tools/browser/snapshot-filter/semantic-scorer'
import { reconstructTree } from '../tools/browser/snapshot-filter/tree-reconstructor'
import { filterSnapshot } from '../tools/browser/snapshot-filter/snapshot-filter'
import { Step } from '../runtime/types'

vi.mock('@huggingface/transformers', () => {
	const EMBEDDING_DIMENSION = 64

	function tokenize(input: string): string[] {
		return input
			.toLowerCase()
			.split(/[^a-z0-9]+/)
			.filter(Boolean)
	}

	function toVector(input: string): number[] {
		const vector = Array.from({ length: EMBEDDING_DIMENSION }, () => 0)

		for (const token of tokenize(input)) {
			let hash = 0
			for (const char of token) {
				hash = (hash * 31 + char.charCodeAt(0)) >>> 0
			}

			vector[hash % EMBEDDING_DIMENSION] += 1
		}

		const norm = Math.hypot(...vector) || 1
		return vector.map((value) => value / norm)
	}

	function cosineSimilarity(a: number[], b: number[]): number {
		if (a.length === 0 || b.length === 0) {
			return 0
		}

		let dot = 0
		let normA = 0
		let normB = 0
		const length = Math.max(a.length, b.length)

		for (let index = 0; index < length; index++) {
			const aValue = a[index] ?? 0
			const bValue = b[index] ?? 0
			dot += aValue * bValue
			normA += aValue * aValue
			normB += bValue * bValue
		}

		if (normA === 0 || normB === 0) {
			return 0
		}

		return dot / (Math.sqrt(normA) * Math.sqrt(normB))
	}

	return {
		pipeline: vi.fn().mockResolvedValue(async (input: string) => ({ data: toVector(input) })),
		cos_sim: vi.fn(cosineSimilarity),
	}
})

vi.mock('../logging', () => ({
	logger: {
		info: vi.fn(),
		warn: vi.fn(),
		error: vi.fn(),
		debug: vi.fn(),
	},
}))

describe('Fuzzy Search', () => {
	beforeEach(() => {
		vi.clearAllMocks()
	})

	describe('Scorer', () => {
		describe('scoreSnapshotElements', () => {
			it('should return empty array for empty query', async () => {
				const json = { key: 'value' }
				expect(await scoreSnapshotElements(json, '')).toEqual([])
			})

			it('should score string values', async () => {
				const json = 'hello world'
				const results = await scoreSnapshotElements(json, 'hello')
				expect(results.length).toBeGreaterThan(0)
				expect(results[0].score).toBeGreaterThan(0)
			})

			it('should score object keys', async () => {
				const json = { 'link "Models" [ref=e7]': 'value' }
				const results = await scoreSnapshotElements(json, 'models')
				expect(results.length).toBeGreaterThan(0)
			})

			it('should traverse nested objects', async () => {
				const json = {
					outer: {
						inner: 'target value',
					},
				}
				const results = await scoreSnapshotElements(json, 'target')
				expect(results.some((r) => r.path.includes('inner'))).toBe(true)
			})

			it('should traverse arrays', async () => {
				const json = ['first', 'second', 'target']
				const results = await scoreSnapshotElements(json, 'target')
				expect(results.some((r) => r.score > 0)).toBe(true)
			})

			it('should handle complex nested structures', async () => {
				const json = {
					'generic [ref=e1]': [
						{
							'banner [ref=e2]': [
								{
									'textbox "Search models" [ref=e19]': 'value',
								},
							],
						},
					],
				}
				const results = await scoreSnapshotElements(json, 'search models')
				expect(results.length).toBeGreaterThan(0)
			})
		})

		describe('filterByThreshold', () => {
			it('should return elements above threshold', () => {
				const elements = [
					{ score: 0.5, path: ['a'], element: 'a', key: 'a' },
					{ score: 0.9, path: ['b'], element: 'b', key: 'b' },
					{ score: 0.3, path: ['c'], element: 'c', key: 'c' },
					{ score: 0.7, path: ['d'], element: 'd', key: 'd' },
				]
				const filtered = filterByThreshold(elements, 0.6)
				expect(filtered).toHaveLength(2)
				expect(filtered.every((e) => e.score >= 0.6)).toBe(true)
			})

			it('should return all elements if threshold is 0', () => {
				const elements = [
					{ score: 0.5, path: ['a'], element: 'a', key: 'a' },
					{ score: 0.1, path: ['b'], element: 'b', key: 'b' },
				]
				const result = filterByThreshold(elements, 0)
				expect(result).toHaveLength(2)
			})

			it('should return empty array if no elements meet threshold', () => {
				const elements = [{ score: 0.5, path: ['a'], element: 'a', key: 'a' }]
				const result = filterByThreshold(elements, 0.8)
				expect(result).toHaveLength(0)
			})
		})

		describe('filterTopPercent', () => {
			it('should return the top 50 percent of elements', () => {
				const elements = [
					{ score: 0.1, path: ['a'], element: 'a', key: 'a' },
					{ score: 0.9, path: ['b'], element: 'b', key: 'b' },
					{ score: 0.3, path: ['c'], element: 'c', key: 'c' },
					{ score: 0.7, path: ['d'], element: 'd', key: 'd' },
				]

				const result = filterTopPercent(elements, 0.5)

				expect(result).toHaveLength(2)
				expect(result.map((element) => element.score)).toEqual([0.9, 0.7])
			})

			it('should round up when selecting top percent of odd-sized input', () => {
				const elements = [
					{ score: 0.1, path: ['a'], element: 'a', key: 'a' },
					{ score: 0.9, path: ['b'], element: 'b', key: 'b' },
					{ score: 0.7, path: ['c'], element: 'c', key: 'c' },
				]

				const result = filterTopPercent(elements, 0.5)

				expect(result).toHaveLength(2)
				expect(result.map((element) => element.score)).toEqual([0.9, 0.7])
			})

			it('should return empty array for invalid percent', () => {
				const elements = [{ score: 0.5, path: ['a'], element: 'a', key: 'a' }]

				expect(filterTopPercent(elements, 0)).toEqual([])
				expect(filterTopPercent(elements, 1.5)).toEqual([])
			})
		})
	})

	describe('Tree Reconstructor', () => {
		describe('reconstructTree', () => {
			it('should return original JSON when no elements selected', () => {
				const json = { key: 'value' }
				const result = reconstructTree(json, [])
				expect(result).toEqual(json)
			})

			it('should preserve parent lineage for matched element', () => {
				const json = {
					'root [ref=e1]': [
						{
							'child [ref=e2]': [
								{
									'target [ref=e3]': 'matched',
								},
							],
						},
					],
				}
				const selectedElements = [
					{
						score: 0.9,
						path: ['root [ref=e1]', 0, 'child [ref=e2]', 0, 'target [ref=e3]'],
						element: 'matched',
						key: 'target [ref=e3]',
					},
				]
				const result = reconstructTree(json, selectedElements) as Record<string, Record<string, unknown>[]>
				expect(result['root [ref=e1]']).toBeDefined()
				expect(result['root [ref=e1]'][0]['child [ref=e2]']).toBeDefined()
			})

			it('should preserve direct children of matched element', () => {
				const json = {
					'parent [ref=e1]': {
						'child1 [ref=e2]': 'value1',
						'child2 [ref=e3]': 'value2',
					},
				}
				const selectedElements = [
					{
						score: 0.9,
						path: ['parent [ref=e1]'],
						element: { 'child1 [ref=e2]': 'value1', 'child2 [ref=e3]': 'value2' },
						key: 'parent [ref=e1]',
					},
				]
				const result = reconstructTree(json, selectedElements) as Record<string, Record<string, string>>
				expect(result['parent [ref=e1]']['child1 [ref=e2]']).toBe('value1')
				expect(result['parent [ref=e1]']['child2 [ref=e3]']).toBe('value2')
			})

			it('should deduplicate overlapping branches', () => {
				const json = {
					'root [ref=e1]': [
						{
							'shared [ref=e2]': [{ 'match1 [ref=e3]': 'val1' }, { 'match2 [ref=e4]': 'val2' }],
						},
					],
				}
				const selectedElements = [
					{
						score: 0.9,
						path: ['root [ref=e1]', 0, 'shared [ref=e2]', 0, 'match1 [ref=e3]'],
						element: 'val1',
						key: 'match1 [ref=e3]',
					},
					{
						score: 0.8,
						path: ['root [ref=e1]', 0, 'shared [ref=e2]', 1, 'match2 [ref=e4]'],
						element: 'val2',
						key: 'match2 [ref=e4]',
					},
				]
				const result = reconstructTree(json, selectedElements) as Record<string, Record<string, unknown>[]>
				expect(result['root [ref=e1]']).toHaveLength(1)
				expect(result['root [ref=e1]'][0]['shared [ref=e2]']).toBeDefined()
			})
		})
	})

	describe('Snapshot Filter', () => {
		describe('filterSnapshot', () => {
			it('should return original JSON when step is undefined', async () => {
				const json = { key: 'value' }
				expect(await filterSnapshot(json, undefined)).toEqual(json)
			})

			it('should prefer step.search over semantic action and expectation when provided', async () => {
				const json = {
					'generic [ref=e1]': [
						{
							'link "Models" [ref=e7]': 'value1',
						},
						{
							'link "GitHub" [ref=e8]': 'value2',
						},
						{
							'textbox "Search models" [ref=e19]': 'value3',
						},
					],
				}
				const step: Step = {
					action: 'open models page',
					expect: 'models link is available',
					search: ['GitHub'],
				}
				const result = (await filterSnapshot(json, step)) as JsonValue
				const resultStr = JSON.stringify(result)
				expect(resultStr).toContain('GitHub')
				expect(resultStr).not.toContain('Models')
			})

			it('should fall back to step.search when action and expectation are blank', async () => {
				const json = {
					'generic [ref=e1]': [
						{
							'textbox "Search models" [ref=e19]': 'value',
						},
						{
							'link "GitHub" [ref=e20]': 'value',
						},
					],
				}
				const step: Step = {
					action: '',
					expect: '',
					search: ['Search models'],
				}
				const result = (await filterSnapshot(json, step)) as JsonValue
				const resultStr = JSON.stringify(result)
				expect(resultStr).toContain('Search models')
				expect(resultStr).not.toContain('GitHub')
			})

			it('should filter snapshot from the combined action and expectation query', async () => {
				const json = {
					'generic [ref=e1]': [
						{
							'textbox "Search models" [ref=e19]': 'value',
						},
						{
							'link "Download" [ref=e21]': 'value',
						},
					],
				}
				const step: Step = {
					action: 'type in search models',
					expect: 'search models textbox is visible',
				}
				const result = (await filterSnapshot(json, step)) as JsonValue
				const resultStr = JSON.stringify(result)
				expect(resultStr).toContain('Search models')
				expect(resultStr).not.toContain('Download')
			})

			it('should use explicit topPercent instead of the default top-percent selection when provided', async () => {
				const json = {
					'generic [ref=e1]': [
						{
							'link "Models" [ref=e7]': 'value1',
						},
						{
							'link "GitHub" [ref=e8]': 'value2',
						},
					],
				}

				const step: Step = {
					action: 'models',
					expect: 'models link is visible',
					topPercent: 100,
				}

				const result = (await filterSnapshot(json, step)) as JsonValue
				const resultStr = JSON.stringify(result)

				expect(resultStr).toContain('Models')
				expect(resultStr).toContain('GitHub')
			})

			it('should filter snapshot using provided elements', async () => {
				const json = {
					'generic [active] [ref=e1]': [
						{
							'banner [ref=e2]': [
								{
									'navigation [ref=e3]': [
										{
											'link "Ollama" [ref=e4]': [{ '/url': '/' }],
										},
										{
											'generic [ref=e6]': [
												{
													'link "Models" [ref=e7] [cursor=pointer]': [{ '/url': '/models' }],
												},
												{
													'link "GitHub" [ref=e8] [cursor=pointer]': [
														{ '/url': 'https://github.com' },
													],
												},
											],
										},
										{
											'generic [ref=e15]': ['img [ref=e17]', 'textbox "Search models" [ref=e19]'],
										},
									],
								},
							],
						},
						{
							'main [ref=e23]': [
								{
									'generic [ref=e24]': [
										{
											'link "Download" [ref=e35] [cursor=pointer]': [{ '/url': '/download' }],
										},
									],
								},
							],
						},
					],
				}
				const step: Step = {
					action: 'Navigate and search',
					expect: 'see models',
					search: ['Search models', 'qwen3-vl', 'qwen3-vl:235b', 'model details', 'capabilities'],
				}
				const result = (await filterSnapshot(json, step)) as JsonValue
				expect(result).toBeDefined()
				expect(JSON.stringify(result)).toContain('Search models')
			})

			it('should handle the example from the spec with elements', async () => {
				const inputSnapshot = {
					'generic [active] [ref=e1]': [
						{
							'banner [ref=e2]': [
								{
									'navigation [ref=e3]': [
										{
											'link "Ollama" [ref=e4] [cursor=pointer]': [
												{ '/url': '/' },
												'img "Ollama" [ref=e5]',
											],
										},
										{
											'generic [ref=e6]': [
												{
													'link "Models" [ref=e7] [cursor=pointer]': [{ '/url': '/models' }],
												},
												{
													'link "GitHub" [ref=e8] [cursor=pointer]': [
														{ '/url': 'https://github.com/ollama/ollama' },
													],
												},
												{
													'link "Discord" [ref=e9] [cursor=pointer]': [
														{ '/url': 'https://discord.gg/ollama' },
													],
												},
												{
													'link "Docs" [ref=e10] [cursor=pointer]': [{ '/url': '/docs' }],
												},
												{
													'link "Cloud" [ref=e11] [cursor=pointer]': [{ '/url': '/cloud' }],
												},
											],
										},
										{
											'generic [ref=e15]': ['img [ref=e17]', 'textbox "Search models" [ref=e19]'],
										},
										{
											'generic [ref=e20]': [
												{
													'link "Sign in" [ref=e21] [cursor=pointer]': [
														{ '/url': '/signin' },
													],
												},
												{
													'link "Download" [ref=e22] [cursor=pointer]': [
														{ '/url': '/download' },
													],
												},
											],
										},
									],
								},
							],
						},
						{
							'main [ref=e23]': [
								{
									'generic [ref=e24]': [
										{
											'link "Ollama floating on a cloud" [ref=e25] [cursor=pointer]': [
												{ '/url': 'https://ollama.com/blog/cloud-models' },
												'img "Ollama floating on a cloud" [ref=e26]',
											],
										},
										{
											'paragraph [ref=e27]': [
												{
													'link "Cloud models" [ref=e28] [cursor=pointer]': [
														{ '/url': 'https://ollama.com/blog/cloud-models' },
													],
												},
												{ text: 'are now available in Ollama' },
											],
										},
									],
								},
							],
						},
						{
							'contentinfo [ref=e37]': [
								{
									'generic [ref=e39]': [
										{ 'generic [ref=e40]': '© 2025 Ollama' },
										{
											'generic [ref=e41]': [
												{
													'link "Download" [ref=e42] [cursor=pointer]': [
														{ '/url': '/download' },
													],
												},
												{
													'link "Blog" [ref=e43] [cursor=pointer]': [{ '/url': '/blog' }],
												},
											],
										},
									],
								},
							],
						},
					],
				}

				const step: Step = {
					action: "Navigate to https://ollama.com/ type 'qwen3' into the 'Search models' search bar click on 'qwen3-vl' link",
					expect: 'qwen3-vl:235b model page is displayed with model details',
					search: ['Search models', 'qwen3-vl', 'qwen3-vl:235b', 'model details', 'capabilities'],
				}

				const result = await filterSnapshot(inputSnapshot, step)
				const resultStr = JSON.stringify(result)

				expect(resultStr).toContain('Search models')
				expect(resultStr).toContain('ref=e19')
			})
		})
	})
})
