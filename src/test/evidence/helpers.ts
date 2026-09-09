import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { resolve } from 'node:path'
import type {
	DriverDescriptorV1,
	EvidencePolicyV1,
	ExecutedStepResult,
	ExecutionResultV1,
	RunRequestV1,
} from '../../contracts/types.js'
import { allocateRunIdentity } from '../../evidence/layout.js'
import { EvidenceStore, type EvidenceStoreOptions } from '../../evidence/store.js'

export const request: RunRequestV1 = {
	schemaVersion: 1,
	scenario: {
		id: 'checkout/promo',
		driver: { id: 'fixture', target: { endpoint: 'https://example.test' } },
		policy: 'ci',
		steps: [
			{ id: 'open-cart', action: 'Open the cart', expect: 'The cart is visible' },
			{ id: 'apply-promo', action: 'Apply a promotion', expect: 'The total is reduced' },
		],
	},
}

export const descriptor: DriverDescriptorV1 = {
	schemaVersion: 1,
	id: 'fixture',
	driverContractVersion: 1,
	targetSchema: { type: 'object' },
	settingsSchema: { type: 'object' },
	requiredSecretSlots: [],
	tools: [{ name: 'fixture_read' }],
	evidenceKinds: [
		{ kind: 'aria-snapshot', mediaType: 'application/yaml', content: 'text' },
		{ kind: 'structured-json', mediaType: 'application/json', content: 'text' },
		{ kind: 'screenshot', mediaType: 'image/png', content: 'opaque' },
	],
}

export const defaultPolicy: EvidencePolicyV1 = {
	retention: 'retain-on-failure',
	redaction: 'on',
	allowOpaque: false,
}

export async function temporaryRoot(): Promise<{ root: string; cleanup(): Promise<void> }> {
	const root = await mkdtemp(resolve(tmpdir(), 'checkmate-evidence-'))
	return { root, cleanup: () => rm(root, { recursive: true, force: true }) }
}

export async function createStore(
	root: string,
	overrides: Partial<Omit<EvidenceStoreOptions, 'invocationRoot' | 'identity' | 'stepIds' | 'driverDescriptor'>> = {}
): Promise<EvidenceStore> {
	const identity = await allocateRunIdentity({
		invocationRoot: root,
		outputDirectory: resolve(root, '.checkmate/runs'),
		scenarioId: request.scenario.id,
	})
	return new EvidenceStore({
		invocationRoot: root,
		identity,
		policy: defaultPolicy,
		stepIds: request.scenario.steps.map((step) => step.id),
		driverDescriptor: descriptor,
		...overrides,
	})
}

export function executionResult(overrides: Partial<ExecutionResultV1> = {}): ExecutionResultV1 {
	return {
		kind: 'run-result',
		schemaVersion: 1,
		runId: '0123456789abcdef',
		scenarioId: request.scenario.id,
		status: 'passed',
		category: 'passed',
		reason: 'scenario-complete',
		targetMutation: 'possibly-mutated',
		startedAt: '2026-09-05T12:00:00.000Z',
		durationMs: 100,
		driver: { id: 'fixture', contractVersion: 1 },
		policy: {
			id: 'ci',
			effectiveLimits: {
				scenarioTimeoutMs: 1_000,
				stepTimeoutMs: 500,
				turnsPerStep: 3,
				requestTimeoutMs: 100,
				maxRetries: 0,
				loopMaxRepetitions: 2,
				cleanupTimeoutMs: 100,
			},
		},
		usage: {
			promptTokens: 1,
			cachedPromptTokens: 0,
			completionTokens: 1,
			totalTokens: 2,
			state: 'complete',
		},
		steps: [
			{
				id: 'open-cart',
				status: 'passed',
				category: 'app',
				reason: 'met-expectation',
				actual: 'The cart is visible',
				turns: 1,
				durationMs: 100,
				usage: { promptTokens: 1, cachedPromptTokens: 0, completionTokens: 1, totalTokens: 2 },
				toolCalls: [],
			},
			{ id: 'apply-promo', status: 'not-run', reason: 'prior-step-failed', blockedBy: 'open-cart' },
		],
		evidence: { state: 'complete', references: [] },
		diagnostics: [],
		...overrides,
	}
}

export function executedStep(overrides: Partial<ExecutedStepResult> = {}): ExecutedStepResult {
	return {
		id: 'open-cart',
		status: 'passed',
		category: 'app',
		reason: 'met-expectation',
		actual: 'The cart is visible',
		turns: 1,
		durationMs: 100,
		usage: { promptTokens: 1, cachedPromptTokens: 0, completionTokens: 1, totalTokens: 2 },
		toolCalls: [],
		...overrides,
	}
}
