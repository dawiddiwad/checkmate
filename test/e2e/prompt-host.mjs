#!/usr/bin/env node
// A Pi host that keeps each prompt it gets and answers that it did nothing. It never touches the record.
import { appendFileSync, readFileSync } from 'node:fs'
const prompt = readFileSync(0, 'utf8')
appendFileSync(process.env.FAKE_PI_PROMPTS, `${prompt}\n=====\n`)
console.log(
	JSON.stringify({
		type: 'agent_end',
		messages: [
			{
				role: 'assistant',
				provider: 'fake',
				model: 'default-model',
				stopReason: 'stop',
				content: [
					{ type: 'text', text: JSON.stringify({ status: 'completed', subject: 'none', reasons: [] }) },
				],
			},
		],
		willRetry: false,
	})
)
console.log(JSON.stringify({ type: 'agent_settled', aborted: false }))
