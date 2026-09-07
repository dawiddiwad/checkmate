import { readFile } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { validateManifest, validateRequest } from '../../contracts/validator.js'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../../..')
const published = ['README.md', 'docs/CLI.md', 'docs/CONFIGURATION.md', 'docs/DRIVERS.md', 'docs/EVIDENCE.md']

describe('agent-facing documentation', () => {
	it('teaches one manifest, validate, run, and result workflow', async () => {
		const documents = await Promise.all(published.map((path) => readFile(resolve(root, path), 'utf8')))
		const readme = documents[0]

		expect(readme).toContain('checkmate.config.json')
		expect(readme).toContain('checkmate validate request.json')
		expect(readme).toContain('checkmate run request.json')
		expect(readme).toContain('Exactly one final JSON document on stdout')
		expect(readme).not.toContain('ai.step')
		expect(readme).not.toContain('checkmateBudgetUsd')
		for (const document of documents) expect(document).toContain('Checkmate')
	})

	it('validates every documented JSON request and manifest', async () => {
		for (const path of published) {
			const document = await readFile(resolve(root, path), 'utf8')
			for (const source of jsonBlocks(document)) {
				const value = JSON.parse(source) as Record<string, unknown>
				const validation = 'scenario' in value ? validateRequest(value) : validateManifest(value)
				expect(validation.ok, `${path}: ${JSON.stringify(validation)}`).toBe(true)
			}
		}
	})

	it('documents every category-aligned exit and POSIX support boundary', async () => {
		const cli = await readFile(resolve(root, 'docs/CLI.md'), 'utf8')
		for (const code of [0, 1, 2, 3, 4]) expect(cli).toContain(`\`${code}\``)
		const readme = await readFile(resolve(root, 'README.md'), 'utf8')
		expect(readme).toContain('Linux and macOS')
		expect(readme).toContain('Windows')
	})
})

function jsonBlocks(document: string): string[] {
	return [...document.matchAll(/```json\n([\s\S]*?)\n```/g)].map((match) => match[1])
}
