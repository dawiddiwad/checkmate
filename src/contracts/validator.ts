import { existsSync, readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import type { AnySchema, ValidateFunction } from 'ajv'
import type { Ajv2020 } from 'ajv/dist/2020.js'
import type { FormatsPlugin } from 'ajv-formats'
import { schemaDiagnostics } from './diagnostics.js'
import { serializeJson } from './serialize.js'
import type {
	CheckmateManifestV1,
	DescribeResultV1,
	DriverDescriptorV1,
	RunRequestV1,
	RunResultV1,
	Validation,
	ValidationResultV1,
} from './types.js'

const require = createRequire(import.meta.url)
const Ajv2020Constructor = require('ajv/dist/2020.js') as typeof Ajv2020
const addFormats = require('ajv-formats') as FormatsPlugin

const schemaFiles = {
	manifest: 'checkmate-config.v1.json',
	request: 'run-request.v1.json',
	runResult: 'run-result.v1.json',
	validationResult: 'validation-result.v1.json',
	describeResult: 'describe-result.v1.json',
	descriptor: 'driver-descriptor.v1.json',
} as const

const ajv = new Ajv2020Constructor({
	allErrors: true,
	strict: true,
	coerceTypes: false,
	removeAdditional: false,
	useDefaults: false,
})

addFormats(ajv)

const validators = {
	manifest: ajv.compile(loadSchema(schemaFiles.manifest)),
	request: ajv.compile(loadSchema(schemaFiles.request)),
	runResult: ajv.compile(loadSchema(schemaFiles.runResult)),
	validationResult: ajv.compile(loadSchema(schemaFiles.validationResult)),
	describeResult: ajv.compile(loadSchema(schemaFiles.describeResult)),
	descriptor: ajv.compile(loadSchema(schemaFiles.descriptor)),
}

export function validateManifest(input: unknown): Validation<CheckmateManifestV1> {
	return validate(validators.manifest, input)
}

export function validateRequest(input: unknown): Validation<RunRequestV1> {
	return validate(validators.request, input)
}

export function validateRunResult(input: unknown): Validation<RunResultV1> {
	return validate(validators.runResult, input)
}

export function validateValidationResult(input: unknown): Validation<ValidationResultV1> {
	return validate(validators.validationResult, input)
}

export function validateDescribeResult(input: unknown): Validation<DescribeResultV1> {
	return validate(validators.describeResult, input)
}

export function validateDescriptor(input: unknown): Validation<DriverDescriptorV1> {
	return validate(validators.descriptor, input)
}

function validate<T>(validator: ValidateFunction, input: unknown): Validation<T> {
	try {
		serializeJson(input)
	} catch {
		return {
			ok: false,
			diagnostics: [{ code: 'input.non-json', path: '', message: 'must contain only JSON values' }],
		}
	}

	if (validator(input)) {
		return { ok: true, value: input as T }
	}

	return { ok: false, diagnostics: schemaDiagnostics(validator.errors) }
}

function loadSchema(fileName: string): AnySchema {
	const sourceUrl = new URL(`./schemas/${fileName}`, import.meta.url)
	const url = existsSync(sourceUrl) ? sourceUrl : new URL(`../../schemas/${fileName}`, import.meta.url)
	return JSON.parse(readFileSync(url, 'utf8')) as AnySchema
}
