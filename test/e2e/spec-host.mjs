#!/usr/bin/env node
import { readFileSync } from 'node:fs'
const args = process.argv.slice(2)
if (!args.includes('--no-tools') || !args.includes('--no-mcp')) throw Error('Reviewer received tools')
if (Object.keys(process.env).some((key) => key.startsWith('CHECKMATE_'))) throw Error('Reviewer inherited authority')
const prompt = readFileSync(0, 'utf8')
if (!prompt.includes('The quote is 240. Does the promotion replace loyalty?')) throw Error('Ticket missing')
const answered = prompt.includes('The promotion replaces loyalty.')
const entries = [
	{
		kind: 'review',
		source: 'ticket.md',
		evidence: 'The quote is 240.',
		rationale: answered ? 'Reviewed the owner answer.' : 'Reviewed the open question.',
	},
]
if (!answered)
	entries.push({
		kind: 'question',
		source: 'ticket.md',
		evidence: 'Does the promotion replace loyalty?',
		question: 'Does the promotion replace loyalty?',
		consequence: 'The combined quote is unclear.',
		testIds: ['T1'],
		requirementIds: [],
	})
console.log(
	JSON.stringify({
		type: 'agent_end',
		messages: [
			{ role: 'assistant', stopReason: 'stop', content: [{ type: 'text', text: JSON.stringify(entries) }] },
		],
		willRetry: false,
	})
)
console.log(JSON.stringify({ type: 'agent_settled', aborted: false }))
