import { readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

export async function replay(role, session) {
	const path = join(process.env.QA_REPLAY_DIR, `${session}.json`)
	if (role === 'tester') {
		const response = await fetch(`${process.env.QA_APP_URL}/quote?promotion=true&loyalty=true`)
		const body = await response.json()
		writeFileSync(path, JSON.stringify({ status: response.status, total: body.totalPLN }))
		return 'Observed the quote.'
	}
	const observed = JSON.parse(readFileSync(path, 'utf8'))
	if (observed.status !== 200) throw Error(`Unexpected HTTP status ${observed.status}`)
	const evidence = `HTTP ${observed.status}: ${observed.total} PLN (session ${session})`
	if (observed.total !== 240 && process.env.QA_RETEST === '1')
		return [{ kind: 'verdict', defect: 'a1/D1', result: 'not_fixed', saw: evidence, evidence }]
	if (observed.total !== 240)
		return [
			{
				kind: 'defect',
				id: 'D1',
				rule: 'R1',
				title: 'Promotion total is wrong',
				severity: 'high',
				expected: '240 PLN',
				actual: `${observed.total} PLN`,
				evidence,
			},
		]
	return [
		{
			kind: 'criterion',
			rule: 'R1',
			text: 'The promotion quote is 240 PLN.',
			source: 'ticket.md',
			verdict: 'ok',
			saw: evidence,
		},
	]
}
