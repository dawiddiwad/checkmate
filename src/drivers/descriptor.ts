import { createRequire } from 'node:module'
import type { AnySchema, ValidateFunction } from 'ajv'
import type { Ajv2020 } from 'ajv/dist/2020.js'
import type { FormatsPlugin } from 'ajv-formats'
import { schemaDiagnostics } from '../contracts/diagnostics.js'
import type { Diagnostic, DriverDescriptorV1, JsonObject, Validation } from '../contracts/types.js'
import { appendPointer, inspectJsonStructure, readJsonDocument } from '../config/ingestion.js'
import { resolveDriverDescriptorPath } from '../config/package-resolution.js'
import { hasOwn, ownValue } from '../config/record.js'

const require = createRequire(import.meta.url)
const Ajv2020Constructor = require('ajv/dist/2020.js') as typeof Ajv2020
const addFormats = require('ajv-formats') as FormatsPlugin

export type DescriptorResolver = typeof resolveDriverDescriptorPath

export async function loadDriverDescriptor(input: {
	invocationRoot: string
	driverId: string
	packageName: string
	registrationPath: string
	resolveDescriptorPath?: DescriptorResolver
}): Promise<Validation<DriverDescriptorV1> & { status?: 'invalid' | 'error' }> {
	const resolveDescriptor = input.resolveDescriptorPath ?? resolveDriverDescriptorPath
	const resolved = resolveDescriptor(input.invocationRoot, input.packageName, `${input.registrationPath}/package`)
	if (resolved.ok === false) return { ok: false, diagnostics: resolved.diagnostics }

	const document = await readJsonDocument(resolved.value, input.registrationPath)
	if (document.ok === false) return { ok: false, status: document.status, diagnostics: document.diagnostics }

	const { validateDescriptor } = await import('../contracts/validator.js')
	const validation = validateDescriptor(document.value)
	if (validation.ok === false) return prefixDiagnostics(validation, input.registrationPath)

	const diagnostics = descriptorDiagnostics(validation.value, input.driverId, input.registrationPath)
	return diagnostics.length === 0 ? validation : { ok: false, diagnostics }
}

export function descriptorDiagnostics(
	descriptor: DriverDescriptorV1,
	registeredId: string,
	registrationPath: string
): Diagnostic[] {
	const diagnostics: Diagnostic[] = []
	if (descriptor.id !== registeredId) {
		diagnostics.push({
			code: 'driver.id-mismatch',
			path: `${registrationPath}/package`,
			message: `descriptor id '${descriptor.id}' does not match registered driver '${registeredId}'`,
		})
	}

	diagnostics.push(...driverSchemaDiagnostics(descriptor.targetSchema, `${registrationPath}/targetSchema`))
	diagnostics.push(...driverSchemaDiagnostics(descriptor.settingsSchema, `${registrationPath}/settingsSchema`))
	return diagnostics
}

export function validateDriverValue(schema: JsonObject, value: unknown, path: string): Diagnostic[] {
	const schemaProblems = driverSchemaDiagnostics(schema, path)
	if (schemaProblems.length > 0) return schemaProblems

	try {
		const validate = createAjv().compile(schema as AnySchema)
		return prefixedAjvDiagnostics(validate, value, path)
	} catch {
		return [{ code: 'driver.schema-invalid', path, message: 'driver schema could not be compiled' }]
	}
}

function driverSchemaDiagnostics(schema: JsonObject, path: string): Diagnostic[] {
	const structure = inspectJsonStructure(schema, path)
	if (structure.ok === false) return structure.diagnostics

	const diagnostics: Diagnostic[] = []
	const pending: Array<{ value: unknown; path: string }> = [{ value: schema, path }]
	while (pending.length > 0) {
		const current = pending.pop()!
		if (!current.value || typeof current.value !== 'object') continue
		if (!Array.isArray(current.value)) {
			const object = current.value as Record<string, unknown>
			if (hasOwn(object, '$id')) {
				diagnostics.push({
					code: 'driver.schema-unsupported',
					path: appendPointer(current.path, '$id'),
					message: 'driver-owned schemas must not declare $id',
				})
			}
			const reference = ownValue(object, '$ref')
			if (typeof reference === 'string' && !reference.startsWith('#')) {
				diagnostics.push({
					code: 'driver.schema-unsupported',
					path: appendPointer(current.path, '$ref'),
					message: 'driver-owned schemas may use only local # references',
				})
			}
		}
		for (const [key, value] of Object.entries(current.value)) {
			pending.push({ value, path: appendPointer(current.path, key) })
		}
	}

	if (diagnostics.length > 0) return diagnostics
	try {
		createAjv().compile(schema as AnySchema)
		return []
	} catch {
		return [{ code: 'driver.schema-invalid', path, message: 'must be a valid strict JSON Schema' }]
	}
}

function prefixedAjvDiagnostics(validate: ValidateFunction, value: unknown, path: string): Diagnostic[] {
	if (validate(value)) return []
	return schemaDiagnostics(validate.errors).map((diagnostic) => ({
		...diagnostic,
		path: `${path}${diagnostic.path}`,
	}))
}

function prefixDiagnostics<T>(validation: Validation<T>, path: string): Validation<T> {
	if (validation.ok === true) return validation
	return {
		ok: false,
		diagnostics: validation.diagnostics.map((diagnostic) => ({
			...diagnostic,
			path: `${path}${diagnostic.path}`,
		})),
	}
}

function createAjv(): InstanceType<typeof Ajv2020> {
	const ajv = new Ajv2020Constructor({
		allErrors: true,
		strict: true,
		coerceTypes: false,
		removeAdditional: false,
		useDefaults: false,
		ownProperties: true,
	})
	addFormats(ajv)
	return ajv
}
