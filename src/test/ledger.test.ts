import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { appendLedgerStep, hasPriorAppFailure, readLedger } from '../playwright/ledger'

describe('ledger', () => {
	let outputDir: string

	beforeEach(async () => {
		outputDir = await mkdtemp(path.join(tmpdir(), 'checkmate-ledger-'))
	})

	afterEach(async () => {
		await rm(outputDir, { recursive: true, force: true })
	})

	it('reads an empty ledger when nothing has been recorded yet', async () => {
		expect(await readLedger(outputDir, 'test-1')).toEqual({ attempts: [] })
	})

	it('reads an empty ledger when the file cannot be parsed', async () => {
		const dir = path.join(outputDir, '.checkmate')
		await mkdir(dir, { recursive: true })
		await writeFile(path.join(dir, 'test-1.json'), 'not json')

		expect(await readLedger(outputDir, 'test-1')).toEqual({ attempts: [] })
	})

	it('appends the first step of the first attempt as a new attempt entry', async () => {
		await appendLedgerStep(outputDir, 'test-1', 0, { id: '1:aaaaaa', outcome: 'failed', category: 'app' })

		expect(await readLedger(outputDir, 'test-1')).toEqual({
			attempts: [{ retry: 0, steps: [{ id: '1:aaaaaa', outcome: 'failed', category: 'app' }] }],
		})
	})

	it('appends a second step of the same attempt to the same attempt entry, in call order', async () => {
		await appendLedgerStep(outputDir, 'test-1', 0, { id: '1:aaaaaa', outcome: 'passed', category: 'app' })
		await appendLedgerStep(outputDir, 'test-1', 0, { id: '2:bbbbbb', outcome: 'failed', category: 'app' })

		expect(await readLedger(outputDir, 'test-1')).toEqual({
			attempts: [
				{
					retry: 0,
					steps: [
						{ id: '1:aaaaaa', outcome: 'passed', category: 'app' },
						{ id: '2:bbbbbb', outcome: 'failed', category: 'app' },
					],
				},
			],
		})
	})

	it('opens a new attempt entry for a new retry, keeping earlier attempts intact', async () => {
		await appendLedgerStep(outputDir, 'test-1', 0, { id: '1:aaaaaa', outcome: 'failed', category: 'app' })
		await appendLedgerStep(outputDir, 'test-1', 1, { id: '1:aaaaaa', outcome: 'passed', category: 'app' })

		expect(await readLedger(outputDir, 'test-1')).toEqual({
			attempts: [
				{ retry: 0, steps: [{ id: '1:aaaaaa', outcome: 'failed', category: 'app' }] },
				{ retry: 1, steps: [{ id: '1:aaaaaa', outcome: 'passed', category: 'app' }] },
			],
		})
	})

	it('keeps separate tests in separate ledger files', async () => {
		await appendLedgerStep(outputDir, 'test-1', 0, { id: '1:aaaaaa', outcome: 'failed', category: 'app' })
		await appendLedgerStep(outputDir, 'test-2', 0, { id: '1:bbbbbb', outcome: 'passed', category: 'app' })

		expect(await readLedger(outputDir, 'test-1')).toEqual({
			attempts: [{ retry: 0, steps: [{ id: '1:aaaaaa', outcome: 'failed', category: 'app' }] }],
		})
		expect(await readLedger(outputDir, 'test-2')).toEqual({
			attempts: [{ retry: 0, steps: [{ id: '1:bbbbbb', outcome: 'passed', category: 'app' }] }],
		})
	})

	it('writes JSON that a plain reader can open without going through readLedger', async () => {
		await appendLedgerStep(outputDir, 'test-1', 0, { id: '1:aaaaaa', outcome: 'failed', category: 'app' })

		const raw = await readFile(path.join(outputDir, '.checkmate', 'test-1.json'), 'utf8')
		expect(JSON.parse(raw)).toEqual({
			attempts: [{ retry: 0, steps: [{ id: '1:aaaaaa', outcome: 'failed', category: 'app' }] }],
		})
	})

	describe('hasPriorAppFailure', () => {
		it('is true when an earlier attempt recorded an app failure for the step id', async () => {
			const ledger = await appendAndRead(outputDir, 'test-1', 0, {
				id: '1:aaaaaa',
				outcome: 'failed',
				category: 'app',
			})
			expect(hasPriorAppFailure(ledger, '1:aaaaaa')).toBe(true)
		})

		it('is false when no attempt recorded that step id at all', async () => {
			const ledger = await appendAndRead(outputDir, 'test-1', 0, {
				id: '1:aaaaaa',
				outcome: 'failed',
				category: 'app',
			})
			expect(hasPriorAppFailure(ledger, '2:bbbbbb')).toBe(false)
		})

		it('is false when the recorded failure was not at the app layer', async () => {
			const ledger = await appendAndRead(outputDir, 'test-1', 0, {
				id: '1:aaaaaa',
				outcome: 'failed',
				category: 'model',
			})
			expect(hasPriorAppFailure(ledger, '1:aaaaaa')).toBe(false)
		})

		it('is false when every recorded attempt for that step id passed', async () => {
			const ledger = await appendAndRead(outputDir, 'test-1', 0, {
				id: '1:aaaaaa',
				outcome: 'passed',
				category: 'app',
			})
			expect(hasPriorAppFailure(ledger, '1:aaaaaa')).toBe(false)
		})
	})
})

async function appendAndRead(
	outputDir: string,
	testId: string,
	retry: number,
	entry: Parameters<typeof appendLedgerStep>[3]
) {
	await appendLedgerStep(outputDir, testId, retry, entry)
	return readLedger(outputDir, testId)
}
