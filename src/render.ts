import type { Plan, Result } from './types.ts'
function escapeHtml(value: unknown) {
	return String(value).replace(
		/[&<>"']/g,
		(character) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[character]!
	)
}
function jsonBlock(value: unknown) {
	const json = JSON.stringify(value, null, 2)
	const fence = '`'.repeat(Math.max(3, ...[...json.matchAll(/`+/g)].map((match) => match[0].length + 1)))
	return `${fence}json\n${json}\n${fence}\n`
}
export function renderPlan(plan: Plan) {
	return (
		'# Test plan\n\nThis view is generated from the saved JSON plan. Edit a new plan revision to change it.\n\n' +
		jsonBlock(plan)
	)
}
export function renderResult(result: Result) {
	const json = JSON.stringify(result, null, 2)
	return {
		md: '# Test result\n\nCompletion and coverage are separate. Inspect each test outcome.\n\n' + jsonBlock(result),
		html: `<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'"><title>Checkmate result</title><style>body{font:16px system-ui;max-width:80rem;margin:2rem auto;padding:1rem}pre{white-space:pre-wrap;overflow-wrap:anywhere}td,th{padding:.5rem;text-align:left}table{border-collapse:collapse}tr{border-bottom:1px solid #aaa}</style><h1>Test result</h1><p>Completion: ${escapeHtml(result.completion)}. Coverage: ${escapeHtml(result.coverage.status)}.</p><table><thead><tr><th>Test</th><th>Outcome</th><th>Observation</th></tr></thead><tbody>${result.tests.map((test) => `<tr><td>${escapeHtml(test.testId)}</td><td>${escapeHtml(test.outcome)}</td><td>${escapeHtml(test.observed ?? test.reason)}</td></tr>`).join('')}</tbody></table><h2>Complete record</h2><pre>${escapeHtml(json)}</pre></html>\n`,
	}
}
