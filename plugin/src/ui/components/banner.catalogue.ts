import type { Html } from '../html.ts'
import { banner, blockingBanner } from './banner.ts'

export const examples: Array<[string, Html | string]> = [
	['banner warn', banner({ kind: 'warn', content: 'This decision was for another digest.' })],
	['banner info', banner({ kind: 'info', content: 'The setup request is recorded.' })],
	['banner fail', banner({ kind: 'fail', content: 'Checkmate cannot read the recipes.' })],
	['blockingBanner one', blockingBanner({ count: 1, href: '#' })],
	['blockingBanner many', blockingBanner({ count: 3, href: '#' })],
]
