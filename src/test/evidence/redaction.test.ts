import { readFile, readdir } from 'node:fs/promises'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { parse as parseYaml } from 'yaml'
import type { ExecutionResultV1 } from '../../contracts/types.js'
import { serializeJson } from '../../contracts/serialize.js'
import { Redactor } from '../../redaction/redactor.js'
import { TerminalFinalizer } from '../../evidence/terminal-finalizer.js'
import { createStore, executedStep, executionResult, request, temporaryRoot } from './helpers.js'

const exactSecret = 'synthetic-exact-credential'
const patternedSecret = 'sk-synthetic-pattern-credential'

describe('evidence redaction', () => {
	it('removes exact, patterned, and key-identified credentials recursively without mutating input', () => {
		const value = {
			message: `credentials: ${exactSecret} and ${patternedSecret}`,
			nested: { databasePassword: 'ordinary-password', totalTokens: 3 },
		}
		const redacted = new Redactor({ mode: 'on', exactSecrets: [exactSecret] }).redactContent(value)

		expect(redacted).toEqual({
			message: 'credentials: [secret omitted] and [secret omitted]',
			nested: { databasePassword: '[secret omitted]', totalTokens: 3 },
		})
		expect(value.nested.databasePassword).toBe('ordinary-password')
	})

	it('redacts content-bearing keys without dropping colliding values', () => {
		const redactor = new Redactor({ mode: 'on', exactSecrets: [exactSecret] })
		const first = {
			[`token-${exactSecret}`]: 'secret-key',
			'token-[secret omitted]': 'literal-key',
		}
		const second = {
			'token-[secret omitted]': 'literal-key',
			[`token-${exactSecret}`]: 'secret-key',
		}

		expect(redactor.redactContent(first)).toEqual({
			'token-[secret omitted]': 'literal-key',
			'token-[secret omitted] [collision 2]': 'secret-key',
		})
		expect(redactor.redactContent(second)).toEqual(redactor.redactContent(first))
	})

	it('uses an explicit bounded sensitive-key policy instead of suffix matching', () => {
		const redactor = new Redactor({ mode: 'on' })
		const overlongKey = `${'x'.repeat(129)}password`
		expect(
			redactor.redactContent({
				password: 'redact-me',
				databasePassword: 'redact-me-too',
				compassword: 'not-a-declared-sensitive-key',
				[overlongKey]: 'bounded-work',
			})
		).toEqual({
			password: '[secret omitted]',
			databasePassword: '[secret omitted]',
			compassword: 'not-a-declared-sensitive-key',
			[overlongKey]: 'bounded-work',
		})
	})

	it('preserves typed identities and committed references while redacting content fields', () => {
		const identity = `identity-${exactSecret}-${patternedSecret}`
		const reference = {
			kind: identity,
			mediaType: 'text/plain',
			path: `.checkmate/runs/${identity}/evidence.txt`,
			producer: identity,
			stepId: identity,
		}
		const redactor = new Redactor({ mode: 'on', exactSecrets: [exactSecret] })
		const typedRequest = structuredClone(request)
		typedRequest.scenario.id = identity
		typedRequest.scenario.driver.id = identity
		typedRequest.scenario.policy = identity
		typedRequest.scenario.steps[0].id = identity
		typedRequest.scenario.steps[0].action = exactSecret
		const invocation = redactor.redactInvocation({
			layoutVersion: 1,
			runId: '0123456789abcdef',
			startedAt: '2026-09-05T12:00:00.000Z',
			request: typedRequest,
		})
		const checkpoint = redactor.redactCheckpoint({
			layoutVersion: 1,
			runId: '0123456789abcdef',
			updatedAt: '2026-09-05T12:00:01.000Z',
			state: 'partial',
			completedSteps: [executedStep({ id: identity, actual: exactSecret })],
			evidenceReferences: [reference],
			diagnostics: [{ code: identity, path: `/${identity}`, message: exactSecret }],
		})
		const result = redactor.redactExecutionResult(
			executionResult({
				scenarioId: identity,
				driver: { id: identity, contractVersion: 1 },
				policy: { ...executionResult().policy, id: identity },
				steps: [executedStep({ id: identity, actual: exactSecret })],
				evidence: { state: 'complete', references: [reference] },
				diagnostics: [{ code: identity, path: `/${identity}`, message: exactSecret }],
			})
		)
		const unredactedResult = executionResult({
			scenarioId: identity,
			driver: { id: identity, contractVersion: 1 },
			policy: { ...executionResult().policy, id: identity },
			steps: [executedStep({ id: identity, actual: exactSecret })],
			evidence: { state: 'complete', references: [reference] },
			diagnostics: [{ code: identity, path: `/${identity}`, message: exactSecret }],
		})

		expect(invocation.request.scenario).toMatchObject({
			id: identity,
			driver: { id: identity },
			policy: identity,
		})
		expect(invocation.request.scenario.steps[0]).toMatchObject({ id: identity, action: '[secret omitted]' })
		expect(checkpoint.completedSteps[0]).toMatchObject({ id: identity, actual: '[secret omitted]' })
		expect(checkpoint.evidenceReferences).toEqual([reference])
		expect(checkpoint.diagnostics[0]).toEqual({ code: identity, path: `/${identity}`, message: '[secret omitted]' })
		expect(result).toMatchObject({
			scenarioId: identity,
			driver: { id: identity },
			policy: { id: identity },
			steps: [{ id: identity, actual: '[secret omitted]' }],
			evidence: { references: [reference] },
			diagnostics: [{ code: identity, path: `/${identity}`, message: '[secret omitted]' }],
		})
		expect(serializeJson(structuralResultFields(result))).toBe(
			serializeJson(structuralResultFields(unredactedResult))
		)
	})

	it('parses, redacts, and reserializes declared JSON and YAML evidence', async () => {
		const temporary = await temporaryRoot()
		try {
			const store = await createStore(temporary.root, {
				policy: { retention: 'on', redaction: 'on', allowOpaque: false },
				exactSecrets: [exactSecret],
			})
			await store.writeInvocation(request)
			store.captureDriver({
				stepId: 'open-cart',
				kind: 'structured-json',
				mediaType: 'application/json',
				content: JSON.stringify({ password: 'json-password', [`key-${exactSecret}`]: patternedSecret }),
			})
			store.captureHarnessStep({
				stepId: 'open-cart',
				kind: 'turn-snapshot',
				mediaType: 'application/yaml',
				turn: 1,
				content: `password: yaml-password\nsecret_key: ${exactSecret}\n`,
			})
			const finalized = await store.finalizeStep('open-cart', 'passed')
			const json = JSON.parse(await readFile(resolve(temporary.root, finalized.references[0].path), 'utf8'))
			const yaml = parseYaml(await readFile(resolve(temporary.root, finalized.references[1].path), 'utf8'))

			expect(json).toEqual({
				'key-[secret omitted]': '[secret omitted]',
				password: '[secret omitted]',
			})
			expect(yaml).toEqual({ password: '[secret omitted]', secret_key: '[secret omitted]' })
			expect(JSON.stringify(json)).not.toContain(exactSecret)
			expect(JSON.stringify(yaml)).not.toContain('yaml-password')
		} finally {
			await temporary.cleanup()
		}
	})

	it('preserves structured evidence bytes exactly when redaction is off', async () => {
		const temporary = await temporaryRoot()
		const raw = Buffer.from('{ malformed json\u0000\xff', 'latin1')
		try {
			const store = await createStore(temporary.root, {
				policy: { retention: 'on', redaction: 'off', allowOpaque: false },
			})
			await store.writeInvocation(request)
			store.captureDriver({
				stepId: 'open-cart',
				kind: 'structured-json',
				mediaType: 'application/json',
				content: raw,
			})
			const finalized = await store.finalizeStep('open-cart', 'passed')
			expect(await readFile(resolve(temporary.root, finalized.references[0].path))).toEqual(raw)
		} finally {
			await temporary.cleanup()
		}
	})

	it.each([
		['malformed UTF-8', Buffer.from([0xc3, 0x28])],
		['malformed JSON', Buffer.from('{ nope')],
	] as const)('rejects %s instead of corrupting structured evidence', async (_name, content) => {
		const temporary = await temporaryRoot()
		try {
			const store = await createStore(temporary.root, {
				policy: { retention: 'on', redaction: 'on', allowOpaque: false },
			})
			await store.writeInvocation(request)
			expect(() =>
				store.captureDriver({
					stepId: 'open-cart',
					kind: 'structured-json',
					mediaType: 'application/json',
					content,
				})
			).toThrow(expect.objectContaining({ code: expect.stringMatching(/^evidence\.invalid-/) }))
			expect(store.acceptedBufferBytes).toBe(0)
		} finally {
			await temporary.cleanup()
		}
	})

	it('rejects malformed YAML instead of persisting altered text', async () => {
		const temporary = await temporaryRoot()
		try {
			const store = await createStore(temporary.root, {
				policy: { retention: 'on', redaction: 'on', allowOpaque: false },
			})
			await store.writeInvocation(request)
			expect(() =>
				store.captureHarnessStep({
					stepId: 'open-cart',
					kind: 'turn-snapshot',
					mediaType: 'application/yaml',
					turn: 1,
					content: 'broken: [yaml',
				})
			).toThrow(expect.objectContaining({ code: 'evidence.invalid-structured-content' }))
			expect(store.acceptedBufferBytes).toBe(0)
		} finally {
			await temporary.cleanup()
		}
	})

	it.each(['on', 'off'] as const)('applies the complete durable redaction=%s policy', async (redaction) => {
		const temporary = await temporaryRoot()
		try {
			const store = await createStore(temporary.root, {
				policy: { retention: 'on', redaction, allowOpaque: false },
				exactSecrets: [exactSecret],
			})
			const secretRequest = structuredClone(request)
			secretRequest.scenario.driver.target = {
				endpoint: 'https://example.test',
				password: exactSecret,
			}
			await store.writeInvocation(secretRequest)
			store.captureHarnessStep({
				stepId: 'open-cart',
				kind: 'transcript',
				mediaType: 'text/markdown',
				content: `${exactSecret} ${patternedSecret}`,
			})
			await store.finalizeStep('open-cart', 'passed')
			await store.replaceCheckpoint({
				completedSteps: [
					{
						id: 'open-cart',
						status: 'passed',
						category: 'app',
						reason: 'met-expectation',
						actual: exactSecret,
						turns: 1,
						durationMs: 1,
						usage: { promptTokens: 0, cachedPromptTokens: 0, completionTokens: 0, totalTokens: 0 },
						toolCalls: [
							{
								turn: 1,
								driverId: 'fixture',
								name: 'fixture_read',
								arguments: { apiKey: 'plain-key-value' },
								status: 'ok',
							},
						],
					},
				],
			})
			const result = executionResult({
				runId: store.runIdentity.runId,
				startedAt: store.runIdentity.startedAt,
				steps: [
					{
						id: 'open-cart',
						status: 'passed',
						category: 'app',
						reason: 'met-expectation',
						actual: `${exactSecret} ${patternedSecret}`,
						turns: 1,
						durationMs: 1,
						usage: { promptTokens: 0, cachedPromptTokens: 0, completionTokens: 0, totalTokens: 0 },
						toolCalls: [
							{
								turn: 1,
								driverId: 'fixture',
								name: 'fixture_read',
								arguments: { authorization: exactSecret },
								status: 'ok',
							},
						],
					},
					{ id: 'apply-promo', status: 'not-run', reason: 'prior-step-failed', blockedBy: 'open-cart' },
				],
				evidence: { state: store.state, references: [...store.committedReferences] },
				diagnostics: [{ code: 'fixture.note', path: '', message: exactSecret }],
			})
			const terminal = await new TerminalFinalizer(store).finalize(result)
			const durable = await readTree(store.runIdentity.runDirectory)

			expect(terminal.committed).toBe(true)
			if (redaction === 'on') {
				expect(durable).not.toContain(exactSecret)
				expect(durable).not.toContain(patternedSecret)
				expect(terminal.bytes).not.toContain(exactSecret)
				expect(JSON.stringify(terminal.result)).not.toContain(exactSecret)
				expect(durable).toContain('[secret omitted]')
			} else {
				expect(durable).toContain(exactSecret)
				expect(durable).toContain(patternedSecret)
				expect(terminal.bytes).toContain(exactSecret)
				expect(JSON.stringify(terminal.result)).toContain(exactSecret)
			}
		} finally {
			await temporary.cleanup()
		}
	})

	it('always sanitizes diagnostic text even when result redaction is off', () => {
		const redactor = new Redactor({ mode: 'off', exactSecrets: [exactSecret] })
		expect(redactor.redactText(exactSecret)).toBe(exactSecret)
		expect(redactor.redactDiagnosticText(`${exactSecret} ${patternedSecret}`)).toBe(
			'[secret omitted] [secret omitted]'
		)
	})
})

