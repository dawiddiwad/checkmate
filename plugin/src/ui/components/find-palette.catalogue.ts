import type { Html } from '../html.ts'
import { findPalette } from './find-palette.ts'

export const examples: Array<[string, Html | string]> = [
	['findPalette Claude Code (closed until / is pressed)', findPalette({ harness: 'claude' })],
	['findPalette Pi (closed until / is pressed)', findPalette({ harness: 'pi' })],
]
