import { spawnSync } from 'node:child_process'
import { readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

export async function replay(role, session) {
	const file = join(process.env.QA_REPLAY_DIR, `${session}.json`)
	if (role === 'tester') {
		const response = await fetch(`${process.env.QA_APP_URL}/quote?promotion=true&loyalty=true`)
		const body = await response.json()
		const query = spawnSync(
			process.execPath,
			[
				process.env.QA_CLI,
				'query',
				"SELECT actor, body FROM journal_entries WHERE kind = 'answer'",
				'--workspace',
				process.env.QA_WORKSPACE,
				'--json',
			],
			{ encoding: 'utf8' }
		)
		if (query.status !== 0) throw new Error(`Cannot read answers: ${query.stderr} ${query.stdout}`)
		const answers = JSON.parse(query.stdout).rows.map((row) => ({ actor: row.actor, ...JSON.parse(row.body) }))
		writeFileSync(
			file,
			JSON.stringify({
				status: response.status,
				body,
				answered: answers.some(
					(answer) =>
						answer.actor === 'oracle' &&
						answer.question === 'a1/Q1' &&
						answer.answer === 'The promotion replaces loyalty.'
				),
			})
		)
		return 'The quote and the oracle answers were observed.'
	}
	const observed = JSON.parse(readFileSync(file, 'utf8'))
	const evidence = `HTTP ${observed.status}: ${JSON.stringify(observed.body)}`
	if (observed.status !== 200) throw new Error(`Unexpected response: ${evidence}`)
	if (observed.body.totalPLN !== 240)
		return [
			{
				kind: 'defect',
				id: 'D1',
				rule: 'R1',
				title: 'Promotion total is wrong',
				severity: 'high',
				expected: '240 PLN',
				actual: `${observed.body.totalPLN} PLN`,
				evidence,
			},
			{
				kind: 'question',
				id: 'Q1',
				rule: process.env.QA_QUESTION_RULE || 'outside',
				question: 'Does the promotion replace the loyalty discount?',
				blocking: true,
			},
		]
	if (!observed.answered)
		return [{ kind: 'note', text: 'The promotion question has no answer. The rule was not checked.' }]
	return [
		{
			kind: 'criterion',
			rule: 'R1',
			text: 'The promotion quote is 240 PLN.',
			source: 'ticket.md',
			verdict: 'ok',
			saw: evidence,
		},
		{ kind: 'verdict', defect: 'a1/D1', result: 'fixed', saw: evidence, evidence },
	]
}
