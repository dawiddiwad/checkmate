import OpenAI from 'openai'
import { ConfigurationManager } from '../../configuration-manager'
import { logger } from '../../openai/openai-test-manager'

const KEYWORD_EXTRACTION_PROMPT = `You are a keyword extraction assistant for UI test automation. Given a test step's action and expected result, extract the top 5 most relevant keywords or phrases that would help identify UI elements on a webpage.

Focus on:
- Specific UI element labels (button names, input field labels, link text)
- Unique identifiers or model names mentioned
- Key action targets and expected outcomes

Example: ["Search models", "qwen3-vl", "Submit button", "model details", "capabilities"]`

const DEFAULT_KEYWORD_COUNT = 5

export async function extractKeywordsFromLLM(action: string, expect: string): Promise<string[]> {
	logger.info(`extractKeywordsFromLLM: Starting extraction for action="${action.substring(0, 50)}..."`)

	const configurationManager = new ConfigurationManager()

	const client = new OpenAI({
		apiKey: configurationManager.getApiKey(),
		baseURL: configurationManager.getBaseURL(),
		timeout: 30000,
	})

	try {
		logger.debug(`extractKeywordsFromLLM: Calling LLM with model=${configurationManager.getModel()}`)

		const response = await client.chat.completions.create({
			model: configurationManager.getModel(),
			messages: [
				{ role: 'system', content: KEYWORD_EXTRACTION_PROMPT },
				{ role: 'user', content: `Action: ${action}\nExpected: ${expect}` },
			],
			temperature: 0,
			response_format: {
				type: 'json_schema',
				json_schema: {
					name: 'KeywordExtraction',
					description: 'Extracted keywords for UI element identification',
					schema: {
						$schema: 'http://json-schema.org/draft-07/schema#',
						type: 'object',
						properties: {
							keywords: {
								type: 'array',
								description: 'A string array of potential element keywords found in the test step.',
								items: {
									type: 'string',
								},
								minItems: 1,
								maxItems: 5,
							},
						},
						required: ['keywords'],
						additionalProperties: false,
					},
					strict: true,
				},
			},
		})

		logger.debug(`raw extract response: ${JSON.stringify(response, null, 2)}`)
		const content = response.choices[0]?.message?.content?.trim() ?? '[]'
		logger.debug(`extractKeywordsFromLLM: LLM raw response (${content.length} chars): ${content}`)

		const keywords = parseKeywordsResponse(content)

		logger.info(`extractKeywordsFromLLM: Extracted ${keywords.length} keywords: ${JSON.stringify(keywords)}`)
		return keywords.slice(0, DEFAULT_KEYWORD_COUNT)
	} catch (error) {
		logger.error(`extractKeywordsFromLLM: Failed to extract keywords: ${error}`)
		return []
	}
}

function parseKeywordsResponse(content: string): string[] {
	try {
		// Strip markdown code fences if present
		let cleanContent = content
		const codeBlockMatch = content.match(/```(?:json)?\s*([\s\S]*?)```/)
		if (codeBlockMatch) {
			cleanContent = codeBlockMatch[1].trim()
			logger.debug(`extractKeywordsFromLLM: Stripped markdown code fences, content: ${cleanContent}`)
		}

		const jsonMatch = cleanContent.match(/\[[\s\S]*\]/)
		if (!jsonMatch) {
			logger.warn(`extractKeywordsFromLLM: No JSON array found in response. Clean content: ${cleanContent}`)
			return []
		}

		const parsed = JSON.parse(jsonMatch[0])
		if (!Array.isArray(parsed)) {
			logger.warn(`extractKeywordsFromLLM: Parsed content is not an array`)
			return []
		}

		return parsed.filter((item): item is string => typeof item === 'string')
	} catch (parseError) {
		logger.warn(`extractKeywordsFromLLM: Failed to parse response: ${parseError}`)
		return []
	}
}
