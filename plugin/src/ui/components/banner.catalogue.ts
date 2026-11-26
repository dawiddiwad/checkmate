import type { Html } from '../html.ts'
import { blockingBanner } from './banner.ts'

export const examples: Array<[string, Html | string]> = [
	[
		'blockingBanner one',
		blockingBanner({
			count: 1,
			title: 'question blocks testing',
			text: 'Testers wait on these answers. Everything else can wait.',
			action: 'Answer the first',
			href: '#',
		}),
	],
	[
		'blockingBanner many',
		blockingBanner({
			count: 3,
			title: 'questions block testing',
			text: 'Testers wait on these answers. Everything else can wait.',
			action: 'Answer the first',
			href: '#',
		}),
	],
]
