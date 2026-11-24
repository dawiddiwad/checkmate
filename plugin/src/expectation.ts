// The expected value of a deterministic assertion. Code compares the observed value with it.
//
// - Plain text: the observed value must equal it. Case, spaces and commas are ignored.
// - {{marker}}: the run marker. Code puts the run's marker in its place before it compares.
// - type:number, type:non-empty: the observed value has that shape.
// - one-of:A|B|C: the observed value is one of the listed values.
// - matches:<regex>: the observed value matches the regular expression.
// - at least:N, at most:N: the observed value is a number at least or at most N.
// - contains:TEXT, absent:TEXT: the observed value does or does not contain TEXT (case and spaces ignored).
export const markerPlaceholder = '{{marker}}'

const typeWords = ['number', 'numeric', 'non-empty', 'nonempty', 'text', 'string', 'any', 'anything']

export function combinedMatchers(value: string) {
	return /^(contains|absent|type|at least|at most):[^\n]*[;,]\s*(contains|absent|type|one-of|matches|at least|at most):/.test(
		value.trim()
	)
}

// The reason to refuse an expected value at plan save, or undefined when it is well formed. Each reason names
// the corrected value, so the planner can write the check again without guessing.
export function expectationError(expected: string): string | undefined {
	const value = expected.trim()
	if (typeWords.includes(value.toLowerCase()))
		return `The expected value "${expected}" is a type word, not a value. Write type:number for a number, type:non-empty for text that must be present, or the value itself, for example "3" or "Title is required".`
	// A matcher takes one value. Do not interpret a second matcher as text in the first.
	if (
		/^(contains|absent|type|at least|at most):[^\n]*[;,]\s*(contains|absent|type|one-of|matches|at least|at most):/.test(
			value
		)
	)
		return `The expected value "${expected}" combines two matchers. Split them into two assertions. For HTTP, give one assertion for the status (for example, expected "400") and one for the field or text in the body.`
	if (/^(matches|one-of|type|at least|at most|contains|absent):/.test(value)) return undefined
	if (/^not\s/i.test(value))
		return `The expected value "${expected}" states an absence in words. Write it as absent:<text>, for example absent:${value.replace(/^not\s+/i, '')}.`
	const placeholder = value.replaceAll(markerPlaceholder, '')
	if (/[<>]/.test(placeholder) || /[{}]/.test(placeholder))
		return `The expected value "${expected}" holds a placeholder. Only ${markerPlaceholder} is a placeholder: write ${markerPlaceholder}-T1 for a value with the run marker, not qa-<runId>-T1.`
	return undefined
}

// Working examples for a check, so a refusal shows the corrected shape for the same check.
export function expectationExample(check: string) {
	const text = check.toLowerCase()
	if (/\bcase\b|letter case|ignores? case|case-insensitive/.test(text))
		return `"observe": "the titles in the result list", "expected": "contains:${markerPlaceholder}-<title>"`
	if (
		/\babsent|\bnot (listed|added|shown|present|returned)|\bdoes not (list|show|contain|add)|\bno (book|note|record|item|price)|\bis not added|\bnot be added/.test(
			text
		)
	)
		return `"observe": "the list entries", "expected": "absent:<text that must not appear>"`
	if (/\b(count|how many|number of|total|items?)\b/.test(text) && !/\bid\b/.test(text))
		return `"observe": "the count field", "expected": "3" or "at least:3"`
	if (/\bnumeric\b|\bnumber\b|\bid\b/.test(text))
		return `"observe": "the value of the field", "expected": "type:number"`
	if (/\b\d{3}\b/.test(text) && /status|http|returns|answers|respon|refus|reject|error/.test(text))
		return `"observe": "the HTTP status of the response", "expected": "401" or "one-of:400|422"`
	if (/\bmessage\b|\bshows? the text\b|\bis required\b/.test(text))
		return `"observe": "the message on the page", "expected": "<the message as shown, for example Title is required>"`
	return `"observe": "<the value you see>", "expected": "<the value the check states>"`
}

export function expectationHint(check: string) {
	return `Working example for this check: ${expectationExample(check)}. The run marker is ${markerPlaceholder}. For a shape or a range use type:number, type:non-empty, one-of:A|B, matches:<regex>, at least:N or at most:N. For presence or absence use contains:TEXT or absent:TEXT. Never a type word as a value.`
}

// Case and runs of spaces are ignored in text that contains or lacks a value.
function loose(text: string) {
	return text.toLowerCase().replace(/\s+/g, ' ').trim()
}

