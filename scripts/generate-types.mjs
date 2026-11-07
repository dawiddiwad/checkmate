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
function type(schema) {
	if (schema.const !== undefined) return JSON.stringify(schema.const)
	if (schema.enum) return schema.enum.map((value) => JSON.stringify(value)).join(' | ')
	if (schema.anyOf) return schema.anyOf.map(type).join(' | ')
	if (schema.type === 'array') return `Array<${type(schema.items)}>`
	if (schema.type === 'object')
		return `{\n${Object.entries(schema.properties)
			.map(([key, value]) => `${JSON.stringify(key)}${schema.required.includes(key) ? '' : '?'}: ${type(value)}`)
			.join('\n')}\n}`
	if (schema.type === 'integer') return 'number'
	return schema.type
}
let text = ''
for (const name of names) {
	const schema = JSON.parse(await readFile(new URL(`../contracts/${name}.schema.json`, import.meta.url)))
	text += `export type ${name
		.split('-')
		.map((word) => word[0].toUpperCase() + word.slice(1))
		.join('')} = ${type(schema)}\n\n`
}
text += `export type Reference = { path: string; sha256: string }
export type Request = SetupRequest | PlanRequest | ReviseRequest | ExecuteRequest | ReportRequest
export function validate(name: string, value: unknown): unknown
export function schema(name: string): object
export function profileCheck(value: unknown): Profile
export function planCheck(value: unknown): Plan
export function planCoverage(plan: Plan): Plan['coverage']
export function resultCoverage(plan: Plan, result: Observation): Result['coverage']
export function setup(workspace: string, request: SetupRequest, profile: Profile): Promise<Response>
export function savePlan(workspace: string, request: PlanRequest | ReviseRequest, plan: Plan): Promise<Response>
export function gate(workspace: string, request: ExecuteRequest): Promise<Response & { plan: Plan; target: Profile }>
export function beginRun(workspace: string, request: ExecuteRequest): Promise<Response>
export function finalize(workspace: string, request: ExecuteRequest, observation: Observation): Promise<Response>
export function reports(workspace: string, reference: Reference): Promise<Result>
export function delegate(workspace: string, requestPath: string, options?: { allowedTools?: string[]; claude?: string; playwright?: string; pluginRoot?: string; timeoutSeconds?: number }): Promise<Response>
export function digest(bytes: string | Uint8Array): string
export function readDocument(workspace: string, path: string): Promise<{value: unknown; reference: Reference}>
export function readReference(workspace: string, reference: Reference): Promise<unknown>
export function publish(workspace: string, path: string, value: unknown): Promise<Reference>
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
const path = new URL('../src/types.d.ts', import.meta.url)
if (process.argv.includes('--check')) assert.equal(await readFile(path, 'utf8'), text)
else await writeFile(path, text)
