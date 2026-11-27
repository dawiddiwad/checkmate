import type { Html } from '../html.ts'
import type { RequestRecord } from '../../requests.ts'
import type { ChatTurn } from './chat-turn.ts'
import { chatTurn } from './chat-turn.ts'

const at = new Date(Date.now() - 5 * 60_000).toISOString()

const request: RequestRecord = {
	id: 'R1',
	text: 'Which tests failed on checkout?',
	context: { planId: 'checkout', record: null },
	asker: 'qa-lead',
	conversation: 'chat-1',
	harness: 'claude',
	model: 'sonnet',
	provider: null,
	effort: null,
	modelId: 'sonnet',
	askedAt: at,
	state: 'answered',
	sessionId: null,
	activity: [{ at, line: 'Read the run report' }],
	reply: '**Two** tests failed: T1 and T2.',
	observedModels: [],
	costUsd: 0.02,
	costPartial: false,
	startedAt: at,
	endedAt: at,
	reason: null,
	hint: null,
	denials: [],
	changes: [{ text: 'Answered Q1', command: 'plan answer', subject: 'plan:checkout', at, href: '#' }],
	read: true,
}

const turn: ChatTurn = {
	request,
	number: 1,
	details: '#',
	back: '#',
	csrf: 'catalogue',
	model: 'sonnet',
	failure: null,
	waitingBehind: '',
	permissions: [],
	rowAttrs: { 'data-key': 'request:R1', 'data-label': 'Turn 1' },
}

export const examples: Array<[string, Html | string]> = [
	['chatTurn answered', chatTurn(turn)],
	[
		'chatTurn running with a permission request',
		chatTurn({
			...turn,
			number: 2,
			request: { ...request, id: 'R2', state: 'running', reply: null, changes: [], endedAt: null },
			permissions: [{ command: 'rm -rf build', href: '#' }],
		}),
	],
	[
		'chatTurn waiting',
		chatTurn({
			...turn,
			number: 3,
			request: { ...request, id: 'R3', state: 'waiting', reply: null, activity: [], changes: [] },
			waitingBehind: 'It starts after turn 2.',
		}),
	],
	[
		'chatTurn failed',
		chatTurn({
			...turn,
			number: 4,
			request: { ...request, id: 'R4', state: 'failed', reply: null, changes: [], reason: 'The host stopped.' },
			failure: { cause: 'The host stopped.', lines: ['line one', 'line two'], detail: 'Check the host login.' },
		}),
	],
	[
		'chatTurn stopped',
		chatTurn({
			...turn,
			number: 5,
			request: {
				...request,
				id: 'R5',
				state: 'stopped',
				reply: null,
				changes: [],
				reason: 'Stopped by qa-lead.',
			},
		}),
	],
]
