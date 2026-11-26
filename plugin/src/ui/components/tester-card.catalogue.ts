import type { Html } from '../html.ts'
import { statusMark } from './status-mark.ts'
import { testerCard, timeline } from './tester-card.ts'

export const examples: Array<[string, Html | string]> = [
	[
		'testerCard running',
		testerCard({
			id: 'tester-a1',
			key: 'explorer:a1',
			href: '#',
			label: 'a1',
			mark: statusMark({ state: 'running' }),
			phase: 'test',
			line: 'In its test turn. No activity line yet.',
			stats: ['14 min 9 s', 'cost $0.04'],
		}),
	],
	[
		'testerCard done',
		testerCard({
			id: 'tester-a2',
			key: 'explorer:a2',
			href: '#',
			label: 'a2',
			mark: statusMark({ state: 'passed', label: 'Finished' }),
			phase: 'study',
			line: 'Studied the checkout and the coupon rules.',
			stats: ['3 min', 'cost —'],
			done: true,
		}),
	],
	[
		'timeline',
		timeline({
			label: 'After the testers',
			events: [
				{
					id: 'p-1',
					key: 'phase:record',
					href: '#',
					label: 'record',
					mark: statusMark({ state: 'pending', label: '' }),
					text: 'Starts after the explorers.',
					meta: 'pending',
				},
				{
					id: 'p-2',
					key: 'phase:verify',
					href: '#',
					label: 'verify',
					mark: statusMark({ state: 'not_run', label: '' }),
					text: 'Did not run.',
					meta: 'not run',
				},
			],
		}),
	],
]
