/**
 * Removes the common leading indentation from a multi-line string.
 *
 * Steps are written as template literals in a spec file, so `action` and `expect` arrive
 * carrying whatever indentation the surrounding code happened to have. That indentation is
 * an artifact of the source layout, not of the step, and it should not reach the report or
 * the failure message.
 */
export function dedent(value: string): string {
	const lines = value.split('\n').map((line) => line.replace(/\s+$/, ''))

	while (lines.length > 0 && lines[0].trim() === '') {
		lines.shift()
	}

	while (lines.length > 0 && lines[lines.length - 1].trim() === '') {
		lines.pop()
	}

	const indent = lines
		.filter((line) => line.trim() !== '')
		.reduce((smallest, line) => Math.min(smallest, line.length - line.trimStart().length), Number.MAX_SAFE_INTEGER)

	if (indent === Number.MAX_SAFE_INTEGER) {
		return ''
	}

	return lines.map((line) => line.slice(indent)).join('\n')
}
