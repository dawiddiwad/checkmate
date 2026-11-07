import { readFile, writeFile } from 'node:fs/promises'
import assert from 'node:assert/strict'
const names = [
	'profile',
	'plan',
	'setup-request',
	'plan-request',
	'revise-request',
	'execute-request',
	'report-request',
	'observation',
	'result',
	'response',
]
type Schema = {
	const?: string
	enum?: string[]
	anyOf?: Schema[]
	type?: string
	items?: Schema
	properties?: Record<string, Schema>
	required?: string[]
}
function type(schema: Schema): string {
	if (schema.const !== undefined) return JSON.stringify(schema.const)
	if (schema.enum) return schema.enum.map((value) => JSON.stringify(value)).join(' | ')
	if (schema.anyOf) return schema.anyOf.map(type).join(' | ')
	if (schema.type === 'array') return `Array<${type(schema.items!)}>`
	if (schema.type === 'object')
		return `{\n${Object.entries(schema.properties!)
			.map(([key, value]) => `${JSON.stringify(key)}${schema.required!.includes(key) ? '' : '?'}: ${type(value)}`)
			.join('\n')}\n}`
	if (schema.type === 'integer') return 'number'
	return schema.type!
}
let text = ''
for (const name of names) {
	const schema = JSON.parse(await readFile(new URL(`../contracts/${name}.schema.json`, import.meta.url), 'utf8'))
	text += `export type ${name
		.split('-')
		.map((word) => word[0].toUpperCase() + word.slice(1))
		.join('')} = ${type(schema)}\n\n`
}
text += `export type Reference = { path: string; sha256: string }
export type Request = SetupRequest | PlanRequest | ReviseRequest | ExecuteRequest | ReportRequest
`
const { format } = await import('prettier')
text = await format(text, {
	parser: 'typescript',
	semi: false,
	singleQuote: true,
	useTabs: true,
	printWidth: 120,
	trailingComma: 'es5',
})
const path = new URL('../src/types.ts', import.meta.url)
if (process.argv.includes('--check')) assert.equal(await readFile(path, 'utf8'), text)
else await writeFile(path, text)
