/**
 * The single place that decides what counts as a secret.
 *
 * `StepEvidence` calls this where the loop *records* evidence, so a credential the model typed
 * into the page never reaches `StepReport` in the first place. The logging path (`ToolDispatcher`,
 * `ToolResponseHandler`) consumes the same function instead of keeping its own copy of the rules,
 * so there is exactly one definition of "looks like a secret" in the codebase.
 *
 * @example
 * ```ts
 * scrub('Authorization: Bearer sk-abc123') // 'Authorization: [secret omitted]'
 * ```
 */
export function scrub(value: string): string {
	return scrubSecretFields(value)
		.replace(/data:image\/[a-zA-Z0-9.+-]+;base64,[A-Za-z0-9+/=]+/g, '[image omitted]')
		.replace(/[A-Za-z0-9+/]{200,}={0,2}/g, '[base64 omitted]')
		.replace(/sk-[A-Za-z0-9_-]+/g, '[secret omitted]')
		.replace(/Bearer\s+[A-Za-z0-9._~+/=-]+/gi, 'Bearer [secret omitted]')
		.replace(/Authorization\s*[:=]\s*[^\s,;}]+/gi, '[secret omitted]')
		.replace(/Cookie\s*[:=]\s*[^\n,;}]+/gi, '[secret omitted]')
}

/**
 * Recursively applies {@link scrub} to every string value in an arbitrary JSON-like value,
 * preserving its shape.
 *
 * Tool call arguments are kept as a structured object rather than a serialized string, so
 * scrubbing them string-by-string is what keeps the report's `toolCalls` array both readable
 * and free of secrets.
 *
 * @example
 * ```ts
 * scrubValue({ ref: 'e17', text: 'sk-abc123' }) // { ref: 'e17', text: '[secret omitted]' }
 * ```
 */
export function scrubValue<T>(value: T): T {
	if (typeof value === 'string') {
		return scrub(value) as T
	}

	if (Array.isArray(value)) {
		return value.map((item) => scrubValue(item)) as T
	}

	if (value && typeof value === 'object') {
		return Object.fromEntries(Object.entries(value).map(([key, entry]) => [key, scrubValue(entry)])) as T
	}

	return value
}

function scrubSecretFields(value: string): string {
	const secretKey = String.raw`(?:CHECKMATE_OPENAI_API_KEY|OPENAI_API_KEY|api[_-]?key|apikey|authorization|cookie)`
	return value
		.replace(
			new RegExp(String.raw`(["'])${secretKey}\1\s*:\s*(["'])(?:\\.|(?!\2).)*\2\s*,?`, 'gi'),
			'[secret omitted]'
		)
		.replace(
			new RegExp(String.raw`\b${secretKey}\b\s*[:=]\s*(?:Bearer\s+[^\s,;}]+|"[^"]*"|'[^']*'|[^\s,;}]+)`, 'gi'),
			'[secret omitted]'
		)
}
