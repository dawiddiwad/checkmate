// The request a test plans: its first "METHOD /path" in the action. A path placeholder such as <id> or {id}
// matches any one path segment. A check that names a request is decided only for the request that was sent.
export type PlannedRequest = { method: string; path: string }

export function plannedRequest(action: string): PlannedRequest | null {
	const match = /\b(GET|POST|PUT|PATCH|DELETE)\s+(\/[^\s,;)"'`]*)/.exec(action)
	return match ? { method: match[1], path: match[2] } : null
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
