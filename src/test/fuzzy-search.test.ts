import { describe, it, expect } from 'vitest'
import { tokenize, extractSearchTerms } from '../step/tool/fuzzy-search/tokenizer'
import { scoreElements, selectTopElements, JsonValue } from '../step/tool/fuzzy-search/scorer'
import { reconstructTree } from '../step/tool/fuzzy-search/tree-reconstructor'
import { filterSnapshot } from '../step/tool/fuzzy-search/snapshot-filter'
import { Step } from '../step/types'

describe('Fuzzy Search', () => {
	describe('Tokenizer', () => {
		describe('tokenize', () => {
			it('should return empty array for empty string', () => {
				expect(tokenize('')).toEqual([])
			})

			it('should return empty array for whitespace only', () => {
				expect(tokenize('   ')).toEqual([])
			})

			it('should split by spaces', () => {
				expect(tokenize('hello world')).toEqual(['hello', 'world'])
			})

			it('should convert to lowercase', () => {
				expect(tokenize('Hello World')).toEqual(['hello', 'world'])
			})

			it('should preserve single quoted strings as single token', () => {
				expect(tokenize("type 'Search models' input")).toEqual(['search models', 'type', 'input'])
			})

			it('should preserve double quoted strings as single token', () => {
				expect(tokenize('click "Submit Button" now')).toEqual(['submit button', 'click', 'now'])
			})

			it('should handle mixed quoted and unquoted tokens', () => {
				expect(tokenize('type Qwen3 in to "Search Models" input')).toEqual([
					'search models',
					'type',
					'qwen3',
					'in',
					'to',
					'input',
				])
			})

			it('should handle multiple quoted strings', () => {
				expect(tokenize("'first' and 'second'")).toEqual(['first', 'second', 'and'])
			})
		})

		describe('extractSearchTerms', () => {
			it('should combine tokens from action and expect', () => {
				const result = extractSearchTerms('click button', 'see result')
				expect(result).toContain('click')
				expect(result).toContain('button')
				expect(result).toContain('see')
				expect(result).toContain('result')
			})

			it('should deduplicate tokens', () => {
				const result = extractSearchTerms('click button', 'click result')
				const clickCount = result.filter((t) => t === 'click').length
				expect(clickCount).toBe(1)
			})

			it('should return empty array for empty inputs', () => {
				expect(extractSearchTerms('', '')).toEqual([])
			})
		})
	})

	describe('Scorer', () => {
		describe('scoreElements', () => {
			it('should return empty array for empty tokens', () => {
				const json = { key: 'value' }
				expect(scoreElements(json, [])).toEqual([])
			})

			it('should score string values', () => {
				const json = 'hello world'
				const results = scoreElements(json, ['hello'])
				expect(results.length).toBeGreaterThan(0)
				expect(results[0].score).toBeGreaterThan(0)
			})

			it('should score object keys', () => {
				const json = { 'link "Models" [ref=e7]': 'value' }
				const results = scoreElements(json, ['models'])
				expect(results.length).toBeGreaterThan(0)
			})

			it('should traverse nested objects', () => {
				const json = {
					outer: {
						inner: 'target value',
					},
				}
				const results = scoreElements(json, ['target'])
				expect(results.some((r) => r.path.includes('inner'))).toBe(true)
			})

			it('should traverse arrays', () => {
				const json = ['first', 'second', 'target']
				const results = scoreElements(json, ['target'])
				expect(results.some((r) => r.score > 0)).toBe(true)
			})

			it('should handle complex nested structures', () => {
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
				const results = scoreElements(json, ['search models'])
				expect(results.length).toBeGreaterThan(0)
			})
		})

		describe('selectTopElements', () => {
			it('should return top N elements by score', () => {
				const elements = [
					{ score: 0.5, path: ['a'], element: 'a', key: 'a' },
					{ score: 0.9, path: ['b'], element: 'b', key: 'b' },
					{ score: 0.3, path: ['c'], element: 'c', key: 'c' },
					{ score: 0.7, path: ['d'], element: 'd', key: 'd' },
				]
				const top2 = selectTopElements(elements, 2)
				expect(top2).toHaveLength(2)
				expect(top2[0].score).toBe(0.9)
				expect(top2[1].score).toBe(0.7)
			})

			it('should return all elements if count exceeds length', () => {
				const elements = [{ score: 0.5, path: ['a'], element: 'a', key: 'a' }]
				const result = selectTopElements(elements, 10)
				expect(result).toHaveLength(1)
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
				const result = reconstructTree(json, selectedElements) as any
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
				const result = reconstructTree(json, selectedElements) as any
				expect(result['parent [ref=e1]']['child1 [ref=e2]']).toBe('value1')
				expect(result['parent [ref=e1]']['child2 [ref=e3]']).toBe('value2')
			})

			it('should deduplicate overlapping branches', () => {
				const json = {
					'root [ref=e1]': [
						{
							'shared [ref=e2]': [
								{ 'match1 [ref=e3]': 'val1' },
								{ 'match2 [ref=e4]': 'val2' },
							],
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
				const result = reconstructTree(json, selectedElements) as any
				expect(result['root [ref=e1]']).toHaveLength(1)
				expect(result['root [ref=e1]'][0]['shared [ref=e2]']).toBeDefined()
			})
		})
	})

	describe('Snapshot Filter', () => {
		describe('filterSnapshot', () => {
			it('should return original JSON when step is undefined', () => {
				const json = { key: 'value' }
				expect(filterSnapshot(json, undefined)).toEqual(json)
			})

			it('should return original JSON when action and expect are empty', () => {
				const json = { key: 'value' }
				const step: Step = { action: '', expect: '' }
				expect(filterSnapshot(json, step)).toEqual(json)
			})

			it('should filter snapshot based on step action', () => {
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
											'generic [ref=e15]': [
												'img [ref=e17]',
												'textbox "Search models" [ref=e19]',
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
											'link "Download" [ref=e35] [cursor=pointer]': [{ '/url': '/download' }],
										},
									],
								},
							],
						},
					],
				}
				const step: Step = {
					action: 'type Qwen3 in to "Search Models" input',
					expect: 'should see models link',
				}
				const result = filterSnapshot(json, step) as JsonValue
				expect(result).toBeDefined()
				expect(JSON.stringify(result)).toContain('Search models')
			})

			it('should handle the example from the spec', () => {
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
											'generic [ref=e15]': [
												'img [ref=e17]',
												'textbox "Search models" [ref=e19]',
											],
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
					action: 'type Qwen3 in to "Search Models" input',
					expect: 'see Models link',
				}

				const result = filterSnapshot(inputSnapshot, step)
				const resultStr = JSON.stringify(result)

				expect(resultStr).toContain('Search models')
				expect(resultStr).toContain('Models')
				expect(resultStr).toContain('ref=e19')
				expect(resultStr).toContain('ref=e7')
			})
		})
	})
})
