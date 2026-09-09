import { mkdtemp, readFile, readdir, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { basename, resolve } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { ChatCompletion, ChatCompletionAssistantMessageParam } from 'openai/resources/chat/completions'
import { run } from '../../api/index.js'
import { serializeJson } from '../../contracts/serialize.js'
import { validateRunResult } from '../../contracts/validator.js'
import { EvidenceStore } from '../../evidence/store.js'
import { writeAtomicFile } from '../../evidence/atomic-file.js'
import { createDriverRunner } from '../../runtime/runner.js'
import type { InternalTerminationReason } from '../../runtime/types.js'
import { fixtureManifest, fixtureRequest, writeStaticEnvironment } from '../fixtures/static-environment.js'
import { fixtureDriver, outcomeRunner, readFixtureEnvironment } from './run-fixture.js'

const directories: string[] = []

afterEach(async () => {
	await Promise.all(directories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })))
})

describe('in-process run API', () => {
	it.each([
		['pass', ['met-expectation', 'met-expectation', 'met-expectation'], 'passed', 'passed', 'scenario-complete'],
		['application', ['met-expectation', 'failed-expectation'], 'failed', 'app', 'failed-expectation'],
		['model', ['met-expectation', 'loop-detected'], 'failed', 'model', 'loop-detected'],
		['infrastructure', ['met-expectation', 'provider-error'], 'failed', 'infra', 'provider-error'],
	] as const)(
		'returns one durable %s result with complete step enumeration',
		async (_name, reasons, status, category, reason) => {
			const root = await environment()
			const request = threeStepRequest()
			const close = vi.fn(async () => undefined)
			const started = vi.fn()
			const executed: string[] = []
			const result = await run(
				request,
				{ cwd: root },
				{
					preparation: { readEnvironment: readFixtureEnvironment },
					execution: {
						importDriver: async () => ({ checkmateDriver: fixtureDriver(close, started) }),
						createRunner: outcomeRunner(reasons as readonly InternalTerminationReason[], (step) =>
							executed.push(step.id)
						),
					},
				}
			)

			expect(result).toMatchObject({ status, category, reason, targetMutation: 'possibly-mutated' })
			expect(validateRunResult(result).ok).toBe(true)
			expect(started).toHaveBeenCalledOnce()
			expect(close).toHaveBeenCalledOnce()
			if (result.status === 'invalid') return
			expect(result.steps).toHaveLength(3)
			expect(result.usage.totalTokens).toBe(executed.length * 3)
			expect(executed).toEqual(
				reason === 'scenario-complete' ? ['inspect', 'verify', 'finish'] : ['inspect', 'verify']
			)
			if (reason !== 'scenario-complete') {
				expect(result.steps[2]).toEqual({
					id: 'finish',
					status: 'not-run',
					reason: 'prior-step-failed',
					blockedBy: 'verify',
				})
				expect(result.evidence.references).toEqual(
					expect.arrayContaining([
						expect.objectContaining({ kind: 'transcript', stepId: 'verify', producer: 'harness' }),
						expect.objectContaining({ kind: 'fixture-log', producer: 'fixture' }),
					])
				)
				const fixtureEvidence = result.evidence.references.find(
					(reference) => reference.kind === 'fixture-log'
				)!
				expect(fixtureEvidence).not.toHaveProperty('stepId')
				const evidence = await readFile(resolve(root, fixtureEvidence.path), 'utf8')
				expect(evidence).toContain('[secret omitted]')
				expect(evidence).not.toContain('driver-secret')
			} else {
				expect(result.evidence.references).toEqual([])
			}

			const runDirectories = await readdir(resolve(root, '.checkmate/runs'))
			expect(runDirectories).toHaveLength(1)
			const bytes = await readFile(resolve(root, '.checkmate/runs', runDirectories[0], 'result.json'), 'utf8')
			expect(bytes).toBe(serializeJson(result))
		}
	)

	it('returns an invalid-invocation result without allocating a run directory', async () => {
		const root = await environment()
		const result = await run(
			{ schemaVersion: 1 },
			{ cwd: root },
			{
				preparation: { readEnvironment: readFixtureEnvironment },
			}
		)

		expect(result).toMatchObject({
			status: 'invalid',
			category: 'invalid',
			reason: 'invalid-invocation',
			targetMutation: 'not-attempted',
		})
		await expect(readdir(resolve(root, '.checkmate/runs'))).rejects.toThrow()
	})

	it('loads and executes the selected driver package from the invocation root', async () => {
		const root = await environment()
		const manifest = structuredClone(fixtureManifest)
		manifest.drivers.fixture.package = '@checkmate-test/executable-driver'
		await writeFile(resolve(root, 'checkmate.config.json'), serializeJson(manifest))
		await symlink(
			new URL('../fixtures/drivers/executable-driver', import.meta.url),
			resolve(root, 'node_modules/@checkmate-test/executable-driver'),
			'dir'
		)

		const result = await run(
			fixtureRequest,
			{ cwd: root },
			{
				preparation: { readEnvironment: readFixtureEnvironment },
				execution: { createRunner: outcomeRunner(['met-expectation']) },
			}
		)

		expect(result).toMatchObject({ status: 'passed', category: 'passed', reason: 'scenario-complete' })
	})

	it('terminal-finalizes invocation write failures without importing a driver', async () => {
		const root = await environment()
		const importDriver = vi.fn()
		const result = await run(
			fixtureRequest,
			{ cwd: root },
			{
				preparation: { readEnvironment: readFixtureEnvironment },
				execution: {
					importDriver,
					createStore: (options) =>
						new EvidenceStore({
							...options,
							writeFile: async (path, content) => {
								if (basename(path) === 'invocation.json') throw new Error('invocation device failed')
								await writeAtomicFile(path, content)
							},
						}),
				},
			}
		)

		expect(result).toMatchObject({
			status: 'failed',
			category: 'infra',
			reason: 'evidence-write-failed',
			targetMutation: 'not-attempted',
			evidence: { state: 'partial' },
		})
		expect(importDriver).not.toHaveBeenCalled()
		if (result.status === 'invalid') return
		const resultPath = resolve(
			root,
			'.checkmate/runs',
			(await readdir(resolve(root, '.checkmate/runs')))[0],
			'result.json'
		)
		expect(await readFile(resultPath, 'utf8')).toBe(serializeJson(result))
	})

	it('keeps an application verdict when optional evidence persistence fails', async () => {
		const root = await environment()
		const result = await run(
			fixtureRequest,
			{ cwd: root },
			{
				preparation: { readEnvironment: readFixtureEnvironment },
				execution: {
					importDriver: async () => ({ checkmateDriver: fixtureDriver(async () => undefined) }),
					createRunner: outcomeRunner(['failed-expectation']),
					createStore: (options) =>
						new EvidenceStore({
							...options,
							writeFile: async (path, content) => {
								if (basename(path) === 'transcript.md') throw new Error('optional evidence failed')
								await writeAtomicFile(path, content)
							},
						}),
				},
			}
		)

		expect(result).toMatchObject({
			status: 'failed',
			category: 'app',
			reason: 'failed-expectation',
			evidence: { state: 'partial' },
			diagnostics: [expect.objectContaining({ code: 'evidence.write-failed' })],
		})
	})

	it.each([
		['on', '[secret omitted]', false],
		['off', 'driver-secret', true],
	] as const)('keeps %s redaction byte-identical between API and durable result', async (mode, expected, raw) => {
		const root = await environment()
		const manifest = structuredClone(fixtureManifest)
		manifest.policies.ci.evidence.redaction = mode
		manifest.policies.ci.modelEgress.textRedaction = mode
		await writeFile(resolve(root, 'checkmate.config.json'), serializeJson(manifest))
		const result = await run(
			fixtureRequest,
			{ cwd: root },
			{
				preparation: { readEnvironment: readFixtureEnvironment },
				execution: {
					importDriver: async () => ({ checkmateDriver: fixtureDriver(async () => undefined) }),
					createRunner: () => ({
						run: async (step) => ({
							step,
							outcome: 'failed',
							category: 'app',
							reason: 'failed-expectation',
							actual: 'observed driver-secret',
							turns: 1,
							durationMs: 1,
							usage: { promptTokens: 0, cachedPromptTokens: 0, completionTokens: 0, totalTokens: 0 },
							toolCalls: [],
							transcript: [{ turn: 1, role: 'assistant', content: 'driver-secret' }],
							diagnostics: [],
						}),
						teardown: async () => undefined,
					}),
				},
			}
		)

		expect(result.status).toBe('failed')
		if (result.status === 'invalid') return
		const bytes = serializeJson(result)
		expect(bytes).toContain(expected)
		expect(bytes.includes('driver-secret')).toBe(raw)
		const directory = (await readdir(resolve(root, '.checkmate/runs')))[0]
		expect(await readFile(resolve(root, '.checkmate/runs', directory, 'result.json'), 'utf8')).toBe(bytes)
	})

	it('uses the injected clock for identity, scenario, evidence, and cleanup boundaries', async () => {
		const root = await environment()
		const now = vi.fn(() => Date.parse('2026-09-06T12:00:00.000Z'))
		const nativeNow = vi.spyOn(Date, 'now').mockImplementation(() => {
			throw new Error('global clock used')
		})
		try {
			const result = await run(
				fixtureRequest,
				{ cwd: root },
				{
					preparation: { readEnvironment: readFixtureEnvironment },
					execution: {
						now,
						importDriver: async () => ({ checkmateDriver: fixtureDriver(async () => undefined) }),
						createRunner: outcomeRunner(['met-expectation']),
					},
				}
			)

			expect(result).toMatchObject({ startedAt: '2026-09-06T12:00:00.000Z', durationMs: 0 })
			expect(now).toHaveBeenCalled()
		} finally {
			nativeNow.mockRestore()
		}
	})

	it('disposes scenario timing and sanitizes a thrown execution secret reader', async () => {
		const root = await environment()
		const clearTimer = vi.fn<typeof clearTimeout>((handle) => clearTimeout(handle))
		const result = await run(
			fixtureRequest,
			{ cwd: root },
			{
				preparation: { readEnvironment: readFixtureEnvironment },
				execution: {
					clearTimer,
					readEnvironment: (name) => {
						if (name === 'CHECKMATE_TEST_DRIVER_SESSION') return 'reader-secret'
						throw new Error('reader failed after reader-secret')
					},
				},
			}
		)

		expect(result).toMatchObject({ status: 'failed', category: 'infra', reason: 'driver-start-failed' })
		expect(serializeJson(result)).not.toContain('reader-secret')
		expect(serializeJson(result)).toContain('[secret omitted]')
		expect(clearTimer).toHaveBeenCalled()
	})

	it('enforces a scenario token budget through the real step execution loop', async () => {
		const root = await environment()
		const request = structuredClone(fixtureRequest)
		request.scenario.limits = { budgetTokens: 2 }
		const result = await run(
			request,
			{ cwd: root },
			{
				preparation: { readEnvironment: readFixtureEnvironment },
				execution: {
					importDriver: async () => ({ checkmateDriver: fixtureDriver(async () => undefined) }),
					createRunner: (options) =>
						createDriverRunner({
							...options,
							aiClient: { send: async () => providerToolResponse() } as never,
						}),
				},
			}
		)

		expect(result).toMatchObject({
			status: 'failed',
			category: 'infra',
			reason: 'token-budget-exceeded',
			usage: { totalTokens: 3 },
		})
		if (result.status === 'invalid') return
		expect(result.steps[0]).toMatchObject({ reason: 'token-budget-exceeded', usage: { totalTokens: 3 } })
	})
})

