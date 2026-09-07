import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { resolve } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import type { PreparedRun } from '../../api/prepare-run.js'
import { reconcileExecutionResult } from '../../cli/reconcile-result.js'
import { serializeJson } from '../../contracts/serialize.js'
import type { ExecutionResultV1 } from '../../contracts/types.js'
import type { RunIdentity } from '../../evidence/layout.js'

const directories: string[] = []

afterEach(async () => {
	await Promise.all(directories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })))
})

describe('worker result reconciliation', () => {
	it('accepts deterministic bytes matching the immutable prepared plan', async () => {
		const fixture = await reconciliationFixture()
		await expect(
			reconcileExecutionResult(serializeJson(fixture.result), fixture.identity, fixture.prepared)
		).resolves.toMatchObject({
			result: { status: 'passed', scenarioId: 'scenario' },
		})
	})

	it.each([
		[
			'run identity',
			(result: ExecutionResultV1): void => {
				result.runId = 'ffffffffffffffff'
			},
		],
		[
			'scenario identity',
			(result: ExecutionResultV1): void => {
				result.scenarioId = 'other'
			},
		],
		[
			'timestamp',
			(result: ExecutionResultV1): void => {
				result.startedAt = '2026-01-02T00:00:00.000Z'
			},
		],
		[
			'driver',
			(result: ExecutionResultV1): void => {
				result.driver.id = 'other'
			},
		],
		[
			'policy',
			(result: ExecutionResultV1): void => {
				result.policy.id = 'other'
			},
		],
		[
			'limits',
			(result: ExecutionResultV1): void => {
				result.policy.effectiveLimits.turnsPerStep++
			},
		],
		[
			'step order',
			(result: ExecutionResultV1): void => {
				result.steps[0].id = 'other'
			},
		],
		[
			'usage arithmetic',
			(result: ExecutionResultV1): void => {
				result.usage.totalTokens++
			},
		],
	] as const)('rejects a corrupted %s field', async (_name, corrupt) => {
		const fixture = await reconciliationFixture()
		corrupt(fixture.result)
		await expect(
			reconcileExecutionResult(serializeJson(fixture.result), fixture.identity, fixture.prepared)
		).rejects.toThrow()
	})

	it('rejects non-deterministic JSON and non-execution union arms', async () => {
		const fixture = await reconciliationFixture()
		const nonDeterministic = `${JSON.stringify(fixture.result)}\n`
		await expect(reconcileExecutionResult(nonDeterministic, fixture.identity, fixture.prepared)).rejects.toThrow(
			/deterministic/
		)
		await expect(
			reconcileExecutionResult(
				serializeJson({
					kind: 'run-result',
					schemaVersion: 1,
					status: 'invalid',
					category: 'invalid',
					reason: 'invalid-invocation',
					targetMutation: 'not-attempted',
					diagnostics: [{ code: 'invalid', path: '', message: 'invalid' }],
				}),
				fixture.identity,
				fixture.prepared
			)
		).rejects.toThrow(/execution result arm/)
	})

	it('accepts only declared, contained, committed evidence references', async () => {
		const fixture = await reconciliationFixture()
		const evidencePath = resolve(fixture.identity.runDirectory, 'evidence/harness/steps/001-step/transcript.md')
		await mkdir(resolve(evidencePath, '..'), { recursive: true })
		await writeFile(evidencePath, 'evidence')
		fixture.result.evidence.references.push({
			kind: 'transcript',
			mediaType: 'text/markdown',
			path: `${fixture.identity.relativeRunDirectory}/evidence/harness/steps/001-step/transcript.md`,
			producer: 'harness',
			stepId: 'step',
		})
		await expect(
			reconcileExecutionResult(serializeJson(fixture.result), fixture.identity, fixture.prepared)
		).resolves.toBeDefined()

		fixture.result.evidence.references[0].path = '../sibling/result.json'
		await expect(
			reconcileExecutionResult(serializeJson(fixture.result), fixture.identity, fixture.prepared)
		).rejects.toThrow()
	})

	it.each([
		[
			'passed step failure reason',
			(result: ExecutionResultV1): void => {
				const step = result.steps[0]
				if (step.status !== 'not-run') step.reason = 'failed-expectation'
			},
		],
		[
			'pre-execution mutation claim',
			(result: ExecutionResultV1): void => {
				result.targetMutation = 'not-attempted'
			},
		],
		[
			'undeclared driver tool',
			(result: ExecutionResultV1): void => {
				const step = result.steps[0]
				if (step.status !== 'not-run') {
					step.toolCalls = [{ turn: 1, driverId: 'fixture', name: 'unknown', arguments: {}, status: 'ok' }]
				}
			},
		],
		[
			'run lifecycle route',
			(result: ExecutionResultV1): void => {
				result.status = 'failed'
				result.category = 'infra'
				result.reason = 'driver-start-failed'
			},
		],
	] as const)('rejects illegal %s semantics', async (_name, mutate) => {
		const fixture = await reconciliationFixture()
		mutate(fixture.result)
		await expect(
			reconcileExecutionResult(serializeJson(fixture.result), fixture.identity, fixture.prepared)
		).rejects.toThrow()
	})

	it('requires canonical evidence layout and exact producer attribution', async () => {
		const fixture = await reconciliationFixture()
		const wrongHarnessPath = resolve(fixture.identity.runDirectory, 'evidence/harness/transcript.md')
		await mkdir(resolve(wrongHarnessPath, '..'), { recursive: true })
		await writeFile(wrongHarnessPath, 'evidence')
		fixture.result.evidence.references = [
			{
				kind: 'transcript',
				mediaType: 'text/markdown',
				path: `${fixture.identity.relativeRunDirectory}/evidence/harness/transcript.md`,
				producer: 'harness',
				stepId: 'step',
			},
		]
		await expect(
			reconcileExecutionResult(serializeJson(fixture.result), fixture.identity, fixture.prepared)
		).rejects.toThrow(/canonical/)

		const driverPath = resolve(fixture.identity.runDirectory, 'evidence/driver/fixture/001-trace.txt')
		await mkdir(resolve(driverPath, '..'), { recursive: true })
		await writeFile(driverPath, 'evidence')
		fixture.prepared.driver.descriptor.evidenceKinds.push({
			kind: 'trace',
			mediaType: 'text/plain',
			content: 'text',
		})
		fixture.result.evidence.references = [
			{
				kind: 'trace',
				mediaType: 'text/plain',
				path: `${fixture.identity.relativeRunDirectory}/evidence/driver/fixture/001-trace.txt`,
				producer: 'fixture',
				stepId: 'step',
			},
		]
		await expect(
			reconcileExecutionResult(serializeJson(fixture.result), fixture.identity, fixture.prepared)
		).rejects.toThrow(/attributed/)
	})

	it('accepts interruption overriding an already recorded application failure', async () => {
		const fixture = await reconciliationFixture()
		fixture.result.status = 'interrupted'
		fixture.result.category = 'infra'
		fixture.result.reason = 'interrupted'
		const step = fixture.result.steps[0]
		if (step.status === 'not-run') throw new Error('fixture step must be executed')
		step.status = 'failed'
		step.reason = 'failed-expectation'

		await expect(
			reconcileExecutionResult(serializeJson(fixture.result), fixture.identity, fixture.prepared)
		).resolves.toBeDefined()
	})
})

