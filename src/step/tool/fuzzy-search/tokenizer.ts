const QUOTED_TOKEN_PATTERN = /(['"])(.*?)\1/g

export function tokenize(text: string): string[] {
	if (!text || text.trim() === '') {
		return []
	}

	const tokens: string[] = []
	const quotedTokens: string[] = []

	let match: RegExpExecArray | null
	while ((match = QUOTED_TOKEN_PATTERN.exec(text)) !== null) {
		quotedTokens.push(match[2])
	}

	const textWithoutQuoted = text.replace(QUOTED_TOKEN_PATTERN, '')
	const wordTokens = textWithoutQuoted.split(/\s+/).filter((token) => token.length > 0)

	tokens.push(...quotedTokens, ...wordTokens)

	return tokens.map((token) => token.toLowerCase())
}

export function extractSearchTerms(action: string, expect: string): string[] {
	const actionTokens = tokenize(action)
	const expectTokens = tokenize(expect)
	const combined = [...actionTokens, ...expectTokens]
	return [...new Set(combined)]
}