async function environment(): Promise<string> {
	const root = await mkdtemp(resolve(tmpdir(), 'checkmate-run-api-'))
	directories.push(root)
	await writeStaticEnvironment(root)
	return root
}

function threeStepRequest() {
	const request = structuredClone(fixtureRequest)
	request.scenario.steps = [
		{ id: 'inspect', action: 'Inspect', expect: 'Readable' },
		{ id: 'verify', action: 'Verify', expect: 'Correct' },
		{ id: 'finish', action: 'Finish', expect: 'Complete' },
	]
	return request
}

function providerToolResponse(): {
	response: ChatCompletion
	assistantMessages: ChatCompletionAssistantMessageParam[]
} {
	return {
		response: {
			id: 'budget-response',
			object: 'chat.completion',
			created: 0,
			model: 'fixture-model',
			choices: [
				{
					index: 0,
					logprobs: null,
					finish_reason: 'tool_calls',
					message: {
						role: 'assistant',
						content: null,
						refusal: null,
						tool_calls: [
							{
								id: 'call-fixture',
								type: 'function',
								function: { name: 'fixture_read', arguments: '{}' },
							},
						],
					},
				},
			],
			usage: { prompt_tokens: 2, completion_tokens: 1, total_tokens: 3 },
		} as ChatCompletion,
		assistantMessages: [] as ChatCompletionAssistantMessageParam[],
	}
}
