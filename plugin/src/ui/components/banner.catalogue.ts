import type { Html } from '../html.ts'
import { blockingBanner } from './banner.ts'

export const examples: Array<[string, Html | string]> = [
	['blockingBanner one', blockingBanner({ count: 1, href: '#' })],
	['blockingBanner many', blockingBanner({ count: 3, href: '#' })],
]
