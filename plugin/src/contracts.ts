import type { Instance, Profile } from './types.ts'
import type { Reply } from './store.ts'
import { canonical } from './store.ts'
import * as validators from './validators.js'

export type Documents = {
	profile: Profile
	instance: Instance
}

const identifier = /^[A-Za-z0-9][A-Za-z0-9_-]{0,95}$/

export type RefusalKind = 'malformed' | 'prohibited'

export class Refusal extends Error {
	kind: RefusalKind
	hint: string | undefined
	constructor(kind: RefusalKind, message: string, hint?: string) {
		super(message)
		this.kind = kind
		this.hint = hint
	}
}

export const refusalReasons: Record<RefusalKind, string> = {
	malformed: 'Refused: malformed request.',
	prohibited: 'Refused: prohibited in the current state.',
}

export function refused(status: 'invalid_request' | 'rejected', subject: string, error: unknown): Reply {
	const refusal = status === 'invalid_request' ? 'malformed' : error instanceof Refusal ? error.kind : 'prohibited'
	const hint = error instanceof Refusal ? error.hint : undefined
	return {
		status,
		subject,
		reasons: [refusalReasons[refusal], error instanceof Error ? error.message : String(error)],
		refusal,
		...(hint ? { hint } : {}),
		data: {},
	}
}

export function requireCondition(condition: unknown, message: string, hint?: string): asserts condition {
	if (!condition) throw new Refusal('prohibited', message, hint)
}

export function requireWellFormed(condition: unknown, message: string, hint?: string): asserts condition {
	if (!condition) throw new Refusal('malformed', message, hint)
}

export function same(a: unknown, b: unknown) {
	return canonical(a) === canonical(b)
}

export type SchemaProblem = { field: string; text: string; unknown: boolean; choices?: string[] }

export function schemaProblems(name: string, value: unknown, prefix = name): SchemaProblem[] {
	const check = validators[name.replace(/-./g, (match) => match[1].toUpperCase()) as keyof typeof validators]
	if (check(value)) return []
	return unionErrors(check.errors ?? [])
		.filter((error) => error.keyword !== 'propertyNames')
		.map((error) => ({
			field: String(
				error.instancePath.split('/')[1] ??
					error.params.missingProperty ??
					error.params.additionalProperty ??
					''
			),
			text: schemaError(`${prefix}${error.instancePath}`, error),
			unknown: error.keyword === 'additionalProperties',
			...(error.keyword === 'enum' ? { choices: (error.params.allowedValues ?? []).map(String) } : {}),
		}))
}

export function schemaErrors(name: string, value: unknown, prefix = name) {
	return schemaProblems(name, value, prefix).map((problem) => problem.text)
}

export function validate<K extends keyof Documents>(name: K, value: unknown, hint?: string): Documents[K] {
	const errors = schemaErrors(name, value)
	requireWellFormed(
		!errors.length,
		`Invalid ${name}: ${errors.join(', ')}`,
		hint ??
			`Fix each named field and send the ${name} again. The schema is contracts/${name}.schema.json in the plugin.`
	)
	return value as Documents[K]
}

type SchemaError = NonNullable<validators.Validator['errors']>[number]

function unionErrors(errors: SchemaError[]): SchemaError[] {
	let kept = errors
	for (const union of errors.filter((error) => ['anyOf', 'oneOf'].includes(error.keyword))) {
		const misses = kept.filter(
			(error) =>
				error.keyword === 'type' &&
				error.instancePath === union.instancePath &&
				error.schemaPath.startsWith(union.schemaPath) &&
				/^\/[0-9]+\/type$/.test(error.schemaPath.slice(union.schemaPath.length))
		)
		const under = (error: SchemaError) =>
			error.instancePath === union.instancePath || error.instancePath.startsWith(`${union.instancePath}/`)
		const matched = kept.some((error) => error !== union && !misses.includes(error) && under(error))
		const merged = { ...misses[0], params: { type: misses.flatMap((error) => error.params.type ?? []) } }
		const replacement = matched ? [] : misses.length ? [merged] : [union]
		kept = kept.flatMap((error) => (error === union ? replacement : misses.includes(error) ? [] : [error]))
	}
	return kept
}

function typeList(types: string[]) {
	if (types.length < 3) return types.join(' or ')
	return `${types.slice(0, -1).join(', ')}, or ${types.at(-1)}`
}

function schemaError(path: string, error: SchemaError) {
	if (error.keyword === 'type') return `${path} must be ${typeList([error.params.type ?? []].flat())}`
	if (error.keyword === 'additionalProperties')
		return `${path} has unknown field "${error.params.additionalProperty}"`
	if (error.keyword === 'required') return `${path} needs field "${error.params.missingProperty}"`
	if (error.keyword === 'enum') return `${path} must be one of: ${error.params.allowedValues?.join(', ')}`
	if (error.propertyName !== undefined) return `${path} field name "${error.propertyName}" ${error.message}`
	return `${path} ${error.message}`
}

export function requireIdentifier(value: unknown, name: string): string {
	requireWellFormed(
		typeof value === 'string' && identifier.test(value),
		`Invalid ${name}: ${String(value)}. Use 1 to 96 letters, digits, _ or -, starting with a letter or digit.`
	)
	return value
}

export function requireText(value: unknown, name: string): string {
	requireWellFormed(typeof value === 'string' && value.trim().length > 0, `Missing ${name}`)
	return value
}

export function requireChoice<T extends string>(value: unknown, choices: readonly T[], name: string): T {
	requireWellFormed(
		choices.includes(value as T),
		`Invalid ${name}: ${String(value)}. Use one of: ${choices.join(', ')}.`
	)
	return value as T
}

export function revisionReference(text: string, name: string) {
	const [id, revision, ...rest] = text.split('@')
	requireIdentifier(id, name)
	requireWellFormed(
		!rest.length && (revision === undefined || /^[1-9][0-9]*$/.test(revision)),
		`Invalid ${name}: ${text}. Use <id> or <id>@<revision>.`
	)
	return { id, revision: revision === undefined ? null : Number(revision) }
}

export function index<T, K extends keyof T>(items: T[], key: K, name: string, hint?: string): Map<T[K], T> {
	const map = new Map<T[K], T>()
	for (const item of items) {
		requireWellFormed(!map.has(item[key]), `Duplicate ${name}: ${String(item[key])}`, hint)
		map.set(item[key], item)
	}
	return map
}

export function profileCheck(value: unknown): Profile {
	const profile = validate('profile', value)
	index(profile.tools, 'name', 'tool')
	index(profile.entryPoints, 'name', 'entry point')
	for (const tool of profile.tools)
		requireWellFormed(
			tool.version === undefined || !/resolve-and-pin|unknown/i.test(tool.version),
			`Record the actual version of ${tool.name}, or leave version out`
		)
	return profile
}

export function approvalPolicy(profile: Profile) {
	return profile.approvals ?? { plan: 'required', result: 'required' }
}

export function unusedId(prefix: string, used: string[]) {
	let number = 1
	while (used.includes(`${prefix}${number}`)) number++
	return `${prefix}${number}`
}
