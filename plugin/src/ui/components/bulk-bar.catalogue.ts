import type { Html } from '../html.ts'
import { bulkBar } from './bulk-bar.ts'

export const examples: Array<[string, Html | string]> = [
	['bulkBar (hidden until rows are picked)', bulkBar({ planId: 'checkout', csrf: 'catalogue' })],
]
