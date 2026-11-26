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
			builds: [
				{ build: 'build-1', label: 'B1' },
				{ build: 'build-2', label: 'B2' },
			],
			columns: [
				{ label: 'R1', title: 'Login works', cells: ['passed', 'passed'] },
				{ label: 'R2', title: 'Checkout total', cells: ['failed', 'question'] },
				{ label: 'Out', title: 'Outside the rules', cells: ['not_checked', 'failed'] },
			],
		}),
	],
	['board without builds', board({ builds: [], columns: [] })],
	['boardKey', boardKey],
]
