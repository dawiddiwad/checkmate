import process from 'node:process'
import { z } from 'zod/v4'
import { defineDriverTool } from '@xoxoai/checkmate/driver'

if (process.env.CHECKMATE_ASSERT_STATIC === '1') throw new Error('Static preparation imported the driver executable')

export const checkmateDriver = {
	id: 'fixture',
	driverContractVersion: 1,
	async start() {
		return {
			tools: [
				defineDriverTool({
					name: 'fixture_generate',
					description: 'Generate a structured fixture fact',
					schema: z.object({}).strict(),
					handler: async (_args, { generateStructured }) => {
						const request = {
							messages: [
								{
									role: 'user',
									content: [
										{
											type: 'text',
											text: 'Inspect fixture fact: ready. Credential: provider-secret',
										},
									],
								},
							],
							schemaName: 'fixture_fact',
							schema: {
								type: 'object',
								properties: { fact: { type: 'string' } },
								required: ['fact'],
								additionalProperties: false,
							},
						}
						await generateStructured(request)
						return JSON.stringify((await generateStructured(request)).value)
					},
				}),
			],
			instructions: ['Call fixture_generate before verifying each step.'],
			buildInitialContext: async () => [],
			handleToolResponses: async () => [],
			close: async () => undefined,
		}
	},
}
