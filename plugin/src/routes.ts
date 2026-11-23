// The request a test plans: its first "METHOD /path" in the action. A path placeholder such as <id> or {id}
// matches any one path segment. A check that names a request is decided only for the request that was sent.
export type PlannedRequest = { method: string; path: string }

export function plannedRequest(action: string): PlannedRequest | null {
	const match = /\b(GET|POST|PUT|PATCH|DELETE)\s+(\/[^\s,;)"'`]*)/.exec(action)
	if (!match) return null
	// The run marker in a path is one segment, and the sentence's full stop is not part of the path.
	const path = match[2].replaceAll('{{marker}}', '<id>').replace(/[.:]+$/, '')
	return { method: match[1], path }
}

// The request a check decides: the request its assertion names, else the first request of the test's action.
// A test with a control and a refusal names one request per check, so each check is matched to its own request.
export function checkRequest(action: string, named: string | undefined): PlannedRequest | null {
	return (named ? plannedRequest(named) : null) ?? plannedRequest(action)
}

function pathPattern(path: string) {
	const parts = path.split(/(<[^>]+>|\{[^}]+\})/)
	const source = parts
		.map((part) => (/^(<[^>]+>|\{[^}]+\})$/.test(part) ? '[^/]+' : part.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')))
		.join('')
	return new RegExp(`^${source}$`)
}

// "METHOD /path" as sent; a query string does not change the route.
export function requestMatches(planned: PlannedRequest, sent: string) {
	const [method = '', target = ''] = sent.trim().split(/\s+/)
	return method.toUpperCase() === planned.method && pathPattern(planned.path.split('?')[0]).test(target.split('?')[0])
}
