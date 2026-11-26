import type { Html } from '../html.ts'
import { targetCard } from './target-card.ts'

export const examples: Array<[string, Html | string]> = [
	[
		'targetCard',
		targetCard({
			targetId: 'shop-local',
			revision: 1,
			capabilities: ['browser', 'http'],
			entryPoints: ['web'],
			activeInstances: 2,
		}),
	],
	[
		'targetCard without profile',
		targetCard({ targetId: 'mobile', revision: null, capabilities: [], entryPoints: [], activeInstances: 0 }),
	],
]
