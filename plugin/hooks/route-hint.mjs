// UserPromptSubmit hint: when the person asks to test, QA, check, verify or retest a change,
// a ticket or a build, add one line that points to the Checkmate test skill. It is a hint only.
// It never blocks the prompt: any error leaves the prompt unchanged.

const hint =
	'This request looks like a test of an application change. Use the checkmate:test skill, which starts independent testers and records what they find. The operator does not test or use curl as a test.'

// A request to test the application: a test verb with a change, ticket, build, feature or application noun.
const testVerb =
	/\b(test|tests|testing|qa|check|verify|retest|validate)\b|\b(meets?|passes?)\b.*\b(criteria|ticket|requirements?|spec|acceptance)\b/i
const subject =
	/\b(change|changes|ticket|build|feature|acceptance|criteria|requirements?|shop|cart|app|application|release|my app|coupon|discount|checkout|order|site|website|flow|endpoint|api)\b|\.md\b|\bSHOP-\d+\b/i

// Development work on the code's own tests, and other unrelated requests. These stay silent.
const development =
	/\b(unit|npm|yarn|pnpm|jest|vitest|mocha|pytest|snapshot|fixture|spec file|lint|linter|format|flaky|ci|pipeline|workflow|benchmark|coverage)\b|\b(fix|write|add|create|update|delete|remove|rename|refactor|debug)\b.*\btests?\b|\bfix\b.*\b(failing|broken|flaky)\b|\bwhy (is|does)\b|\btests?\b.*\b(fail|failing|broken|red|green|timeout)\b|\bexplain\b|\bwhat is\b|\bhow do i\b|\bhow to\b|\binstall\b|\bcreate a ticket\b|\bsummari[sz]e\b|\bpull request\b|\bpr\b/i

export function routeHint(prompt) {
	if (typeof prompt !== 'string' || !prompt.trim()) return null
	if (!testVerb.test(prompt) || !subject.test(prompt)) return null
	if (development.test(prompt)) return null
	return hint
}

async function main() {
	let input = ''
	for await (const chunk of process.stdin) input += chunk
	const event = JSON.parse(input || '{}')
	const text = routeHint(event.prompt)
	if (text) {
		process.stdout.write(
			JSON.stringify({ hookSpecificOutput: { hookEventName: 'UserPromptSubmit', additionalContext: text } })
		)
	}
}

if (process.argv[1] && import.meta.url === new URL(`file://${process.argv[1]}`).href) {
	main()
		.catch(() => {})
		.finally(() => process.exit(0))
}
