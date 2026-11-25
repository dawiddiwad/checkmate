// Generates plugin/src/validators.js from the JSON Schemas.
import { Ajv } from 'ajv'
import addFormats from 'ajv-formats'
import standaloneCode from 'ajv/dist/standalone/index.js'
import { build } from 'esbuild'
import { readdir, readFile, writeFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import assert from 'node:assert/strict'

const contracts = new URL('../plugin/contracts/', import.meta.url)
const output = new URL('../plugin/src/validators.js', import.meta.url)
const declarations = new URL('../plugin/src/validators.d.ts', import.meta.url)
const files = (await readdir(contracts)).filter((file) => file.endsWith('.schema.json')).sort()

const ajv = new Ajv({ allErrors: true, allowUnionTypes: true, code: { source: true, esm: true } })
addFormats.default(ajv)
const exports: Record<string, string> = {}
for (const file of files) {
	const schema = JSON.parse(await readFile(new URL(file, contracts), 'utf8'))
	assert.equal(schema.$id, file, `${file} needs "$id": "${file}"`)
	ajv.addSchema(schema)
	exports[file.slice(0, -'.schema.json'.length).replace(/-./g, (match) => match[1].toUpperCase())] = file
}

for (const file of ['worker-rule', 'verification', 'plan-candidate', 'plan-delta']) {
	const schema = ajv.getSchema(`${file}.schema.json`)!
	for (const example of (schema.schema as { examples: unknown[] }).examples)
		assert(schema(example), `${file} example: ${ajv.errorsText(schema.errors)}`)
}

const bundle = await build({
	stdin: {
		contents: standaloneCode.default(ajv, exports),
		resolveDir: fileURLToPath(new URL('..', import.meta.url)),
		loader: 'js',
	},
	bundle: true,
	format: 'esm',
	platform: 'node',
	legalComments: 'none',
	minify: true,
	write: false,
})
const outputs = [
	{ path: output, text: bundle.outputFiles[0].text },
	{
		path: declarations,
		text:
			'export type Validator = ((value: unknown) => boolean) & {\n' +
			'\terrors?: Array<{\n' +
			'\t\tinstancePath: string\n' +
			'\t\tschemaPath: string\n' +
			'\t\tkeyword: string\n' +
			'\t\tparams: {\n' +
			'\t\t\tadditionalProperty?: string\n' +
			'\t\t\tallowedValues?: unknown[]\n' +
			'\t\t\tmissingProperty?: string\n' +
			'\t\t\ttype?: string | string[]\n' +
			'\t\t}\n' +
			'\t\tpropertyName?: string\n' +
			'\t\tmessage?: string\n' +
			'\t}> | null\n' +
			'}\n' +
			Object.keys(exports)
				.sort()
				.map((name) => `export const ${name}: Validator\n`)
				.join(''),
	},
]
for (const file of outputs) {
	if (process.argv.includes('--check'))
		assert.equal(await readFile(file.path, 'utf8'), file.text, 'Run npm run generate')
	else await writeFile(file.path, file.text)
}
