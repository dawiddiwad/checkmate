import assert from 'node:assert/strict'
import { mkdir, writeFile, readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { fixture } from './fixture.js'
import { sandbox, fixtureJson, root, write } from './support.js'
import { delegate, worker } from '../plugin/src/launcher.ts'
import { gate } from '../plugin/src/stages.ts'
import { readReference, readDocument } from '../plugin/src/files.ts'
import { schema } from '../plugin/src/contracts.ts'

assert(
	process.env.CLAUDE_CODE_OAUTH_TOKEN ||
		process.env.ANTHROPIC_API_KEY ||
		process.env.CHECKMATE_USE_HOST_LOGIN === '1',
	'Configure Claude authentication before live tests'
)
process.env.PATH = `${join(root, 'node_modules/.bin')}:${process.env.PATH}`
process.env.CLAUDE_CONFIG_DIR ??= '/tmp/checkmate-live-claude'
const workspace = await sandbox()
const app = await fixture()
const measurements = []
console.log(`Live artifacts: ${workspace}`)
const options = { allowedTools: ['Read', 'Write', 'Edit', 'Bash'], timeoutSeconds: 240 }
async function stage(name, request) {
	const path = `${name}.json`
	await write(workspace, path, request)
	const started = Date.now()
	const result = await delegate(workspace, path, options)
	measurements.push({ stage: name, durationMs: Date.now() - started, status: result.status })
	console.log(JSON.stringify(measurements.at(-1)))
	assert(result.artifact, JSON.stringify(result))
	assert(!['operational_error', 'interrupted', 'invalid_request'].includes(result.status), JSON.stringify(result))
	return { response: result, value: await readReference(workspace, result.artifact) }
}
try {
	await mkdir(join(workspace, '.playwright'), { recursive: true })
	await writeFile(
		join(workspace, '.playwright/cli.config.json'),
		JSON.stringify({
			browser: {
				browserName: 'chromium',
				launchOptions: {
					executablePath: process.env.CHECKMATE_BROWSER_EXECUTABLE ?? '/usr/bin/chromium',
					headless: true,
				},
			},
		})
	)
	await writeFile(
		join(workspace, 'AGENTS.md'),
		'# Fixture workspace\n\nUse the running fixture. Do not change its code. The browser config is `.playwright/cli.config.json`. Use one isolated session per run. Use `open --idle-timeout=30000`. The checkout button creates a 100 PLN order. The quote endpoint is GET /quote?promotion=true&loyalty=true. The health endpoint is GET /health. Read /health for setup. Do not use /order or /quote during setup or planning. The caller owns the fixture server. No record cleanup is required. Browser sessions must be closed.\n'
	)
	const setupRequest = {
		contractVersion: 'toolkit-1',
		requestId: 'live-setup',
		operation: 'setup',
		caller: 'acceptance-test',
		targetId: 'checkout-local',
		baseUrl: app.baseUrl,
		capabilities: ['browser', 'http'],
		allowedOperations: ['read_catalog', 'create_fixture_order', 'apply_fixture_discount'],
		profilePath: 'profile.json',
	}
	const configured = await stage('setup', setupRequest)
	assert.equal(configured.value.readyForLiveExecution, true)
	const planRequest = await fixtureJson('plan-request')
	planRequest.target = configured.response.artifact
	const planned = await stage('plan', planRequest)
	assert.equal(app.actions(), 0, 'Planning executed a test action')
	assert(planned.value.gaps.some((g) => g.requirementIds.includes('R2') && g.severity === 'blocking'))
	assert(planned.value.gaps.some((g) => g.requirementIds.includes('R3') && g.severity === 'blocking'))
	const selected = planned.value.tests.filter((t) => t.requirementIds.includes('R1')).map((t) => t.id)
	const initial = {
		contractVersion: 'toolkit-1',
		requestId: 'live-partial',
		operation: 'execute',
		caller: 'acceptance-test',
		runId: 'live-partial',
		plan: planned.response.artifact,
		target: configured.response.artifact,
		selectedTestIds: selected,
		partialExecution: 'wait_for_resolution',
		timeoutSeconds: 240,
		onNewBlocker: 'return_to_caller',
		applicationBuild: 'fixture-build-1',
		outputDirectory: 'runs/live-partial',
	}
	assert.equal((await gate(workspace, initial)).status, 'needs_decision')
	await stage('partial', { ...initial, partialExecution: 'ready_only' })
	const templates = await fixtureJson('decisions')
	const decisions = planned.value.gaps
		.filter((gap) => gap.status === 'open' && gap.severity === 'blocking')
		.map((gap, i) => {
			assert(
				gap.requirementIds.length === 1 && ['R2', 'R3'].includes(gap.requirementIds[0]),
				'Unexpected blocker needs a caller decision'
			)
			const decision = templates[gap.requirementIds[0] === 'R2' ? 0 : 1]
			return { ...decision, id: `D${i + 1}`, gapId: gap.id }
		})
	const revised = await stage('revise', {
		contractVersion: 'toolkit-1',
		requestId: 'live-revise',
		operation: 'revise',
		caller: 'acceptance-test',
		basePlan: planned.response.artifact,
		baseRevision: 1,
		decisions,
	})
	const ready = revised.value.tests.filter((t) => t.readiness === 'ready').map((t) => t.id)
	const execute = {
		...initial,
		requestId: 'live-execute',
		runId: 'live-run',
		outputDirectory: 'runs/live-run',
		plan: revised.response.artifact,
		selectedTestIds: ready,
	}
	const failed = await stage('execute', execute)
	assert(failed.value.findings.some((f) => f.type === 'defect' && f.requirementIds.includes('R2')))
	assert.equal(failed.value.coverage.status, 'partial')
	app.fix()
	const retest = await stage('retest', {
		...execute,
		requestId: 'live-retest',
		runId: 'live-retest',
		outputDirectory: 'runs/live-retest',
		applicationBuild: 'fixture-build-2',
		retestOf: failed.response.artifact,
		selectedTestIds: revised.value.tests.filter((t) => t.requirementIds.includes('R2')).map((t) => t.id),
	})
	assert(
		retest.value.tests
			.filter((t) => retest.value.selectedTestIds.includes(t.testId))
			.every((t) => t.outcome === 'passed')
	)
	assert.equal(retest.value.coverage.status, 'partial')
	assert((await readReference(workspace, failed.response.artifact)).findings.some((f) => f.type === 'defect'))
	const sameRequest = {
		...planRequest,
		requestId: 'same-session-plan',
		outputPlanId: 'same-session',
		planDirectory: 'plans/same-session',
	}
	await write(workspace, 'same-session.json', sameRequest)
	const same = await worker(
		'claude',
		[
			'-p',
			'--plugin-dir',
			join(root, 'plugin'),
			'--output-format',
			'json',
			'--json-schema',
			JSON.stringify(schema('response')),
			'--permission-prompts',
			'none',
			'--allowedTools',
			'Read,Write,Edit,Bash',
			'--no-session-persistence',
		],
		{
			cwd: workspace,
			timeoutSeconds: 240,
			prompt: 'Use checkmate:plan in this session with same-session.json. This is not a delegated candidate task. Publish the plan with the Checkmate CLI and return its response. Do not execute tests.',
		}
	)
	assert.equal((await readReference(workspace, same.artifact)).revision, 1)
	await readDocument(workspace, 'plans/same-session/v1.json')
	assert((await readFile(join(workspace, 'runs/live-run/report.html'), 'utf8')).includes('Test result'))
	console.log(
		'Live acceptance passed: setup, gaps, partial execution, revision, defect, retest, and same-session planning.'
	)
} finally {
	await app.close()
	await writeFile(join(workspace, 'measurements.json'), JSON.stringify(measurements, null, 2) + '\n')
}
