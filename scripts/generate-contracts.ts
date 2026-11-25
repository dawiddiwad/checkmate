// Writes the observeFrom values and the evidence kinds of the contracts from the tool recipes.
// The models read these enums as the allowed values, so they list every value that a recipe or the compatible list gives.
// A plan or a run is then checked against the recipes of its target's tools.
import { readFile, writeFile } from 'node:fs/promises'
import assert from 'node:assert/strict'
import { allEvidence, allObserveFrom } from '../plugin/src/recipes.ts'

const fields: Array<{ file: string; pointer: string; values: string[] }> = [
	{ file: 'plan.schema.json', pointer: '/definitions/assertion/properties/observeFrom', values: allObserveFrom() },
	{
		file: 'plan-delta.schema.json',
		pointer: '/properties/tests/additionalProperties/properties/assertions/items/properties/observeFrom',
		values: allObserveFrom(),
	},
	{
		file: 'plan-patch.schema.json',
		pointer:
			'/properties/tests/additionalProperties/anyOf/0/properties/assertions/additionalProperties/anyOf/0/properties/observeFrom',
		values: allObserveFrom(),
	},
	{
		file: 'actions.schema.json',
		pointer: '/definitions/evidence/items/anyOf/0/properties/kind',
		values: allEvidence(),
	},
	{
		file: 'actions.schema.json',
		pointer: '/definitions/evidence/items/anyOf/1/properties/kind',
		values: allEvidence(),
	},
	{ file: 'result.schema.json', pointer: '/properties/evidence/items/properties/kind', values: allEvidence() },
]

const { format, resolveConfig } = await import('prettier')
const check = process.argv.includes('--check')
for (const file of new Set(fields.map((field) => field.file))) {
	const url = new URL(`../plugin/contracts/${file}`, import.meta.url)
	const before = await readFile(url, 'utf8')
	const schema = JSON.parse(before)
	for (const field of fields.filter((field) => field.file === file)) {
		let node = schema
		for (const key of field.pointer.split('/').slice(1)) node = node?.[key]
		assert(Array.isArray(node?.enum), `${file}${field.pointer} has no enum`)
		node.enum = field.values
	}
	const path = url.pathname
	const after = await format(JSON.stringify(schema, null, '\t'), { ...(await resolveConfig(path)), filepath: path })
	if (check) assert.equal(before, after, `${file} does not list the values of the tool recipes. Run npm run generate`)
	else await writeFile(url, after)
}
