import type { Html } from '../html.ts'
import type { CellState } from './board.ts'
import { board, boardCell, boardKey, resultCell } from './board.ts'

const states: CellState[] = ['passed', 'failed', 'question', 'running', 'not_checked']

export const examples: Array<[string, Html | string]> = [
	...states.map((state): [string, Html | string] => [`boardCell ${state}`, boardCell({ state })]),
	...states.map((state): [string, Html | string] => [
		`boardCell ${state} labelled`,
		boardCell({ state, label: `B2 ${state}`, build: 'build-2', buildLabel: 'B2' }),
	]),
	...['passed', 'failed', 'inconclusive', 'running', null].map((result): [string, Html | string] => [
		`resultCell ${result ?? 'no result'}`,
		resultCell({ result }),
	]),
	[
		'board',
		board({
			label: 'Rules against the last 2 builds',
			builds: [
				{ build: 'build-1', label: 'B1', cells: ['passed', 'failed', 'not_checked'] },
				{ build: 'build-2', label: 'B2', cells: ['passed', 'question', 'failed'] },
			],
		}),
	],
	['board without builds', board({ builds: [], label: 'No build' })],
	['boardKey', boardKey],
]