async function readTree(root: string): Promise<string> {
	const values: string[] = []
	for (const entry of await readdir(root, { withFileTypes: true })) {
		const path = resolve(root, entry.name)
		if (entry.isDirectory()) values.push(await readTree(path))
		else values.push((await readFile(path)).toString('utf8'))
	}
	return values.join('\n')
}

function structuralResultFields(result: ExecutionResultV1): unknown {
	return {
		kind: result.kind,
		schemaVersion: result.schemaVersion,
		runId: result.runId,
		scenarioId: result.scenarioId,
		status: result.status,
		category: result.category,
		reason: result.reason,
		targetMutation: result.targetMutation,
		startedAt: result.startedAt,
		durationMs: result.durationMs,
		driver: result.driver,
		policy: result.policy,
		usage: result.usage,
		steps: result.steps.map((step) =>
			step.status === 'not-run'
				? step
				: {
						id: step.id,
						status: step.status,
						category: step.category,
						reason: step.reason,
						turns: step.turns,
						durationMs: step.durationMs,
						usage: step.usage,
						toolCalls: step.toolCalls.map((call) => ({
							turn: call.turn,
							driverId: call.driverId,
							name: call.name,
							status: call.status,
						})),
					}
		),
		evidence: result.evidence,
		diagnostics: result.diagnostics.map((diagnostic) => ({ code: diagnostic.code, path: diagnostic.path })),
	}
}