// An amount with an optional unit or currency sign: "240 PLN", "$5.00", "240". The unit is the sign or the word after the number.
function splitAmount(text: string): { amount: number; unit: string } | undefined {
	const match = /^(\$|€|£|¥)?\s*(-?\d[\d,]*(?:\.\d+)?)\s*(\$|€|£|¥|[A-Za-z]{2,4})?$/.exec(text.trim())
	if (!match) return undefined
	return { amount: Number(match[2].replaceAll(',', '')), unit: match[1] ?? match[3] ?? '' }
}

// A unit on one side and a bare number on the other compare as numbers: the unit was not observed, which the
// caller records. Units on both sides must match. Two bare numbers compare as text, as before.
function amountSame(observed: string, expected: string): boolean | undefined {
	const seen = splitAmount(observed)
	const wanted = splitAmount(expected)
	if (!seen || !wanted || (!seen.unit && !wanted.unit)) return undefined
	if (seen.unit && wanted.unit && seen.unit !== wanted.unit) return false
	return seen.amount === wanted.amount
}

// The unit the expected value names and the observed value does not carry, for the record. Undefined when none.
export function unitNotObserved(observed: string, expected: string | undefined): string | undefined {
	const wanted = expected === undefined ? undefined : splitAmount(expected)
	const seen = splitAmount(observed)
	return wanted?.unit && seen && !seen.unit ? wanted.unit : undefined
}

// Case, spaces, commas and a closing full stop, question mark, exclamation mark, semicolon or colon are not part of the value:
// "240 PLN" and "240PLN" name the same value, and "Title is required." is the message "Title is required".
function plainSame(observed: string, expected: string) {
	const normal = (text: string) =>
		text
			.toLowerCase()
			.replace(/[\s,]/g, '')
			.replace(/[.!?;:]+$/, '')
	return normal(observed) === normal(expected)
}

export function expectationMatches(observed: string, expected: string, marker: string): boolean {
	const value = observed.trim()
	// Every kind sees the run marker, not only the plain value.
	const rule = expected.trim().replaceAll(markerPlaceholder, marker)
	if (rule === 'type:number') return /^-?\d+(\.\d+)?$/.test(value)
	if (rule === 'type:non-empty') return value !== ''
	if (rule.startsWith('one-of:'))
		return rule
			.slice('one-of:'.length)
			.split('|')
			.map((item) => item.trim())
			.includes(value)
	if (rule.startsWith('matches:')) return new RegExp(rule.slice('matches:'.length)).test(value)
	if (rule.startsWith('at least:')) return Number(value) >= Number(rule.slice('at least:'.length))
	if (rule.startsWith('at most:')) return Number(value) <= Number(rule.slice('at most:'.length))
	if (rule.startsWith('contains:')) return loose(value).includes(loose(rule.slice('contains:'.length)))
	if (rule.startsWith('absent:')) return !loose(value).includes(loose(rule.slice('absent:'.length)))
	const plain = expected.replaceAll(markerPlaceholder, marker)
	return amountSame(value, plain) ?? plainSame(value, plain)
}

// A shell path where a value was expected: the shell expanded a $ or a backtick inside double quotes.
export function looksShellExpanded(observed: string): boolean {
	return /(^|\s)\/(usr\/)?bin\/(ba|z|da)?sh(\s|$)/.test(observed.trim()) || /^(bash|sh|zsh)$/.test(observed.trim())
}

// A money value whose currency sign the shell removed: "$5.00" inside double quotes arrives as ".00". The check
// applies when the expected value or the evidence carries a currency sign.
export function looksTruncatedMoney(observed: string, expected: string | undefined, evidence: string): boolean {
	const currency = /[$€£¥]/.test(expected ?? '') || /[$€£¥]/.test(evidence)
	return currency && /^\.\d/.test(observed.trim())
}

// An expected value that is a bare number or amount, such as 200 or $5.00. Only an observed value of that form is compared.
export function expectsBareValue(expected: string | undefined): boolean {
	return expected !== undefined && /^\$?-?\d+(\.\d+)?$/.test(expected.trim())
}

export function isBareValue(observed: string): boolean {
	return /^\$?-?\d+(\.\d+)?$/.test(observed.trim())
}

// The one bare number or amount inside words, such as 200 in "HTTP 200" or $5.00 in "Shipping: $5.00".
export function wrappedValue(observed: string, expected: string | undefined): string | undefined {
	if (!expectsBareValue(expected)) return undefined
	const kind = /^\$/.test(expected!.trim()) ? /\$-?\d+(?:\.\d+)?/g : /-?\d+(?:\.\d+)?/g
	const found = observed.trim().match(kind) ?? []
	return found.length === 1 ? found[0] : undefined
}

// An observed value that is a type word or a rule is the expectation echoed, not something that was seen.
export function repeatsExpectation(observed: string): boolean {
	const value = observed.trim().toLowerCase()
	return typeWords.includes(value) || /^(type|one-of|matches|at least|at most|contains|absent|present):/.test(value)
}
