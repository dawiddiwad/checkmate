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
			instances: [
				{ instanceId: 'local', environment: 'local', address: 'http://127.0.0.1:4173' },
				{ instanceId: 'staging', environment: 'staging', address: null },
			],
		}),
	],
	[
		'targetCard without profile',
		targetCard({
			targetId: 'mobile',
			revision: null,
			capabilities: [],
			entryPoints: [],
			activeInstances: 0,
			instances: [],
		}),
	],
]
