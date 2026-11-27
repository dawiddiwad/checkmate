import type { Html } from '../html.ts'
import { statusCounts, statusMark, statusStates, statusWord, wordMark, wordStates } from './status-mark.ts'

export const examples: Array<[string, Html | string]> = [
	...statusStates.map((state): [string, Html | string] => [`statusMark ${state}`, statusMark({ state })]),
	['statusMark unknown state', statusMark({ state: 'something_new' })],
	['statusMark with label', statusMark({ state: 'approved', label: 'accepted' })],
	...wordStates.map((state): [string, Html | string] => [`wordMark ${state}`, wordMark({ state, label: state })]),
	['wordMark neutral', wordMark({ state: 'question', label: 'Question' })],
	['wordMark with title', wordMark({ state: 'cost', label: 'Total cost $0.42', title: 'Reported cost' })],
	['statusWord passed', statusWord({ state: 'completed', label: 'record' })],
	['statusWord not run', statusWord({ state: 'not_run', label: 'merge' })],
	[
		'statusCounts',
		statusCounts({ counts: { passed: 4, failed: 2, inconclusive: 1, error: 1, blocked: 1, not_run: 3 } }),
	],
	['statusCounts empty', statusCounts({ counts: {} })],
]
