import type { Html } from '../html.ts'
import { downloadMenu } from './menu.ts'

export const examples: Array<[string, Html | string]> = [
	['downloadMenu', downloadMenu({ label: 'Download', base: '#plan', note: 'The plan as a file.' })],
	[
		'downloadMenu with JUnit',
		downloadMenu({
			label: 'Download report',
			base: '#run',
			note: 'The run report.',
			formats: ['html', 'md', 'json', 'junit'],
		}),
	],
]
