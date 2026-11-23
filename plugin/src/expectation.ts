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

// The reason to refuse an expected value at plan save, or undefined when it is well formed.
export function expectationError(expected: string): string | undefined {
	const value = expected.trim()
	if (typeWords.includes(value.toLowerCase())) return `The expected value "${expected}" is a type word, not a value.`
	if (/^(matches|one-of|type|at least|at most|contains|absent):/.test(value)) return undefined
	if (/^not\s/i.test(value))
		return `The expected value "${expected}" states an absence in words. Write it as absent:<text>.`
	const placeholder = value.replaceAll(markerPlaceholder, '')
	if (/[<>]/.test(placeholder) || /[{}]/.test(placeholder))
		return `The expected value "${expected}" holds a placeholder. Only ${markerPlaceholder} is a placeholder.`
	return undefined
}

export function expectationHint() {
	return `Write the run marker as ${markerPlaceholder}, for example ${markerPlaceholder}-T1. For a shape or a range use type:number, type:non-empty, one-of:A|B, matches:<regex>, at least:N or at most:N. For presence or absence use contains:TEXT or absent:TEXT. Never a type word as a value.`
}

// Case and runs of spaces are ignored in text that contains or lacks a value.
function loose(text: string) {
	return text.toLowerCase().replace(/\s+/g, ' ').trim()
}

// Case, spaces and commas are ignored: "240 PLN" and "240PLN" name the same value.
function plainSame(observed: string, expected: string) {
	const normal = (text: string) => text.toLowerCase().replace(/[\s,]/g, '')
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
	return plainSame(value, expected.replaceAll(markerPlaceholder, marker))
}

// An observed value that is a type word or a rule is the expectation echoed, not something that was seen.
export function repeatsExpectation(observed: string): boolean {
	const value = observed.trim().toLowerCase()
	return typeWords.includes(value) || /^(type|one-of|matches|at least|at most|contains|absent):/.test(value)
}
