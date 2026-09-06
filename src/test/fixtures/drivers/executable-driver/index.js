export const checkmateDriver = {
	id: 'fixture',
	driverContractVersion: 1,
	async start(input) {
		input.secrets.read('session')
		return {
			tools: [
				{
					definition: {
						name: 'fixture_read',
						description: 'Read the executable fixture',
						parameters: { type: 'object', additionalProperties: false },
						strict: true,
					},
					execute: async () => 'fixture read',
				},
			],
			instructions: [],
			buildInitialContext: async () => [],
			handleToolResponses: async () => [],
			close: async () => undefined,
		}
	},
}
