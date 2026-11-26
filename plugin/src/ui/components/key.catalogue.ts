import type { Html } from '../html.ts'
import { key } from './key.ts'

export const examples: Array<[string, Html | string]> = [
	['key spoken', key({ name: 'Enter' })],
	['key hidden from screen readers', key({ name: 1, spoken: false })],
]
