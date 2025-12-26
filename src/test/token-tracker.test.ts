import { describe, it, expect, beforeEach, vi } from 'vitest'
import { TokenTracker } from '../step/openai/token-tracker'
import { ConfigurationManager } from '../step/configuration-manager'
import { ChatCompletion } from 'openai/resources/chat/completions'

vi.mock('../../src/step/openai/openai-test-manager', () => ({
	logger: {
		info: vi.fn(),
		warn: vi.fn(),
		error: vi.fn(),
		debug: vi.fn(),
	},
}))

describe('TokenTracker', () => {
	let tokenTracker: TokenTracker
	let mockConfig: ConfigurationManager

	beforeEach(() => {
		mockConfig = {
			getTokenBudgetUSD: vi.fn().mockReturnValue(undefined),
			getTokenBudgetCount: vi.fn().mockReturnValue(undefined),
			getModel: vi.fn().mockReturnValue('gpt-4o-mini'),
		} as any

		tokenTracker = new TokenTracker(mockConfig)
	})

	describe('budget enforcement - USD', () => {
		it('should throw error when USD budget is exceeded', () => {
			vi.mocked(mockConfig.getTokenBudgetUSD).mockReturnValue(0.01)

			const response: ChatCompletion = {
				id: 'test',
				object: 'chat.completion',
				created: Date.now(),
				model: 'gpt-4o-mini',
				choices: [],
				usage: {
					prompt_tokens: 100000,
					completion_tokens: 100000,
					total_tokens: 200000,
				},
			}

			expect(() => {
				tokenTracker.log(response, 0, 'gpt-4o-mini')
			}).toThrow(/OpenAI API budget of 0\.01\$ per test exceeded/)
		})

		it('should not throw error when USD budget is not set', () => {
			vi.mocked(mockConfig.getTokenBudgetUSD).mockReturnValue(undefined)

			const response: ChatCompletion = {
				id: 'test',
				object: 'chat.completion',
				created: Date.now(),
				model: 'gpt-4o-mini',
				choices: [],
				usage: {
					prompt_tokens: 1000000,
					completion_tokens: 1000000,
					total_tokens: 2000000,
				},
			}

			expect(() => {
				tokenTracker.log(response, 0, 'gpt-4o-mini')
			}).not.toThrow()
		})

		it('should not throw error when within USD budget', () => {
			vi.mocked(mockConfig.getTokenBudgetUSD).mockReturnValue(10.0)

			const response: ChatCompletion = {
				id: 'test',
				object: 'chat.completion',
				created: Date.now(),
				model: 'gpt-4o-mini',
				choices: [],
				usage: {
					prompt_tokens: 100,
					completion_tokens: 100,
					total_tokens: 200,
				},
			}

			expect(() => {
				tokenTracker.log(response, 0, 'gpt-4o-mini')
			}).not.toThrow()
		})

		it('should accumulate costs across multiple calls', () => {
			vi.mocked(mockConfig.getTokenBudgetUSD).mockReturnValue(0.05)

			const response1: ChatCompletion = {
				id: 'test1',
				object: 'chat.completion',
				created: Date.now(),
				model: 'gpt-4o-mini',
				choices: [],
				usage: {
					prompt_tokens: 50000,
					completion_tokens: 50000,
					total_tokens: 100000,
				},
			}

			const response2: ChatCompletion = {
				id: 'test2',
				object: 'chat.completion',
				created: Date.now(),
				model: 'gpt-4o-mini',
				choices: [],
				usage: {
					prompt_tokens: 50000,
					completion_tokens: 50000,
					total_tokens: 100000,
				},
			}

			expect(() => {
				tokenTracker.log(response1, 0, 'gpt-4o-mini')
			}).not.toThrow()

			expect(() => {
				tokenTracker.log(response2, 0, 'gpt-4o-mini')
			}).toThrow(/OpenAI API budget of 0\.05\$ per test exceeded/)
		})
	})

	describe('budget enforcement - token count', () => {
		it('should throw error when token count budget is exceeded', () => {
			vi.mocked(mockConfig.getTokenBudgetCount).mockReturnValue(100)

			const response: ChatCompletion = {
				id: 'test',
				object: 'chat.completion',
				created: Date.now(),
				model: 'gpt-4o-mini',
				choices: [],
				usage: {
					prompt_tokens: 60,
					completion_tokens: 50,
					total_tokens: 110,
				},
			}

			expect(() => {
				tokenTracker.log(response, 0, 'gpt-4o-mini')
			}).toThrow(/OpenAI API budget of 100 tokens per test exceeded\. Total tokens used: 110/)
		})

		it('should not throw error when token count budget is not set', () => {
			vi.mocked(mockConfig.getTokenBudgetCount).mockReturnValue(undefined)

			const response: ChatCompletion = {
				id: 'test',
				object: 'chat.completion',
				created: Date.now(),
				model: 'gpt-4o-mini',
				choices: [],
				usage: {
					prompt_tokens: 1000000,
					completion_tokens: 1000000,
					total_tokens: 2000000,
				},
			}

			expect(() => {
				tokenTracker.log(response, 0, 'gpt-4o-mini')
			}).not.toThrow()
		})

		it('should not throw error when within token count budget', () => {
			vi.mocked(mockConfig.getTokenBudgetCount).mockReturnValue(1000)

			const response: ChatCompletion = {
				id: 'test',
				object: 'chat.completion',
				created: Date.now(),
				model: 'gpt-4o-mini',
				choices: [],
				usage: {
					prompt_tokens: 400,
					completion_tokens: 400,
					total_tokens: 800,
				},
			}

			expect(() => {
				tokenTracker.log(response, 0, 'gpt-4o-mini')
			}).not.toThrow()
		})

		it('should accumulate token counts across multiple calls', () => {
			vi.mocked(mockConfig.getTokenBudgetCount).mockReturnValue(200)

			const response1: ChatCompletion = {
				id: 'test1',
				object: 'chat.completion',
				created: Date.now(),
				model: 'gpt-4o-mini',
				choices: [],
				usage: {
					prompt_tokens: 60,
					completion_tokens: 60,
					total_tokens: 120,
				},
			}

			const response2: ChatCompletion = {
				id: 'test2',
				object: 'chat.completion',
				created: Date.now(),
				model: 'gpt-4o-mini',
				choices: [],
				usage: {
					prompt_tokens: 50,
					completion_tokens: 50,
					total_tokens: 100,
				},
			}

			expect(() => {
				tokenTracker.log(response1, 0, 'gpt-4o-mini')
			}).not.toThrow()

			expect(() => {
				tokenTracker.log(response2, 0, 'gpt-4o-mini')
			}).toThrow(/OpenAI API budget of 200 tokens per test exceeded\. Total tokens used: 220/)
		})
	})

	describe('budget enforcement - both USD and token count', () => {
		it('should throw error when USD budget is exceeded first', () => {
			vi.mocked(mockConfig.getTokenBudgetUSD).mockReturnValue(0.001)
			vi.mocked(mockConfig.getTokenBudgetCount).mockReturnValue(1000000)

			const response: ChatCompletion = {
				id: 'test',
				object: 'chat.completion',
				created: Date.now(),
				model: 'gpt-4o-mini',
				choices: [],
				usage: {
					prompt_tokens: 10000,
					completion_tokens: 10000,
					total_tokens: 20000,
				},
			}

			expect(() => {
				tokenTracker.log(response, 0, 'gpt-4o-mini')
			}).toThrow(/OpenAI API budget of 0\.001\$ per test exceeded/)
		})

		it('should throw error when token count budget is exceeded first', () => {
			vi.mocked(mockConfig.getTokenBudgetUSD).mockReturnValue(100)
			vi.mocked(mockConfig.getTokenBudgetCount).mockReturnValue(10)

			const response: ChatCompletion = {
				id: 'test',
				object: 'chat.completion',
				created: Date.now(),
				model: 'gpt-4o-mini',
				choices: [],
				usage: {
					prompt_tokens: 8,
					completion_tokens: 8,
					total_tokens: 16,
				},
			}

			expect(() => {
				tokenTracker.log(response, 0, 'gpt-4o-mini')
			}).toThrow(/OpenAI API budget of 10 tokens per test exceeded\. Total tokens used: 16/)
		})
	})

	describe('resetStep', () => {
		it('should reset step token counts to zero', () => {
			const response: ChatCompletion = {
				id: 'test',
				object: 'chat.completion',
				created: Date.now(),
				model: 'gpt-4o-mini',
				choices: [],
				usage: {
					prompt_tokens: 100,
					completion_tokens: 50,
					total_tokens: 150,
				},
			}

			tokenTracker.log(response, 0, 'gpt-4o-mini')

			tokenTracker.resetStep()

			const response2: ChatCompletion = {
				id: 'test2',
				object: 'chat.completion',
				created: Date.now(),
				model: 'gpt-4o-mini',
				choices: [],
				usage: {
					prompt_tokens: 75,
					completion_tokens: 25,
					total_tokens: 100,
				},
			}

			expect(() => {
				tokenTracker.log(response2, 0, 'gpt-4o-mini')
			}).not.toThrow()
		})

		it('should not affect test token counts', () => {
			vi.mocked(mockConfig.getTokenBudgetCount).mockReturnValue(300)

			const response1: ChatCompletion = {
				id: 'test1',
				object: 'chat.completion',
				created: Date.now(),
				model: 'gpt-4o-mini',
				choices: [],
				usage: {
					prompt_tokens: 100,
					completion_tokens: 50,
					total_tokens: 150,
				},
			}

			const response2: ChatCompletion = {
				id: 'test2',
				object: 'chat.completion',
				created: Date.now(),
				model: 'gpt-4o-mini',
				choices: [],
				usage: {
					prompt_tokens: 100,
					completion_tokens: 50,
					total_tokens: 150,
				},
			}

			tokenTracker.log(response1, 0, 'gpt-4o-mini')

			tokenTracker.resetStep()

			tokenTracker.log(response2, 0, 'gpt-4o-mini')

			const response3: ChatCompletion = {
				id: 'test3',
				object: 'chat.completion',
				created: Date.now(),
				model: 'gpt-4o-mini',
				choices: [],
				usage: {
					prompt_tokens: 100,
					completion_tokens: 50,
					total_tokens: 150,
				},
			}

			expect(() => {
				tokenTracker.log(response3, 0, 'gpt-4o-mini')
			}).toThrow(/OpenAI API budget of 300 tokens per test exceeded/)
		})
	})

	describe('log with missing usage data', () => {
		it('should handle response without usage data', () => {
			const response: ChatCompletion = {
				id: 'test',
				object: 'chat.completion',
				created: Date.now(),
				model: 'gpt-4o-mini',
				choices: [],
			}

			expect(() => {
				tokenTracker.log(response, 100, 'gpt-4o-mini')
			}).not.toThrow()
		})

		it('should handle response with partial usage data', () => {
			const response: ChatCompletion = {
				id: 'test',
				object: 'chat.completion',
				created: Date.now(),
				model: 'gpt-4o-mini',
				choices: [],
				usage: {
					prompt_tokens: 0,
					completion_tokens: 0,
					total_tokens: 0,
				},
			}

			expect(() => {
				tokenTracker.log(response, 50, 'gpt-4o-mini')
			}).not.toThrow()
		})
	})

	describe('edge cases', () => {
		it('should handle zero token usage', () => {
			vi.mocked(mockConfig.getTokenBudgetCount).mockReturnValue(100)

			const response: ChatCompletion = {
				id: 'test',
				object: 'chat.completion',
				created: Date.now(),
				model: 'gpt-4o-mini',
				choices: [],
				usage: {
					prompt_tokens: 0,
					completion_tokens: 0,
					total_tokens: 0,
				},
			}

			expect(() => {
				tokenTracker.log(response, 0, 'gpt-4o-mini')
			}).not.toThrow()
		})

		it('should handle exact budget match for token count', () => {
			vi.mocked(mockConfig.getTokenBudgetCount).mockReturnValue(100)

			const response: ChatCompletion = {
				id: 'test',
				object: 'chat.completion',
				created: Date.now(),
				model: 'gpt-4o-mini',
				choices: [],
				usage: {
					prompt_tokens: 50,
					completion_tokens: 50,
					total_tokens: 100,
				},
			}

			expect(() => {
				tokenTracker.log(response, 0, 'gpt-4o-mini')
			}).not.toThrow()
		})

		it('should throw on budget exceeded by 1 token', () => {
			vi.mocked(mockConfig.getTokenBudgetCount).mockReturnValue(100)

			const response: ChatCompletion = {
				id: 'test',
				object: 'chat.completion',
				created: Date.now(),
				model: 'gpt-4o-mini',
				choices: [],
				usage: {
					prompt_tokens: 51,
					completion_tokens: 50,
					total_tokens: 101,
				},
			}

			expect(() => {
				tokenTracker.log(response, 0, 'gpt-4o-mini')
			}).toThrow(/OpenAI API budget of 100 tokens per test exceeded\. Total tokens used: 101/)
		})
	})
})
