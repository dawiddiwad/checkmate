import type { Html } from '../html.ts'
import { composer } from './composer.ts'

export const examples: Array<[string, Html | string]> = [
	[
		'composer Claude Code',
		composer({
			csrf: 'catalogue',
			action: '#',
			selection: { harness: 'claude', model: 'sonnet', provider: null, effort: null, modelId: 'sonnet' },
		}),
	],
	[
		'composer Pi with provider',
		composer({
			csrf: 'catalogue',
			action: '#',
			selection: { harness: 'pi', model: 'gpt-5', provider: 'openai', effort: 'high', modelId: 'openai/gpt-5' },
			back: '#',
		}),
	],
]
