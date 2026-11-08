import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { validate, planCheck } from '../plugin/src/contracts.ts'
import { readDocument, readReference, digest } from '../plugin/src/files.ts'
import { gate, resultCoverage } from '../plugin/src/stages.ts'
import { root } from './support.ts'

test('documentation examples retain valid contracts, references, coverage, and evidence', async () => {
	const workspace = join(root, 'docs/examples')
	for (const operation of ['setup', 'plan', 'revise', 'execute'] as const) {
		validate(`${operation}-request`, (await readDocument(workspace, `${operation}-request.json`)).value)
	}
	const request = validate('execute-request', (await readDocument(workspace, 'execute-request.json')).value)
	const checked = await gate(workspace, request)
	assert.equal(checked.status, 'completed')
	const plan = planCheck(await readReference(workspace, request.plan))
	const result = validate('result', (await readDocument(workspace, 'runs/run-1/result.json')).value)
	assert.deepEqual(result.coverage, resultCoverage(plan, result))
	for (const entry of result.evidence)
		assert.equal(digest(await readFile(join(workspace, request.outputDirectory, entry.path))), entry.sha256)
	const readme = await readFile(join(root, 'README.md'), 'utf8')
	const blocks = [...readme.matchAll(/```json\n([\s\S]*?)```/g)].map((match) => JSON.parse(match[1]))
	for (const path of ['profile.json', 'plan-request.json', 'execute-request.json', 'runs/run-1/result.json']) {
		const document = await readFile(join(workspace, path), 'utf8')
		assert(
			blocks.some((block) => JSON.stringify(block) === JSON.stringify(JSON.parse(document))),
			`${path} is missing from the README examples`
		)
	}
})