async function reconciliationFixture(): Promise<{
	prepared: PreparedRun
	identity: RunIdentity
	result: ExecutionResultV1
}> {
	const root = await mkdtemp(resolve(tmpdir(), 'checkmate-reconcile-'))
	directories.push(root)
	const runDirectory = resolve(root, '.checkmate/runs/run')
	await mkdir(runDirectory, { recursive: true })
	const effectiveLimits = {
		scenarioTimeoutMs: 1000,
		stepTimeoutMs: 500,
		turnsPerStep: 2,
		requestTimeoutMs: 200,
		maxRetries: 0,
		loopMaxRepetitions: 2,
		cleanupTimeoutMs: 100,
		budgetTokens: 100,
	}
	const identity: RunIdentity = {
		runId: '0123456789abcdef',
		startedAt: '2026-01-01T00:00:00.000Z',
		runDirectory,
		relativeRunDirectory: '.checkmate/runs/run',
	}
	const prepared = {
		invocationRoot: root,
		outputDirectory: resolve(root, '.checkmate/runs'),
		request: {
			schemaVersion: 1,
			scenario: {
				id: 'scenario',
				driver: { id: 'fixture', target: {} },
				policy: 'ci',
				steps: [{ id: 'step', action: 'act', expect: 'observe' }],
			},
		},
		policy: {
			id: 'ci',
			effectiveLimits,
			evidence: { retention: 'retain-on-failure', redaction: 'on', allowOpaque: false },
			driver: { id: 'fixture', settings: {}, allowedTools: ['*'] },
			modelEgress: {
				provider: { id: 'openai', model: 'fixture', apiKeyBinding: 'provider' },
				textRedaction: 'on',
				allowOpaque: false,
				maxStepBytes: 1000,
				maxMessageBytes: 1000,
			},
		},
		modelEgress: {
			provider: { id: 'openai', model: 'fixture', apiKeyBinding: 'provider' },
			textRedaction: 'on',
			allowOpaque: false,
			maxStepBytes: 1000,
			maxMessageBytes: 1000,
		},
		effectiveLimits,
		secretBindings: { provider: { source: 'environment', name: 'KEY' } },
		driver: {
			id: 'fixture',
			packageName: '@test/fixture',
			settings: {},
			target: {},
			allowedTools: ['*'],
			secretBindings: {},
			descriptor: {
				schemaVersion: 1,
				id: 'fixture',
				driverContractVersion: 1,
				targetSchema: {},
				settingsSchema: {},
				requiredSecretSlots: [],
				tools: [],
				evidenceKinds: [],
			},
		},
	} as unknown as PreparedRun
	const result: ExecutionResultV1 = {
		kind: 'run-result',
		schemaVersion: 1,
		runId: identity.runId,
		scenarioId: 'scenario',
		status: 'passed',
		category: 'passed',
		reason: 'scenario-complete',
		targetMutation: 'possibly-mutated',
		startedAt: identity.startedAt,
		durationMs: 10,
		driver: { id: 'fixture', contractVersion: 1 },
		policy: { id: 'ci', effectiveLimits: { ...effectiveLimits } },
		usage: { promptTokens: 2, cachedPromptTokens: 0, completionTokens: 1, totalTokens: 3, state: 'complete' },
		steps: [
			{
				id: 'step',
				status: 'passed',
				category: 'app',
				reason: 'met-expectation',
				turns: 1,
				durationMs: 5,
				usage: { promptTokens: 2, cachedPromptTokens: 0, completionTokens: 1, totalTokens: 3 },
				toolCalls: [{ turn: 1, driverId: 'harness', name: 'pass_test_step', arguments: {}, status: 'ok' }],
			},
		],
		evidence: { state: 'complete', references: [] },
		diagnostics: [],
	}
	return { prepared, identity, result }
}
