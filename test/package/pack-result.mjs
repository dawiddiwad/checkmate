import assert from 'node:assert/strict'

export function parsePackResult(output, packageName) {
	const results = Object.values(JSON.parse(output))
	assert.equal(results.length, 1, 'npm pack must return exactly one package')
	const [result] = results
	assert.equal(result.name, packageName, 'npm pack returned an unexpected package')
	assert(Array.isArray(result.files), 'npm pack result must contain files')
	assert(typeof result.filename === 'string' && result.filename.length > 0, 'npm pack result must contain a filename')
	return result
}
