import type { Html } from '../html.ts'
import { notice } from './notice.ts'

export const examples: Array<[string, Html | string]> = [
	['notice info', notice({ kind: 'info', content: 'The setup request is recorded.' })],
	['notice warn', notice({ kind: 'warn', content: 'This decision was for another digest.' })],
	['notice fail', notice({ kind: 'fail', content: 'Checkmate cannot read the recipes.' })],
]
